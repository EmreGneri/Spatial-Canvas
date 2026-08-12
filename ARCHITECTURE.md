# spatial-canvas · Mimari Sözleşmesi

v0.4 — Gün 6. Değişiklikler: PNG/WebM export modülü (`src/engine/export.ts`), embed modu (`src/embed.ts`, `<spatial-canvas>` custom element), Vite embed build girişi.
İki katmanın birbirine güvenli bağlanabilmesi için yazıldı.
Değişiklik tartışılır, yazılır, imzalanır. Sessiz sapma yok.

## Katman Bölüşümü

| Katman | Sahip | Klasör |
|---|---|---|
| Veri katmanı: depth, GPGPU parçacık sistemi, node graph, preset serileştirme, export | Emre | `src/engine/` |
| Render katmanı: tüm GLSL shader'lar, pass zinciri, 3 render modu | Zeynep | `src/shaders/`, `src/ui/` |
| Ortak sözleşme | ikisi birlikte | `ARCHITECTURE.md` |

## Texture Sözleşmesi

| Texture | Format | Boyut | İçerik |
|---|---|---|---|
| `depthTexture` | R32F, tek kanal | görsel çözünürlüğü | 0 = uzak, 1 = yakın |
| `positionTexture` | RGBA32F veya RGBA16F | 384×384 (147.456 parçacık) | xyz = konum (**simülasyon her karede yazar**), w = opaklık (α) |

| `homeTexture` | RGBA32F | 384×384 | xyz = dinlenme konumu (CPU: depth'ten bir kez), w = opaklık (α) |
- **y-flip tek yerde çözülür:** texture upload'u (`src/engine/buffers.ts`, `flipY = true`).
  Sonuç: `v = 1` → görselin **üstü**. Shader'larda, UV'lerde, CPU'da flip **yoktur**.
- Normalize etmek veri katmanının işi: Zeynep ham veri beklemez, hep 0..1 alır.
- `depthTexture` ve `homeTexture` `NearestFilter`. `positionTexture` (RT) de
  `NearestFilter` — parçacık aramaları birebir örneklenir.
- Engine exposes textures to renderers: `engine.positionTexture` (Gün 3'ten beri
  simülasyonun RT texture'ı — **THREE.Texture, DataTexture değil**) ve
  `engine.depthTexture`; ikincisi depth hesaplanana dek `null`.

## Koordinat Uzayı (Gün 2)

- Kamera: perspektif (60°), konum (0, 0, 3.5), hedef orijin. OrbitControls
  (damping açık) kamerayı yönetir — sahiplik Emre.
- Point cloud dünyası: yükseklik 2 birim (`POINTS_WORLD_HEIGHT`), genişlik
  `2 · aspect` (depth kaynağının oranından), `z = (d − 0.5) · 2`
  (`POINTS_DEPTH_RANGE`): d = 0 (uzak) → z = −1, d = 1 (yakın) → z = +1.
  **z orijin etrafında ortalıdır** — OrbitControls hedefi (0,0,0) bulutun
  merkezine denk gelsin diye; ortalanmazsa yörünge bulutun arka yüzeyi
  etrafında döner. Renk rampası için shader `z / 2 + 0.5` ile 0..1'e döner.
- Depth → konum dönüşümü **yalnızca `src/engine/buffers.ts`**
  (`fillPositionsFromDepth`). Shader'larda, UV'lerde, CPU'da yeniden çevrim yok.
- y-flip hâlâ tek yerde: texture upload'u (flipY = true, v = 1 → üst).

## Point Cloud Sözleşmesi (Gün 2)

- **Vertex konumları CPU dizisinden DEĞİL, `uPositions` texture'ından shader'da
  okunur** (`src/engine/points.ts`). Geometri yalnızca `aUv` grid'i taşır
  (u = (i+0.5)/N, v = 1-(j+0.5)/N); position attribute boştur, frustum culling
  kapalıdır.
- Engine'deki material yer tutucudur; render modları (Zeynep) kendi point cloud
  shader'ını `engine.setPointsMaterial(material)` ile takar. Material uniform
  sözleşmesi: `uPositions` her shader'da zorunlu — **tip THREE.Texture** (RT
  texture'ı). Engine, ping-pong nedeniyle okunan texture her karede değiştiği
  için `uPositions`'ı her karede günceller; material buna dokunmaz.
- Texture'lara erişim: `engine.positionTexture`, `engine.depthTexture`
  (depth hesaplanana dek `null`).

## GPGPU Simülasyon (Gün 3 — Emre)

Sahne: tam ekran quad + ortho kamera, ana sahneden ayrı (`src/engine/simulation.ts`).

- **Hızın yeri — karar:** Verlet (konum + önceki konum) tek texture'da
  imkânsız: `w` = opaklık (sözleşme) + konum (3) + önceki konum (3) = 7 kanal >
  RGBA'nın 4'ü. **Hız ping-pong çifti** kullanıldı (4 RT: konum ×2 + hız ×2) —
  Verlet'le aynı bellek, tek kuvvet ifadesi, iki ayrı pass (pos, vel).
- **Format:** `EXT_color_buffer_float` varsa RGBA32F, yoksa RGBA16F (yarım
  hassasiyet bu sahne için yeterli). Tespit Engine'de, log satırında.
- **Tohumlama:** `seedFrom` yalnızca **ilk** depth'te çalışır — `homeTexture`'ı
  her iki konum RT'sine kopyalar, hız RT'lerini sıfırlar. Sonraki depth'ler
  (canlı kamera saniyede ~10 kez) yalnızca `setHome` çağırır: dinlenme konumu
  akan görüntüyü takip eder, simülasyon sıfırlanmaz. Her karede tohumlanırsa
  parçacıklar hiç hareket edemez ve fareyle yapılan deformasyon sürekli silinir.
- **Kare hızı bağımsızlığı:** `uDtScale` = kare süresi / (1/60), 0.5..2 arasına
  kırpılır. Olmadan 144 Hz ekranda yay sert, 30 fps'te gevşek davranır; kırpma
  olmadan sekme arka plandan dönünce bulut patlar.
- **Sim sahnesinin quad'ı sahneye eklenmiş olmalı.** Eklenmezse her pass RT'yi
  sıfıra siler; sonuç ekranda "tek nokta"dır, typecheck ve build yakalamaz.
  Geliştirmede tohumlama sonrası tek piksel geri okunur ve sıfırsa konsola
  hata basılır (`assertSeeded`).
- **Kuvvet:** `yay(home − konum) + fare`. Ölü bölge: home'a `uRestLength`'ten
  yakınken yay kuvveti sıfır (titreme yok).
- **Fare:** hover'da sürekli kuvvet; sol tık OrbitControls'ta kalır. Canvas
  dışında kuvvet sıfır. Ekran konumu → z = 0 düzlemine izdüşüm (kamera
  dönmüşse de doğru — orbit'e dayanıklı).
- **w (opaklık) korunur:** sim pos pass'i `cur.w`'yi kopyalar. Değeri veri
  katmanı yazar (sampler.ts: ön plan maskesi α; 0 = arka plan, gizli).
- **Jitter tohumu:** render shader'ları tohumu aUv hash'iyle türetir
  (boyut saçılması / karakter rastgeleliği) — w artık tohum taşımaz.

| Uniform | Anlam | Varsayılan |
|---|---|---|
| `uStiffness` | yay katsayısı | 0.035 |
| `uDamping` | sönüm (0..1) | 0.96 |
| `uRestLength` | ölü bölge yarıçapı | 0.005 |
| `uForceMode` | 0 = itme, 1 = çekim, 2 = vortex | 0 |
| `uForceRadius` | fare kuvvet alanı yarıçapı | 1.0 |
| `uForceStrength` | fare kuvvet şiddeti | 0.08 |
| `uMouseWorld` | fare, dünya koordinatı (z=0 düzlemi) | — |
| `uMouseActive` | canvas içi/ dışı | 0 |
| `uDtScale` | kare süresi / (1/60), 0.5..2 kırpılı — Engine her karede yazar | 1 |

Simülasyon uniform'ları `engine.simUniforms` ile okunur (UI Gün 4).

## Pass Zinciri (Render Katmanı)

Sahip: **Zeynep**. Sıra ve composer Engine'de (`src/engine/Engine.ts`).
Gün 4'ten itibaren zincir GRAFTAN kurulur: feedback düğümü aktifse
grain/vignette composer'a eklenir, değilse çıkar (`Engine.setPostPassEnabled`).

```
RenderPass (point cloud sahnesi) → Grain/Vignette → [Zeynep: Feedback → Chromatic Aberration → Neon Wireframe] → Output
```

- Gün 1'deki grain/vignette seam'dir: zincirin çalıştığını kanıtlar, Zeynep genişletir.
- **Pass kancası:** Engine pass içlerine (uniform isimleri) doğrudan yazmaz. Her
  pass opsiyonel `update(time)` yöntemi sunar (`TickablePass`), Engine her
  karede çağırır. Yeni pass'ler (Feedback, ChroAber, Neon) aynı kancayı kullanır.
- Composer hedefi half-float; parçacık pass'leri (Gün 3) full float gerektirirse
  `EffectComposer` render target'ı güncellenir — bu da Zeynep'in kararı.

## Kamera / Video Yolu (Gün 2 + Gün 6)

- Gün 1 kararı gereği: statik görsel → Depth-Anything-Small (model); video dosyası
  ve canlı kamera → depth modeli **YOK**, luminance height map
  (`src/depth.ts` → `luminanceHeightMap`): parlaklık = yükseklik, parlak = yakın.
- Çıktı aynı `DepthResult` sözleşmesi: 0..1, satır 0 = üst. Engine'de mode
  ayrımı yok — tek `setDepth` girişi.
- **Gün 6 (video 3D):** luminance artık ham parlaklık değil: ① hafif box blur
  (codec gürültüsü), ② Sobel kenar kabartma (yüz hatları z'de belirgin),
  ③ merkeze radyal vurgu (özne arka plandan ayrışır). Ayarlar
  `LuminanceOptions` (`src/depth.ts`) — `edgeStrength`, `centerBoost`,
  `centerRadius`, `smoothingRadius`; App.tsx video döngüsü varsayılanları
  kullanır. Hepsi CPU'da, kare başına — maliyet çıkarımsız.

## Render Parametre Sözleşmesi (Gün 4)

Her material/pass KENDİ parametre tanımını dışa verir (`src/engine/params.ts`):

```ts
interface ParamDef {
  key: string;          // uniform adı (uStiffness gibi)
  label: string;        // UI etiketi
  min?: number; max?: number;
  default: number;
  kind?: 'number' | 'color';  // varsayılan 'number'; renk '#rrggbb' olarak serileşir
}
```

- Tanımlar sahiplerinin dosyasında durur: `SIM_PARAMS` (simulation.ts), `GRAIN_PARAMS`
  (grainPass.ts), `POINTS_PARAMS` (pointCloudMaterial.ts), `ASCII_PARAMS` (asciiMaterial.ts).
- Serileştirme (`preset.ts`) uniform adlarını bilmez — liste yürür, o kadar.
  **Yeni uniform eklemek = listeye satır eklemek.** Listeye satır eklemeyen yeni
  uniform preset'e girmez (kural, CHANGELOG'a yazılır).
- Hesaplanan değerler (uTime, uResolution, uPositions, uAtlas/uCharSet) ve API
  kontrolleri (ascii charSet → renderer düğümü params'ına string olarak) listede
  YOKTUR.
- `applyParams` bilinmeyen anahtarı ve tür uyuşmazlığını ATLAR, asla çökmez:
  Zeynep bir uniform'u silerse eski preset'ler sorunsuz açılır.

## Node Graph (Gün 4)

Sahne boru hattının **tek doğruluk kaynağı** graftır (`src/engine/graph.ts`).
Preset = graf + parametreler; parametreler düğümlerin üstünde durur
(`node.params`), ikinci bir durum ağacı YOKTUR.

```
media → depth → particles → renderer → feedback → output
```

- 6 düğüm tipi: `media` (tür: synthetic|upload|camera; medya gömülmez),
  `depth`, `particles` (SIM_PARAMS), `feedback` (post-pass zinciri — bugün
  grain/vignette; Zeynep'in feedback/chroaber/neon'u bu düğüme eklenir),
  `renderer` (mode + aktif material'ın parametreleri), `output`.
- Kenar = veri akışı. **Aktiflik = media'dan erişilebilirlik**: feedback
  düğümünün giriş kenarı kesilirse post-pass composer'dan çıkar, grain/vignette
  gerçekten kaybolur (Engine.setGraph). Çevrimler (feedback) kural dışı değil:
  topolojik sıra (Kahn) çözülmeyenleri sona ekler.
- Engine: `setGraph(graph)` sırayla ① renderer modunu kurar ② composer'ı
  aktifliğe göre yeniden kurar ③ düğüm parametrelerini uniform'lara uygular.
  `registerRenderMode(name, material, params)` modları graf için kaydeder;
  ModeSelector'daki doğrudan `setPointsMaterial` takası da adı izler.
  **Aynı material'ı tekrar takma yasak** (setPointsMaterial eskisini dispose
  eder; ascii material'ın atlas'ı dispose kancasıyla bırakılırdı) — setGraph
  yalnızca farklı material'da takas yapar.

## Node Graph UI (Gün 5)

`src/ui/NodeGraphEditor.tsx` — React Flow (`@xyflow/react`) ile görsel
düzenleyici. Editör ayrı durum tutmaz: her değişiklik `engine.setGraph`'e
gider, düğüm parametreleri graf params'ında yaşar.

- 6 düğüm sabit kurulur (düğüm silme v1'de yok, yalnızca kenar koparma:
  kenar seç + Backspace/Delete veya kaynaktan çekerek başka hedefe taşıma).
- **Kablo çek → pass kapanır:** feedback düğümünün giriş kenarı kopunca
  `setGraph` post-pass'i composer'dan çıkarır; geri takılınca döner.
- Seçili düğümün parametre paneli `ParamDef` listesinden üretilir (isim
  bilmez): sayı → slider, renk → color input, renderer → mod düğmeleri
  (points/ascii), media → kaynak türü salt-okunur (medya gömülmez).
- Düğüm konumları yalnızca UI'dır — graf şemasına YAZILMAZ, preset'te yoktur.
- Graf motor dışından kurulduğunda (preset yükleme) `graphTick` prop'u ile
  editör tazelenir; düğüm seçimi sıfırlanır.
- Bilinen sınırlar: ascii karakter seti (setCharSet API'si) editörde
  düzenlenmez; ModeSelector'dan yapılan mod takası editörün renderer
  düğümüne yansımaz (kayıtta toPreset doğru değeri yazar).

## Preset Şeması v1 (Gün 4)

```json
{
  "version": 1,
  "name": "slot adı",
  "mediaType": "synthetic | upload | camera",
  "gridSize": 384,
  "camera": { "position": [0, 0, 3.5], "target": [0, 0, 0] },
  "graph": {
    "nodes": [
      { "id": "media",     "type": "media",     "params": {} },
      { "id": "depth",     "type": "depth",     "params": {} },
      { "id": "particles", "type": "particles", "params": { "uStiffness": 0.08, "uForceMode": 0, "..." : "..." } },
      { "id": "renderer",  "type": "renderer",  "params": { "mode": "points", "uPointSize": 6, "..." : "..." } },
      { "id": "feedback",  "type": "feedback",  "params": { "uGrainAmount": 0.06, "uVignette": 0.45, "..." : "..." } },
      { "id": "output",    "type": "output",    "params": {} }
    ],
    "edges": [
      { "from": "media", "to": "depth" },
      { "from": "depth", "to": "particles" },
      { "from": "particles", "to": "renderer" },
      { "from": "renderer", "to": "feedback" },
      { "from": "feedback", "to": "output" }
    ]
  }
}
```

- `src/engine/preset.ts`: `toPreset(source)` anlık durumu düğüm params'ına
  tazeler; `applyPreset(target, json)` grafı kurar + kamerayı geri kor.
- **Sürüm kararı:** yalnızca `version === 1` açılır. Bilinmeyen sürüm hata
  döner, sahneye dokunulmaz. Bilinmeyen alanlar atlasılır (yukarıdaki kural).
- Kayıt: isimli localStorage slotları (`spatial-canvas.preset.<ad>`). Dosya
  indirme/yükleme Gün 6.
- gridSize kayıt anındaki ızgara; farklıysa uyarı verir, ızgara çalışma
  zamanında değişmez.
- Kanıt testi (GPU'suz): `node scripts/verify-preset.mjs` — sahte engine ile
  round-trip, sürüm koruması, bilinmeyen alan toleransı, graf aktifliği.
  Node'un uzantısız import sorunu `scripts/ts-extension-loader.mjs` ile çözülür.

## Export + Embed (Gün 6 — Emre)

- **PNG export** (`src/engine/export.ts`): `canvas.toBlob` — mevcut frame'i indirir. EffectComposer WebGL render target'larına çizdiği için ekran canvas'ı her karede günceldir; `preserveDrawingBuffer` gerekmez (senkron çağrı anında tarayıcı canvas içeriğini kopyalar).
- **WebM export**: `MediaRecorder` + `canvas.captureStream(60)`. VP9 desteklenirse `video/webm;codecs=vp9`, yoksa VP8/varsayılan. Bit hızı 8 Mbps varsayılan.
- **Embed modu** (`src/embed.ts`): `<spatial-canvas>` custom element. Aynı bundle, ayrı build girişi (`vite.config.ts` → `rollupOptions.input.embed`). UI mount edilmez; depth modeli yalnızca `src` attribute'u varsa lazy yüklenir (`import('./depth')`). WebGL yoksa statik görsel fallback (`<img>`). `IntersectionObserver` ile görünür olana kadar lazy init.
- **Embed bundle**: `dist/assets/embed-*.js` (~3.4 kB) — ana uygulama (~402 kB) ile aynı chunk'ları paylaşır, depth modeli ayrı chunk'ta (~522 kB) lazy yüklenir.

## Model ve Runtime

- Depth modeli + ORT wasm: `public/` içinde, CDN yok. `npm run fetch:assets` ile yeniden üretilir.
- `numThreads = 1` (COOP/COEP gerekmez). WebGPU yolu `model_fp16.onnx` + jsep build.
- Yükleme/çıkarım süreleri her kurulumda ölçülür (`console.time` → log).

## Her Gün, Unutma

1. Sabah 15 dk senkron: dün bitti / bugün var / tıkanan.
2. Öğle + akşam 1'er dakika ekran kaydı — çirkin halleri de kaydedin, geriye dönük üretilmez.
3. Akşam 30 dk ortak entegrasyon: o günün shader'ı gerçek motorda. Sandbox'ta kalan shader "bitmedi" sayılır.
