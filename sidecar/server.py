"""Spatial Canvas yerel çıkarım yardımcısı (sidecar).

Web uygulaması (src/engine/sidecarClient.ts) bu sunucuyu http://127.0.0.1:8765
adresinde arar. Bulursa ağır modelleri kullanıcının GPU'sunda koşturur; bulamazsa
ya da bir istek hata verirse sayfa boyu tarayıcı yoluna düşer.

Protokol (ham float32, JSON/base64 yok):
  GET  /health                    -> {"ok": true, "arkaUc": "<EP>", "modeller": [...]}
  POST /infer/depth?model=small   girdi [1,3,H,W] (V2 işlemcisi)  -> [1,H,W] disparite
  POST /infer/depth?model=da3     girdi [1,3,H,W] (V2 işlemcisi)  -> [1,2,H,W] derinlik+gökyüzü
  POST /infer/mask                girdi [1,3,1024,1024] ImageNet   -> [1,1,1024,1024] olasılık
  POST /infer/depth?model=moge    girdi [1,3,518,518] RGB [0,1]    -> [1,5,518,518] nokta+maske+ölçek
  POST /infer/depth?model=david-mask girdi [1,3,512,512] BGR [0,1] -> [1,1,512,512] DAViD ön plan
  Başlıklar: X-Dims (virgüllü boyutlar), X-Frame-Id (yanıtta aynen döner).
  409: daha yeni bir 'small' karesi geldiği için bu kare atıldı.

Ölçüldü (2026-10-10, RTX 5070 Laptop, DirectML):
  small 32 ms · da3 ~0,25 sn (CPU 14,4 sn) · mask (CPU) ~7 sn, yük altında daha uzun
  BiRefNet bilerek CPU'da: DirectML'de VRAM'i doldurup DA3'ü 40 kat yavaşlatıyordu.
DA3 DirectML'de yalnız SABİT boyutla koşuyor (dinamik Reshape hatası), bu yüzden
518x518'e sabitlenir; farklı girdi önce 518'e, çıktı geri örneklenir.
TEK GPU THREAD'İ: DirectML oturumunu oturumu kuran thread dışından çalıştırmak her
çağrıda ~10 sn ekliyor (ölçüldü: aynı thread 275 ms, yeni thread 10,2 sn). Bu yüzden
oturumlar da, tüm çıkarımlar da tek bir kalıcı işçi thread'inde koşar.

Çalıştırma:  sidecar\\.venv\\Scripts\\python sidecar\\server.py [--origin https://site]
Kurulum:     sidecar\\hazirla.py (bağımlılıklar + modeller)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import onnxruntime as ort
from PIL import Image

DA3_SIZE = 518
MASK_SIZE = 1024
# Kötüye kullanım/bellek koruması: en büyük kabul edilen girdi (float sayısı).
MAX_FLOATS = 3 * 2048 * 2048

MODEL_FILES = {
    'small': 'da2_small_fp16.onnx',
    'da3': 'da3mono_large.onnx',
    'mask': 'birefnet_lite_fp16_tree.onnx',
}
# İsteğe bağlı (hazirla.py --moge); yoksa /health listelemez, sunucu yine açılır.
MOGE_FILE = 'moge-2-vitl-normal.onnx'
# İsteğe bağlı DAViD (Microsoft, MIT) yumuşak ön plan maskesi, ViT-B FP32. Giriş 512x512 BGR [0,1]
# (model kartı). Yalnız maske: kullanıcı kararı (2026-10-24) DAViD maskesi daha iyi, DAViD derinliği
# değil (`?derinlik=david` tarayıcıda kalır). Dosya yoksa ya da oturum kurulamazsa listelenmez.
DAVID_SIZE = 512
DAVID_MASK_FILE = 'foreground-segmentation-model-vitb16_384.onnx'

# Varsayılan izinli origin'ler: yalnız yerel geliştirme (her port — yerelde çalışan
# başka bir geliştirme sunucusunun sayfası da GPU uç noktalarını kullanabilir; yalnız
# senin makinende çalışan sayfalar). Yayındaki site --origin ile eklenir.
LOCAL_ORIGIN = re.compile(r'^http://(localhost|127\.0\.0\.1)(:\d+)?$')


def error_message(error: Exception) -> str:
    """ORT yerel kodlamalı hatayı UTF-8 sanırsa asıl hata baytlarını da koru."""
    if isinstance(error, UnicodeDecodeError):
        detail = error.object.decode(error.encoding, errors='replace')
    else:
        try:
            detail = str(error)
        except Exception:
            detail = repr(error)
    return f'{type(error).__name__}: {detail}'


def guc_kisitlamasini_kapat():
    """Windows'un arka plan süreçlere uyguladığı güç kısıtlamasından (EcoQoS) çık.

    Ölçüldü (2026-10-10): sunucu bağımsız/arka plan süreç olarak başlatılınca DA3
    istek başına ~10 sn sürüyordu; aynı kod ön plandaki bir sürecin altında 0,36 sn.
    DirectML binlerce op'u CPU'dan gönderir; verimlilik moduna alınan süreçte bu
    gönderim 30 kat yavaşlar.
    """
    if sys.platform != 'win32':
        return
    import ctypes
    from ctypes import wintypes

    class PowerThrottling(ctypes.Structure):
        _fields_ = [('Version', wintypes.ULONG), ('ControlMask', wintypes.ULONG), ('StateMask', wintypes.ULONG)]

    process_power_throttling = 4  # PROCESS_INFORMATION_CLASS.ProcessPowerThrottling
    execution_speed = 0x1         # PROCESS_POWER_THROTTLING_EXECUTION_SPEED
    state = PowerThrottling(1, execution_speed, 0)  # denetle, ama KAPALI tut
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    # Tipler AÇIK tanımlanmalı: tanımsızken GetCurrentProcess'in 64-bit sözde tutamağı (-1)
    # 32-bit int'e kırpılıyor ve çağrılar sessizce başarısız oluyordu (ölçüldü: öncelik
    # "Normal" kaldı, Vite'ın başlattığı yardımcıda DA3 10–15 sn/istek).
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.SetProcessInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel32.SetProcessInformation.restype = wintypes.BOOL
    kernel32.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.SetPriorityClass.restype = wintypes.BOOL
    surec = kernel32.GetCurrentProcess()
    if not kernel32.SetProcessInformation(surec, process_power_throttling, ctypes.byref(state), ctypes.sizeof(state)):
        print(f'uyarı: güç kısıtlaması kapatılamadı (hata {ctypes.get_last_error()})', flush=True)
    above_normal = 0x8000
    if not kernel32.SetPriorityClass(surec, above_normal):
        print(f'uyarı: öncelik yükseltilemedi (hata {ctypes.get_last_error()})', flush=True)


def ebeveyni_izle(pid: int):
    """Ebeveyn süreç (Vite) biterse kendini kapat.

    Vite yardımcıyı konsoldan AYRIK başlatır (arka plandaki terminal penceresinin süreç
    ağacı Windows'ta kısılıyor: ölçüldü 12–14 sn/istek, ayrık 0,26 sn). Ayrık süreç
    Ctrl-C'yi almadığı için yetim kalmasın diye ebeveyni 2 sn'de bir yoklar.
    """
    def bekci():
        if sys.platform == 'win32':
            import ctypes
            from ctypes import wintypes
            k = ctypes.WinDLL('kernel32', use_last_error=True)
            k.OpenProcess.restype = wintypes.HANDLE
            k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            k.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            synchronize = 0x00100000
            h = k.OpenProcess(synchronize, False, pid)
            if not h:
                os._exit(0)  # ebeveyn zaten yok
            k.WaitForSingleObject(h, 0xFFFFFFFF)  # ebeveyn bitene kadar bekle
        else:
            while True:
                time.sleep(2)
                if os.getppid() != pid:
                    break
        print('ebeveyn süreç bitti, yardımcı kapanıyor', flush=True)
        os._exit(0)
    threading.Thread(target=bekci, name='ebeveyn-bekcisi', daemon=True).start()


def pick_providers() -> list[str]:
    available = ort.get_available_providers()
    for ep in ('CUDAExecutionProvider', 'DmlExecutionProvider'):
        if ep in available:
            return [ep, 'CPUExecutionProvider']
    return ['CPUExecutionProvider']


def session(path: Path, providers: list[str], fixed: dict[str, int] | None = None) -> ort.InferenceSession:
    so = ort.SessionOptions()
    so.log_severity_level = 3
    # ORT_ENABLE_ALL, DirectML'de fp16 V2'nin LayerNorm füzyonunu bozuyor
    # ("InsertedPrecisionFreeCast ... does not exist"); BASIC hem koşuyor hem BiRefNet'te daha hızlı.
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    # ORT belgesi: DirectML bellek deseni ve paralel yürütmeyi desteklemez. Açık
    # bırakılınca istek sayısıyla GPU belleği şişti (ölçüldü: 7,1 GB / 8 GB, istek
    # başına 0,25 sn → 14 sn; bellek sistem RAM'ine taşınca).
    so.enable_mem_pattern = False
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    for name, value in (fixed or {}).items():
        so.add_free_dimension_override_by_name(name, value)
    # Füzyonlar ayrıca kapatılır: BASIC seviyesinde de LayerNorm füzyonu çalışabiliyor.
    return ort.InferenceSession(str(path), so, providers=providers,
                                disabled_optimizers=['SimplifiedLayerNormFusion', 'LayerNormFusion'])


def resize_plane(plane: np.ndarray, w: int, h: int) -> np.ndarray:
    return np.asarray(Image.fromarray(plane.astype(np.float32), mode='F').resize((w, h), Image.BILINEAR), np.float32)


class Models:
    moge = None  # İsteğe bağlı büyük model ilk MoGe fotoğrafında kurulur.
    moge_hata: str | None = None  # Oturum kurulamazsa bir kez yazılır; /health artık 'moge' listelemez.
    david = None  # DAViD maske oturumu; yalnız kurulup ısındıysa /health 'david-mask' listeler.

    def __init__(self, model_dir: Path, providers: list[str], david: bool = True):
        self.model_dir = model_dir
        self.providers = providers
        missing = [f for f in MODEL_FILES.values() if not (model_dir / f).exists()]
        if missing:
            raise SystemExit(f'eksik model dosyaları ({model_dir}): {missing}. Önce: python sidecar/hazirla.py')
        t = time.perf_counter()
        self.small = session(model_dir / MODEL_FILES['small'], providers)
        self.da3 = session(model_dir / MODEL_FILES['da3'], providers,
                           {'num_views': 1, 'height': DA3_SIZE, 'width': DA3_SIZE})
        # BiRefNet CPU'da: DirectML'de 1024² etkinlikleri ~4,4 GB VRAM ekliyor; DA3 ile
        # toplam 7,2/8 GB olunca DA3 0,25 sn'den 11,6 sn'ye çıkıyor ve sonunda bellek
        # hatasıyla düşüyordu (ölçüldü 2026-10-10). CPU'da VRAM sabit ~3 GB, maske ~7 sn.
        self.mask = session(model_dir / MODEL_FILES['mask'], ['CPUExecutionProvider'])
        # Isınma: ilk çağrı kabukları derler (DA3 ~3,8 sn); ilk kullanıcı isteği beklemesin.
        self.run_small(np.zeros((1, 3, DA3_SIZE, DA3_SIZE), np.float32))
        self.run_da3(np.zeros((1, 3, DA3_SIZE, DA3_SIZE), np.float32))
        self.run_mask(np.zeros((1, 3, MASK_SIZE, MASK_SIZE), np.float32))
        if david:
            self.david_kur()
        print(f'modeller yüklendi ve ısındı ({time.perf_counter() - t:.1f} sn) · {providers[0]}', flush=True)
        self.small_seq = 0
        self.debug = False
        self.seq_lock = threading.Lock()

    def run_small(self, x: np.ndarray) -> np.ndarray:
        out = self.small.run(None, {'pixel_values': x})[0]
        return out.reshape(1, x.shape[2], x.shape[3])

    def run_da3(self, x: np.ndarray) -> np.ndarray:
        _, _, h, w = x.shape
        if (h, w) != (DA3_SIZE, DA3_SIZE):
            x = np.stack([resize_plane(x[0, c], DA3_SIZE, DA3_SIZE) for c in range(3)])[None]
        ext = np.eye(4, dtype=np.float32)[None, None]
        k = np.array([[DA3_SIZE, 0, DA3_SIZE / 2], [0, DA3_SIZE, DA3_SIZE / 2], [0, 0, 1]], np.float32)[None, None]
        depth, sky = self.da3.run(['depth', 'sky'], {'image': x[:, None], 'extrinsics_in': ext, 'intrinsics_in': k})
        depth, sky = depth.reshape(DA3_SIZE, DA3_SIZE), sky.reshape(DA3_SIZE, DA3_SIZE)
        if (h, w) != (DA3_SIZE, DA3_SIZE):
            depth, sky = resize_plane(depth, w, h), resize_plane(sky, w, h)
        return np.stack([depth, sky])[None]

    def run_mask(self, x: np.ndarray) -> np.ndarray:
        logits = self.mask.run(None, {'input_image': x})[-1]
        return (1 / (1 + np.exp(-logits))).astype(np.float32).reshape(1, 1, MASK_SIZE, MASK_SIZE)

    def available(self) -> list[str]:
        return (list(MODEL_FILES) + (['moge'] if (self.model_dir / MOGE_FILE).exists() and not self.moge_hata else [])
                + (['david-mask'] if self.david else []))

    def david_kur(self):
        """DAViD maske oturumu açılışta (GPU thread'inde) kurulur ve ısıtılır; hata yardımcıyı düşürmez.

        Tembel değil: istemci fotoğraf maskesini /health listesine bakarak varsayılan açar, liste
        "gerçekten koşuyor" demeli. Ölçüldü (2026-10-24, RTX 5070 Laptop 8 GB, tek ViT-B model):
        ~1,1 GB adanmış + ~0,45 GB paylaşılan GPU belleği, ~40 ms sıcak (DML çıktısı CPU ile 2e-4
        içinde). Çekirdek (small+DA3) ~2,8 GB adanmış → toplam ~3,9 GB. GPU başka işle doluyken
        DirectML paylaşılan belleğe taşar ve süre saniyelere çıkar; dar VRAM'de --davidsiz.
        """
        if not (self.model_dir / DAVID_MASK_FILE).exists():
            return
        try:
            oturum = session(self.model_dir / DAVID_MASK_FILE, self.providers, {'batch_size': 1})
            oturum.run(None, {'input': np.zeros((1, 3, DAVID_SIZE, DAVID_SIZE), np.float32)})
            self.david = oturum
        except Exception as e:
            self.david = None
            print(f'DAViD maske oturumu kurulamadı, devre dışı: {error_message(e)}', flush=True)

    def run_david_mask(self, x: np.ndarray) -> np.ndarray:
        """[1,3,512,512] BGR [0,1] -> [1,1,512,512] ön plan olasılığı (0..1)."""
        if x.shape != (1, 3, DAVID_SIZE, DAVID_SIZE) or not np.isfinite(x).all() or x.min() < 0 or x.max() > 1:
            raise ValueError('DAViD expects BGR [1,3,512,512] in [0,1]')
        if not self.david:
            raise RuntimeError('DAViD kullanılamıyor')
        maske = self.david.run(None, {'input': x})[0]
        if maske.shape != (1, 1, DAVID_SIZE, DAVID_SIZE):
            raise ValueError('Unexpected DAViD mask shape')
        return np.clip(maske, 0, 1).astype(np.float32)

    def run_moge(self, x: np.ndarray) -> np.ndarray:
        if x.shape != (1, 3, DA3_SIZE, DA3_SIZE) or not np.isfinite(x).all() or x.min() < 0 or x.max() > 1:
            raise ValueError('MoGe expects RGB [1,3,518,518] in [0,1]')
        if self.moge_hata:
            raise RuntimeError(f'MoGe kullanılamıyor: {self.moge_hata}')
        if self.moge is None:
            # Resmi FP32 grafı: FP16 dönüşümü DirectML'de nokta haritasını %8 (göreli L2),
            # metrik ölçeği %9 kaydırdı; FP32 DML çıktısı CPU ile 1e-6 içinde (moge-photo.md).
            try:
                self.moge = session(self.model_dir / MOGE_FILE, self.providers,
                                    {'batch_size': 1, 'height': DA3_SIZE, 'width': DA3_SIZE})
            except Exception as e:
                self.moge_hata = error_message(e)
                print(f'MoGe oturumu kurulamadı, devre dışı: {self.moge_hata}', flush=True)
                raise
        # ViT-S scale, ViT-L metric_scale yayımlar; sabit aktarım token girdisi istemez.
        scale_name = 'metric_scale' if 'metric_scale' in {v.name for v in self.moge.get_outputs()} else 'scale'
        feeds = {'image': x}
        if 'num_tokens' in {v.name for v in self.moge.get_inputs()}:
            feeds['num_tokens'] = np.array(1800, dtype=np.int64)
        points, mask, scale = self.moge.run(['points', 'mask', scale_name], feeds)
        if points.shape != (1, DA3_SIZE, DA3_SIZE, 3) or mask.shape != (1, DA3_SIZE, DA3_SIZE):
            raise ValueError('Unexpected MoGe point-map or mask shape')
        scale_value = float(scale.reshape(-1)[0])
        if not np.isfinite(scale_value) or scale_value <= 0:
            raise ValueError('Invalid MoGe metric scale')
        return np.concatenate([points.transpose(0, 3, 1, 2), mask[:, None],
            np.full((1, 1, DA3_SIZE, DA3_SIZE), scale_value, dtype=np.float32)], axis=1)


def make_handler(models: Models, gpu: ThreadPoolExecutor, extra_origins: set[str]):
    # Aynı anda en fazla bu kadar POST gövdesi bellekte (bellek tavanı ~8 × 48 MB).
    ucusta = threading.BoundedSemaphore(8)
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, fmt, *args):  # sessiz: kare başına log istemiyoruz
            pass

        def origin_ok(self) -> str | None:
            origin = self.headers.get('Origin')
            if origin is None:
                return None  # tarayıcı dışı istemci (test betiği): CORS başlığı gerekmez
            return origin if (LOCAL_ORIGIN.match(origin) or origin in extra_origins) else ''

        def cors(self, origin: str | None):
            if origin:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Expose-Headers', 'X-Dims, X-Frame-Id')

        def reply(self, status: int, body: bytes = b'', ctype='application/json', extra: dict | None = None):
            origin = self.origin_ok()
            self.send_response(status)
            self.cors(origin)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            origin = self.origin_ok()
            if origin == '':
                self.send_response(403)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            self.send_response(204)
            self.cors(origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Dims, X-Frame-Id')
            # Chrome yerel ağ erişimi: yayındaki https sayfasından 127.0.0.1'e istek için şart.
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_GET(self):
            if self.origin_ok() == '':
                return self.reply(403, b'{"ok":false}')
            if urlparse(self.path).path == '/health':
                body = json.dumps({'ok': True, 'arkaUc': models.providers[0], 'modeller': models.available()})
                return self.reply(200, body.encode())
            self.reply(404, b'{"ok":false}')

        def do_POST(self):
            # İzinsiz origin ve sınırı aşan gövde OKUNMADAN reddedilir, bağlantı kapatılır
            # (ön istek gerektirmeyen text/plain POST ile başka bir site sunucuya 48 MB
            # tamponlatamasın). Diğer hatalarda gövde önce okunur: okunmadan yanıt verilirse
            # istemci hâlâ yazarken bağlantı kopar (WinError 10053) ve 400 yerine ağ hatası görür.
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = -1
            if self.origin_ok() == '' or not 0 <= length <= MAX_FLOATS * 4:
                self.close_connection = True
                code = 403 if self.origin_ok() == '' else 413
                return self.reply(code, b'{"ok":false}', extra={'Connection': 'close'})
            if not ucusta.acquire(blocking=False):
                self.close_connection = True
                return self.reply(503, b'{"ok":false}', extra={'Connection': 'close'})
            try:
                body = self.rfile.read(length)
                self.isle(body)
            finally:
                ucusta.release()

        def isle(self, body: bytes):
            url = urlparse(self.path)
            if url.path == '/infer/mask':
                model = 'mask'
            elif url.path == '/infer/depth':
                model = (parse_qs(url.query).get('model') or [''])[0]
            else:
                return self.reply(404, b'{"ok":false}')
            if model not in models.available():
                return self.reply(400, json.dumps({'ok': False, 'hata': f'model yok: {model}'}).encode())
            try:
                dims = [int(d) for d in self.headers.get('X-Dims', '').split(',')]
                n = int(np.prod(dims))
                if len(dims) != 4 or dims[0] != 1 or dims[1] != 3 or min(dims) < 1 or len(body) != n * 4:
                    raise ValueError(f'geçersiz girdi: dims={dims} bayt={len(body)}')
                if model == 'mask' and dims[2:] != [MASK_SIZE, MASK_SIZE]:
                    raise ValueError('mask girdisi 1024x1024 olmalı')
                if model == 'moge' and dims[2:] != [DA3_SIZE, DA3_SIZE]:
                    raise ValueError('MoGe girdisi 518x518 olmalı')
                if model == 'david-mask' and dims[2:] != [DAVID_SIZE, DAVID_SIZE]:
                    raise ValueError('DAViD girdisi 512x512 olmalı')
                x = np.frombuffer(body, dtype=np.float32).reshape(dims)
            except ValueError as e:
                return self.reply(400, json.dumps({'ok': False, 'hata': str(e)}).encode())
            frame = self.headers.get('X-Frame-Id', '')

            mine = 0
            if model == 'small':
                with models.seq_lock:
                    models.small_seq += 1
                    mine = models.small_seq
            def job():
                # En yeni 'small' kazanır: bu kare sıradayken daha yenisi geldiyse atla.
                if model == 'small' and mine != models.small_seq:
                    return None
                t = time.perf_counter()
                out = {'small': models.run_small, 'da3': models.run_da3, 'mask': models.run_mask,
                       'moge': models.run_moge, 'david-mask': models.run_david_mask}[model](x)
                if models.debug:
                    print(f'{model} {x.shape[2]}x{x.shape[3]} {1000 * (time.perf_counter() - t):.0f} ms '
                          f'thread={threading.current_thread().name}', flush=True)
                return out

            try:
                out = gpu.submit(job).result()
            except Exception as e:  # GPU/oturum hatası: istemci tarayıcıya düşer
                message = error_message(e)
                # Yönlendirilmiş Windows konsolunda log kodlaması HTTP yanıtını engellemesin.
                try:
                    print(f'{model} inference failed: {ascii(message)}', flush=True)
                    traceback.print_exc()
                except (OSError, UnicodeError):
                    pass
                return self.reply(500, json.dumps({'ok': False, 'hata': message}).encode('utf-8'))
            if out is None:
                return self.reply(409, b'{"ok":false}', extra={'X-Frame-Id': frame})
            out = np.ascontiguousarray(out, dtype=np.float32)
            if not np.isfinite(out).all():
                return self.reply(500, b'{"ok":false,"hata":"sonlu olmayan cikti"}')
            self.reply(200, out.tobytes(), 'application/octet-stream',
                       {'X-Dims': ','.join(map(str, out.shape)), 'X-Frame-Id': frame})

    return Handler


def main(argv=None):
    ap = argparse.ArgumentParser(description='Spatial Canvas yerel çıkarım yardımcısı')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--models', type=Path, default=Path(__file__).parent / 'models')
    ap.add_argument('--origin', action='append', default=[], help='izinli ek origin (yayındaki site), tekrarlanabilir')
    ap.add_argument('--debug', action='store_true', help='istek başına model süresini yazdır')
    ap.add_argument('--ebeveyn', type=int, default=0, help='bu PID biterse kapan (Vite eklentisi verir)')
    ap.add_argument('--davidsiz', action='store_true',
                    help='DAViD maskesi yüklenmez (~1,1 GB VRAM); istemci fotoğrafta eski maskeye döner')
    args = ap.parse_args(argv)
    guc_kisitlamasini_kapat()
    if args.ebeveyn:
        ebeveyni_izle(args.ebeveyn)
    # Port modelleri yüklemeden ÖNCE alınır: başka bir örnek çalışıyorsa (ör. iki dev
    # sunucusu) 1,3 GB'ı boşuna GPU'ya yükleyip sonra düşmek yerine hemen çık.
    try:
        srv = ThreadingHTTPServer((args.host, args.port), BaseHTTPRequestHandler)
    except OSError as e:
        print(f'port {args.port} kullanımda, başka bir yardımcı çalışıyor olabilir: {e}', flush=True)
        return 3
    gpu = ThreadPoolExecutor(max_workers=1, thread_name_prefix='gpu')
    models = gpu.submit(Models, args.models, pick_providers(), not args.davidsiz).result()
    models.debug = args.debug
    srv.RequestHandlerClass = make_handler(models, gpu, set(args.origin))
    print(f'dinleniyor: http://{args.host}:{srv.server_port}', flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
