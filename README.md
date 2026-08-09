# spatial-canvas

Tarayıcıda çalışan mekânsal görsel motor. Fotoğraf → derinlik haritası (Depth-Anything-V2-Small, tamamen yerel) → 3D uzay → parçacık/ASCII/neon render modları. TouchDesigner benzeri node tabanlı akış, MIDI/audio ile canlı performans, tek satır embed hedefleniyor.

## Durum

- **Gün 1 (veri katmanı):** tamamlandı — depth pipeline, R32F depth texture, 384×384 position texture, pass zinciri seam'i, mimari sözleşme.
- Depth inference doğrulandı (`scripts/verify-depth.mjs`, Node WASM yolu): model yükleme **345 ms**, 512×512 çıkarım **334 ms** (q8, tek thread). Tarayıcıda ilk yükleme WASM derlemesiyle daha yüksek olur — log'da ölçülür.

## Kurulum

```bash
npm install
npm run fetch:assets   # model ağırlıkları + ORT runtime'ı public/'e indirir (~120 MB, gitignore'lı)
npm run dev
```

Model ve runtime CDN'den gelmez; tamamen yereldir. `public/models` ve `public/ort` silinirse `npm run fetch:assets` ile yeniden üretilir.

## Scripts

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` / `preview` | Production build / önizleme |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run fetch:assets` | Model + ORT dosyalarını vendor eder |
| `node scripts/verify-depth.mjs` | Depth modelini offline doğrular (tarayıcı testinden önce) |

## Mimari

- **Veri katmanı** (`src/engine/`) — Emre: depth pipeline, GPGPU parçacık sistemi, node graph, preset serileştirme, export.
- **Render katmanı** (`src/shaders/`, `src/ui/`) — Zeynep: GLSL shader'lar, pass zinciri, 3 render modu, arayüz.
- **Sözleşme:** [ARCHITECTURE.md](ARCHITECTURE.md) — texture formatları, y-flip politikası, koordinat uzayı, preset şeması. İki katman birbirine yalnızca bu sözleşme üzerinden bağlanır.

## Model Dosyaları (public/models)

| Dosya | Boyut | Yol |
|---|---|---|
| `model_quantized.onnx` | 26 MB | WASM (varsayılan) |
| `model_fp16.onnx` | 34 MB | WebGPU (`device: 'webgpu'`) |

## Notlar

- `onnxruntime-web` tek thread kullanır (`numThreads = 1`) → COOP/COEP header'ları gerekmez.
- `vite.config.ts` içinde `optimizeDeps.exclude`: transform paketleri Vite'ın ön-paketlemesinden çıkarılır, aksi halde ORT'un dinamik import'u dev'de 500 verir.
