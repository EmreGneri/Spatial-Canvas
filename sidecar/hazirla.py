"""Yerel yardımcı kurulumu: sanal ortam bağımlılıkları + model dosyaları.

Çalıştırma (repo kökünden):
    python sidecar/hazirla.py

Yaptıkları:
  1. sidecar/.venv yoksa oluşturur; onnxruntime-directml (Windows) ya da
     onnxruntime, numpy, pillow, onnx kurar.
  2. sidecar/models/ altına üç modeli indirir (zaten varsa ve boyutu doğruysa atlar):
     - depth-anything-v2-small fp16 (Apache-2.0)        canlı video
     - DA3Mono-Large (Apache-2.0, ~1,3 GB)               fotoğraf derinliği
     - BiRefNet_lite fp16 (MIT)                          fotoğraf nesne ayırma
     - DAViD ViT-B ön plan maskesi (MIT, 449 MB)         fotoğraf özne maskesi (varsayılan açık)
       Kaynak Microsoft'un Azure statik deposu; dosya adı sürüm taşımaz, boyut + MD5
       (sunucunun Content-MD5 başlığı, 2026-10-24) sabitleme görevi görür.
  3. BiRefNet'in çok çıkışlı Split / çok girişli Concat düğümlerini anlamca birebir
     aynı küçük ağaçlara böler (DirectML'de ~%30 hızlı; çıktı bit-bit aynı, ölçüldü).

DA3 lisans notu: resmi `depth-anything/DA3MONO-LARGE` Apache-2.0. Buradaki ONNX
dışa aktarımı üçüncü taraf `SpatialHub/depth-anything-3-onnx` deposundan; depo
etiketi CC-BY-NC, README'si bu dosya için Apache-2.0 diyor. Ticari dağıtımdan önce
resmi ağırlıklardan kendi dışa aktarımınızı yapın.
"""

from __future__ import annotations

import hashlib
import subprocess
import argparse
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV = HERE / '.venv'
MODELS = HERE / 'models'
HF = 'https://huggingface.co'
DAVID = 'https://facesyntheticspubwedata.z6.web.core.windows.net/iccv-2025/models'

DOSYALAR = [
    # (hedef ad, kaynak URL, beklenen bayt[, beklenen MD5])
    ('da2_small_fp16.onnx', f'{HF}/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx', None),
    ('da3mono_large.onnx', f'{HF}/SpatialHub/depth-anything-3-onnx/resolve/main/da3mono_large.onnx', 2712303),
    ('da3mono_large.onnx.data', f'{HF}/SpatialHub/depth-anything-3-onnx/resolve/main/da3mono_large.onnx.data', 1336737792),
    ('birefnet_lite_fp16.onnx', f'{HF}/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx', 114538221),
    ('foreground-segmentation-model-vitb16_384.onnx', f'{DAVID}/foreground-segmentation-model-vitb16_384.onnx',
     449231719, 'f28be34c9594895277a3603b025c2fbc'),
]


def venv_python() -> Path:
    return VENV / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')


def kur_ortam():
    if not venv_python().exists():
        print('sanal ortam oluşturuluyor…')
        subprocess.check_call([sys.executable, '-m', 'venv', str(VENV)])
    ort_pkg = 'onnxruntime-directml' if sys.platform == 'win32' else 'onnxruntime'
    subprocess.check_call([str(venv_python()), '-m', 'pip', 'install', '--quiet', ort_pkg, 'numpy', 'pillow', 'onnx'])


def md5(yol: Path) -> str:
    h = hashlib.md5()
    with open(yol, 'rb') as f:
        for parca in iter(lambda: f.read(1 << 22), b''):
            h.update(parca)
    return h.hexdigest()


def indir(ad: str, url: str, boyut: int | None, ozet: str | None = None):
    hedef = MODELS / ad
    if hedef.exists() and (boyut is None or hedef.stat().st_size == boyut):
        print(f'var: {ad}')
        return
    print(f'indiriliyor: {ad}')
    gecici = hedef.with_suffix(hedef.suffix + '.part')
    urllib.request.urlretrieve(url, gecici)
    if boyut is not None and gecici.stat().st_size != boyut:
        raise SystemExit(f'{ad}: beklenen {boyut} bayt, gelen {gecici.stat().st_size}')
    if ozet is not None and md5(gecici) != ozet:
        raise SystemExit(f'{ad}: MD5 uyuşmuyor (beklenen {ozet}); dosya {gecici} olarak bırakıldı')
    gecici.replace(hedef)


def agacla():
    hedef = MODELS / 'birefnet_lite_fp16_tree.onnx'
    if hedef.exists():
        print('var: birefnet_lite_fp16_tree.onnx')
        return
    print('BiRefNet düğümleri ağaçlanıyor…')
    subprocess.check_call([str(venv_python()), str(HERE / 'agacla.py'),
                           str(MODELS / 'birefnet_lite_fp16.onnx'), str(hedef)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--moge', action='store_true', help='isteğe bağlı MoGe-2 ViT-L (1,32 GB)')
    args = parser.parse_args()
    kur_ortam()
    MODELS.mkdir(exist_ok=True)
    for dosya in DOSYALAR:
        indir(*dosya)
    agacla()
    if args.moge:
        indir('moge-2-vitl-normal.onnx',
              f'{HF}/Ruicheng/moge-2-vitl-normal-onnx/resolve/1c02388b024dd34da413e1a934d7a941785f1460/model.onnx',
              1324265014)
    print(f'hazır. Başlatmak için: {venv_python()} {HERE / "server.py"}')


if __name__ == '__main__':
    main()
