# spatial-canvas · Mimari Sözleşmesi

v0.5 — Gün C (denetim turu). Değişiklikler: kabuk mesh'i normalleri + kabuk kimliğini (`aShell`) kendisi üretir ve DIŞA yönlüdür; renk grid'inin ALPHA kanalı bakılı oklüzyon taşır; neon kenarları depth yerine `uPositions`'tan türetilir; luminance (video) yolu netlik ipucu + zamansal kararlı normalizasyon kazandı; kimlik durumundaki post-pass'ler çizilmez; `reconstruction/volume.ts` kaldırıldı.
v0.7 — Anatomik derinlik turu: ön plan z uzamı SİLÜET ORANLIDIR
(`ANATOMIC_DEPTH_RATIO`, sampler + mesh; z uzayı sabitleri `zUnit` ile
ölçeklenir, arka plan dalı ve [−1,+1] kırpması değişmedi); nesne maskesi
siluette OTORİTEDİR (adaylık yalnızca maske) ve bileşen bağlantısında GÜVEN
kaynağıdır; `depth.ts` fotoğraf yoluna tek yönlü eğim sınırlayıcı
(`limitDepthSlope`) eklendi.
v0.6 — Gün D (CV dönüşümü; Gün 0 sözleşmesi): GaussianBuffer sözleşmesi (gSplatA/B/C), PoseTrack sözleşmesi, intrinsik varsayımı (60° dikey → ParamDef), füzyon çıktısı + keyframeIndex kanalı, `eval-out/report.json` metrik formatı; node graph'a pose + fusion düğümleri, 5. render modu `splat`, `verify-flow.mjs`/`verify-pose.mjs`.
v0.4 — Gün 6: PNG/WebM export modülü (`src/engine/export.ts`), embed modu (`src/embed.ts`, `<spatial-canvas>` custom element), Vite embed build girişi.
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
| `uImageTexture` (fotoğraf grid'i) | RGBA8, sRGB | 384×384 | rgb = fotoğraf pikseli (konum grid'iyle aynı remap), **a = bakılı oklüzyon (Gün C)** |

- **AO KANALI (Gün C):** renk grid'inin alpha'sı `sampler.computeAoMap`
  çıktısıdır (depth farkından çukur kapanması, `[0.35, 1]`). Ek texture yoktur:
  render material'ları aynı örneklemede `.a`'yı `uAoStrength` ile tüketir.
  Video kaynağında `uImageTexture` canlı `VideoTexture`'dır ve alpha = 1
  olduğundan AO kendiliğinden nötrdür. `uAoStrength = 0` → görünüm değişmez.
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
  `2 · aspect` (depth kaynağının oranından). **z ∈ [−1, +1] KIRPMA sözleşmesi
  değişmedi** (`POINTS_DEPTH_RANGE` = 2 arka plan dalının ve kırpmanın
  referansıdır), ama ÖN PLAN z uzamı artık sabit değildir:
  - **SİLÜET ORANLI z uzamı (`ANATOMIC_DEPTH_RATIO` = 0.7, `sampler.ts`):**
    `zSpan = 0.7 · 2 · min(rx, ry)`, `zUnit = zSpan / 2`, ön plan
    `z = (d − 0.5) · zSpan + kavis + kenar dökümü`. `rx/ry` siluetin DÜNYA
    yarı eksenleridir (`computeBodyGeometry`). Sebep: sabit uzamda derinlik
    HER ZAMAN bulut yüksekliğinin tamamıydı — 25 cm derinliğindeki bir büst
    boyu kadar derin çiziliyor, kafa üstü anatomik olmayacak kadar dışarı
    fırlıyordu. Ölçü siluetten okunur, özne-agnostiktir.
  - **z uzayındaki TÜM sabitler kullanım yerinde `zUnit` ile ölçeklenir:**
    `EDGE_WALL_Z`, `THIN_SHELL_Z`, elipsoit kavis (`curvature · zUnit · …`),
    `MESH_MIN_WALL_Z` ve mesh arka kapak düzlemi. Sabitlerin KENDİLERİ
    sözleşme değeri olarak sabittir. Ölçeklenmezlerse yüzey küçülürken duvar
    eski uzamda kalır ve kabuk yine kutuya döner.
  - **ARKA PLAN dalı ölçeklenmez:** `z = (d − 0.5) · range − BACKDROP_Z_PIN`
    (duvar geride kalsın diye). Siluet yoksa (`body = null`) ön plan da eski
    davranışa döner (`zSpan = range`).
  - `mesh.ts`'teki `depthScale` (0.7) ayrı bir koldur: `zSpan`, `range`in
    YERİNE geçer, `depthScale`in ÜSTÜNE gelmez.
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
- **Gün C — türetilmiş veri KONUM texture'ından okunur, depth'ten değil.**
  Konum grid'i önem remap'iyle büküktür (aşağı), depth ham görüntü uzayındadır;
  depth'i `aUv` ile örneklemek iki farklı uzayı karıştırır. `pointCloudMaterial`
  yüzey normalini komşu texel'lerin z'sinden türetir; `neonWireMaterial` Sobel
  kenarlarını da (eski `uDepth`/`uTexelSize`/`uHasDepth` + `setDepthTexture`
  kaldırıldı — kenarlar kayıyordu). Render katmanının Engine'den depth
  beslemesi isteyen bir yolu KALMADI.
- **Önem tabanlı örnekleme (Gün B):** depth'ten konuma dönüşüm önem remap'iyle
  bükülür (`buildImportanceRemap` — `0.5·depth + 0.3·center + 0.2·contrast +
  0.4·fg`). fg = segmentation maskesi; verilmezse center terimi kadraj
  merkezine göre, verilirse ÖZNENİN kütle merkezine göre hesaplanır (kenarda
  duran özne yoğunluk kaybetmez). Yoğunluk `SAMPLE_MIN/MAX_DENSITY`
  ([0.15, 2.5])'a kırpılır;
  CDF + invCdf örnekleme koordinatını büker, grid/aUv sözleşmesi değişmez.
  Renk grid'i (sampleImageGrid) AYNI maskeyi almalıdır — hizalama kuralı:
  setDepth'te işlenen maske `Engine.lastFgMask`'ta saklanır, setPhoto onu
  kullanır. fgMask boyut uyumsuzluğu RangeError'dur (sessiz sapma yok).

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
Gün 4'ten itibaren zincir GRAFTAN kurulur. Gün 7: 'feedback' düğümü post-pass
zincirini yönetmeye başladı; Gün A ile zincir FXAA + bloom ekledi:
aktifken hepsi çalışır, giriş kenarı kesilince feedback + chromatic + bloom +
FXAA `pass.enabled = false` ile, grain `removePass` ile kapanır (geri açılınca
aynı indekse `insertPass`).

```
RenderPass → FXAA → Feedback → ChroAber → Bloom → Grain/Vignette → Output
```

- Feedback: TouchDesigner tarzı birikim (ping-pong, half-float; `feedbackPass.ts`
  içindeki ölçüm tablosu). `uFeedbackAmount = 0` iken çıkış girişe bit-birebir
  eşittir — varsayılan görünüm kaybolmaz. Chromatic: `uAmount = 0` iken aynı
  koşul.
- FXAA: `antialias: false` kurulumuna karşı kenar yumuşatma; YERİ kritiktir
  (RenderPass'ten hemen sonra — efektlerin kendi kenarlarını bozmaz).
  Parametresizdir, preset'e girmez, `feedback` düğümüyle birlikte kapanır.
- Bloom: `bloomPass.ts` sarmalayıcı — `BLOOM_PARAMS` sözlüğü (uBloomStrength/
  uBloomRadius/uBloomThreshold) `update(time)` kancasında UnrealBloomPass'in
  iç parametrelerine senkron edilir (TickablePass deseni). feedback düğümünün
  parametre listesindedir.
- Output: ACES tonemapping + sRGB çıkışı (`OutputPass`); exposure
  `renderer.toneMappingExposure` üzerinden `lookUniforms` köprüsünden gelir.
- **GLOBAL LOOK (Gün A):** exposure + fog `Engine.lookUniforms` köprüsünde
  yaşar (`shaders/look.ts`, `LOOK_PARAMS`) — output graf düğümünün
  parametreleridir. Engine her karede köprüyü üç render material'ına
  (uFogDensity/uFogColor, aynı uniform adları) ve renderer'a işler.
- **Pass kancası:** Engine pass içlerine (uniform isimleri) doğrudan yazmaz. Her
  pass opsiyonel `update(time)` yöntemi sunar (`TickablePass`), Engine her
  karede çağırır. Feedback `update` birikimi eski kare sayısından temizler.
- **KİMLİK PASS'İ ÇİZİLMEZ (Gün C — FPS, kalite kaybı yok):** feedback, chromatic
  ve bloom `enabled`'ı kendileri hesaplar: `chainEnabled` (graf 'feedback'
  düğümünün kolu — Engine yalnızca bunu yazar) **VE** parametrenin kimlik
  olmaması. `uFeedbackAmount = 0` → çıkış girişe bit-birebir eşit (iki tam ekran
  geçişi boşa), `uAmount = 0` → chromatic aynı, `uBloomStrength = 0` → mip
  zinciri boşa. Üçünün de VARSAYILANI 0'dır. Feedback atlanan karelerde birikim
  bayatladığı için `needsClear` işaretler (geri açılınca leke basmaz). FXAA
  parametresizdir, kimlik durumu yoktur — yalnızca `enabled` ile yönetilir.
- Composer hedefi half-float; parçacık pass'leri (Gün 3) full float gerektirirse
  `EffectComposer` render target'ı güncellenir — bu da Zeynep'in kararı.

## Siluet Sözleşmesi (`reconstruction/silhouette.ts`)

Nesne maskesi (`segmentation.ts`, RMBG) verildiğinde:

- **MASKE OTORİTEDİR (adaylık):** aday koşulu YALNIZCA `mask ≥ 0.5`'tir; depth
  eşiği (`SILHOUETTE_BIN_LO` = 0.05) devre dışıdır. Eskiden kesişim aranıyordu
  ve maske özneyi doğru bulsa bile derinliği düşük kalan bölge (koyu saç,
  arkaya giden kol) siliniyordu — depth maskeyi cezalandırıyordu. **Maske
  yoksa depth eşiği aynen kalır.**
- **MASKE GÜVENİ (bağlantı):** bileşen selinde `connected(p,q)` artık
  `filled ∨ |Δd| ≤ GRADIENT_BREAK ∨ (mask[p] ≥ 0.5 ∧ mask[q] ≥ 0.5)`. Gerçek
  bir uzuv (kalkık kol) yüzden öne çıktığı için `|Δd| > 0.15` oluyor, bileşen
  "severed" sayılıp eleniyordu. Duvar reddi KORUNUR: duvarın maskesi düşüktür,
  maske o kapıyı açamaz.
- **SIZMA KORUMASI YERİ DEĞİŞMEDİ:** güven sınırı hâlâ fonksiyon sonundaki SON
  AND'dir (`mask < 0.5 → 0`) — morfolojik kapanış, bileşen birleştirme veya
  satır dolgusu hiçbir arka plan pikselini diriltemez.

## Kamera / Video Yolu (Gün 2 + Gün 6)

- Gün 1 kararı gereği: statik görsel → Depth-Anything-V2 (model, `src/depth.ts`
  `MODEL` sabiti — bugün `-base`); video dosyası ve canlı kamera → depth modeli
  **YOK**, luminance height map (`luminanceHeightMap`).
- Çıktı aynı `DepthResult` sözleşmesi: 0..1, satır 0 = üst. Engine'de mode
  ayrımı yok — tek `setDepth` girişi.
- **TEK YÖNLÜ EĞİM SINIRLAYICI (`limitDepthSlope`, yalnızca FOTOĞRAF yolu).**
  `estimateDepth` boru hattının SON aşamasıdır (normalize → detay → stretch →
  sobel → **sınırlayıcı**): `d[i] = min(d[i], min(4-komşu d[j]) + MAX_SLOPE_PER_PX)`,
  `MAX_SLOPE_PER_PX = 0.02`, 4 geçiş. Tek yönlüdür — yalnızca komşularını AŞAN
  piksel geri çekilir, çukur öne çekilmez (göz/çene çukurları doldurulmaz).
  Opsiyonel maske verilirse yalnızca `mask ≥ 0.5` piksellerde ve yalnızca maske
  İÇİNDEKİ komşularla çalışır (siluet sınırındaki gerçek sıçrama korunur);
  `estimateDepth` segmentasyon maskesini görmediği için `mask = null` ile
  çağırır. **Video/luminance yolu (`heightMapFromLuminance`) DEĞİŞMEDİ.**
- **Gün C (video derinliği).** Boru hattı sırası — hepsi CPU'da, kare başına,
  çıkarımsız; havuzlanmış buffer'larla tahsissiz:
  1. luminance (ham),
  2. **netlik (defocus) ipucu:** ham luminance'ın gradyan enerjisi → geniş
     yarıçaplı yumuşatma → kare ortalamasına normalizasyon (net = 1, flu = 0).
     Parlaklık kötü bir derinlik vekilidir; videoda geçerli olan ipucu
     "özne net, arka plan flu"dur. Ağırlık: `focusStrength` (0.55).
  3. taban = `mix(low-pass, focus, focusStrength)`,
  4. **işaretli** mikro rölyef: `edgeStrength · (raw − low-pass)`. (Eskiden
     `|Sobel|` eklenirdi; büyüklük her zaman pozitif olduğu için her kenar
     SIRT oluyordu — kabartma değil tel kafes.)
  5. merkeze radyal vurgu (`centerBoost`, 0.3 — netlik ipucu geldiği için payı
     azaltıldı),
  6. **zamansal kararlı normalizasyon** (`stableRange`, EMA α = 0.15): kare
     başına min/max, tek parlamada tüm sahnenin z eşlemesini kaydırıyordu.
     Kaynak değişiminde `resetLuminanceState()` çağrılır (App).
- **Temporal harman App'te ve hareket duyarlıdır:** α = 0.12 + |Δ|·6 (1'e
  kırpılı) — durgun bölge kararlı, hareketli bölge gecikmesiz.
- Solid modu fotoğraf-only kalır: video/kamera kabuk üretmez, nokta bulutuna
  düşülür ve sebebi log'a yazılır (`Engine.solidAvailable`).

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
  `depth`, `particles` (SIM_PARAMS), `feedback` (POST-PASS ZİNCİRİ — Gün 7 +
  Gün A: feedback birikimi + chromatic + bloom + grain/vignette, parametresiz
  FXAA ile birlikte; zincir bu düğümden açılır/kapanır, parametreleri düğümde
  düz sözlükle yaşar), `renderer` (mode + aktif material'ın parametreleri),
  `output` (Gün A: ekran çıktısı — global look: ACES exposure + sis,
  LOOK_PARAMS).
- Kenar = veri akışı. **Aktiflik = media'dan erişilebilirlik**: feedback
  düğümünün giriş kenarı kesilirse post-pass zinciri (feedback → chromatic →
  grain/vignette) gerçekten kapanır (Engine.setGraph). Çevrimler (feedback)
  kural dışı değil: topolojik sıra (Kahn) çözülmeyenleri sona ekler.
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
  `setGraph` post-pass zincirini kapatır (feedback + chromatic enabled=false,
  grain composer'dan çıkar); geri takılınca üçü de döner.
- Seçili düğümün parametre paneli `ParamDef` listesinden üretilir (isim
  bilmez): sayı → slider, renk → color input, renderer → mod düğmeleri
  (points/ascii), media → kaynak türü salt-okunur (medya gömülmez).
- Düğüm konumları yalnızca UI'dır — graf şemasına YAZILMAZ, preset'te yoktur.
- Graf motor dışından kurulduğunda (preset yükleme) `graphTick` prop'u ile
  editör tazelenir; düğüm seçimi KORUNUR (id'ler her grafta sabittir, panel
  değeri her render'da engine'den okur).
- **Gün 8 — mod takası tek kapıdan:** ModeSelector, ControlPanel ve editörün
  renderer düğümü `App.changeMode`'a düşer; sıra: `setPointsMaterial` (material
  takası) → `Engine.selectRenderMode(mode)` (renderer düğümünün `params.mode`
  graf üzerinde güncellenir — graf tek doğruluk kaynağı kalır) → UI state →
  `graphTick`. Üç kol da birbirinin değişikliğini görür; editör mod butonları
  points/ascii/neon/solid'in dördünü sunar.
- **Gün B — `solid` render modu (fotoğraf-only):** `buildShellMesh`
  (`reconstruction/mesh.ts`) depth grid'ini kapalı z-kabuk meshine çevirir
  (gövde + duvar şeridi + kapak; su geçirmezlik yönlü kenar dengesi =
  her kenar iki yönde tam 1 kez — `verify-mesh.mjs`). `Engine.setShellGeometry`
  meshi sahneye koyar; solid mod + kabuk hazır → nokta bulutu gizlenir, mesh
  görünür (video/kamera solid'e mesh vermez — graceful fallback, nokta bulutu).
  UV grid uzayındadır (köşe uv'si 4 texel merkezinin ortası → bilinear köşe
  rengi). Material (`solidMaterial.ts`) points ailesinden: diffuse ışık +
  fresnel + spekülar + AO + opak + depthWrite; SOLID_PARAMS render preset'ine
  girer (Gün A loop köprüsü uFogDensity/uFogColor solid'de de çalışır). Gün B
  temizlik: Z hesabı 3×3 box blur'dan geçen depth'i örnekler ve ekstrüzyon
  `depthScale` (0.7) ile sönümlenir (kavis ölçeklenmez); siluet/remap/kaide ham
  depth'ten beslenir. Fotoğraf yüklenişinde segmentasyon otomatik çalışır
  (RMBG maskesi siluete AND edilir) — arka plan büstü yastığa çevirmez.
- **Gün C — kabuk sözleşmesi üç madde kazandı (üçü de HATA düzeltmesi):**
  1. **Dikey hiza:** köşe satırı `remap.yOf`'a SATIR koordinatı (üstten alta,
     `t = j/N`) verir; dünya/uv `v = 1 − t` ayrı hesaplanır. Eskiden `v`
     veriliyordu → mesh dikey ters, üzerine doğru yönde boyanmış doku.
  2. **Yön:** ön yüz `+z`'den bakınca CCW'dir (normali DIŞA). Kapalı ve tutarlı
     yönlü yüzeyde tek yüzün dışa bakması hepsinin dışa bakmasıdır → material
     `FrontSide` çizer (fragment maliyeti yarı). Eski sarım içe dönüktü ve
     duvar sınıflaması ön yüzü komple duvar rengine boyuyordu.
  3. **Normal + kabuk kimliği geometriden gelir** (`ShellMeshData.normals`,
     `.shell` → `aShell` attribute'u): `computeVertexNormals` KULLANILMAZ, çünkü
     front/back/duvar köşeleri paylaşılır (su geçirmezlik sayımı bunu ister) ve
     ortalama normal siluet sınırında ön yüzü duvarla karıştırır. Ön yüz normali
     z alanının merkezi farkından, arka kapak (0,0,−1). Duvar/kapak sınıflaması
     `aShell` interpolasyonundandır (front 1 → back 0), normal tahmininden
     DEĞİL — dik yüzeyler (burun kanadı, çene profili) duvar sayılmaz.
  Kabuk ızgarası 128 → **192** (kabuk yalnızca fotoğraf yüklenişinde kurulur).
- Bilinen sınırlar: ascii karakter seti (setCharSet API'si) editörde
  düzenlenmez (ControlPanel'de düzenlenir).

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
      { "id": "feedback",  "type": "feedback",  "params": { "uGrainAmount": 0.06, "uVignette": 0.45, "uFeedbackAmount": 0, "uDecay": 0.98, "uAmount": 0, "uBloomStrength": 0, "..." : "..." } },
      { "id": "output",    "type": "output",    "params": { "uExposure": 1, "uFogDensity": 0, "..." : "..." } }
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

## Gün D — CV Dönüşümü: Pose + Splat + Eval (Gün 0 sözleşmesi)

İmza: 2026-08-13, Gün 0. Bu bölüm 7 günlük CV fazının karar çerçevesidir;
tartışılır, yazılır, imzalanır — sessiz sapma yok. Kapsam ve sınırlar D.8'de.

### D.1 GaussianBuffer Sözleşmesi (gSplat)

Mevcut texture disiplininin birebir aynısı: **384²**, füzyon (sim) yazabilir,
Engine her karede bind eder, material dokunmaz (uPositions kuralı).

| Texture | Format | İçerik |
|---|---|---|
| `gSplatA` | RGBA32F | xyz (dünya) + opaklık (w) |
| `gSplatB` | RGBA32F | normal.xyz + ölçek (w) |
| `gSplatC` | RGBA8 | rgb + AO (a) — renk grid'i alpha-AO kuralıyla uyumlu |

- **Yazan:** Emre (veri/sim şeridi — füzyon). **Okuyan:** Zeynep (render
  şeridi). Tutarsızlıkta yazan taraf hatalıdır.
- **Quaternion'a geçiş senaryosu (kanal bütçesi).** Bugünkü düzende `gSplatB`
  dolu: normal.xyz + ölçek(w). Quaternion tek başına 4 kanal ister, yani
  "ölçek → quat" ancak kanal takasıyla mümkündür. Geçilecekse TEK senaryo
  şudur: `gSplatB` = quat.xyzw (normal quat'tan türetilir), **ölçek
  `gSplatA.w`'ye**, **opaklık `gSplatC.a`'ya** taşınır — o zaman `gSplatC`'nin
  AO kanalı serbest kalmaz, AO ayrı bir texture'a çıkar. Maliyeti budur;
  geçiş sözleşme değişikliğidir, imzalanmadan yapılmaz. Geçilmezse `gSplatB`
  normal+ölçek olarak kalır (bugünkü hâl).

### D.2 PoseTrack Sözleşmesi

Kayıt: `{ id, R (quat xyzw, sağ el), t (vec3, y-up), timeMs, scaleA, scaleB,
fovY }` — CPU tarafı veri tipi; texture'a yazılmaz, GPU'ya uniform/UBO ile
gider. Tip karşılığı: `src/engine/vision/types.ts` → `PoseTrackRecord`.

- **Dünya orijini = ilk keyframe** (identity). Sonraki pozlar ona göre.
- **Dönmenin YÖNÜ: kamera→dünya (`world_from_camera`).** Kamera uzayındaki bir
  nokta dünyaya `p_world = R · p_cam + t` ile gider; `t` kameranın dünya
  konumudur. Ters yön (`camera_from_world`) gerekiyorsa çağıran eşleniği alır —
  kayıt asla ters yönü tutmaz. (Konvansiyon yazılmadığında poz zinciri sessizce
  ters kurulur; Gün 5 buna göre yazılacak.)
- **Ölçek hizalaması İKİ terimlidir:** `d_metric ≈ scaleA · d_pred + scaleB`
  (en küçük kareler), keyframe başına yeniden çözülür. Kayıt ikisini birden
  taşır — yalnızca eğimi saklamak hizalamayı geri kurulamaz yapardı.
  Sürüklenme dürüstçe raporlanır (D.8).
- `Engine.getCameraPose()` (render kamerası) ile KARIŞMAZ — ayrı veri tipi.

### D.3 İntrinsik Belirsizliği

- Telefon FOV'u bilinmiyor → varsayılan **60° dikey**, UI slider → `ParamDef`'e
  girer (preset'e kaydedilir). Değişim poz zincirini geçersiz kılar (cache yok).

### D.4 Füzyon Çıktısı

- Aynı GaussianBuffer düzeni + ayrı **`keyframeIndex` kanalı** (timeline
  filtresi: her splat'ın hangi keyframe'den geldiği).
- Oklüzyon delikleri: **NA sentinel**. Delik doldurma çok-görüntülü füzyonla
  yapılır; **diffusion/inpainting YASAK** (üretici model kuralı).

### D.5 Metrik Rapor Formatı — `eval-out/report.json`

```json
{
  "run": "ad", "date": "ISO", "commit": "hash",
  "params": { "...": "ablasyon parametreleri" },
  "results": [{ "metric": "AbsRel", "value": 0.123, "dataset": "nyuv2", "split": "val", "column": "depth" }]
}
```

- Kolonlar: `depth | seg | pose | timing`. Depth: AbsRel/RMSE/δ<1.25; seg: IoU;
  pose: ATE/RPE.
- **Ablasyon kolları (sabit 7):** `ao`, `focusBoost`, `edgeStrength`,
  `letterbox_vs_distort`, `importanceSampling`, `depthSmoothing`,
  `foregroundStretch`. `params` bloğu bu yedi anahtarı TAM olarak taşır:
  uygulanmayan kol `null`, fazladan anahtar yasak. (`edgeStrength` Gün D/1'de
  eklendi — harness onu gerçekten ölçüyor; şema dışı anahtar sessiz sapmaydı.)
- **Bir kol ancak ÖLÇÜLEBİLİYORSA raporlanır.** İki çalışma yalnızca o kolda
  ayrışmalı (tek değişken) VE en az bir metrikte fark üretmeli. Matematiksel
  olarak etkisiz kalan bir kol (ör. `edgeStrength`, `smoothingRadius = 0` iken:
  low-pass girdinin kopyası olur, işaretli detay terimi sıfırlanır)
  raporlanmaz — `verify-eval.mjs` bunu denetler.
- **Zamanlama metodolojisi:** `timing` kolonu **medyandır** (1 ısınma turu +
  20 tekrar). Tek örnekli ortalama JIT derlemesini ölçüyordu (ilk çağrı
  sonrakilerin ~3 katı, kollar arası 40×'e varan sahte fark).
- **ATE tanımı:** Sim(3) hizalaması (ölçek + dönme + öteleme, Horn kapalı form)
  SONRASI konum artıklarının RMSE'si. Monoküler yörünge ölçek belirsiz olduğu
  için hizalama Sim(3)'tür; hizalamasız fark keyfi dünya çerçevesini hata
  sayardı. RPE komşu keyframe çiftlerinin ÖTELEME farkıdır (hizalamasız).
  İkisi de yalnızca konumdur — dönme hatası ayrı metriktir, bu fazda yok.
- **Harness bağımsızlığı:** eval yolu (`heightMapFromLuminance`) ML
  kütüphanesine bağlı OLAMAZ. `src/depth.ts` `@huggingface/transformers`'ı
  tembel yükler (yalnızca `loadDepthModel`/`estimateDepth`) — "eval harness
  asla kesilmez" kuralı model yığınının çalışmasına bağlanamaz.
- UI okuyup gösterebilir (metrik paneli). Veri kümesi alımı (NYUv2 alt kümesi
  / DIODE val) indirmeden önce lisans + boyut teyit edilir; D.7 gereği gerçek
  veri kümesi metrikleri sentetik GT'den SONRA gelir.

### D.6 Akış Sözleşmesi (G3)

- `src/engine/vision/flow.ts`: Shi-Tomasi köşe + piramidal Lucas-Kanade,
  **320×180, 300–500 nokta**; çıktı `{ x, y, u, v, status }`.
- Zamansal depth: akışla warp edilmiş EMA + ileri-geri tutarlılık oklüzyon
  maskesi.
- `verify-flow.mjs`: sentetik kaydırma/döndürmede bilinen akışa karşı hata
  < eşik.

### D.7 Kesme Sırası (imzalanan)

1. WebGPU sıralama → CPU radix'te kal
2. Gerçek veri kümesi metrikleri → sentetik ground-truth
3. Keyframe timeline UI → "tüm keyframe'ler" görünümü
4. Ölçek hizalama → tek global ölçek

**Asla kesilmez:** eval harness + akış tabanlı depth.

### D.8 Sınır Bildirimi (kapsam)

- Loop closure yok; sürüklenme birikir. Dokusuz duvar/gökyüzü çöker. Rolling
  shutter pozu bozar. Dinamik sahne (yürüyen insan) kırar.
- Hedef kapsam: **30–60 sn el kamerası, 8–20 keyframe, statik sahne** → orbit
  edilebilir tek 3D sahne. Genelleme bu fazın dışında.

### D.9 Entegrasyon

- Node graph'a **`pose`** ve **`fusion`** düğümleri; parametreleri ParamDef'e
  oturur (graf tek doğruluk kaynağı korunur).
- 5. render modu **`splat`** → `registerRenderMode`, `SPLAT_PARAMS`.
- Git: `feat/eval-flow-pose` (Emre) + `feat/splat-render` (Zeynep), akşam
  `main`'e; AI izi kuralı aynen (ne + neden, insan yazarı).

## Model ve Runtime

- Depth modeli + ORT wasm: `public/` içinde, CDN yok. `npm run fetch:assets` ile yeniden üretilir.
- `numThreads = 1` (COOP/COEP gerekmez). WebGPU yolu `model_fp16.onnx` + jsep build.
- Yükleme/çıkarım süreleri her kurulumda ölçülür (`console.time` → log).

## Her Gün, Unutma

1. Sabah 15 dk senkron: dün bitti / bugün var / tıkanan.
2. Öğle + akşam 1'er dakika ekran kaydı — çirkin halleri de kaydedin, geriye dönük üretilmez.
3. Akşam 30 dk ortak entegrasyon: o günün shader'ı gerçek motorda. Sandbox'ta kalan shader "bitmedi" sayılır.
