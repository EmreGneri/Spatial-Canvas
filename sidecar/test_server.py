"""Sidecar uçtan uca testi: sunucuyu boş bir portta başlatır, gerçek fotoğrafla
her modeli çağırır. Çalıştırma:  sidecar\\.venv\\Scripts\\python sidecar\\test_server.py [--models DİZİN]
(ek argümanlar sunucuya aynen geçer; ör. worktree'de ana checkout'un model dizini)
"""

import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PHOTO = ROOT / 'assets' / 'thumbnail.jpg'  # repoda izlenen tek fotoğraf
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def tensor(w, h, photo=PHOTO):
    a = np.asarray(Image.open(photo).convert('RGB').resize((w, h), Image.BICUBIC), np.float32) / 255
    return np.ascontiguousarray(((a - MEAN) / STD).transpose(2, 0, 1)[None], np.float32)


def post(base, path, x, frame='1', origin=None):
    req = urllib.request.Request(base + path, data=x.tobytes(), method='POST', headers={
        'Content-Type': 'application/octet-stream', 'X-Dims': ','.join(map(str, x.shape)), 'X-Frame-Id': frame,
        **({'Origin': origin} if origin else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            dims = [int(d) for d in r.headers['X-Dims'].split(',')]
            return r.status, np.frombuffer(r.read(), np.float32).reshape(dims), r.headers
    except urllib.error.HTTPError as e:
        return e.code, None, e.headers
    except (ConnectionAbortedError, ConnectionResetError, urllib.error.URLError):
        # Sunucu izinsiz origin'i gövdeyi OKUMADAN reddedip bağlantıyı kapatır;
        # istemci yazmayı bitirmeden kapanırsa 403 yerine bağlantı hatası görür.
        return 'kesildi', None, {}


def main():
    proc = subprocess.Popen([sys.executable, str(Path(__file__).parent / 'server.py'), '--port', '0',
                             '--origin', 'https://ornek.app', *sys.argv[1:]],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
    try:
        base = None
        for line in proc.stdout:
            print('  sunucu:', line.rstrip())
            if line.startswith('dinleniyor:'):
                base = line.split()[1]
                break
        assert base, 'sunucu başlamadı'
        threading.Thread(target=lambda: [None for _ in proc.stdout], daemon=True).start()

        with urllib.request.urlopen(base + '/health', timeout=5) as r:
            h = json.load(r)
        assert h['ok'] is True and h['arkaUc'] in ('DmlExecutionProvider', 'CUDAExecutionProvider', 'CPUExecutionProvider'), h
        print('OK health', h)

        # small: [1,H,W], sonlu
        s, y, hd = post(base, '/infer/depth?model=small', tensor(518, 392), frame='7')
        assert s == 200 and y.shape == (1, 392, 518) and np.isfinite(y).all(), (s, None if y is None else y.shape)
        assert hd['X-Frame-Id'] == '7'
        print('OK small', y.shape)

        # da3: [1,2,H,W]; 518 dışı boyut da kabul edilir (geri örneklenir); derinlik pozitif
        for w, hgt in ((518, 518), (518, 392)):
            s, y, _ = post(base, '/infer/depth?model=da3', tensor(w, hgt))
            assert s == 200 and y.shape == (1, 2, hgt, w), (s, None if y is None else y.shape)
            # gökyüzü kanalı olasılık değil, ~0..1 skor (açık gökyüzünde 1,09 ölçüldü); istemci 0,5 eşiği kullanır
            assert (y[0, 0] > 0).all() and y[0, 1].min() >= 0
        print('OK da3', y.shape)

        # Hız: istek başına süre. Tek GPU thread'i olmadan DirectML her yeni thread'de
        # ~10 sn ekliyordu (bağlantı başına thread) — bu eşik o hatayı yakalar.
        t = time.perf_counter()
        for _ in range(3):
            assert post(base, '/infer/depth?model=da3', tensor(518, 518))[0] == 200
        per = (time.perf_counter() - t) / 3
        assert per < 3.0, f'da3 isteği {per:.1f} sn'
        print(f'OK da3 hız ({per * 1000:.0f} ms/istek)')

        # da3 polarite (yerel test fotoğrafı varsa): öne uzanan kol arkadaki kapıdan YAKIN = küçük derinlik
        ozum = ROOT / 'assets' / 'özüm.jpg'
        if ozum.exists():
            s, y, _ = post(base, '/infer/depth?model=da3', tensor(518, 518, ozum))
            d = y[0, 0]
            arm, door = d[430:510, 40:200].mean(), d[25:100, 10:75].mean()
            assert arm < door, (arm, door)
            print(f'OK da3 polarite (kol {arm:.3f} < kapı {door:.3f})')

        # mask: [1,1,1024,1024] olasılık; ön plan makul oranda
        s, y, _ = post(base, '/infer/mask', tensor(1024, 1024))
        assert s == 200 and y.shape == (1, 1, 1024, 1024) and 0 <= y.min() and y.max() <= 1
        fg = float((y > .5).mean())
        assert 0.02 < fg < 0.95, fg
        print(f'OK mask (ön plan %{fg * 100:.1f})')

        # david-mask (isteğe bağlı, listeleniyorsa): BGR [0,1] 512² -> ön plan olasılığı
        if 'david-mask' in h['modeller']:
            a = np.asarray(Image.open(PHOTO).convert('RGB').resize((512, 512), Image.BICUBIC), np.float32) / 255
            x = np.ascontiguousarray(a[..., ::-1].transpose(2, 0, 1)[None], np.float32)
            s, y, _ = post(base, '/infer/depth?model=david-mask', x)
            assert s == 200 and y.shape == (1, 1, 512, 512), (s, None if y is None else y.shape)
            fg = float((y > .5).mean())
            assert 0 <= y.min() and y.max() <= 1 and 0.02 < fg < 0.95, fg
            assert post(base, '/infer/depth?model=david-mask', tensor(518, 518))[0] == 400
            t = time.perf_counter()
            for _ in range(3):
                assert post(base, '/infer/depth?model=david-mask', x)[0] == 200
            print(f'OK david-mask (ön plan %{fg * 100:.1f}, '
                  f'{(time.perf_counter() - t) / 3 * 1000:.0f} ms/istek)')

        # geçersiz istekler
        assert post(base, '/infer/mask', tensor(512, 512))[0] == 400
        assert post(base, '/infer/depth?model=base', tensor(518, 518))[0] == 400
        print('OK geçersiz istekler 400')

        # CORS: izinli origin başlığı alır, izinsiz 403
        s, _, hd = post(base, '/infer/depth?model=small', tensor(518, 518), origin='http://localhost:5173')
        assert s == 200 and hd['Access-Control-Allow-Origin'] == 'http://localhost:5173'
        s, _, hd = post(base, '/infer/depth?model=small', tensor(518, 518), origin='https://ornek.app')
        assert s == 200 and hd['Access-Control-Allow-Origin'] == 'https://ornek.app'
        assert post(base, '/infer/depth?model=small', tensor(518, 518), origin='https://kotu.example')[0] in (403, 'kesildi')
        req = urllib.request.Request(base + '/infer/mask', method='OPTIONS', headers={
            'Origin': 'https://ornek.app', 'Access-Control-Request-Private-Network': 'true'})
        with urllib.request.urlopen(req, timeout=5) as r:
            assert r.status == 204 and r.headers['Access-Control-Allow-Private-Network'] == 'true'
        print('OK CORS + yerel ağ ön isteği')

        # 409: aynı anda çok 'small' karesi; en az biri atılır, son gelen işlenir
        results = []
        x = tensor(518, 518)
        def one(i):
            results.append((i, post(base, '/infer/depth?model=small', x, frame=str(i))[0]))
        # GPU'yu uzun bir mask isteğiyle meşgul et, bu sırada small'lar sıraya girsin
        blocker = threading.Thread(target=lambda: post(base, '/infer/mask', tensor(1024, 1024)))
        blocker.start()
        time.sleep(0.3)
        ts = [threading.Thread(target=one, args=(i,)) for i in range(4)]
        for t in ts:
            t.start(); time.sleep(0.05)
        for t in ts + [blocker]:
            t.join()
        codes = sorted(c for _, c in results)
        assert 409 in codes and 200 in codes, codes
        print('OK eski kare 409', codes)
        print('TÜM SIDECAR TESTLERİ GEÇTİ')
    finally:
        proc.terminate()


if __name__ == '__main__':
    main()
