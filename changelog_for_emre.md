# changelog_for_emre

Tur 10 — Arka Plan Katmanı (Inpainting), Maske Dilate/Feather ve İnce Kabuk Sırt Kapağı

Tarih: 11 Ağustos 2026
Proje: `C:\Users\Emre\Desktop\Spatial-Canvas-main - Kopya`

---

## Amaç

- `image_9121d4.jpg` (Özüm): özne arkasındaki siyah boşluğun point cloud'da perde/çanak olarak görünmesi → arka plan katmanı (depth inpainting) eklendi.
- `image_917391.jpg` (Karina): yüz/el bölgelerindeki RMBG < 0.5 hataları → maskeye dilate + feather eklendi.
- Özne arka kenarındaki ön plan dökümü → ince kabuk sırt kapağı (thin shell back-cap) eklendi.

## Tasarım Kararı (Bu Turda Çözüldü)

- Shader'lar (`pointCloudMaterial.ts`, `asciiMaterial.ts`) RGB okumuyor — renk yalnızca z-derinlik rampasından geliyor.
- Bu nedenle arka plan katmanı RENKSİZ, yalnızca DEPTH inpainting içeriyor; ayrı RGB DataTexture gerekmedi.
- Arka plan, simülasyona girmeyen AYRI statik 384² RGBA32F DataTexture (`backdropTexture`).
- Ön plan texture'ındaki sert binary sözleşmesi (w ∈ {0,1}) değişmedi — ölü arka plan texel'leri ön planda korunuyor.
- Aynı material paylaşılıyor; `uPositions` nesne başına `onBeforeRender`'da takas ediliyor:
  - arka plan → `backdropTexture`
  - ön plan → `simulation.positionTexture`
- `renderOrder`: arka plan 0, ön plan 1.

## Yapılan Değişiklikler

### `src/engine/reconstruction/silhouette.ts`

- Yeni sabitler: `MASK_DILATE_RADIUS = 4`, `MASK_FEATHER_RADIUS = 2`
- Yeni export: `dilateAndFeatherMask(mask, w, h)` — önce dilate (minMaxPass max ×2), sonra boxBlur (feather)
- Yardımcılar: `minMaxPass`, `boxBlur`
- Kritik nokta: dilate maskenin KENDİ çözünürlüğünde (1024²) uygulanıyor; siluet AND eşiği (≥ 0.5) aynen kalıyor → uzak arka plan hâlâ 0 (perde koruması sürer), yalnızca özne İÇİNDEKİ RMBG hataları kapanır.
- Tur 9'dan korunanlar: sert binary `alpha`, `isForeground: Uint8Array`, `minCoreSize` (%10), geometri kuralları (delik/gradyan/duvar/uzuv/boşluk).

### `src/engine/reconstruction/segmentation.ts`

- `segmentForeground` çıktısı artık `dilateAndFeatherMask` ile yumuşatılmış maske dönüyor.

### `src/engine/reconstruction/sampler.ts`

- Yeni sabitler:
  - `THIN_SHELL_Z = 0.05`, `THIN_SHELL_PX = 3` (ince kabuk)
  - `BACKDROP_OPACITY = 0.4`, `BACKDROP_Z_PUSH = 0.04`, `INPAINT_MAX_LEVEL = 5` (arka plan)
- `sampleVolumePositions` (ince kabuk):
  - `zFront` kenar dökümünden ÖNCE kaydediliyor; `dPx` döküm bloğu dışına alındı (tek hesaplama).
  - Döküm sonrası: `if (dPx <= THIN_SHELL_PX) z = Math.min(z, zFront - THIN_SHELL_Z)` — özne arka kenar bandındaki döküntüler 0.05 geriye itiliyor (sırt kapağı).
- `sampleBackdropPositions(depth, depthWidth, depthHeight, opts)`:
  - Ön plan ile aynı grid/remap; siluet `buildSilhouette` ile AYNI girdilerden üretiliyor → texel hizası garanti.
  - Delik = siluet (alpha ≥ 0.5); `inpaintBackgroundDepth` ile dolduruluyor.
  - Siluet texel'lerine: `xyz` = inpaint duvar z − `BACKDROP_Z_PUSH`, `w = BACKDROP_OPACITY`.
  - Siluet dışı texel'ler ölü: (0, 0, 0, 0).
- `inpaintBackgroundDepth` (push-pull piramit):
  - Pull: seviyeler yarıya iner, ağırlıklı ortalama; top bilinmeyen = `rootFallback` (bilinen küresel ortalama).
  - Push: bilinmeyen piksel, bir üst (dolu) seviyeden bilinear örnekleme (`sampleLevel`).
- `sampleLevel` HATA DÜZELTMESİ (NaN): `x0/y0` yalnızca alttan kelepçeleniyordu — tek boyutlu piramit seviyelerinde (ör. 129 → 64) siluet kadraja değdiğinde son satır/sütun `Float32Array` DIŞINA okuyordu → `undefined` → NaN yayılıyordu. Artık üstten de kelepçeli: `Math.min(lvl.w - 1, ...)`.
- Düzeltme: arka plan çıktısının x/y kanalları başta yazılmıyordu (xy hizalama testi patladı) → `out[o] = wx; out[o+1] = wy` eklendi.
- `index.ts` exportları güncellendi: `THIN_SHELL_Z`, `BACKDROP_OPACITY`, `dilateAndFeatherMask`, `sampleBackdropPositions`, vb.

### `src/engine/buffers.ts`

- `createBackdropTexture()`: RGBA32F 384×384 DataTexture (y-flip, Nearest).
- `fillBackdropFromDepth(tex, depth, dw, dh, opts)`: `sampleBackdropPositions` çağırır (`POSITION_TEXTURE_SIZE` vb.).

### `src/engine/Engine.ts`

- `readonly backdropTexture`, `backdropPoints: THREE.Points`, `ownsBackdropMaterial`.
- Kurulum: `createBackdropTexture()` + `createPointsCloud(backdropTexture)`; renderOrder 0/1; `onBeforeRender`'da `uPositions` takası.
- `setPointsMaterial(material)`: material ön plan ile paylaşılır (placeholder yok edilir); `THREE.Points.material` tipi `Material | Material[]` olduğundan `as THREE.Material` cast'leri.
- `setDepth`: `fillPositionsFromDepth` sonrası `fillBackdropFromDepth(..., { foregroundMask: mask })`.
- `dispose`: backdropTexture, backdropPoints.geometry, sahip olunan placeholder material.

### `scripts/verify-sampler.mjs`

- Test 20 (arka plan katmanı): rim sahnesi — siluet texel w ≈ BACKDROP_OPACITY (Float32 yuvarlaması → 1e-6 epsilon), z < −0.8 (inpaint duvarı), fg arkasında, xy hizalı (1e-9), tam ön plan görüntüsü dolu, düz d=0 → hepsi ölü.
- Test 21 (ince kabuk): rim sahnesi — sınır bandı texel (184, 192) z ≤ −0.25 (zFront −0.2 − kabuk 0.05); iç kısım (80, 192) −0.2 korunur.
- Test 22 (dilate/tüy): 24×24 blok — iç > 0.5 korunur, 4px dış halka > 0.5, 12px ötede 0, (0, 0.5) arası kısmi değerler var (feather).
- Test 23 (regresyon — NaN): 65² TEK boyut + sol yarı fg (çerçeveye değen siluet) → z sınırlı ve [-1, +1] içinde; kelepçesiz `sampleLevel` bunu NaN ile patlatıyordu.

### `scripts/verify-curtain.mjs`

- Başlık "Tur 9+10"; importlar güncellendi (`BACKDROP_OPACITY`, `sampleBackdropPositions`, `dilateAndFeatherMask`, `resampleBilinear`).
- Gerçek yol: RMBG çıktısı → `dilateAndFeatherMask(segRes.output.data, MASK_SIZE, MASK_SIZE)` (segmentation.ts ile birebir ayna).
- Test 5b (arka plan katmanı): tüm 384² texel'de w>0 → ayak izi maske içinde (TEK YÖNLÜ oracle — siluet geometri kuralları ayak izini kesebilir), w ≈ BACKDROP_OPACITY (epsilon), z ∈ [-1,+1] sınırlı; w==0 → z==0.

## Doğrulama Sonuçları

- `npm run typecheck` ✓ (cast düzeltmeleri sonrası temiz)
- `npm run verify` — 7/7 ✓ (positions, depth, preset, volume, sampler, seg, curtain)
- `npm run build` ✓ (vite, 793ms)

Curtain gerçek görsel (`C:/Users/Emre/Desktop/thumbnail.jpg`, 720×720):

```
rmbg           : ~1 s
maske          : ön plan %32.9 (344934/1048576) — dilate sonrası Tur 9'daki %19.7'den arttı
depth          : ~1.2 s
sampler        : 136-745 ms
maske bbox     : x [-1.000, 0.980] y [-0.999, 0.991]
noktalar       : 48480 canlı / 98976 ölü (147456), z [-0.98, 0.91]
kaide dökümü   : 14462 nokta z < -0.5 (hepsi öznenin kendi sınır bandında)
kütle merkezi  : nokta (-0.098, 0.003) vs maske (-0.097, 0.004) → Δ 0.001
arka plan katmanı: 46526 canlı nokta (w = 0.4), z [-0.97, 0.89] — oklüzyon deliği dolu
```

## Karşılaşılan Hatalar ve Dersler

1. **Float32 strictEqual tuzağı**: `0.4000000059604645 ≠ 0.4` → sabit karşılaştırmalarda 1e-6 epsilon kullan.
2. **Oracle yönü**: arka plan silueti izler, ham maskeyi DEĞİL — siluet geometri kuralları (gradyan kırığı vb.) ayak izi içindeki bazı gerçek arka plan pikselini ölü bırakır → test tek yönlü (w>0 ise footprint içinde) olmalı.
3. **`THREE.Points.material` tipi** `Material | Material[]` → `as THREE.Material` cast gerekiyor (setPointsMaterial + dispose).
4. **`sampleLevel` OOB**: NaN'ı izole etmek için seviye seviye tarama yapıldı; sentetik testler (düz + ortada delik) yakalamadı çünkü OOB yalnızca TEK boyutlu seviye + çerçeveye değen siluet kombinasyonunda oluşuyor. Regresyon testi eklendi.

## Not

- Push/commit YAPILMADI (kullanıcı istemedi).
- `npm run verify` ve `npm run build` zinciri tamamen yeşil.

---

# Tur 11 — Fotoğraf Rengi (uImageTexture) ve Tek Buffer fg+bg

Tarih: 11 Ağustos 2026
Proje: `C:\Users\Emre\Desktop\Spatial-Canvas-main - Kopya`

---

## Amaç

- Parçacıklar mavi derinlik rampası yerine ORİJİNAL FOTOĞRAF rengini göstersin (`uImageTexture`).
- Arka plan öznenin arkasında siyah delik bırakmasın: fg+bg TEK buffer/pass üzerinde birleştirildi — ayrı backdrop katmanı, material takası, `BACKDROP_Z_PUSH` oyunları kaldırıldı.

## Tasarım Kararı (Bu Turda Çözüldü)

- **Renk bağlama**: Önem tabanlı örnekleme (`buildImportanceRemap`) texel eşlemesini büktüğü için fotoğraf GPU'ya HAM bind edilip shader'da `aUv` ile okunamaz. Renkler konumlarla AYNI remap üzerinden CPU'da `sampleImageGrid` ile 384² RGBA8 grid'e yeniden örneklenir: texel (i,j) hem konumda hem renkte aynı pikseli gösterir. Render: `uHasImage = 1` → `texture2D(uImageTexture, vUv).rgb`; `uHasImage = 0` (kamera/video yolu) → derinlik rampası.
- **Tek buffer**: Ölü texel konsepti KALDIRILDI. Siluet dışı her texel arka plan noktası taşır: `w = BACKDROP_OPACITY (0.4)`, gerçek arka plan derinliği, `z = (d−0.5)·2 − BACKDROP_Z_PIN (0.15)` (arka sınıra kırpılır; öznenin kendi derinliğinden her zaman 0.05 geride). `BACKDROP_Z_PUSH`, `inpaintBackgroundDepth`, `sampleBackdropPositions`, ayrı katman texture'ı/material'ı/`renderOrder`/`onBeforeRender` takası TAMAMEN silindi — inpaint gereksizdi çünkü arka plan texel'leri zaten fotoğrafın gerçek arka plan pikselleri.
- Shader'da w iki seviyeli: 1 = ön plan, 0.4 = arka plan (ara değer yok, perde yok).

## Yapılan Değişiklikler

### `src/engine/reconstruction/sampler.ts`

- `BACKDROP_Z_PUSH = 0.04` + `INPAINT_MAX_LEVEL = 5` → `BACKDROP_Z_PIN = 0.15`.
- Ölü texel dalı → arka plan noktası: gerçek derinlik örneklenir, `z = clamp((d−0.5)·range − BACKDROP_Z_PIN)`, `w = BACKDROP_OPACITY`; kavis/döküm hesabı yapılmaz.
- Yeni: `sampleImageGrid(rgb, imgW, imgH, depth, depthW, depthH, opts)` → N×3 Float32Array (0..1) + `sampleBilinearRgb` + `ImageSampleOptions` — remap `depth` üzerinden konumlarla BİREBİR kurulur (`x = remap ? remap.xOf(u)·sx − 0.5 : u·imgW − 0.5`).
- Silinen: `sampleBackdropPositions`, `inpaintBackgroundDepth`, `sampleLevel`, arka plan katmanı dokümantasyonu.

### `src/engine/reconstruction/index.ts`

- Export'lar: `sampleImageGrid`, `ImageSampleOptions` eklendi; `sampleBackdropPositions`, `BackdropSampleOptions` çıkarıldı.

### `src/engine/buffers.ts`

- Silinen: `createBackdropTexture`, `fillBackdropFromDepth`, `BackdropFillOptions`.
- Yeni: `createImageColorTexture()` — RGBA8 (UnsignedByteType), `SRGBColorSpace`, `flipY=true`, NearestFilter, 384²; `fillImageColorTexture(tex, rgb, imgW, imgH, depth, depthW, depthH, opts)` + `ImageColorFillOptions`.

### `src/engine/Engine.ts`

- Silinen: `backdropPoints`, `ownsBackdropMaterial`, `renderOrder`/`onBeforeRender` uPositions takası, dispose/import/constructor'daki backdrop plumbing.
- Yeni: `imageColorTexture`, `photoData`, `photoWidth`, `photoHeight` alanları; `setPhoto(source: HTMLCanvasElement | HTMLImageElement)` — RGB'yi Float32Array (0..1) çeker, texture'ı lazy üretir, depth varsa hemen doldurur, tüm `renderModes` material'larına `uImageTexture`/`uHasImage` işler.
- `setDepth`: `fillBackdropFromDepth` yerine `photoData` varsa `fillImageColorTexture`; sıra bağımsız (setPhoto→setDepth veya tersi).

### `src/shaders/pointCloudMaterial.ts` + `asciiMaterial.ts`

- Uniform'lar: `uImageTexture: THREE.Texture`, `uHasImage: number`.
- Vertex: `vUv = aUv`.
- Fragment: `col = uHasImage > 0.5 ? texture2D(uImageTexture, vUv).rgb : (rampa/uColor karışımı)`; alpha iki seviyeli (fg 1, bg 0.4). Ascii'de fotoğraf modunda hem glif hem hücre dolgusu `uImageTexture`'dan gelir.

### `src/App.tsx`

- Fotoğraf yolunda `setDepth`'ten ÖNCE `engine.setPhoto(source)` çağrılır (kamera/video yolu çağırmaz → rampada kalır).

### `scripts/verify-sampler.mjs`

- Test 2: düz d=0 → TÜM grid arka plan (w = BACKDROP_OPACITY, z = −1 kırpılmış).
- Test 5/6/8/9/11/12/13/15/16/19/20: "ölü texel (w=0, z=0)" iddiaları → "arka plan noktası (w = BACKDROP_OPACITY, gerçek z − PIN)" iddiaları; iki seviyeli w taraması; derin saf arka plan z = −1 tam.
- Test 20 yeniden yazıldı: tek buffer — arka plan noktası kendi texel grid konumunda, tüm z sınırlı (NaN yok).
- Yeni test 23 (`sampleImageGrid`): düz renk → her texel aynı renk (k adımı 3'ün katı olmalı!); X-gradyan → kenar texel x1 kelepçeli bilinear, merkez texel doğrusal.

### `scripts/verify-curtain.mjs` (tamamen yeniden yazıldı)

- Tur 11 sözleşmesi: w ∈ {1, BACKDROP_OPACITY}, ölü texel YOK; ön plan noktası maske bbox'ı dışına taşamaz (TEK YÖNLÜ oracle — sınır bandında sampler'ın yumuşak maske kararı binary ayak izinden 1-2 texel sapabilir); arka plan noktaları gerçekten üretildi (texel sayısı > %5), uzak duvar z ≤ −0.9 raporu.
- Yeni test 6: `sampleImageGrid` — seçili 4 texel bağımsız `bilinearRgb` okumasıyla birebir (renk hizası tam).

### `scripts/verify-positions.mjs`

- d=0 → z = −1, w = BACKDROP_OPACITY (Float32 → 1e-6 epsilon); alt yarı/fade sözleşmeleri aynı şekilde güncellendi.

## Doğrulama Sonuçları

- `npm run typecheck` ✓, `npm run build` ✓ (vite, 819ms), `npm run verify` — 7/7 ✓.

Curtain gerçek görsel (`C:/Users/Emre/Desktop/thumbnail.jpg`, 720×720):

```
rmbg           : ~1.2 s
maske          : ön plan %32.9 (344934/1048576)
depth          : ~0.8 s
sampler        : 134-248 ms
maske bbox     : x [-1.000, 0.980] y [-0.999, 0.991]
noktalar       : 46526 ön plan / 100930 arka plan (147456), z [-0.98, 0.91]
arka plan      : 28216 texel z ≤ −0.9 (uzak duvar → PIN tabanına sabitlenmiş)
kütle merkezi  : nokta (-0.120, -0.005) vs maske (-0.097, 0.004) → Δ 0.025
renk grid      : 4 texel bağımsız bilinear okumayla birebir eşleşti
```

## Karşılaşılan Hatalar ve Dersler

1. **Float32 strictEqual tekrar**: `0.4000000059604645 ≠ 0.4` — verify-positions'ta w karşılaştırmaları epsilon'a alındı.
2. **Oracle yönü**: Sınır bandında sampler yumuşak maskeden karar verir, binary ayak izinden değil → bg noktası ayak izi İÇİNDE de olabilir. Perde iddiası yalnızca tek yönlü: w=1 noktası ayak izi dışına çıkamaz.
3. **Türkçe string içinde kesme işareti**: `'...−1'e yaklaşır'` string'i kırar (JS tek tırnak) → çift tırnak veya farklı ifade.
4. **RGB dizisinde adım**: 3 kanallı `Float32Array`'de texel adımı 3'ün katı olmalı — `k += 257` kanal kaymasıyla ROTATED değerler okutuyordu (0.6, 0.2, 0.4).

## Not

- Push/commit YAPILMADI (kullanıcı istemedi).
- `npm run verify` ve `npm run build` zinciri tamamen yeşil; kamera/video yolu `uHasImage = 0` ile derinlik rampasına düşer (fotoğraf rengi yalnızca fotoğraf yolunda).

---

# Tur 12 — Video Doku Temizliği, Canlı Nesne Ayırma ve Renk Modu Kontrolü

Tarih: 11 Ağustos 2026
Proje: `C:\Users\Emre\Desktop\Spatial-Canvas-main - Kopya`

---

## Amaç

- (Şikayet 1) Resim → video geçişinde eski `uImageTexture` GPU önbelleğinin temizlenmesi; video aktifken dokunun her karede güncellenmesi (hayalet yok, canlı renkler).
- (Şikayet 4 & 2) "Nesne ayırma" butonunun shader'a CANLI bağlanması: AÇIK iken arka plan parçacıkları tamamen atılır (beyaz kağıt/perde yok, sadece büst); KAPALI iken tüm sahne çizilir, arka plan derinlik karartmasıyla (×0.4) sönük kalır.
- (Şikayet 3) "Orijinal Renkler" toggle'ı (varsayılan AÇIK): KAPALI iken doku renkleri yok sayılır, Near/Far derinlik gradyanı kullanılır.

## Yapılan Değişiklikler

### `src/engine/Engine.ts`

- Yeni sahiplik alanları: `videoElement`, `videoTexture` (THREE.VideoTexture), `objectSeparation` (false), `useTextureColor` (true).
- `pushSharedUniforms(material)` — TEK KAPI: uImageTexture (video ?? fotoğraf grid'i), uHasImage, uObjectSeparation, uUseTextureColor; `pushSharedUniformsAll()` tüm render modlarına + aktif material'a yayar. setPointsMaterial/setPhoto artık bunu kullanır (inline tekrar yok — gelecek uniform'lar tek noktadan eklenir).
- `setPhoto(source)`: başta `releasePhoto()` — yeni görsel yüklendiğinde eski renk grid'i DISPOSE edilir (önbellek sızmaz, hayalet kalmaz).
- `releasePhoto()`: imageColorTexture dispose + photoData/photoWidth/photoHeight sıfırlama + uniform yayımı. Video dokusu varsa uHasImage yeniden 1.
- `setVideoSource(video | null)`: video → eski video/fotoğraf dokularını dispose eder, canlı `VideoTexture` üretir (sRGB, Nearest, mipmap yok); null → video dokusunu bırakır (teardownSource her kaynak değişiminde çağırır).
- Render döngüsü (raf): `if (videoTexture && videoElement) videoTexture.needsUpdate = true` — videonun her yeni karesi GPU'ya taşınır.
- `setObjectSeparation(on)` / `setUseTextureColor(on)`: canlı uniform yayımı.
- `dispose()`: videoTexture de bırakılır.

### `src/shaders/pointCloudMaterial.ts` + `asciiMaterial.ts`

- Yeni uniform'lar: `uObjectSeparation`, `uUseTextureColor` (yapıcı değerleri 0 / 1 — Engine yönetir, preset parametre değildir).
- Fragment: `uObjectSeparation > 0.5 && vOpacity < 0.5` → discard (arka plan tamamen gider — shader'da atma, buffer'da veri aynı kalır, canlı togglable).
- Renk kararı: `uHasImage > 0.5 && uUseTextureColor > 0.5` → doku; aksi halde point cloud'da Near/Far gradyanı, ascii'de uColor/uBgColor.
- `uObjectSeparation < 0.5 && vOpacity < 0.5` → `col *= 0.4` (arka plan karartması — parlak duvar büstü yutmasın).

### `src/App.tsx`

- Yeni state: `useTextureColor` (varsayılan true) — üst barda "orijinal renkler" checkbox'ı, değişimde `engine.setUseTextureColor`.
- `toggleSegment()`: buton artık shader'a CANLI bağlı (`engine.setObjectSeparation`). Yükleme sırasında maske üretilmemişse ve fotoğraf hâlâ eldeyse (son kaynak/depth ref'lerde) RMBG şimdi yeniden çalıştırılır, `setDepth` maske ile yenilenir — buton sonradan açıldığında da gerçekten ayırır.
- `teardownSource()`: `engine.setVideoSource(null)` — GPU video dokusu her kaynak değişiminde bırakılır.
- Video yükleme + kamera: `engine.setVideoSource(video)` — canlı renkler; fotoğraf ref'leri/maske sıfırlanır.
- `run()`: `lastPhotoRef`/`lastDepthRef`/`maskLoadedRef` saklanır (geç re-segmentasyonun girdileri).

## Doğrulama Sonuçları

- `npm run typecheck` ✓, `npm run build` ✓ (vite, 1.04s), `npm run verify` — 7/7 ✓ (shader değişiklikleri CPU sözleşme testlerini etkilemedi).

## Not

- Video renkleri GPU-side canlı VideoTexture'dan gelir (kare başına CPU grid örneklemesi yok — task'ın öngördüğü `needsUpdate` yolu); luminance yolunda önem bazlı remap nedeniyle ince kenar kayması görülebilir, fotoğraf yolu hâlâ CPU grid'iyle birebir hizalıdır.
- Push/commit YAPILMADI (kullanıcı istemedi).
