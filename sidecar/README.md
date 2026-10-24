# Yerel çıkarım yardımcısı (sidecar)

Web uygulaması tarayıcıda çalışır. Bu küçük sunucu isteğe bağlıdır: çalışıyorsa
ağır modeller senin GPU'nda koşar, çalışmıyorsa her şey tarayıcı yoluna düşer.

| İş | Yardımcı varken | Yokken (tarayıcı) |
|---|---|---|
| Fotoğraf derinliği | DA3Mono-Large (~0,3 sn) | Depth Anything V2-small |
| Fotoğraf nesne ayırma | BiRefNet_lite (CPU, ~7 sn) | IS-Net |
| Fotoğraf özne maskesi inceltme | DAViD ViT-B ön plan ∩ özne maskesi (varsayılan) | yok (`?maske=david` ile tarayıcıda, 449 MB) |
| Canlı video derinliği | V2-small (GPU, ~30 ms) | V2-small (WebGPU) |
| Video nesne ayırma | IS-Net (değişmez) | IS-Net |

Süreler RTX 5070 Laptop + DirectML ile ölçüldü (2026-10-10).

## Otomatik başlatma

`npm run dev` yardımcıyı kendisi başlatır (`sidecar/vite-eklentisi.ts`) ve dev kapanınca
yardımcı da kapanır. Localhost'ta sayfa onu kendiliğinden kullanır; kapatmak için bir kez
`?inference=browser`. Canlı video yalnız `?inference=sidecar` ile açıkça seçilirse yardımcıya gider.
Kurulum yoksa dev normal başlar ve tek satır ipucu yazar.

## Kurulum (bir kez)

```
python sidecar/hazirla.py
```

Sanal ortamı kurar, ~2 GB modeli `sidecar/models/` altına indirir (DAViD maskesi 449 MB dahil).
DAViD maskesini kapatmak için `?maske=isnet`; sunucu tarafında `server.py --davidsiz`.

## Elle çalıştırma (gerekirse)

```
sidecar\.venv\Scripts\python sidecar\server.py
```

Sonra uygulamayı bir kez `?inference=sidecar` ile aç (ör. `http://localhost:5173/?inference=sidecar`).
Seçim tarayıcıda hatırlanır; kapatmak için `?inference=browser`.

Yayındaki siteden kullanmak için o adresi izinli origin olarak ekle:

```
sidecar\.venv\Scripts\python sidecar\server.py --origin https://senin-siten.app
```

## Test

```
sidecar\.venv\Scripts\python sidecar\test_server.py
```

## Güvenlik

Sunucu yalnız `127.0.0.1`'i dinler; CORS yalnız localhost'a ve `--origin` ile verilen
adreslere açıktır, diğer sitelerin istekleri 403 alır.
