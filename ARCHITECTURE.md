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

**Güncel kapsam (2026-09-24):** D.1–D.8, `Engine` içindeki surfel/füzyon
yolunun sözleşmesidir. Uygulamaya ayrıca gerçek WebGPU 3DGS eğitimi eklendi;
ayrı veri ve render yolu D.9'da tanımlanır. Eski tarihli ölçüm paragrafları
yeni eğitim yolunun sonucu sayılmaz.

## Katman Bölüşümü

| Katman | Sahip | Klasör |
|---|---|---|
| Veri katmanı: depth, GPGPU parçacık sistemi, node graph, preset serileştirme, export | Emre | `src/engine/` |
| Render katmanı: GLSL shader'lar, pass zinciri, stilize render modları | Zeynep | `src/shaders/`, `src/ui/` |
| Gerçek 3DGS: SfM, WebGPU eğitim, ayrı rasterizer ve `.ply` | Emre + vendored `splat.js` | `src/engine/reconstruction/egitim3dgs.ts`, `src/vendor/splat.js/` |
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
  Video kaynağında `uImageTexture` ilk model karesine kadar canlı
  `VideoTexture`'dır; sonra modelin işlediği karenin renk grid'i olur
  (2026-09-24). İkisinde de alpha = 1 (`skipAo`), AO kendiliğinden nötrdür.
  `uAoStrength = 0` → görünüm değişmez.
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
  **2026-09-25: varsayılan KAPALI (opt-in, `importanceSampling: true`).**
  Remap yalnız örnekleme koordinatını büker, dünya xy'si düzgün grid'de
  kalır — yoğun bölge (özne) x/y'de BÜYÜTÜLÜR, z büyümez. Ölçüm (16:9
  büst, 518×291): özne genişliği 1.216 → 2.216 (×1.82), z/x 0.40 → 0.21;
  her render modunda "basık ve yayık" büst. Splat yarıçapı/normalleri ve
  nokta boyutu düzgün grid aralığını varsaydığından fotoğraf yolu remap'siz
  koşar: `Engine.setDepth` konumlara açıkça `false` verir, renk dolumları ve
  kabuk varsayılanla aynı remap'i paylaşır (video zaten öyleydi). Kol yalnız
  eval/lab ölçümü için açılır.

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

Nesne maskesi (`segmentation.ts`, bugün IS-Net) verildiğinde:

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
- **DİLASYON TEK YERDE (Gün E, bulgu 2).** Maske dilate + tüy işlemi YALNIZCA
  `segmentation.ts` içinde, maskenin KENDİ çözünürlüğünde (1024²) ve
  `MASK_DILATE_RADIUS` = 4 px ile uygulanır. `Engine.setDepth` maskeyi depth
  boyutuna yalnızca **resample eder, ikinci kez dilate ETMEZ.** Eskiden orada
  `round(MASK_DILATE_RADIUS × maskWidth/width)` = 8 px'lik ikinci bir geçiş
  vardı: (a) iki aşama birbirinden habersizdi, etkileri çarpışıyordu; (b) ölçek
  çarpanı ters yöndeydi — 1024 → 518 küçültmesini telafi etmek yarıçapı BÖLMEYİ
  gerektirir (4/1.98 ≈ 2), çarpmayı değil. Ölçüm (2026-08-14): ham özne alanına
  göre çift dilasyon **+%23.9**, tek dilasyon **+%6.2**; 14 px'lik kol–gövde
  boşluğu çift dilasyonda tamamen doluyordu (topaklaşma), tek dilasyonda açık
  kalıyor. `scripts/verify-curtain.mjs` bu ikinci geçişi hiç çalıştırmıyordu —
  üretim yolu ile tek gerçek-fotoğraf testi ayrışmıştı; artık aynı hesap.

## Derinlik Son-İşleme Maskesi (`depth.ts`, Gün E — bulgu 1)

`estimateDepth`'in stretch / sobel / eğim sınırlayıcı aşamaları hangi "ön plan"
tanımını kullanır:

- **Özne maskesi OTORİTEDİR.** `estimateDepth(source, { subjectMask })`
  verildiğinde üç aşama da bu maskeyi kullanır; maske depth çıktısına
  `resampleBilinear` ile ölçeklenir (1024 vs 518 — ikisi de letterbox karesinin
  iç kırpımı, aynı görsel alan).
- **Stretch + sobel ağırlığı maskenin kendisi DEĞİL, `fillSoftMaskInterior`
  çıktısıdır** (fotoğraf ve canlı yol): gerçek iç (6 px içinde her piksel
  ≥ 0.5) 1'e doldurulur, dış tüy (< 0.5) dokunulmaz. Sebep: segmentasyon
  öznenin İÇİNDE de kararsız kalabiliyor (d93ef671: çıplak yüz 0.51–0.65,
  çerçeve ~1.0) ve harman `d + (hedef − d)·m` o çukuru derinliğe kase olarak
  basıyordu — yüz içe çöküyordu. Eğim sınırlayıcı ham maskeyi kullanır (≥ 0.5
  bölgeleri dolgu ile değişmez). Bkz. CHANGELOG 2026-09-25.
- **Maske verilmezse eski davranış AYNEN korunur:** depth-türevli sahte maske
  (`smoothstep(0.15, 0.8, D)`) + maskesiz eğim sınırlayıcı. Kamera/video yolu ve
  maskesiz çağrılar bit-bit aynıdır (regresyon testi: `after_check` ölçümü).
- **Çağrı sırası sözleşmesi:** `App.tsx` fotoğraf yolunda `segmentForeground`
  ARTIK `estimateDepth`'ten ÖNCE koşar. Segmentasyon butonu sonradan açılırsa
  depth maskeyle YENİDEN çıkarılır (önbellekteki depth maske-kördür).
- **Gerekçe (ölçüldü, 2026-08-14).** Sahte maske yüz yakın planında gerçek
  maskeyle örtüşür, ama gövde / ayna selfie karesinde YAKIN ZEMİN de yüksek D
  taşıdığı için maskeye giriyor: `applyForegroundStretch`'in min/max taraması
  zemini kapsıyor ve özne sıkışık kalıyordu (özne derinlik aralığı 0.116 →
  0.117, yani stretch fiilen etkisiz). Gerçek maskeyle aynı sahnede 0.116 →
  0.850. Özne İÇ bölgesinde tam zincir sonrası rölyef std'si **0.0307 → 0.2105
  (×6.86)**.
- **Eğim sınırlayıcı BÖLGE-AYRIK koşar.** Maske varken önce maske içi (yalnız
  iç komşularla), sonra maske dışı (yalnız dış komşularla) sınırlanır; 0.5
  eşiği iki bölgeyi tam bölüştürür (hiçbir piksel iki kez sınırlanmaz, hiçbiri
  atlanmaz). Tek maskesiz geçişte özne↔arka plan sıçraması "aşırı eğim"
  sayılıyor ve öznenin 4 piksellik dış halkası arka plan seviyesine çekiliyordu
  (ortalama **0.750** derinlik kaybı, maks 0.780) — siluet kenarı 3B'de arkaya
  çöküyordu. Arka plan sıçramalarının sınırlanması KAYBOLMAZ.
- **EĞİM TAVANI KARARI (Gün E, bulgu 6 — KAPANDI, `MAX_SLOPE_PER_PX`
  DEĞİŞTİRİLMEDİ).** Bulgu 1 sonrası şüphe: stretch gerçekten çalıştığı için
  öznenin İÇ eğimleri büyüyor (gövde sahnesinde kazanç ×7.30) ve 0.02 tavanına
  takılıyor — sınırlayıcı kazanılan rölyefi geri alıyor mu? **Ölçüm: hayır.**
  - Rölyef maliyeti: sentetik gövde sahnesinde tavanlı 0.2105 vs tavansız
    0.2104 (**%−0.07**); gerçek büst fotoğrafında 0.2044 vs 0.2012 (**%−1.63**,
    yani tavanlı olan daha yüksek). İki bağımsız sahnede de kayıp YOK.
  - Koruma sürüyor: stretch sonrası aykırı sivrilme (3×3, komşusundan 0.10
    kopuk tepe) tavansız 0.4951, tavanlı 0.0309 — **×16 bastırma**.
  - Tavan çok sayıda pikseli hafifçe kırpar (gövde sahnesinde ~15.9k px × 0.030)
    ama bu rölyefe yansımaz; kazanç-ölçekli tavan (0.02 × stretch kazancı)
    denendi: kırpılan piksel 15897 → 32 düşüyor, rölyef std AYNI kalıyor
    (0.2105), buna karşılık sivrilme bastırması 0.0309 → 0.0928'e zayıflıyor.
    Yani ölçekleme, ölçülebilir bir kazanç vermeden korumayı gevşetirdi.
  - **Karar:** tavan sabit 0.02 kalır. Kırpılan piksel sayısı tek başına kusur
    göstergesi DEĞİLDİR — karar rölyef ölçümüne dayanır.
    `verify-depth-mask.mjs` [6] bloğu bunu kilitler: rölyef maliyeti %5'i
    aşarsa ya da sivrilme bastırması ×4'ün altına düşerse test patlar.

### Test kapsamı (Gün E, bulgu 3)

- `scripts/verify-depth-mask.mjs` (zincirin 11. script'i, model YÜKLEMEZ):
  kontrollü SENTETİK sahnelerde yönlü iddiaları kilitler — gövde rölyef kazancı
  ×6.86 (eşik ×4), sahte maske sızması %77 → %0, bölge-ayrık sınırlayıcıda
  kenar aşınması tam 0, maske alan şişmesi +%6.2 (eşik %10) ve kol–gövde
  boşluğunun açık kalması, zSpan ölçek tutarlılığı, determinizm.
- `scripts/verify-curtain.mjs`: GERÇEK fotoğrafta aynı metrikleri raporlar ve
  kök nedenin orada da bulunduğunu doğrular. **Yönlü assert YOKTUR** — asset
  bir büsttür, yani bulgu 1'in zaten çalışan vakası; ayrıca std iki yol
  arasında karşılaştırılabilir değildir (maske-kör yol std'yi kenar çökmesi ve
  derinlikle korele stretch kazancı üzerinden yapay şişirir). Kendi
  gövde/ayna fotoğrafını ölçmek için: `node scripts/verify-curtain.mjs <yol>`.
- **Bilinen boşluk:** repoda gövde/ayna fotoğrafı YOK (üretici model yasak,
  lisanslı görsel indirilmedi) — gerçek dünyada doğrulama kullanıcının kendi
  karesiyle yapılır.

## Stretch Aralığı (`depth.ts`, Gün E — bulgu 8)

`applyForegroundStretch` aralığı **ham min/max DEĞİL, %`STRETCH_TRIM_PCT`
(= 10) histogram kırpmalıdır** (her iki uçtan, 256 kova, sıralama yok).

Ham min/max maskenin uçlarına kilitlenir — sızan duvar/kapı, en yakın el, en
uzak omuz — ve özne KÜTLESİ sıkışık kalır; 3B'de ince levha görünür. Ölçüm
(gerçek fotoğraflar): özüm.jpg maskesi tek bileşen (%99.5, duvar kirlenmesi
YOK) ama öznenin p25-p75'i 0.135 iken min-max 0.844 → ham min/max ile stretch
kazancı ≈ ×1.0, yani etkisiz.

**ÖLÇÜM TUZAĞI (bir kez düşüldü, kayda geçiyor):** etkiyi *toplam z aralığı*
ile ölçmek YANILTIR — min/max her koşulda doyduğu için kırpma hiç işe
yaramıyormuş gibi görünür ve doğru düzeltme yanlışlıkla geri alınır. Doğru
metrik öznenin **kütle yayılımıdır** (p10-p90).

Nokta bulutu z p10-p90 (gerçek fotoğraflar, 2026-08-14):

| Foto | kırpmasız | kırpma %10 |
|---|---|---|
| özüm.jpg | 0.357 | **0.686** (+%92) |
| ayna selfie | 0.644 | **0.801** (+%24) |
| AESPA-KARINA-5 | 0.824 | **1.164** (+%41) |

Kırpma dışında kalan pikseller hedef banda KELEPÇELENİR (en yakın el doyar);
0..1 ve `STRETCH_HI` sözleşmeleri korunur. `pct = 0` eski ham min/max
davranışına döner (testlerin kullandığı kaçış kapısı).
`verify-depth-mask.mjs` [7] bloğu kilitler.

## Dejenere Maske Koruması (`App.tsx`, Gün E — bulgu 9)

Eski RMBG modeli bazı karelerde **her pikseli ön plan** döndürüyordu (ölçüldü: ayna
selfie'sinde ortalama-ton dolgusuyla %100). Böyle bir maske hiçbir şey ayırmaz
ama ZARAR verir: stretch aralığı sahnenin tamamına açılır (özne bandı yine
sıkışır) ve siluet AND'i arka planı elemez. Boş maske koruması zaten vardı;
artık **ön plan oranı > %92 olan maske de atlanır** ve depth maskesiz koşar.
Eşik gerekçesi: gerçek bir özne kadrajı doldursa bile maske kenarlarda 0
bırakır; %92 üstü pratikte "model pes etti" demektir. Eşik eski modelde
ölçülmüştü; IS-Net için yeniden doğrulama yayın öncesi açık iştir.

## zSpan Sözleşmesi (`sampler.ts`, Gün E — bulgu 4)

```
zSpan = ANATOMIC_DEPTH_RATIO · 2 · min(rx, ry) / min(halfW, halfH)
```

**KADRAJ YÖNÜ DERİNLİĞİ DEĞİŞTİRMEZ.** Dünya uzayında y hep ±`halfH`, x ise
±`halfW = (w/h)·halfH`'tir; yani DİKEY kadrajda dünya genişliği 1'in altına
iner (özüm.jpg 0.751, ayna selfie 0.562) ve siluetin `rx`'i bu daralmış ölçekte
ölçülür. Bölen olmadan `min(rx, ry)` kadraja göre FARKLI FİZİKSEL EKSENİ seçer
(yatay karede yükseklik, dikeyde genişlik) ve aynı özne yalnızca kadraj yönü
yüzünden daha sığ çizilirdi. Yarı eksen artık kadrajın KISA kenarı biriminde
ölçülür: yatay kadrajda bölen 1'dir (davranış aynen korunur), dikeyde daralma
geri alınır.

`ANATOMIC_DEPTH_RATIO` DEĞİŞMEDİ — düzeltilen şey anatomi değil, kadraj yönünün
derinliğe sızmasıdır (yön bir sahne özelliği değildir).

**Ölçüm (gerçek fotoğraflar, `assets/`, 2026-08-14)** — son nokta bulutu ön plan
z aralığı (stretch zaten doyduğu için pratikte zSpan'a eşittir):

| Foto | oran | önce | sonra |
|---|---|---|---|
| AESPA-KARINA-5.webp | 1.50 (yatay) | 1.342 | **1.342** (değişmez) |
| özüm.jpg | 0.75 (dikey) | 0.550 | **0.732** (+%33) |
| ayna selfie | 0.56 (dikey) | 0.513 | **0.913** (+%78) |

`verify-depth-mask.mjs` [5] bloğu kilitler: aynı özne dört kadraj oranında
(yatay 1.50 / kare / dikey 0.75 / dikey 0.56) **aynı zSpan** üretmeli (Δ < 0.01,
ölçülen 0.552–0.558), eski bölensiz formülün kadraja duyarlı olduğu
(×1.78 sapma) senaryo nöbetçisi olarak doğrulanır, ve özne ×1.5 büyüyünce
zSpan ×1.5 olmalı (ölçek tutarlılığı korunur).

**Denetim geçmişi (dürüstlük kaydı):** bu madde iki kez YANLIŞ kapatıldı.
İlkinde "gövde 3.5× sığlaşıyor" gerekçesi yanlış çerçevelenmişti; ikincisinde
varsayılan antropometriye bakılıp "formül doğru" denmişti. İkisi de gerçek
çıktı ölçülmeden verilmiş kararlardı. Doğru teşhis ancak gerçek fotoğraflar
(`assets/`) uçtan uca ölçülünce çıktı: son z aralığı ≈ zSpan, yani stretch
değil zSpan darboğaz.

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
- **Canlı model derinliği (2026-09-24, `vision/liveDepth.ts`).** Yukarıdaki
  luminance yolu artık yalnız model gelene kadar geçici önizlemedir; WebGPU
  varsa `startLiveDepth` Depth Anything V2 Small ile devralır. Video için
  sözleşme:
  - **Tam kare izdüşüm (`fullFrame`, `sampler.ts`):** önem örneklemesi ve
    siluet dalı yok; `z = clamp((d − 0.5) · 2, −1, 1)`, xy `(3.5 − z) / 3.5`
    ile ölçeklenir ki başlangıç kamerasından kare birebir hizalı görünsün.
    Maske geometriyi DEĞİŞTİRMEZ, yalnız w (opaklık) sınıflandırır; canlı
    video derinliği de maskesiz hesaplanır (`maskeAl` verilmez).
  - **Harmanlama:** fotoğraf ve preset'ler additive kalır; video kaynağında
    Engine point cloud material'ını `NormalBlending`'e alır (yoğun tam kare
    ızgara additive'de beyaza doyuyordu).
  - **Derinlik sırası:** video kaynağında `depthWrite = true`; fragment
    shader alfası `VIDEO_ALPHA_CUTOFF` (0.3) altındaki pikselleri atar, kalanı
    opak çizer. Izgara satır sırasıyla çizildiği için derinlik yazılmazsa
    kamera dönünce uzak satır yakının üstüne biniyordu. Yarı saydam piksel
    derinlik yazsaydı arkadaki komşu düşer, koyu benekler kalırdı; bedeli
    video sprite kenarlarının (nesne ayırma silueti dahil) sertleşmesidir.
    Fotoğraf `depthWrite = false` + additive kalır.
  - **Kadraj:** dünya yüksekliği sabit 2 değil,
    `2 · 3.5 · tan(fov/2) · min(1, kameraOranı / videoOranı) · 0.94`
    (`contain`). Değer her derinlik karesinde Engine'de hesaplanır.
  - **Renk:** modelin işlediği karenin RGB'si aynı `setDepth` çağrısıyla renk
    grid'ine yazılır; nokta bulutu sonraki video karesiyle boyanmaz.
  - **Konum:** video home'u her karede doğrudan tohumlanır (`seedFrom`,
    hız = 0). Yay takibinin aşımı rengi şekilden ayırıyordu. Fotoğraf yolu
    yay simülasyonunu korur.
  - **Nokta izi:** `uVideoFootprint = 1` iken nokta boyutu ızgaranın ekrandaki
    fiziksel piksel aralığından (DPR, zoom, en-boy) türetilir; fotoğrafta
    eski `uPointSize / mesafe` formülü değişmez. `verify-video-point-footprint`
    kapsamayı 0.3 kesimiyle kanıtlar; varsayılan boyut 6 boşluksuzdur, boşluk
    eşiği ~3,2'den ~3,9'a çıktı (slider en az 2).
  - **DPR ölçeği:** fotoğraf, ASCII ve neon nokta boyutu
    `uDprScale = anlık piksel oranı / başlangıç oranı` ile çarpılır.
    Uyarlamalı DPR düşünce sprite'lar oturum ortasında büyümez; açılıştaki
    görünüm değişmez. Video izi zaten fiziksel pikseldedir, çift ölçeklenmez.
  - **Düz video:** OutputPass ton eğrisini tüm kareye uygular; malzemedeki
    `toneMapped: false` etkisizdi. Düz video açıkken
    `renderer.toneMapping = NoToneMapping` (animasyon döngüsü ve `renderFrame`
    aynı yoldan). Bu modda pozlama kolu etkisizdir (three pozlamayı yalnız
    ton eğrisi içinde uygular).
  - **GPU kuyruğu:** segmentasyon (IS-Net) oturum kurulumu ve çıkarımı
    `segmentation.ts` içinde `gpuSirasinaGir`'e girer; çağıranlar sarmaz
    (kuyruk yeniden girişli değildir). Eşzamanlı yüklemeler tek oturumda
    birleşir (`onceRetry`).
  - **Kaynak nesli:** `teardownSource()` bir nesil sayacını artırır
    (`src/sourceGuard.ts`). Fotoğraf, dosya, kamera ve canlı derinlik yolları
    her `await` sonrası nesli kontrol eder; bayat kamera akışı hemen
    durdurulur, bayat fotoğraf sonucu hiçbir şey yazmaz.
  - **Zaman:** aralık yumuşatması çıkarım sayısına değil medya zamanına
    bağlıdır (yarı ömür 450 ms aralık, 500 ms ön plan stretch'i). Sahne
    kesmesi, seek/döngü ve 1,5 sn'yi aşan zaman sıçraması durumu sıfırlar.
    Canlı videoda özne kırpması yapılmaz (kırpık tahmin kadraja yayılıp arka
    plan uyduruyordu).
  - **Splat köprüsü:** video derinliği Splat/Crystal modu dışında 147k
    Gaussian'ı yeniden üretmez; kirli bayrak mod girişinde ve
    `gaussianSnapshot` içinde tazelenir. Yakalanan sahne (`setGaussians`)
    kaynak değişene kadar köprü tarafından ezilmez.

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

- **Canlı uniform tek doğruluk kaynağıdır (2026-09-24).** Sağ panel ve reset
  uniform'lara doğrudan yazar; graf editörü her uygulamadan önce düğüm
  parametrelerini canlı değerlerden yeniler (`liveGraph` = `toPreset`
  yenilemesi, `src/ui/nodeGraphSync.ts`), editörde düzenlenen düğüm en son
  uygulanır. Renderer düğümünün parametreleri yalnız kendi modunun
  material'ına uygulanır. Renk uniform'ları yerinde güncellenir (`.set`),
  `THREE.Color` nesnesi değiştirilmez. Düğümler silinemez
  (`deletable: false`); kenarlar tek tek silinir.

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
  (IS-Net maskesi siluete AND edilir) — arka plan büstü yastığa çevirmez.
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
  filtresi: her splat'ın hangi keyframe'den geldiği). **Gün 7:** kanal
  `GaussianBufferData.keyframeIndex` (Uint16Array) olarak CPU tarafında
  yaşar; **GPU'ya gitmez** — material/sıralama bundan habersizdir (shader'a
  dokunulmadı), timeline filtresi CPU'da okur.
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

- **Gün 2 — bilinçli null kollar:** `ao` ve `letterbox_vs_distort` hiçbir
  çalışmada doldurulmaz, ikisi de `null` raporlanır. `ao`: AO, komşu
  yüzeylerin bloklama eğrisini örnekler; bu fazdaki sahnelerde (sentetik lab,
  küçük özne) ölçülebilir bir fark üretmiyor ve "AO 0/açık" ikilisi null
  değil, asılsız sayı olurdu — sayı ile kol doldurmak D.5'te YASAK.
  `letterbox_vs_distort`: SFU beslemesini iki yoldan (letterbox kırpma vs
  serbest oran distorsiyonu) karşılaştıracak kol; şema sürüm 1'de FOV
  sözleşmesi (60° dikey) her ikisini de örtüştüğü için kol bu fazda tanımsız —
  gerçek video girdi kümesiyle (letterbox çalışmaları) doldurulacak.
- **Gün 2 — yeni ölçülen kollar:** `depthSmoothing` (bilateral adım
  yumuşatması), `foregroundStretch` (ön plan min/max açılımı) ve
  `importanceSampling` artık ayrı rapor dosyalarında ölçülür
  (`report-smoothOn/Off.json`, `report-stretchOn/Off.json`,
  `report-importanceOn/Off.json`). Kolların OFF ikilisi 0 değerli, DIĞER
  kollar sabit null'dur; yalnızca ilgili anahtar 1 ya da 0 olur — raporlarda
  "işlem yok" kolları `medianMs = 0` ile işaretlenir (ölçülecek işlem yok;
  D.5 timing metodolojisi yalnızca ON kollarına uygulanır).

### D.6 Akış Sözleşmesi (G3 + G4)

- `src/engine/vision/flow.ts`: Shi-Tomasi köşe + piramidal Lucas-Kanade,
  **320×180, 300–500 nokta**; çıktı `{ x, y, u, v, status }`. (G3, kilitli.)
- Zamansal depth: akışla warp edilmiş EMA + ileri-geri tutarlılık oklüzyon
  maskesi (G4, `src/engine/vision/temporal.ts`).
- `verify-flow.mjs`: sentetik kaydırma/döndürmede bilinen akışa karşı hata
  < eşik.
- Optik akış (`flow.ts`): kenar bandı (~±28 px, piramit×pencere) büyük
  hareketlerde status=0 döner — belgeli LK sınırı, düzeltme değil.
- **Zamansal derinlik (`temporal.ts`, G4):** seyrek akış NN ile yoğunlaştırılır
  (IDW ölçümde 55× kötü: 3.2 px vs 0.058 px max hata); oklüzyon = ileri-geri
  round-trip ≤ 0.1 px VE NN mesafesi ≤ 28 px (yoksa ham derinlik aynen geçer);
  EMA **α=0.3**. Sabitlerin tamamı 2026-08-14 ölçümlerinden. **Kazandığı
  bölge:** yumuşak (düşük-frekanslı) derinlik haritaları — medyan RMSE
  0.0229 vs naif EMA 0.0250 vs ham 0.0308 (N=6, salınımlı ≤2.2 px kayma +
  korelasyonlu gürültü). **Bilinen sınır (belgeli, bug değil):** sert kenar
  (lab gtDepth) sahnelerinde bilinear warp 2-4 px kenar bandı üretir ve EMA'nın
  gürültü kazancını yutar (0.0343 vs 0.0318) — kenar-korumalı warp backlog'ta.
  `verify-temporal.mjs`: 5 grup + adversarial belgeleme (assert'siz).
- `verify` zinciri 10 script (G4'te verify-temporal eklendi).

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

### D.1b GaussianBuffer'ın RENDER tarafı (Zeynep — Gün 1-4)

D.1 sözleşmesinin tüketici ucu. **Yazan taraf değişmedi** (füzyon → Emre);
burası yalnızca okur.

- **Texture'ları Engine bind eder, material ASLA atama yapmaz** — `uPositions`
  kuralının birebir aynısı. Material uniform'ları: `uSplatA`/`uSplatB`/
  `uSplatC` + `uSplatGrid`.
- **`flipY = false`** (buffers.ts'teki görüntü texture'larının aksine):
  GaussianBuffer bir görüntü değildir, texel (i,j) bir SPLAT indeksidir.
  y-flip politikası (v=1 → görselin üstü) yalnızca görüntü türevli
  texture'lar içindir; burada flip açık olsaydı index → uv çevrimi sessizce
  dikey aynalanırdı.
- **Çizim nesnesi AYRI**: `splat` modu nokta bulutunun material takası
  DEĞİLDİR (`src/engine/splats.ts` → instanced quad, `aCorner` +
  `aSplatIndex`). `setPointsMaterial('splat')` takas yapmaz; yalnızca mod adı
  ve görünürlük güncellenir — `solid` modunun graceful-fallback deseniyle
  aynı. GaussianBuffer boşsa nokta bulutunda kalınır.
- **Rasterizasyon (EWA):** Σ₃ = R·diag(s², s², (s·ε)²)·Rᵀ (surfel, normal
  ekseni `SPLAT_FLATTEN` = 0.1 kadar yassı) → görüş uzayı → perspektif
  Jacobian ile Σ₂ → özvektörler ekran elipsinin eksenleri. Σ₂ köşegenine
  0.3 px² eklenir (screen-space prefilter): piksel altına inen splat
  tekilleşip kaybolmaz. `uViewport` **drawing buffer** ölçeğindedir (DPR
  dahil) — CSS pikseli verilirse elipsler yarı boyutta çizilir ve yüzey
  delinir.
- **Blend + sıra:** `depthWrite = false`, `depthTest = true`, premultiplied
  "over". Sıra CPU'da kurulur (`src/shaders/splatSort.ts`) ve `aSplatIndex`
  olarak yüklenir — splat verisi ASLA yeniden dizilmez, yalnızca çizim
  indeksi sıralanır. `depthWrite` açık olsaydı sıralama hiçbir işe yaramazdı.
- **İki sıralama yolu (D.7/1 kararının kodu — WebGPU compute YOK):**
  `radix` (16 bit anahtar, 2 geçiş LSD, TAM sıralama, varsayılan) ve
  `bucket` (tek geçiş histogram, YAKLAŞIK). Kova yolunun sözleşmesi: bir
  derinlik ihlali asla KOVA GENİŞLİĞİNİ aşamaz (`verify-splat.mjs` ölçer).
- **Yeniden sıralama kapısı:** sıra her karede değil, görüş yönü 2°'den fazla
  dönünce kurulur — 147k'lık attribute yüklemesi (590 kB) her kareye
  ödenmez.
- **Nesne ayırma = opaklık kapısı (`splatOpacityGate`):** ayırma AÇIK ve
  kaynak köprü (`point-cloud`) iken sıralama kapısı en az 0.5'tir; arka plan
  splat'ları (w = `BACKDROP_OPACITY`) sıraya hiç girmez — Point Cloud /
  ASCII / Neon'daki `vOpacity < 0.5` discard'ının splat karşılığı. Kapı
  olmadan komşusuna değecek boyuttaki arka plan splat'ları sürekli bir
  tabakaya kaynaşıp yandan bakışta kavisli bir "perde" olarak görünüyordu.
  `authored` Gauss'lar gerçek opaklık taşır, kapıdan etkilenmez.
- **ÖZVEKTÖR SEÇİMİNDE KÖŞEGEN DALI (hata geçmişi — tekrar etmesin):** Σ₂
  köşegen olduğunda (`b ≈ 0`) büyük özvektör formülü `(b, l₁−a)` 0/0'a düşer.
  O dalda eksen, büyük özdeğerin hangi köşegen girdiye ait olduğuna bakılarak
  seçilmelidir (`a ≥ d ? (1,0) : (0,1)`). Koşulsuz `(1,0)` seçmek elipsi 90°
  DÖNÜK çizer; kısalma MİKTARI doğru göründüğü için hata testlerden ve gözden
  kolayca kaçar. Σ₂ merkezdeki ve eksen hizalı HER splat'ta köşegendir, yani
  bu dal istisna değil KURALDIR.
- **Ölçüm (2026-08-14, bu makine, 147.456 splat, medyan/11):** radix
  **2.93 ms**, kova **1.84 ms**. Kova yaklaşıklığı: ardışık ters çift
  %48.87, en büyük derinlik ihlali 0.00175 dünya birimi (kova genişliği
  sınırı içinde).
- **GPU doğrulaması (2026-08-14, tarayıcıda, `gl.readPixels` ile ölçüldü):**
  tek splat, normal Y ekseni etrafında eğik → ekran ayak izi YATAY kısalır,
  ölçülen genişlik/yükseklik 1.000 / 0.865 / 0.712 / 0.500 / 0.269
  (θ = 0/30/45/60/75°) ve karşılık gelen cos θ = 1 / 0.866 / 0.707 / 0.500 /
  0.259 — piksel hassasiyetinde uyuşuyor. Normal X ekseni etrafında eğikken
  kısalma DİKEY eksene geçiyor (h/w = 0.712 @45°, 0.269 @75°): yönelim hem
  büyüklük hem eksen olarak doğru.
- **Kare maliyeti (aynı koşu, 147.456 splat, senkron `renderFrame` + `finish`,
  kamera her karede dönüyor — yani sıralama kapısı HER karede tetikleniyor,
  en kötü hâl):** 640×420 → 3.7 ms · 1280×720 → 3.5 ms · 1920×1080 → 3.4 ms;
  bunun 2.7-2.9 ms'i CPU sıralamasıdır. Maliyet çözünürlükten neredeyse
  BAĞIMSIZ: bu yük fill-rate değil **CPU sıralama** sınırlıdır. Referans:
  `points` modu aynı sahnede 0.40 ms.

### D.2b Poz görselleştirme + D.4 timeline (Zeynep — Gün 5-6)

- **`src/shaders/trajectoryOverlay.ts`** — keyframe frustum'ları + yörünge
  çizgisi. Frustum köşeleri KAMERA UZAYINDA kurulur ve `p_world = R·p_cam + t`
  ile dünyaya taşınır. **Ters yön (camera_from_world) ALINMAZ** — kayıt zaten
  doğru yöndedir; tersini almak frustum'ları orijine göre AYNALAR ve hiçbir
  sayı patlamaz (Gün 5'in en olası sessiz hatası). `verify-overlay.mjs`
  frustum ekseninin gerçekten hedefe baktığını geometrik olarak denetler.
  Tek `LineSegments` + tek `Line` — keyframe başına nesne yok.
- **D.4 timeline filtresi** — `filterOrderByKeyframe` (`splatSort.ts`):
  sıralanmış çizim indeksini YERİNDE sıkıştırır. Sıra arkadan öne olduğu için
  sıkıştırma o sırayı KORUR; filtre sıralamadan SONRA uygulanır ki sıralama
  maliyeti seçime göre değişmesin. `keyframeIndex` D.4 gereği **GPU'ya
  GİTMEZ** — filtre tamamen CPU tarafındadır, material bundan habersizdir.
  Kanıt: keyframe'lerin splat sayıları toplamı = tüm splat sayısı (parçalar
  bütünü verir, kayıp/çoğalma yok).
- **Türetilen normalin tabanı (`NORMAL_MIN_NZ` = 0.38, `splats.ts` köprüsü):**
  komşu z farkından türetilen normal, derinlik SÜREKSİZLİĞİNDE patlıyor ve
  splat kameraya dik kılcal bir şeride çöküyordu. Sınır eksen başına eğim
  kırparak sağlanamaz (iki eksen birden büyükse `n_z` yine çöker); doğrudan
  normale uygulanır. Ölçüm: `|n_z| < 0.35` taşıyan splat oranı **%15.87 → %0**,
  en küçük `|n_z|` tam **0.380**. Gerçek füzyon normalleri geldiğinde bu
  tabana ihtiyaç kalmaz.

### D.6c Dosya videosu: ARAMA (seek) tabanlı yakalama (Zeynep — Gün 6)

`src/engine/vision/seekCapture.ts` — `captureKeyframesBySeek`. **Dosyadan**
yüklenen video için keyframe yakalama yolu; canlı kaynak (kamera/stream) için
`videoPipe.captureKeyframes` (rVFC) doğru yol olmaya devam eder.

İki ölçülmüş gerekçe (2026-08-14, 1920×1080 · 12.0 sn gerçek klip):

1. **rVFC/rAF görünürlüğe bağlıdır.** Sayfa kompozit edilmiyorsa
   (`document.hidden`) video İLERLEMEZ: ölçüldü — 12.4 sn boyunca rVFC 0,
   rAF 0, `currentTime` 0 → 0, video kendiliğinden duraklıyor ve yakalama
   **0 kare** dönüyor. `seeked` olayı kompozitörden bağımsızdır.
2. **Taban (baseline) darlığı.** Oynatma yakalaması 8 × 250 ms = klibin
   yalnızca 2 saniyesini örnekliyordu; poz çözümü PARALLAKS ister. Seek yolu
   klibin tamamına yayar: ölçülen zaman damgaları 0.60 → 11.41 sn.

Sözleşme aynı (`KeyframeFrame[]`), füzyon tarafında tek satır değişmez.
Bir seek zaman aşımına uğrarsa o kare ATLANIR, çekim düşmez.

### D.6b Sentetik yörünge üreteci (Zeynep — Gün 4)

`src/engine/vision/trajectory.ts` — Gün 5 poz çözücüsünün doğruluk verisi.
Poz zinciri **kamera→dünya** (D.2) yönündedir ve `toFirstKeyframeOrigin`
zinciri ilk keyframe'e çerçeveler (D.2: dünya orijini = ilk keyframe).
Yörünge saf daire DEĞİLDİR (dikey salınım eklenir) ve sahne düzlemsel
DEĞİLDİR — ikisi de essential matrix için dejenere yapılandırmalardır.
`projectScene` pinhole izdüşüm + görünürlük + deterministik gauss gürültüsü
üretir; kamera arkası nokta NaN + `visible = 0` taşır (sessiz yanlış
izdüşüm yok). Görüntü RENDER EDİLMEZ: çözücünün girdisi nokta eşleşmeleridir.
Kanıt: `scripts/verify-trajectory.mjs`.

### D.10 Poz Çözücü (Emre — Gün 5, `src/engine/vision/pose.ts` + `linalg.ts`)

Essential matrix (normalize 8-nokta) + RANSAC + SVD ayrıştırma (4 aday) +
cheirality (üçgenleme oylaması) → D.2 `PoseTrackRecord[]` zinciri.
`src/engine/vision/linalg.ts`: genel simetrik N×N Jacobi özçözücü (döngüsel
döndürmeler) + 3×3 SVD (bunun üzerine kurulu) — `metrics.ts`teki
`largestEigenvector4` yalnızca 4×4'e özeldi (Horn Sim(3)), essential matrix
hem 9×9 (8-nokta null uzayı) hem 3×3 (E'nin SVD'si) özayrışım istediği için
genel çözücü buraya, tek yere yazıldı.

- **Girdi eşleşmeye kayıtsız:** `PointMatch = {x1,y1,x2,y2}` piksel çiftleri.
  Gerçek boru hattında `flow.ts`'in izlediği köşeler olur; bu modül kaynağı
  bilmez.
- **`recoverPose`/`decomposeEssential` çıktısı İKİLİ GÖRECELİ dönmedir:**
  `X_camB = R · X_camA + t` (kamera `i` → kamera `i+1`). D.2'nin MUTLAK
  `PoseTrackRecord.R` alanıyla (kamera→dünya, ilk keyframe=kimlik)
  KARIŞTIRILMAZ — `chainPoseTrack` ikisi arasındaki zincirleme dönüşümü
  yapar (aşağıda).
- **Ölçek Gün 6'ya bırakılır:** essential matrix `t`'yi yalnızca YÖN olarak
  verir (|t|=1). `scaleA=1, scaleB=0` (kimlik varsayımı) — D.7 başarı ölçütü
  yalnızca ROTASYONDUR, bu fazda öteleme büyüklüğüne karar VERİLMEZ.
- **D.7 doğrulaması** (`scripts/verify-pose.mjs`, Zeynep'in `trajectory.ts`
  üretecine karşı, model YÜKLEMEZ): izole çift 0.00000° (gürültüsüz),
  12-keyframe zincirde ADIM hatası medyan 0.121° / maks 0.292° (D.7 eşiği
  <1-2°'yi geçer), %30 kaba aykırı değerle 0.183°. **Biriken (mutlak) zincir
  hatası GATE EDİLMEZ** — D.8 zaten "loop closure yok, sürüklenme birikir"
  diyor; adım hatası (ardışık keyframe'lerin GÖRECELİ dönmesi) doğru ölçüttür.

**HATA GEÇMİŞİ (dürüstlük kaydı — bu turda 5 gerçek hata bulundu ve
düzeltildi, sırayla):**

1. `svd3`'ün üçüncü tekil vektörü (`U₂`) KOŞULSUZ çapraz çarpımla
   dolduruluyordu ("σ₂≈0 varsayımıyla"). Ham (rütbe-2 kısıtından önceki)
   essential matrix adayında σ₂ genelde sıfır DEĞİLDİR — o dalda `M·V₂/σ₂`
   formülü kullanılmalı. Sabit 3×3 test matrisinde çapraz çarpım TAM TERS
   işaretli `U₂` üretti → `det(U)` etkilenmedi ama genel SVD reconstrüksiyonu
   bozuktu.
2. Aynı fonksiyonda eşik MUTLAK 1e-9'du. σ₀ büyükken (essential matrix'te
   tipik ~4) rütbe-2 kısıtlı bir E'nin σ₂'si tam sıfır olmayıp ~1e-8
   mertebesinde kalabiliyordu — bu, `M·V₂/σ₂` bölmesi için yetersiz
   hassasiyette (pay da aynı mertebede küçük): bölüm kayan nokta gürültüsüne
   düşüyor, `U`'nun üçüncü sütunu sıfıra yakın çıkıyor, `det(U)≈0` (ortogonal
   DEĞİL) oluyordu. Eşik artık σ₀'a BAĞIL.
3. Rütbe-2/eşit-tekil-değer (essential matrix'e özgü σ₁=σ₂) kısıtlaması ÖNCE
   Hartley-normalize uzayında uygulanıp SONRA denormalize ediliyordu. Hartley
   T'si benzerlik dönüşümüdür (ötelemeli) — homojen 3×3 olarak ORTOGONAL
   DEĞİLDİR; tekil DEĞERLER yalnızca ortogonal dönüşümler altında korunur.
   Sıra: ÖNCE denormalize, SONRA kısıtla (kısıt yalnızca gerçek kalibre
   uzayda anlamlıdır).
4. **KÖK NEDEN (asıl hata).** Satır kurulumu standart (x,y,1) izdüşümsel-
   düzlem sözleşmesini kullanır (Hartley T'nin alt satırı [0,0,1] — doğru,
   dokunulmadı). Ama bu projenin kamera ışını **z=-1**'dir (`pixelToRay`,
   kamera −z'ye bakar): gerçek homojen ışın (xn,yn,-1)'dir, (xn,yn,1) DEĞİL.
   Satırlar örtük biçimde (xn,yn,1) kullandığından çıkan E TEK bileşenin (z)
   işareti ters bir sözleşmeye aitti — genel (düzlemsel olmayan) hareket
   geometrisinde bu basit bir ölçek/genel işaret çevirmesine İNDİRGENMEZ.
   Saf yatay (Y-ekseni) dönmede z-işareti tesadüfen fark etmiyormuş GİBİ
   göründü (rotasyon hatası ~0°, dikey öteleme sıfır olduğu için dejenere özel
   hâl) — bu ÇÜRÜTÜCÜ kanıt sanılıp önce YANLIŞ bir "ters R" düzeltmesi
   yapıldı (aşağıda 5. madde); gerçek (düzlemsel olmayan, dikey bileşenli)
   12-keyframe yörüngede aynı kod adım başına 2-3°'ye düşüyordu — z-işareti
   orada telafi olmuyordu. Düzeltme kapalı formda `fixHomogeneousZSign`:
   satır açılımından türetilir, yalnızca üçüncü SATIR/SÜTUNUN köşe-dışı dört
   girdisi (row-major indeks 2,5,6,7) işaret değiştirir. Doğrulandı:
   düzeltilmiş E, yörünge verisinden BAĞIMSIZ kurulan `Etrue=[t]ₓR` ile
   ×1e-6 hassasiyette eşleşti.
5. Madde 4 keşfedilmeden ÖNCE, o zamanki (yanlış) E'yi telafi etmek için
   `decomposeEssential`'da `U·W·Vᵀ`'nin sonucu TERS ALINIYORDU (yanlışlıkla
   "standart kütüphane kamera2→kamera1 veriyor" sanılmıştı). Bu, saf yatay
   dönme test senaryosunda TESADÜFEN doğru sonucu veriyordu (ölçülen: 0.00°)
   ama genel harekette YENİ bir hataya yol açıyordu. Kök neden (madde 4)
   düzeltildikten sonra standart ders kitabı formülü (Hartley & Zisserman
   §9.6.2) DOĞRUDAN doğru sonucu verdi — ters alma KALDIRILDI.

Ayrıca test tarafında (kod değil, ölçüm hedefi) bir hata: `verify-pose.mjs`
başlangıçta `recoverPose`'un İKİLİ GÖRECELİ çıktısını `toFirstKeyframeOrigin`
çıktısının MUTLAK `p.R`'siyle DOĞRUDAN karşılaştırıyordu — 2 keyframe'de
`gt[1].R` sayısal olarak `Rrel`'in TERSİDİR, bu yüzden doğru kod bile ~80°
"hata" gösteriyordu. Düzeltme: `trueRelativeRotation(rawA, rawB)` yardımcı
fonksiyonu `RBᵀ·RA`'yı HAM pozlardan doğrudan kurar.

### D.11 Ölçek Hizalama + Keyframe Zinciri (Emre — Gün 6, `src/engine/vision/scale.ts`)

Üç parça: (1) MUTLAK D.2 poz çiftinden dünya noktası üçgenleme (Gün 5'in
göreceli `triangulateDepths`'i üzerine kurulu — `X_camB=Rrel·X_camA+trel`
`chainPoseTrack` ile AYNI türetme), (2) `d_metric ≈ scaleA·d_pred + scaleB`
kapalı-form en küçük kareler (D.2), (3) akış tabanlı keyframe seçimi
(parallaks + izleme kalitesi eşiği, D.8 hedefi 8-20 keyframe).

- **`triangulateWorldPoint`** yalnızca GÖRECELİ pozu (`Rrel,trel`) kullanır —
  bu, iki mutlak pozun ORTAK bir rijit dönüşümle taşınmasından ETKİLENMEZ
  (Rrel/trel türetimi de ortak dönüşüm altında değişmez). Yani `chainPoseTrack`
  çıktısı (ilk-keyframe-orijinli çerçeve) ile başka bir çerçevedeki pozlar
  CHEIRALITY/DERİNLİK amacıyla karışık kullanılabilir; yalnızca MUTLAK dünya
  konumu (`tri.point`) istendiğinde pozların TUTARLI bir çerçevede olması
  gerekir (test kanıtı: `verify-scale.mjs` [2] notu).
- **`fitScaleAlignment`** derinlik MODELİNDEN bağımsızdır (D.5 "harness
  bağımsızlığı" kuralının aynısı) — `getPredictedDepth` çağıranın sağladığı
  bir fonksiyondur, model yükü bu modülde YOKTUR.
- **`selectKeyframes`** referansı HER yeni keyframe'de günceller (ona kayar);
  güncellenmeseydi parallaks asla düşmez, ilk eşikten sonra HER kare keyframe
  olurdu. Son kare her zaman keyframe'dir (D.8: eşik video sonunda
  tetiklenmemiş olabilir, sessizce dışarıda bırakılmaz).
- **Ölçek Gün 5'ten devralınan kısıtla uyumludur:** `d_metric` (üçgenlenen
  derinlik) pose zincirinin KENDİ tutarlı ama keyfi ölçeğindedir — mutlak
  metre DEĞİLDİR (essential matrix `t`'yi yön olarak verir). Bu fazda "metrik"
  sözcüğü D.2'nin `scaleA/scaleB` alanlarının DOLDURULMASI anlamına gelir,
  gerçek dünya metresine kalibrasyon bu fazın kapsamı dışıdır (D.8).

**Doğrulama** (`scripts/verify-scale.mjs`, zincirin 14. script'i, model
YÜKLEMEZ, Zeynep'in `trajectory.ts`'ine karşı):

| Test | Sonuç |
|---|---|
| Üçgenleme (gerçek poz, gürültüsüz, tek nokta) | 6.24e-8 dünya birimi hata |
| Üçgenleme (gerçek poz, 200 nokta RMS) | 1.78e-7 dünya birimi |
| Üçgenleme (Gün 5'in TAHMİN ettiği poz zinciriyle) | 100/100 cheirality |
| Ölçek uydurma (sentetik a=2.7,b=-0.4 + gürültü) | â=2.6995, b̂=-0.4012 |
| Ölçek uydurma (dejenere: sabit d_pred) | `null` (sessiz yanlış sayı YOK) |
| Uçtan uca (üçgenleme→hizalama zinciri) | beklenen â/b̂'den <%5 sapma |
| Keyframe seçimi (60 kare, 150° yay) | 8 keyframe (D.8 hedefi: 8-20) |
| Determinizm | birebir |

**Bilinen sınır (dürüstçe bildirilir, D.8 ile aynı ruhta):** bu modül gerçek
video/derinlik-modeli entegrasyonuyla UÇTAN UCA test EDİLMEDİ — Gün 6'nın
plan metni "30 sn'lik gerçek klip"ten bahsediyor, burada doğrulama SENTETİK
yörünge + sentetik-bozulmuş "d_pred" ile yapıldı (projenin D.7 kesme
sırasının 2. maddesiyle aynı gerekçe: "gerçek veri kümesi metrikleri →
sentetik ground-truth, sentetik de savunulabilir sayıdır"). Gerçek video
entegrasyonu (Gün 7'nin "füzyon" adımı) bu modülü `flow.ts`'in izlediği
noktalarla ve `depth.ts`'in gerçek çıktısıyla besleyecek — arayüz
(`PointMatch`, `getPredictedDepth`) bunu KABUL EDECEK biçimde tasarlandı,
ayrıca bir sözleşme değişikliği gerekmez.

### D.9 Entegrasyon

- Node graph'a **`pose`** ve **`fusion`** düğümleri; parametreleri ParamDef'e
  oturur (graf tek doğruluk kaynağı korunur).
- 5. render modu **`splat`** → `registerRenderMode`, `SPLAT_PARAMS`.
- Git: `feat/eval-flow-pose` (Emre) + `feat/splat-render` (Zeynep), akşam
  `main`'e; AI izi kuralı aynen (ne + neden, insan yazarı).
- **Gün 7 (durum):** `src/engine/vision/fusion.ts` — keyframe bulutlarını
  dünya çerçevesinde birleştirip GaussianBuffer'ı doldurur (`fuseKeyframes`:
  seyrek splat pikseli + flow eşleşmeleri + yoğun d_pred → ölçek hizalaması
  → dünya splat'ları + keyframeIndex; `fuseVideoFrames`: video köprüsü —
  yoğun depth/rgb haritalarını alır). Sentetik yörüngede doğrulandı
  (verify-fusion.mjs: ölçek 0.3691 vs 1/2.7, konum RMS 3.14e-3, ATE 2.99e-3).
- **Gün 7 KABLOSU (ilk sürüm kaydı):** `src/engine/vision/
  videoPipe.ts` köprünün canlı ucudur — `captureKeyframes` (rVFC, zaman
  kapılı 8 kare) + `buildFusionScene` (flow → chainPoseTrack →
  fuseVideoFrames → `fitBufferToCamera` kamera uyumu) + App.tsx `video → 3B`
  butonu → `Engine.setGaussians` → splat modu. **Güncel uygulama farkları:**
  keyframe boyutu 384×288'dir; `CapturePanel` dosyayı seek ile klibe yayarak
  örnekler. `buildFusionScene` varsayılan olarak Depth Anything derinliğini dener ve
  başarısız olursa luminance vekiline döner; `diagnostics.derinlikKaynagi`
  kullanılan kaynağı bildirir. Bu yolun ölçeği üçgenleme başarısızsa metrik
  değildir. Fit yalnız sunum kopyasına uygulanır. `verify-videopipe.mjs` ve
  `verify-video-depth.mjs` ilgili sözleşmeleri denetler.

### D.9 · Gerçek 3DGS eğitim yolunun sınırı

- `App.tsx` içindeki `3D eğit`, yüklenen **video dosyasını**
  `egitim3dgs.ts`'ye verir. `splat.js` keskin kareleri seçer; SfM kamera
  pozları/seyrek noktalar üretir; `GSTrainer` WebGPU üzerinde anizotropik
  Gaussian konum, ölçek, dönüş, opaklık ve SH renk parametrelerini optimize
  eder. Eğitimden ayrılan kare için PSNR raporlanır.
- Eğitim çıktısı D.1'deki `gSplatA/B/C` veya `Engine.setGaussians` yoluna
  yazılmaz. Ayrı `SessionView` aynı `splat.js` rasterizer'ıyla çizer;
  `exportPlyBlob` standart 3DGS `.ply` dosyası üretir. Ana araç çubuğundaki
  `PLY` düğmesi D.1 surfel sahnesinindir; eğitim görünümündeki `.ply indir`
  düğmesi eğitilmiş sahnenindir.
- **Serbest gezinme sınırı (2026-09-26):** WASD kamerası nokta bulutu
  yarıçapıyla değil, eğitim kameralarının hacmiyle sınırlanır:
  `Egitim.kameralar` (çekim sırasıyla kamera merkezleri) ve `pivot`'tan
  kurulan (cam_i, cam_i+1, pivot) üçgen yelpazesi + `FLY_PAY` × medyan
  kamera–pivot uzaklığı pay (`egitimControls.flySiniri`). Kamera sınıra
  dayanınca yüzey boyunca kayar. Yörünge modunun yakınlaştırma sınırı
  değişmedi.
- GPU profili uygulamada NVIDIA için `standard`/40 kare/10.000 iterasyon,
  diğer adaptörlerde `quick`/24 kare/3.000 iterasyondur. Bu yalnız ölçülmüş
  Intel ve RTX davranışına dayalı temkinli seçimdir; diğer cihazlarda kalite
  veya başarı garantisi değildir. Sayılar ve klip
  `src/vendor/splat.js/VENDORED.md` içinde tutulur.
- Eski D.1b WebGL surfel rasterizasyonu ile 3DGS eğitim renderer'ının
  eşitliği iddia edilmez. Pozdan serbest çizim/coverage isteği eski surfel
  hattının fotometrik önerisine aittir; 3DGS eğitimi için ön koşul değildir.
- **GPU kilidi (2026-09-24):** splat.js bizim GPU kuyruğumuzu bilmez. Eğitim
  sürerken hızlı 3B harita paneli çalışamaz; panel çalışırken `3D eğit`
  başlayamaz.

## Model ve Runtime

- Depth Anything V2 Small, YOLOS Tiny, IS-Net ve ORT runtime dosyaları
  `public/` içindedir; CDN yok. `npm run fetch:assets` ile yeniden üretilir.
- **`public/` = yayınlanan dosyalar (2026-09-24).** Vite `public/`'i olduğu gibi
  `dist/`'e kopyalar. `npm run build` önce `fetch:assets` çalıştırır; betik
  `public/models` ve `public/ort`'u listesinin birebir aynası yapar (listede
  olmayan ağırlık silinir, lisansı kapalı eski modeller dağıtıma sızmaz) ve
  `public/` içinde video varsa build'i durdurur. Test klipleri
  `assets/test-clips/` altındadır.
- Gerçek 3DGS eğitim kodu `src/vendor/splat.js/` altında sabitlenmiştir;
  görüntü kareleri kullanıcının yerel dosyasından gelir.
- **Önbellek (vercel.json):** URL'si içerik değişince değişmeyen `/ort/*` ve
  `/models/*` `max-age=0, must-revalidate`; Vite'ın içerik karmalı
  `/assets/*` dosyaları 1 yıl `immutable`. `onnxruntime-web` tam sürüme
  sabitlidir (`@huggingface/transformers`'ın beklediği gece sürümü); JS ile
  WASM uyuşmazlığı böylece önlenir.
- **Lisans bildirimi:** `npm run build`, `scripts/gen-third-party-notices.mjs`
  ile `public/THIRD_PARTY_NOTICES.txt` üretir: üretim npm paketleri,
  vendored splat.js ve mediabunny (MPL-2.0), sunulan model ağırlıkları
  (kaynak URL'leriyle). `Xenova/yolos-tiny`'nin kendi etiketi yoktur; lisansı
  temel modeli `hustvl/yolos-tiny` (Apache-2.0) üzerinden atfedilir.
- `numThreads = 1` (COOP/COEP gerekmez). WebGPU yolu `model_fp16.onnx` + jsep build.
- Yükleme/çıkarım süreleri her kurulumda ölçülür (`console.time` → log).

## Her Gün, Unutma

1. Sabah 15 dk senkron: dün bitti / bugün var / tıkanan.
2. Öğle + akşam 1'er dakika ekran kaydı — çirkin halleri de kaydedin, geriye dönük üretilmez.
3. Akşam 30 dk ortak entegrasyon: o günün shader'ı gerçek motorda. Sandbox'ta kalan shader "bitmedi" sayılır.
