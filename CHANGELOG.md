# Değişiklik Günlüğü

Sözleşmeye dokunan her değişiklik buraya yazılır (`ARCHITECTURE.md` kuralı: sessiz sapma yok).
En yeni üstte.

---

## KURAL: git geçmişinde AI izi YOK (herkes, her commit)

Bu reponun git geçmişi ve commit mesajları **hiçbir AI izi taşımaz**. İş
asistanla yapılsa bile iz, "insan yazdı" gibi görünür. Neden: repo ve içerik
(içerik üretim boru hattının parçası) yayına gidiyor; AI atfı herhangi bir
yerde görünürse proje itibarını kaybeder ve bu kural kapanır.

- Commit mesajında (başlık ve gövde) AI/Claude/assistant/opencode sözcüğü
  **yok**. Mesaj yalnızca ne + neden, örn. `day 4: preset schema v1, node
  graph model, render param contract`.
- `Co-authored-by:` veya herhangi bir imza satırı (Claude, opencode, tool adı)
  **asla eklenmez**. Yazar alanı yalnızca insan: Emre `<emregneri01@gmail.com>`
  veya Zeynep.
- CHANGELOG/ARCHITECTURE/README'de "AI yazdı", "asistan ekledi" gibi ifadeler
  **yok**. Sahiplik katman düzeyinde yazılır (`(Emre)` / render katmanı) — bu
  ekip içi iş bölümüdür, iz değildir.
- AI üretimi kodda yorum olarak imzalanmaz ("şu AI'a soruldu" vb.).
- Kural bozulursa geçmiş yeniden yazılır (bu repo Gün 1'de bunu bir kez
  yaptı): iz taşıyan commit amend + force-push ile temizlenir.

---

## ÖNCE BUNU OKU — ilk senkronda `git pull` çalışmaz (2026-08-10)

**Bu tek seferliktir.** Aşağıdaki `reset --hard`'ı bir kez yaptıysan bundan
sonrası normal: `git pull` sorunsuz çalışır, geçmiş bir daha yeniden
yazılmayacak.

Uzak geçmiş yeniden yazıldı. Gün 1 render commit'i `e6b44cd` → **`fd3dabb`**
oldu. **Ağaç birebir aynı, tek bir dosya bile değişmedi**; commit mesajının
sonundaki bir satır kaldırıldı, o kadar. Yazar (`quanvon
<von3dstudio@gmail.com>`) ve tarih korundu — katkı hâlâ Zeynep'in.

Hash değiştiği için `git pull` merge çıkarır. Doğrusu:

```bash
# Push'lanmamış işin YOKSA
git fetch origin && git reset --hard origin/main
```

```bash
# Push'lanmamış işin VARSA — önce sakla, yoksa emeğin uçar
git stash
git fetch origin && git reset --hard origin/main
git stash pop
```

Emin değilsen kontrol et: `git log origin/main..HEAD --oneline` boş çıkıyorsa
push'lanmamış işin yok, doğrudan `reset --hard` güvenli.

Senkron sonrası doğrulama:

```bash
npm install
npm run fetch:assets   # model + ORT runtime gitignore'lı, yeniden indirilir (~120 MB)
npm run verify         # sözleşme testleri geçmeli
npm run dev
```

### Render katmanını doğrudan etkileyen iki şey

1. **`positionTexture`'ın z bileşeni artık orijine ortalı** (−1..+1, eskiden
   0..+2). 0..1 aralığı isteyen shader `pos.z / POINTS_DEPTH_RANGE + 0.5`
   yazar. Gerekçe aşağıda, "Point cloud yanlış merkez etrafında dönüyordu".
2. **`grainPass.ts` başlangıç uniform değerleri değişti** — senin dosyan.
   Kasıtlıysa tek commit'le geri alınır; shader mantığına dokunulmadı. Tablo
   aşağıda, "Render katmanı" başlığında.

### Kırılırsa fark edilmesi zor olan kurallar

Repoya yeni giren (insan veya asistan) bunları bilmeden değiştirmesin:

| Kural | Nerede | Neden |
|---|---|---|
| y-flip **yalnızca** texture upload'unda (`flipY = true`) | `src/engine/buffers.ts` | Shader'da veya UV'de ikinci bir flip eklenirse ekran doğru görünür ama depth/optik akış ters çalışır |
| Model ve ORT runtime **yerel**, CDN yok | `src/depth.ts`, `public/` | Demo günü internet/sürüm kaymasına bağımlı olmamak için; `env.allowRemoteModels = false` |
| `numThreads = 1` | `src/depth.ts` | Tek thread olduğu için COOP/COEP header'ı gerekmiyor. Çoğaltılırsa header şart olur, embed hedefi kırılır |
| `optimizeDeps.exclude` listesi | `vite.config.ts` | Çıkarılırsa Vite ön-paketlemesi ORT'un dinamik import'unu yeniden yazar, dev'de 500 döner |
| Kamera/video yolunda depth modeli **yok** | `src/depth.ts` → `luminanceHeightMap` | Kare başına depth çıkarımı ~400 ms; canlı kamerada imkânsız. Gün 1 kararı, tartışma kapandı |
| Engine pass içlerine yazmaz | `src/engine/Engine.ts` → `TickablePass` | Her pass `update(time)` sunar, Engine çağırır. Yeni pass'ler (Feedback, ChroAber, Neon) aynı kancayı kullanır |
| Render modu material değişimiyle olur | `engine.setPointsMaterial(mat)` | `uPositions` uniform'u her point cloud shader'ında **zorunlu** — konumlar oradan okunur |

---

## 2026-08-11 — Tek buffer fg+bg, fotoğraf rengi, canlı nesne ayırma (Emre)

Fotoğraf yolundaki üç fazlı iş. Kalıcı sözleşme değişikliği tek ve önemli: **`w`
kanalı artık tohum değil, opaklık** (aşağıda "Sözleşme değişikliği"). Render
katmanını doğrudan ilgilendiren özet en altta, "Render katmanına" başlığında.

### Faz 1 — Arka plan katmanı ve maske yumuşatma

Şikayetler: `image_9121d4.jpg`'de özne arkasındaki siyah boşluk point cloud'da
perde/çanak olarak görünüyordu; `image_917391.jpg`'de RMBG < 0.5 hataları yüz/el
bölgelerinde delik açıyordu; özne arka kenarında ön plan dökümü vardı.

- `silhouette.ts`: `MASK_DILATE_RADIUS = 4`, `MASK_FEATHER_RADIUS = 2` +
  `dilateAndFeatherMask` (minMaxPass max ×2, sonra boxBlur). Dilate maske kendi
  çözünürlüğünde (1024²) uygulanır; uzak arka plan hâlâ 0 kalır (perde koruması
  sürer), yalnızca özne İÇİNDEKİ RMBG hataları kapanır. Tur 9 kuralları
  (minCoreSize %10, geometri kuralları) korundu.
- `sampler.ts`: `THIN_SHELL_Z = 0.05`, `THIN_SHELL_PX = 3` — özne arka kenar
  bandındaki (dPx ≤ 3) döküntüler `zFront − 0.05`'e itilir (ince kabuk sırt
  kapağı).
- Bu fazda arka plan ayrı katman olarak başlamıştı (`sampleBackdropPositions` +
  push-pull piramit `inpaintBackgroundDepth` + ayrı `backdropTexture`/Points/
  renderOrder 0-1/`onBeforeRender` uPositions takası) — **Faz 2'de tamamen
  kaldırıldı**, gerekli değildi. Kalıcı olan yalnızca maske yumuşatma + ince
  kabuktur.

### Faz 2 — Tek buffer + orijinal fotoğraf rengi (sözleşme değişikliği)

**`w` kanalı sözleşmesi değişti.** Gün 3'teki "w'de rastgele tohum var, simülasyon
boyunca korunur" notu **geçersiz**. Home texture doldurulurken w artık iki
seviyeli **opaklık** yazılır: `1` = ön plan, `BACKDROP_OPACITY (0.4)` = arka
plan. Ara değer yok. Simülasyon w'yi aynen kopyalar (kimliği korunur), ama
parçacığın "rastgeleliği" artık w'den okunamaz. Shader'larda w'yi seed yerine
opaklık olarak kullanın.

- **Ölü texel kaldırıldı:** siluet dışındaki her texel gerçek bir arka plan
  noktası taşır: `z = (d−0.5)·range − BACKDROP_Z_PIN (0.15)` (arka sınıra
  kırpılır, öznenin derinliğinden her zaman ≥ 0.05 geride), `w = 0.4`. Inpaint
  gereksizdi — arka plan texelleri zaten fotoğrafın gerçek arka plan
  pikselleri. Silinen API'ler: `sampleBackdropPositions`, `inpaintBackgroundDepth`,
  `sampleLevel`, `createBackdropTexture`, `fillBackdropFromDepth`,
  `BACKDROP_Z_PUSH` (0.04). Arka plan katmanı/material takası/renderOrder
  pipe'ı da silindi — artık **tek** position texture, tek pass.
- **Fotoğraf rengi (`uImageTexture`):** önem-tabanlı örnekleme
  (`buildImportanceRemap`) texel eşlemesini büktüğü için fotoğraf GPU'ya ham
  bind edilmez. Renkler konumlarla AYNI remap üzerinden CPU'da 384² RGBA8 grid'e
  yeniden örneklenir (`sampleImageGrid`, bilinear `sampleBilinearRgb`) — texel
  (i,j) hem konumda hem renkte aynı pikseli gösterir. Engine'de
  `imageColorTexture` (`createImageColorTexture`: RGBA8, `SRGBColorSpace`,
  `flipY = true`, NearestFilter), `setPhoto(source)` ve `setDepth` sıra
  bağımsız (ikisi de hangi sırayla çağrılırsa çağrılsın doldurur).
- Shader sözleşmesi: `uHasImage > 0.5` → `texture2D(uImageTexture, vUv).rgb`;
  değilse (kamera/video yolu) → derinlik rampası (ascii'de `uColor/uBgColor`).
  ASCII modunda glif RENK + hücre dolgu RENGİ ikisi de o fotoğraf grid'inden
  gelir (şeffaflık aynı grid'deki grid şeffaflığıdır).

### Faz 3 — Video doku temizliği ve canlı kontroller

- `Engine.releasePhoto()`: yeni görsel yüklendiğinde eski renk grid'i dispose
  edilir (GPU önbellek sızması yok). `setVideoSource(video|null)`: canlı
  `THREE.VideoTexture` (sRGB, Nearest, mipmap yok); render döngüsünde
  `videoTexture.needsUpdate = true` her karede yazılır; `teardownSource`
  her kaynak değişiminde `setVideoSource(null)` çağırır. `dispose` video
  dokusunu da bırakır.
- `Engine.pushSharedUniforms(material)` — tek kapı: `uImageTexture`
  (video ?? fotoğraf grid'i), `uHasImage`, `uObjectSeparation`,
  `uUseTextureColor`. `setPointsMaterial`/`setPhoto` bunu kullanır; yeni
  shared uniform'lar yalnızca buraya eklenir.
- Shader (point cloud + ascii, iki material'da da): `uObjectSeparation > 0.5 &&
  vOpacity < 0.5` → `discard` (nesne ayırma: yalnızca özne); `uObjectSeparation
  < 0.5 && vOpacity < 0.5` → `col *= 0.4` (arka plan karartması, parlak duvar
  büstü yutmasın). Renk: `uHasImage > 0.5 && uUseTextureColor > 0.5` → doku;
  aksi halde rampa. `uUseTextureColor` varsayılan 1 — uygulamadaki "orijinal
  renkler" checkbox'ı.
- `App.tsx`: `toggleSegment` artık canlı `engine.setObjectSeparation` bağlar;
  maske üretilmemişken açılırsa fotoğraf hâlâ eldeyse RMBG yeniden çalıştırılır
  (`lastPhotoRef`/`lastDepthRef`/`maskLoadedRef` — `run()` bunları saklar).

### Render katmanına (kodu devralan için özet)

- Material yapıcıları bu uniform'ları tanımlar (başlangıç değerleriyle),
  DEĞERLERİ Engine yazar: `uImageTexture`, `uHasImage`, `uObjectSeparation`,
  `uUseTextureColor`, paylaşılan eskiler (`uPositions` zorunlu, `uDepthRange`
  vb.). Vertex'te `vUv = aUv` olmalı — fotoğraf rengi o UV'den okunur.
- `uPositions` artık tek texture (takas/renderOrder yok). `w` = opaklık
  (1 / 0.4), tohum değil.
- Nokta boyutu/renk/titreme gibi efektler w'den "rastgelelik" alamaz; istiyorsa
  vertex shader'da aUv tabanlı deterministik varyasyon üretsin.
- Kamera/video yolu `uHasImage = 0` — rampa; video RENK ler canlı
  VideoTexture'dan gelir (kare başına CPU grid örneklemesi yok); luminance
  yolundaki önem remap'inden ince kenar kayması görülebilir, fotoğraf yolu CPU
  grid'iyle birebir hizalıdır.

### Doğrulama

`npm run verify` ✓ (7 script: positions, depth, preset, volume, sampler, seg,
curtain — Gün 2'deki "iki script" notu eskidi), `npm run typecheck` ✓,
`npm run build` ✓.

Gerçek görsel (`thumbnail.jpg`, 720×720): 46526 ön plan / 100930 arka plan
texel, 28216 texel z ≤ −0.9 (uzak duvar PIN tabanına sabitlenmiş), kütle
merkezi Δ 0.025, renk grid'i 4 texelde bağımsız bilinear okumayla birebir.

---

## 2026-08-11 — Fotoğraf→3D kalite paketi (Emre)

Fotoğraf → depth → point cloud zincirindeki dört darboğaz düzeltildi.
Sözleşmeler değişmedi (R32F/RGBA32F, tek y-flip, 384 grid, aUv, GPGPU ping-pong);
her değişiklik push öncesi tarayıcıda elle test edildi.

### Depth çıkarımı (`src/depth.ts`)

1. **Aspect koruması (letterbox).** Depth Anything V2 processor'ı girdiyi
   518×518 kareye SIKIŞTIRARAK resize ediyordu — dikey portrelerde yüzler
   yamuluyor, derinlik hatalı çıkıyordu. Artık girdi önce aynı kareye letterbox
   yapılıyor (aspect korunur, pad = görselin ortalama rengi), model çıktısı pad
   alanından kırpılıyor. Yan fayda: `depthTexture` artık orijinal dev boyutta
   değil (12 MP fotoğrafta ~48 MB GPU → kırpılmış boyut). Eski davranış
   `estimateDepth(source, { aspect: 'distort' })` ile seçilebilir.
2. **Sağlam normalize.** Min-max öncesi en alt/üst %1 tıraşlanıyor (histogram
   tabanlı, sıralama yok). Tek parlak outlier piksel 0..1 skalasını ezip ön
   plan detayını düzleştiremiyor. `percentile: 0` ile eski davranış.
3. **Bilinear örnekleme (`src/engine/buffers.ts`).** Home texture 384 grid'ine
   doldurulurken nearest (tek piksel) yerine komşu 4 pikselin ağırlıklı
   ortalaması — yüz hatları gibi ince geçişlerdeki aliasing gitti. Grid boyutu
   depth boyutuna eşitken davranış birebir aynı (`verify-positions` kırmadı).

### Video/kamera yolunda temporal stabilite (`src/App.tsx`, `src/depth.ts`)

"Video modunda aşırı hareket" kaynağı tespit edildi: luminance her karede
home'a 1:1 yazılıyor; codec gürültüsü tek parlaklık kademesiyle bile ölü
bölgeyi (uRestLength 0.005) aşıp 147.456 parçacığın Z'sini dürtüyordu.

1. **Temporal smoothing** (`LUMINANCE_SMOOTHING_ALPHA = 0.1`): yeni luminance
   karesi geçen kareye `lerp(prev, cur, 0.1)` ile yapıştırılıyor — kısa gürültü
   sönümlenir, yavaş ışık/motion değişimi akışkan kalır. İlk kare ham kabul
   edilir. Yalnızca video/kamera yolu; fotoğraf depth pipeline'ına dokunulmadı.
2. **Frame sync:** 100 ms `setInterval` yerine `requestVideoFrameCallback` —
   luminance yalnızca gerçek yeni video karesinde hesaplanır (atlanan kare
   sıçraması yok). rVFC desteklemeyen tarayıcıda interval fallback korunur.
3. **Frame başına allocation yok:** `luminanceHeightMap` scratch
   `Float32Array`'ini yeniden kullanır, lerp in-place — ilk kare dışında yeni
   dizi yok.

### Sözleşme ve performans

- Engine, simulation shader'ları ve GPGPU ping-pong'a dokunulmadı; tüm
  sözleşmeler birebir korundu (doğrulama: `npm run verify` ✓ · `npm run
  typecheck` ✓ · `npm run build` ✓ · dev server HTTP 200 ✓).
- `ARCHITECTURE.md` değişmedi — kontrat katmanına dokunulmadı.

### Açık işler (bilinçli erteleme)

- Sahne kesmesi algısı (video loop geçişinde bulut "patlaması") EKLENMEDİ —
  smoothing + frame sync sonucu gözlemlenecek; hâlâ belirginse ele alınacak.
- Önem-tabanlı partikül dağılımı (yüz/ön planda yoğunluk remap) değerlendirme
  aşamasında, uygulanmadı.

---

## 2026-08-10 — Gün 3: GPGPU parçacık simülasyonu (Emre)

## 2026-08-10 — Gün 5: node graph editörü (Emre)

Gün 4'teki graf veri modelinin görsel düzenleyicisi eklendi
(`src/ui/NodeGraphEditor.tsx`, React Flow / `@xyflow/react`). Graf hâlâ
sahnenin **tek doğruluk kaynağı**: editör ayrı bir durum ağacı tutmaz, her
değişiklik doğrudan `engine.setGraph`'e gider. Yeni UI yazanlar bu kurala
uysun — parametreleri iki yerde tutmak preset'i yalan duruma sokar.

### Render katmanını doğrudan etkileyen şeyler

1. **`setGraph` artık aynı render material'ını tekrar TAKMIYOR.** Eskiden her
   graf kurulumu `setPointsMaterial` çağırıyor, o da eskisini dispose ediyordu.
   Ascii material'ın atlas'ı `dispose` kancasıyla bırakıldığı için ascii modda
   her graf kurulumu (ör. bir slider'ın her hareketi) atlası silip ekranı
   boşaltıyordu. Davranış değişmedi: mod farklıysa takas, aynıysa yalnızca ad
   güncellenir. (Material sahipliği kuralı: Gün 4 gözden geçirmesi — Engine
   yalnızca kendi yer tutucusunu dispose eder; dışarıdan gelen material
   çağıranın malıdır.)
2. **Graf artık görsel: kablo çek → pass gerçekten kapanır.** Feedback
   düğümünün giriş kenarı kopunca post-pass composer'dan çıkar (bugün
   grain/vignette), geri takılınca aynı sıraya döner. `insertPass` +
   `grainPassIndex` (Gün 4 gözden geçirmesi) sayesinde grain kapatılıp açılsa
   bile zincirdeki yeri korunur — feedback/chromatic aberration/neon pass'leri
   geldiğinde aynı koruma onların sırası için de geçerli olacak. Zeynep'in
   pass'leri feedback düğümüne bağlanır; "efekt kaybolur" kanıtı o pass'lerle
   de gösterilecek.
3. **Parametre paneli ParamDef listesinden üretilir** — material'ların kendi
   tanım listelerine (`POINTS_PARAMS`, `ASCII_PARAMS`, `GRAIN_PARAMS`,
   `SIM_PARAMS`) eklenen her satır editörde otomatik görünür, isim bilmez.
   Renk → renk seçici, sayı → slider, renderer → points/ascii mod düğmeleri,
   media → kaynak türü salt-okunur (medya gömülmez, Gün 4 şeması).

### Veri katmanı

- `src/ui/NodeGraphEditor.tsx` (yeni): 6 düğüm sabit kurulur (media · depth ·
  particles · feedback · renderer · output), kenar bağlama/koparma canlı,
  düğüm konumları yalnızca UI'dır — graf şemasına yazılmaz, preset'te yoktur.
- Kenar silme: kenarı seç + Backspace/Delete. Düğüm silme v1'de yok (şemada
  düğüm seti sabittir; silme istekleri yutulur).
- Preset yüklendiğinde editör motordan tazelenir (`graphTick` prop'u, App'te
  PresetControls yükleme sonrası tetikler) — kaydet → yenile → yükle döngüsü
  editör durumunu da geri getirir.
- Bilinen sınırlar: ascii karakter seti (setCharSet API'si) editörde
  düzenlenmez; ModeSelector'dan yapılan mod takası editörün renderer
  düğümüne anlık yansımaz (kayıt anında `toPreset` doğru modu yazar).
- `src/engine/params.ts`, `graph.ts`, `preset.ts` mantığı değişmedi; yalnızca
  `setGraph`'teki material takası guard'ı eklendi.

### Doğrulama

`npm run verify` ✓ · `npm run typecheck` ✓ · `npm run build` ✓
Dev server HTTP 200 · chunk >500 kB uyarısı Gün 6'ya not (code-split).
Tarayıcı kanıtı: kablo çek → grain kaybolur, parametre slider'ları canlı,
preset kaydet → yenile → yükle (kamera dahil) — Gün 5'in elle doğrulama
adımı, henüz yapılmadı.

## 2026-08-10 — Gün 4 gözden geçirmesi: material sahipliği

Gün 4'te render modları bir kayıt defterine (`renderModes`) taşındı ve
material'lar App'te `useMemo` ile **bir kez** üretilip mod takasında ileri geri
kullanılmaya başlandı. `Engine.setPointsMaterial` ise Gün 2'den beri giden
material'ı dispose ediyordu — o zaman doğruydu (giden şey Engine'in kendi yer
tutucusuydu), Gün 4'ten sonra değil.

Sonuç: `points → ascii → points` dizisinde her takas, bir sonraki takasta
gereken material'ı yok ediyordu. ASCII'nin `dispose` kancası karakter atlasını
da bıraktığı için atlas her dönüşte yeniden rasterleştiriliyor, shader'lar
yeniden derleniyordu. `ModeSelector`'daki "aynı moda tıklama" koruması da
aslında bu davranışın bir sonucuydu (aynı material hem dispose edilip hem
takılırdı).

**Sahiplik kuralı yazıldı:** Engine yalnızca **kendi ürettiği** yer tutucuyu
dispose eder. Dışarıdan gelen material çağıranın malıdır — App onları unmount'ta
bırakır. `Engine.dispose()` de artık kayıtlı material'a dokunmuyor (StrictMode'un
çift mount'unda ikinci engine ölü material'la açılıyordu).

Yanında üç küçük düzeltme:

| Sorun | Sonucu | Düzeltme |
|---|---|---|
| `applyPreset` `mediaType`'ı preset'ten yazıyordu | Medya geri yüklenmediği için motor yalan söylüyordu: ekranda sentetik görsel dururken kaynak türü `camera` görünüyor, sonraki kayıt yanlış türü yazıyordu | Kopyalanmıyor; fark varsa uyarı |
| `setPostPassEnabled` grain'i `addPass` ile geri koyuyordu | Zeynep'in feedback/chroma/neon pass'leri geldiğinde kapat-aç sonrası grain zincirin sonuna düşecekti | Kapatırken indeks not ediliyor, `insertPass` ile aynı yere dönüyor |
| `saveSlot` `setItem`'ı korumasız çağırıyordu | Kota dolu veya gizli modda kaydetme uygulamayı düşürürdü | `try/catch`, `false` döner |

`verify-preset.mjs` eski `mediaType` davranışını doğruluyordu; yeni sözleşmeye
çekildi (tür ezilmiyor, tek medya uyarısı bekleniyor).

---

## Render katmanına — Gün 3 sonrası durum

Gün 3'te veri katmanı tamamen `src/engine/` içinde kaldı; `src/shaders/` ve
`src/ui/` klasörlerine **hiç dokunulmadı**. Ama altındaki veri değişti, render
katmanını üç noktada ilgilendiriyor.

**1. Parçacıklar artık hareket ediyor.** Gün 2'de `positionTexture` sabit bir
depth ızgarasıydı. Gün 3'ten beri her karede GPU'da yeniden hesaplanıyor:
parçacık bir yay ile dinlenme konumuna bağlı, fare bir kuvvet alanı uyguluyor.
Point cloud shader'ın için pratik sonucu: **konumlar kare kare değişir**,
sabit varsayamazsın.

**2. `positionTexture` tür değiştirdi.** Artık `DataTexture` değil, ping-pong
**render target texture'ı** (TS tipi: `THREE.Texture`). Örnekleme aynı —
`texture2D(uPositions, aUv)`. Kritik: **texture'ı bir yerde saklama.** Her kare
farklı bir texture nesnesi okunuyor (ping-pong takası); Engine `uPositions`
uniform'unu her karede senin material'ına yazıyor. Sen sadece uniform'u
tanımla, değerine dokunma.

**3. `w` kanalı senin işine yarar.** Her parçacığın `w`'sinde sabit bir rastgele
tohum var (0..1) ve simülasyon boyunca korunuyor. Nokta boyutu değişkenliği,
renk sapması, parlaklık titremesi gibi şeyler için bedava: `texture2D(uPositions, aUv).w`.

**Değişmeyenler:** `depthTexture` (R32F, 0 = uzak, 1 = yakın, satır 0 = üst),
z'nin orijine ortalı olması, `engine.setPointsMaterial(mat)` ile mod takma,
`update(time)` pass kancası, y-flip'in tek yerde çözülmesi. `uPositions`
uniform'u hâlâ her point cloud shader'ında zorunlu.

**Senin işin bekliyor:** Render Modu 1 (point cloud shader'ı) — `points.ts`
içindeki material hâlâ yer tutucu. Onu `setPointsMaterial` ile değiştirdiğinde
Gün 2 + Gün 3 gerçekten birleşmiş olur. Sim ayarları (`engine.simUniforms`)
`App.tsx`'teki geçici satırda; senin `ui/ControlPanel` panelin ayrı kalıyor,
karıştırmadım.

**Yeni kural — sim sahnesine hiçbir şey ekleme.** `simulation.ts`'teki sahne
yalnızca tam ekran quad'ı taşır. Oraya bir mesh eklemek simülasyon pass'ini
bozar; boş bırakmak ise render target'ı sıfıra siler (bugün tam olarak bu oldu,
aşağıda).

### Veri katmanı

- **`src/engine/simulation.ts` (yeni):** GPGPU simülasyonu. Konumlar CPU'da
  değil, shader'da her karede hesaplanır. Kuvvet = yay(dinlenme konumu − konum)
  + fare kuvveti. Sönüm, yay katsayısı, ölü bölge uniform'larda.
- **Hızın yeri — karar:** Verlet tek texture'da mümkün değildi (`w` = seed
  sözleşmesi + konum + önceki konum 4 kanala sığmaz). Hız ping-pong çifti
  kullanıldı: konum ×2 + hız ×2 RT, iki ayrı pass (pos, vel). Gerekçe
  `ARCHITECTURE.md` → "GPGPU Simülasyon".
- **`homeTexture` (yeni):** parçacığın dinlenme konumu — yay buraya çeker.
  `fillPositionsFromDepth` artık bunu doldurur. Tohumlama (konumları home'a
  eşitleme + hızları sıfırlama) **yalnızca ilk depth'te**; sonraki depth'ler
  yalnızca home'u tazeler, böylece canlı kamerada dinlenme konumu görüntüyü
  takip ederken simülasyon kesintisiz sürer.
- **Format seçimi:** `EXT_color_buffer_float` yoksa sim RT'leri RGBA16F'ye düşer
  (engin log satırı: "sim RT: RGBA32F/RGBA16F").
- **Fare kuvvet alanı:** hover'da sürekli (sol tık OrbitControls'ta kaldı),
  canvas dışında kuvvet sıfır, z = 0 düzlemine izdüşüm (orbit'e dayanıklı).
  Modlar: itme / çekim / vortex (uniform `uForceMode`).
- **Seed korunur:** sim pos pass'i `cur.w`'yi kopyalar; GPU tarafı
  `verify-positions.mjs` ile test edilemiyor (CPU tarafı test ediliyor).

### Deploy (Vercel)

- `vercel.json` eklendi: vite framework, `dist` çıktısı, model/ORT statik
  dosyalarına uzun önbellek.
- **Bilinen:** prod build `dist/assets/` içine 23 MB'lık ikinci bir ORT wasm
  kopyası koyuyor (`public/ort` zaten aynı runtime'ı taşıyor). Gün 6'ya not.

### Gün 3 gözden geçirmesi — simülasyon çalışmıyordu

İlk yazımda **simülasyon quad'ı sahneye eklenmemişti** (`scene.add(quad)` yok).
Sonuç: her pass boş bir sahne çizdi, yani render target'ı sıfıra sildi.
Konumlar `(0,0,0)` oldu, 147k parçacığın hepsi orijine çöktü — ekranda tek
nokta. `typecheck` ve `build` bunu yakalayamaz; sadece ekrana bakınca görülür.

Bununla birlikte düzeltilenler:

| Sorun | Sonucu | Düzeltme |
|---|---|---|
| Quad sahnede değil | Simülasyon hiç çizmiyor, bulut tek noktaya çöküyor | `scene.add(quad)` |
| Hız RT'leri hiç başlatılmamış | İlk kare tanımsız içerikten okuyor (çöp hız) | `seedFrom` hız RT'lerini sıfırlıyor |
| `setDepth` her çağrıda tohumluyordu | Canlı kamerada saniyede 10 kez sıfırlama; parçacıklar hiç hareket edemiyor, fare deformasyonu siliniyor | Tohumlama yalnızca ilk depth'te; sonrası `setHome` |
| Sim sonrası render target bağlı kalıyordu | Sonraki pass'ler yanlış hedefe çizebilir | `setRenderTarget(null)` ile bırakılıyor |
| Kuvvet/hız ifadesi iki shader'da kopyaydı | Biri düzenlenince konum ve hız birbirinden kopar | Tek `integrateVelocity()` fonksiyonu, iki pass de onu çağırıyor |
| Zaman adımı yoktu | 144 Hz'de yay sert, 30 fps'te gevşek; sekme dönüşünde patlama | `uDtScale` (0.5..2 kırpılı), Engine her karede yazıyor |
| `EXT_color_buffer_float` yoksa sessizce RGBA16F'ye düşülüyordu | Half-float da desteklenmiyorsa sebep görünmüyor | İkinci eklenti de kontrol ediliyor, yoksa konsola hata |
| Sayfa açılışında imleç canvas üzerindeyse `pointerenter` gelmiyordu | Kuvvet, imleç dışarı çıkıp girene kadar ölü | `pointermove` de aktif ediyor |

**Yeni koruma:** geliştirmede tohumlamadan sonra konum RT'sinden tek piksel
geri okunuyor; sıfır çıkarsa konsola "sim pass'i hiçbir şey çizmiyor" hatası
basılıyor. Bu hata sınıfı bir daha sessizce geçmesin diye.

### Kuvvet ayarı ve eksik mod seçici

İlk değerlerle denge sapması `uForceStrength / uStiffness` = `0.08 / 0.035` ≈
**2.3 birim**, yani parçacık bütün buluttan (yükseklik 2 birim) uzağa
itilebiliyordu; `uForceRadius = 1.0` da sahnenin yarısını kaplıyordu. Sonuç:
imlecin altında devasa bir delik ve kenarda sert parçacık yığılması.

| Uniform | Eski | Yeni |
|---|---|---|
| `uStiffness` | 0.035 | 0.08 |
| `uDamping` | 0.96 | 0.9 |
| `uForceRadius` | 1.0 | 0.35 |
| `uForceStrength` | 0.08 | 0.02 |

Sapma artık ≈ 0.25 birim. Kenar sönümü doğrusaldan `smoothstep`'e alındı —
doğrusal sönümde kuvvet sınırında bıçak gibi bir kesim oluşuyordu.

**Eksik olan:** üç kuvvet modu (itme / çekim / vortex) shader'da yazılıydı ama
`uForceMode`'u değiştiren hiçbir şey yoktu — mod 0'da sabit kalıyordu, yani
Gün 3'ün üç modundan yalnızca biri erişilebilirdi. `App.tsx`'e veri katmanının
kendi ayar satırı eklendi: üç mod butonu + yarıçap/şiddet/yay slider'ları ve
canlı "sapma ≈ x birim" göstergesi. Bu Emre'nin ayar kolu;
`src/ui/ControlPanel` (render katmanı, Zeynep) ayrı kalıyor.

### Doğrulama

`npm run verify` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ — süreler bu
satırın altındaki Gün 2 girişinde.

Tarayıcıda gözle doğrulandı (Emre): nokta bulutu 3B uzayda dönüyor, imleç
bulutu deforme ediyor, imleç çekilince parçacıklar dinlenme konumuna geri
toplanıyor, üç kuvvet modu da çalışıyor. GPGPU çıktısı Node'da test
edilemediği için bu adım her zaman elle yapılır.

---

## 2026-08-10 — Gün 2 hata düzeltmeleri + sözleşme netleşmesi

Gün 2 veri katmanı üzerinden geçildi; render katmanında da bir düzeltme var.
**Kod yazan/gözden geçiren:** Emre. Zeynep'in `src/shaders/` ve `src/ui/`
dosyalarına yapılan tek dokunuş aşağıda "Render katmanı" başlığında, geri
alınabilir.

### Davranış değiştiren düzeltmeler

**1. Kamera ve video yolu hiç çalışmıyordu — `src/App.tsx`**

Eski akış: video oluştur → `play()` → `startLuminanceLoop()`. Döngü ilk iş
olarak `stopTimers()` çağırıyordu, o da "açık video varsa durdur" yapıyordu —
yani **az önce başlatılan videoyu duraklatıp `srcObject`'i null'lıyordu**.
Kamera açılıp anında ölüyordu; video dosyası ilk karede donuyordu.

Sorumluluklar ayrıldı:

| Fonksiyon | Ne yapar | Ne zaman çağrılır |
|---|---|---|
| `clearTimer()` | Yalnızca interval'i temizler | Yeni döngü başlarken |
| `teardownSource()` | Interval + video + MediaStream + ObjectURL bırakır | **Yeni kaynak yaratılmadan ÖNCE** |

Sıra kuralı: `teardownSource()` her zaman yeni video/stream oluşturmadan önce
çağrılır. Sonra çağrılırsa aynı hata geri gelir.

Yan düzeltmeler: `readyState < 2` iken kare atlanıyor (video ilk kareyi
çözmeden `drawImage` boş çiziyordu), video dosyaları `loop = true`, ObjectURL'ler
`revokeObjectURL` ile bırakılıyor, "sentetik görsel" ve fotoğraf yükleme de
canlı döngüyü durduruyor.

**2. Point cloud yanlış merkez etrafında dönüyordu — `src/engine/buffers.ts`**

`z = d · 2` bulutu z = 0..2 aralığına koyuyordu; OrbitControls hedefi ise
(0,0,0), yani bulutun **arka yüzeyi**. Döndürünce sahne savruluyordu.

```
eski:  z = d · POINTS_DEPTH_RANGE          →  0 .. +2
yeni:  z = (d − 0.5) · POINTS_DEPTH_RANGE  → −1 .. +1   (orijine ortalı)
```

**Render katmanını ilgilendirir:** `positionTexture`'ın z bileşeni artık
ortalıdır. 0..1 aralığı isteyen shader `pos.z / POINTS_DEPTH_RANGE + 0.5`
yazar — `src/engine/points.ts` içindeki yer tutucu shader'da örneği var.
`ARCHITECTURE.md` → "Koordinat Uzayı" güncellendi.

**3. DPR > 1 olan ekranda canvas konteynerden taşıyordu — `src/engine/Engine.ts`**

`renderer.setSize(w, h, false)` çizim tamponunu ayarlıyor ama canvas'ın CSS
boyutunu yazmıyordu. DPR 1.5'te 640×420 konteynerin içinde canvas 960×630 CSS
piksel kaplıyordu. DPR 1 olan makinede görünmeyen, DPR > 1 olanda bariz bir hata.
`updateStyle` varsayılana (açık) döndürüldü.

**4. Kameraya çok yaklaşan noktalar ekranı beyazlatıyordu — `src/engine/points.ts`**

`gl_PointSize = uPointSize / -mv.z` — bulutun içine uçunca `-mv.z → 0`, nokta
boyutu patlıyordu. `max(-mv.z, 0.1)` ile sınırlandı.

**5. `Engine.dispose()` composer'ı bırakmıyordu — `src/engine/Engine.ts`**

Pass'lerin render target'ları her remount/HMR'de GPU'da kalıyordu.
`this.composer.dispose()` eklendi.

### Performans

- **`luminanceHeightMap` — `src/depth.ts`:** canlı kamerada saniyede ~10 kez
  `document.createElement('canvas')` + yeni 2D context açıyordu. Artık modül
  seviyesinde tek çizim yüzeyi yeniden kullanılıyor (boyut değişince resize).
- **`Engine.setDepth`:** her karede yeni `DataTexture` ayırıp eskisini dispose
  ediyordu. Boyut aynıysa artık `image.data.set(...)` + `needsUpdate` ile
  yerinde güncelleniyor. Kamera yolunda GPU tahsis çöpü bitti.

### Render katmanı — Zeynep'in dosyasına tek dokunuş

**`src/shaders/grainPass.ts` başlangıç uniform değerleri.** Değerler slider
aralıklarının uçlarında kalmıştı:

| Uniform | Eskiden | Şimdi | Aralık |
|---|---|---|---|
| `uSaturation` | **0** (tüm renk ölü) | 1 | 0 .. 1.5 |
| `uContrast` | **2** (maks) | 1.05 | 0.5 .. 2 |
| `uVignette` | **1.5** (maks) | 0.45 | 0 .. 1.5 |
| `uGrainAmount` | **0.3** (maks) | 0.06 | 0 .. 0.3 |
| `uGrainSpeed` | 0 | 1 | 0 .. 5 |

Sahne kutudan gri, ezik ve kararmış açılıyordu; point cloud'un derinlik renk
rampası hiç görünmüyordu. Muhtemelen slider denemesinden kalma değerler.

**Bu Zeynep'in estetik kararı.** Kasıtlıysa tek satırla geri alınır — shader
mantığına dokunulmadı, yalnızca `createGrainPass()` içindeki başlangıç
değerleri değişti. Pass'in kendisi (instance başına uniform, `uResolution`'ın
drawing buffer'dan gelmesi, `update(time)` kancası) olduğu gibi duruyor.

### Yeni: sözleşme regresyon kontrolü

```bash
npm run verify
```

İki script çalışır:

- **`scripts/verify-positions.mjs`** (yeni) — GPU gerekmez. `ARCHITECTURE.md`'nin
  sessizce kırılabilen dört kuralını assert'ler: z orijine ortalı, grid satırı
  0 = görselin üstü (y-flip yönü), `w` seed'i doldurma sırasında korunuyor,
  en-boy oranı x genişliğine doğru yansıyor.
- **`scripts/verify-depth.mjs`** — depth modelini Node'da offline çalıştırır.

Shader veya koordinat uzayına dokunan herkes bunu çalıştırsın. y-flip hatası
ekranda "biraz garip" görünür, testte kesin patlar.

### Doküman düzeltmeleri

- `README.md`: `model_fp16.onnx` boyutu 34 MB yazıyordu → ölçülen **47.34 MB**.
- `README.md`: "MIDI/audio ile canlı performans" satırı kaldırıldı — proje
  tanımı ses/müzik girdisi içermiyor, tamamen görsel.
- `ARCHITECTURE.md`: koordinat uzayı bölümü z ortalamasıyla güncellendi.

### Bilinen, düzeltilmedi

Prod build `dist/assets/` içine 23 MB'lık bir ORT wasm kopyası daha koyuyor
(`public/ort` zaten aynı runtime'ı taşıyor). Çalışıyor ama deploy boyutu
şişiyor. Gün 3'teki Vercel deploy testinde bakılacak.

### Doğrulama

`npm run typecheck` ✓ · `npm run build` ✓ · `npm run verify` ✓
(model yükleme 400 ms, 512×512 çıkarım 384 ms, q8 tek thread)
Dev server'da konsol temiz; sentetik görsel 512×512 depth üretip engine'e girdi.
