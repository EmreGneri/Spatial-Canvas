# spatial-canvas

Tarayıcıda çalışan mekânsal görsel motor. Fotoğraf → derinlik haritası (Depth-Anything-V2, tamamen yerel — aktif model `src/depth.ts` içindeki `MODEL` sabiti, bugün `-base`) → 3D uzay → parçacık/ASCII/neon/solid render modları. TouchDesigner benzeri node tabanlı akış ve tek satır embed hedefleniyor. Ses/müzik girdisi **yok** — proje tamamen görsel.

## Durum

- **Tur 2 / E3–E4 (Emre):** Tracker'ın optik akışı ve nesne tespiti Worker'a
  taşındı; Worker veya Web Locks olmayan tarayıcıda eski yol kullanılır. Aynı NYC klibinde
  FPS örnekleri: [E3 ölçümü](docs/benchmarks/E3-tracker.md). Brush
  karşılaştırmasının ölçülen ve eksik kısımları:
  [E4 raporu](docs/benchmarks/E4-brush.md).

- **Viral sprint (render katmanı — Zeynep):** **tracker HUD overlay** (motor
  canvas'ının üstünde ayrı 2D canvas — köşe parantez kutuları, LOCK vurgusu,
  ID/koordinat etiketleri, sayaç bloğu; üstteki "tracker" düğmesi), **"canlı
  fotoğraf" paralaks sway** (mod satırındaki düğme + hız kolu, `setAutoSway`),
  **neon modu düzeltildi** (ekran siyahtı: kenar ölçeği gerçek
  derinlik verisine göre + kenarlar artık görüntü kontrastını da okuyor, yeni
  "doku kenarı" kolu — parlak piksel oranı %0 → %2.2) ve üst araç çubuğu tek görsel dile
  çekildi. İkisi de preset'e kaydolmaz (sprint kararı). `npm run verify` 29/29.
  Detay: [CHANGELOG.md](CHANGELOG.md).
- **Gün C (denetim turu):** solid modun iki kök hatası düzeltildi — kabuk mesh'i
  dikey ters kuruluyordu ve ön yüzün sarımı içe dönük olduğu için fotoğraf
  dokusu görünmeyen arka kapağa biniyor, ekranda düz gri kütle kalıyordu. 3D
  okunurluk: bakılı oklüzyon (renk grid'inin alpha kanalında, ek texture yok) +
  kabuk normalleri geometriden + spekülar vurgu + kabuk ızgarası 192. Video:
  netlik (defocus) ipucu, işaretli mikro rölyef, zamansal kararlı normalizasyon,
  hareket duyarlı harman. FPS: kimlik durumundaki post-pass'ler (bloom/feedback/
  chromatic — üçünün de varsayılanı kapalı) artık hiç çizilmiyor. "Maskeyi
  göster" düzeltildi. Detay: [CHANGELOG.md](CHANGELOG.md).

> **SÜRÜM KURALI — git'e AI izi ASLA gitmez.** Bu reponun uzak geçmişine
> (push'lanan her şeye) hiçbir AI/Claude/assistant/opencode atfı, `Co-authored-by:`
> veya imza satırı girmez. Kural detayı ve neden: [CHANGELOG.md "KURAL" bölümü](CHANGELOG.md).
> Commit mesajı yalnızca ne + neden; yazar alanı yalnızca insan (Emre / Zeynep).

- **Gün B (solid modu + mesh doğrulaması):** dördüncü render modu `solid` — depth grid'i kapalı z-kabuk mesh'e döner (fotoğraf-only), nokta bulutu yerine geometri çizilir; `Engine.setShellGeometry` + `buildShellMesh` (`reconstruction/mesh.ts`), su geçirmezlik yönlü kenar dengesiyle doğrulanır (`scripts/verify-mesh.mjs`, `npm run verify` zincirinde). Detay: [CHANGELOG.md](CHANGELOG.md).
- **Gün A (görüntü kalitesi):** ACES tonemapping + exposure (sağ panel "Look"), bloom (feedback düğümüyle birlikte kapanır), FXAA (parametresiz, zincirin başında), üç modda da sis (uFogDensity/uFogColor — global look köprüsünden). Output graf düğümü global look kollarını taşır (eski preset'ler uyumlu). Detay: [CHANGELOG.md](CHANGELOG.md).
- **Gün 8 (mod takası tek kapıya):** ModeSelector, ControlPanel ve graf editörünün renderer düğümü aynı `changeMode` kapısına düşer; takas artık graf renderer düğümünün `params.mode`'unu da günceller (`Engine.selectRenderMode`) — üç kol da birbirinin değişikliğini görür, editörde neon da var. Detay: [CHANGELOG.md](CHANGELOG.md).
- **Gün 7 (post-pass zinciri tamamlandı):** feedback birikimi + chromatic aberration pass'leri composer'a bağlandı — sağ panelde Feedback/Chromatic slider bölümleri canlı, `feedback` graf düğümü üç pass'ı birden (feedback → chromatic → grain) açıp kapatıyor; preset şeması parametreleri düğümde saklıyor (eski preset'ler uyumlu). Detay: [CHANGELOG.md](CHANGELOG.md).
- **Gün 6 (export + embed + video 3D + ışık):** PNG/WebM export, `<spatial-canvas>` embed (lazy depth, WebGL fallback), preset dosya indir/yükle, luminance yükseltme (Sobel + merkez vurgu), home blend + grab (video akıcılığı), otomatik DPR, nesne ayırma kenar düzeltmesi, point cloud'a yüzey normalleri + ışık + fresnel. Detay: [CHANGELOG.md](CHANGELOG.md).
- **Gün 1 (veri katmanı):** tamamlandı — depth pipeline, R32F depth texture, 384×384 position texture, pass zinciri seam'i, mimari sözleşme.
- **Gün 1 (render katmanı):** tamamlandı — grain/vignette pass'i renk grading ile genişletildi, canlı slider paneli.
- **Gün 2 (veri katmanı):** depth → 3D point cloud (konumlar shader'da `positionTexture`'dan okunur), perspektif kamera + OrbitControls, sürükle-bırak görsel/video, canlı kamera (luminance yolu). Hata düzeltmeleri ve sözleşme değişikliği: [CHANGELOG.md](CHANGELOG.md).
- **Gün 6 (export + embed):** PNG/WebM export (`src/engine/export.ts`), `<spatial-canvas>` custom element embed modu (`src/embed.ts`), lazy depth model yükleme, WebGL fallback. Aynı bundle'dan ayrı build girişi (`vite.config.ts` → `rollupOptions.input.embed`).
- **Gün 3 (veri katmanı):** GPGPU parçacık simülasyonu — 147k parçacık ping-pong render target'larda, yay + fare kuvvet alanı (itme / çekim / vortex), kare hızından bağımsız zaman adımı, FPS sayacı, `vercel.json`. `positionTexture` artık her karede GPU'da yeniden hesaplanıyor.
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
| `npm run verify` | Sözleşme kontrolleri: position texture (z ortalı, y-flip, opaklık) + depth modeli offline |

## Mimari

- **Veri katmanı** (`src/engine/`) — Emre: depth pipeline, GPGPU parçacık sistemi, node graph, preset serileştirme, export.
- **Render katmanı** (`src/shaders/`, `src/ui/`) — Zeynep: GLSL shader'lar, pass zinciri, 4 render modu, arayüz.
- **Sözleşme:** [ARCHITECTURE.md](ARCHITECTURE.md) — texture formatları, y-flip politikası, koordinat uzayı, preset şeması. İki katman birbirine yalnızca bu sözleşme üzerinden bağlanır.
- **Ne değişti:** [CHANGELOG.md](CHANGELOG.md) — repoyu yeni çektiysen buradan başla. Diğer katmanı etkileyen her düzeltme, gerekçesiyle birlikte orada.

## Model Dosyaları (public/models)

| Dosya | Boyut | Yol |
|---|---|---|
| `model_quantized.onnx` | 26 MB | WASM (varsayılan) |
| `model_fp16.onnx` | 47 MB | WebGPU (`device: 'webgpu'`) |

## Notlar

- `onnxruntime-web` tek thread kullanır (`numThreads = 1`) → COOP/COEP header'ları gerekmez.
- `vite.config.ts` içinde `optimizeDeps.exclude`: transform paketleri Vite'ın ön-paketlemesinden çıkarılır, aksi halde ORT'un dinamik import'u dev'de 500 verir.
