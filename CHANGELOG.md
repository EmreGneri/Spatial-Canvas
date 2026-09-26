# Değişiklik Günlüğü

Sözleşmeye dokunan her değişiklik buraya yazılır (`ARCHITECTURE.md` kuralı: sessiz sapma yok).
En yeni üstte.

## 2026-09-26 — Z (Zeynep): splat temizleme, mod kalitesi, AR önizleme, hata sınırı, eğitim grafiği

Beş iş, tek ölçüt: **kullanıcı ne olduğunu görsün, düzeltebilsin.**

**Splat temizleme aracı** (`ui/splatSecim.ts`, `ui/SplatTemizleme.tsx`).
Eğitim/füzyon sonrası havada duran Gaussian'lar ve arka plan artığı çıktıya
giriyordu. Otomatik filtre DENENDİ ve başarısız oldu (Emre'nin raporu: üç
filtre de ya gerçek içeriği siliyor ya floater'ı azaltmıyor) — elle seçim tek
yol. Sahnenin üstünde 2D seçim katmanı: **fırça** (ekran dairesi), **lasso**
(serbest poligon, içbükey şekiller dahil) ve **küre** (imleç altındaki EN
YAKIN splat çevresinde dünya küresi — fırçanın aksine ARKADAKİ yüzeyi almaz).

- **Silme = opaklık 0**, diziden çıkarma DEĞİL: indeks kaydırmak D.4 keyframe
  kimliğini ve sıralama scratch'ini geçersizleştirir, geri almayı imkânsız
  kılardı. Opaklık kapısı 0'lı splat'ı sıraya hiç almaz, çizim maliyeti de
  kalkar. Geri alma adım adım ve toplu.
- **Vurgu GaussianBuffer'ın renk kanalına YAZMAZ** — vurgu yalnız 2D katmanda
  yaşar, orijinal veri bit bit korunur.
- **`gez` modu varsayılan**: katman olayları yakalarken kamera kilitleniyordu,
  oysa floater'ı bulmak için döndürmek gerekiyor. `gez` açıkken katman
  saydam bir seyirci (`pointerEvents: none`), seçim modlar arasında korunur.
- **KAPSAM (dürüstlük kaydı):** araç MOTORUN GaussianBuffer'ını temizler. 3D
  eğitim görünümündeki sahne splat.js'in kendi tamponunda yaşıyor ve dışarıya
  açılmıyor; **PLY çıktısındaki floater'lar orada.** Eğitim oturumunun
  Gaussian dizisine bir tutamaç gelince araç aynı mantıkla çalışır
  (`splatSecim.ts` yalnız bir xyzw dizisi ister).
- Motor tarafında iki küçük ekleme: `splatViewProjection()` (kamera nesnesi
  DEĞİL, matris kopyası) ve `commitSplatOpacity()`. `SplatObject.refreshOpacity`
  bilerek `syncFromTextures` KULLANMAZ — o, keyframe kimliği verilmediğinde
  D.4 timeline filtresini sessizce düşürüyordu.
- **Ölçülen kusur ve düzeltmesi:** köprü doldurucusu opaklığı iki seviyeli
  yazıyor (sentetik sahne: 140.523 splat 0.40, 6.933 splat 1.00). Nesne ayırma
  açıkken motorun kapısı 0.50'ye çıkıyor, yani o 140 bin splat zaten
  çizilmiyor. Araç sabit 0.02 eşiğiyle başlamıştı: onları "seçilebilir" sayıp
  "sil (140.523)" yazacak, silme ekranda hiçbir şey değiştirmeyecekti. Eşik
  artık motordan okunuyor (`Engine.splatOpacityThreshold`, çizimle AYNI
  fonksiyon). Tarayıcıda uçtan uca: ayırma açık → çizilen 6.933, "kalan"
  6.933/147.456, fırça 5.092 seçti, silme sonrası 1.841, geri alma 6.933.

**Render modu varsayılan kalitesi** (`shaders/modKalite.ts`). Altı modun
post-FX'i kod varsayılanında duruyordu ve o varsayılanlar pratikte KAPALI
demekti (bloom 0, chromatic 0, grain 0, sis 0). Her mod aynı işlenmemiş
görüntüyü veriyor, preset kapakları bu yüzden birbirine benziyordu. Her moda
KENDİ malzemesine göre profil yazıldı; ortak bir "güzel" profil yok, çünkü
aynı bloom ASCII'de harfleri okunmaz yaparken Neon'da modun bütün esprisi.

Ölçüm "göz kararı" değil: iki sahnede (sentetik + `assets/thumbnail.jpg`),
320×200 kareden `konuOran` (L > 0.05 piksel oranı) ve `konuDoyg` (yalnız o
piksellerde doygunluk). Arka plan hariç — kadrajın ~%95'i siyah olduğu için
genel ortalama farkı gizliyordu. thumbnail.jpg, kapalı → profil:

| mod | konuOran | konuDoyg |
|---|---|---|
| Point Cloud | 0.0226 → 0.0306 | 0.415 → 0.455 |
| ASCII | 0.0188 → 0.0232 | 0.480 → 0.380 (bilerek) |
| Neon | 0.1919 → 0.5029 | 0.598 → 0.555 |
| Solid | 0.0255 → 0.0287 | 0.292 → 0.283 |
| Splat | 0.0238 → 0.0293 | 0.425 → 0.459 |
| Crystal | 0.0239 → 0.0260 | 0.175 → 0.228 |

Konu kapsamı altı modda da arttı, kırpılan piksel oranı altısında da %0.
Solid'in kazancı ölçüm sınırında — o modda post-FX'in yapabileceği az, dürüst
kayıt bu. **Kullanıcının ayarı kaybolmaz:** moddan çıkarken o modun değerleri
oturumluk hafızaya alınır, aynı moda dönünce profil değil KULLANICININ ayarı
uygulanır.

**Grain pass — negatif ışık kelepçesi** (`shaders/grainPass.ts`). Yol boyunca
çıktı: `uContrast` 0.5 etrafında dönüyor ve pass LİNEER uzayda çalışıyor;
sahnenin siyah zemini lineer ~0.003, yani 1'in biraz üstündeki her kontrast
onu EKSİYE düşürüyor. Ara tampon kayan noktalı olduğu için eksi değer hayatta
kalıyor ve OutputPass'in sRGB `pow`'u tanımsız sonuç veriyordu. **Ölçüldü
(ASCII, sentetik sahne): kontrast 1.05'te zemin 0.035, 1.18'de 0.34 — yani
kontrastı ARTIRMAK zemini AYDINLATIYORDU.** Tek satır kelepçe
(`max(col.rgb, 0.0)`) bunu kesiyor. **GÖRÜNÜR ETKİ:** varsayılan kontrast
1.05'te siyah zemin artık gerçekten siyah (eskiden 9/255 griye kalkıyordu);
kayıtlı preset'ler bu yüzden biraz daha kontrastlı görünecek. Kelepçeden sonra
bile kontrast > 1 sönük KONU piksellerini siyaha düşürdüğü için (Point Cloud
konu kapsamı 0.0060 → 0.0049) hiçbir mod profilinde kontrast 1'in üstünde
değil; istenen güç pozlama ve doygunlukla alındı.

**AR/VR hızlı önizleme** (`ui/arDurum.ts`, `ui/ArDugmesi.tsx`,
`Engine.xrOturumuAc`). `immersive-ar` yoksa `immersive-vr` denenir — masaüstü
başlığı kullanıcısına "AR yok" demek yanlış bilgi olurdu. Desteklenmeyen
cihazda düğme GİZLENMEZ, kapalı ve sebepli durur (gizli düğme "bu uygulamada
AR yok" gibi okunur, oysa sorun cihazda). Tarayıcıya özel yol: iOS'ta "başka
tarayıcı dene" DENMEZ — hepsi aynı motoru kullanıyor, WebXR hiçbirinde yok;
onun yerine gerçek alternatif (.ply indir) yazılır. Android'de ARCore ve https
koşulu söylenir. Güvenli bağlam (https/localhost) ayrıca kontrol edilir.

**XR'da post-FX KAPALI** ve bu onboarding'de YAZILI (sessiz sapma yok):
EffectComposer tek kameralı tam ekran quad'larla çalışır, XR'da iki göz ve her
karede güncellenen bir XR kamera dizisi var; quad zinciri sahneyi XR poziyla
çizmez. Oturum boyunca sahne doğrudan çizilir ve OrbitControls kapatılır
(dokunmatik jest hem XR poziyle hem taban kamerayla oynarsa çıkışta sahne
başka yerde bulunur); oturum bitince ikisi de geri alınır.

**React hata sınırı** (`ui/hataMesaji.ts`, `ui/HataSinir.tsx`). Render ağacı
çökünce ekran beyaz kalıyordu. Sınır yığın izi göstermez; hatayı TANIDIĞI
sınıfa oturtur ve o sınıfın kurtarma yolunu verir. Sınıflar gerçek olaylardan:
`onbellek` (transformers-cache'e HTML düşmüş → "Unexpected token '<'";
yenileme TEK BAŞINA yetmez, ayrı silme düğmesi var), `webgl` (bağlam kaybı /
shader), `bellek`, `bilinmeyen` (hatanın KENDİ metni gösterilir — "bir şeyler
ters gitti" tek başına kullanıcıyı kör bırakır). **React yalnız RENDER içindeki
hatayı görür**, bu yüzden `window` üzerindeki `error` ve `unhandledrejection`
de dinlenir: motor döngüsündeki hata sahneyi dondurup arayüzü ayakta
bırakıyordu. "Yeniden dene" ağacı `key` ile GERÇEKTEN yeniden mount eder.
Sınır `main.tsx`'te App'in DIŞINDA — App'in kendi mount'u (Engine kurulumu)
çökerse de yakalanır. Tarayıcıda doğrulandı: sahte `error` olayı → doğru
sınıf + adımlar + üç düğme, "yeniden dene" sonrası motor ve tuval geri geldi.

**Eğitim ilerleme grafiği** (`ui/egitimIlerleme.ts`, `ui/EgitimGrafik.tsx`).
Kullanıcı yalnız "eğitiliyor" ve bir yüzde görüyordu; yüzde GEÇEN ZAMANI
söyler, KALİTEYİ söylemez. Trainer zaten iterasyon başına PSNR + Gaussian
sayısı basıyordu (`olay.metrik`) — eksik olan tek şey onu çizmekti. Transport
şeridinin ALTINDA (şeridin içinde değil: grafik kumanda değil DURUM) SVG
polyline; kütüphane yok. X ekseni 0..BÜTÇE, son iterasyona kadar değil — bitişe
ne kadar kaldığı görünsün (hedef-gradyanı etkisi). Y ekseni serinin kendi
aralığı; sabit 0..50'de 1 dB'lik tırmanış düz çizgi gibi görünürdü. PSNR
gelmeden nokta EKLENMEZ (0 dB uydurmak eğriyi yalan bir dipten başlatır).
Seri 240 noktada yarıya SEYRELTİLİR — en eskiyi atmak eğrinin en dik yerini
keserdi. Yanında dB/1k-iterasyon eğimi: "sürdür +4.000" kararı buna bakar.
Emre'nin densification düzeltmesiyle quick katmanda artık gerçek büyüme verisi
üretiliyor, grafik onu gösterir.

**Transport şeridi düzen hatası.** Orta blok `flex: 1, minWidth: 0` idi; flex
ona sıfıra kadar küçülme izni veriyordu, mod seçici **47 px'lik bir sütuna
çöküp** altı düğmeyi alt alta diziyor ve şeridi **432 px** yüksekliğe
çıkarıyordu (ölçüldü). `flex: '1 1 auto'` ile blok kendi içeriğinden dar olmaz,
sığmazsa şeridin `flexWrap`'i devreye girer: şerit **148 px**, üç temiz satır.

**Doğrulama:** `npm run verify` 70 → **77**, hepsi geçiyor (bu turdan beş
yeni script: `verify-hata-siniri`, `verify-splat-temizleme`,
`verify-egitim-ilerleme`, `verify-ar-onizleme`, `verify-mod-kalite`; ikisi
aynı merge'de Emre'den geldi: `verify-subject-crop`, `verify-egitim-densify`).
`npm run typecheck` temiz.

**Açık kalan:** eğitim grafiği gerçek bir eğitim koşusunda görülmedi (verify
seri/kadraj matematiğini kanıtlıyor, kablo denetimi geri çağrıyı kanıtlıyor);
AR oturumu gerçek cihazda denenmedi (masaüstünde WebXR yok — durum mantığı ve
bypass sözleşmesi verify'da).
## 2026-09-26 — 3DGS serbest gezinme: eğitim kameralarının hacmiyle sınırlı

WASD kamerası `1.5 × nokta bulutunun %90 yarıçapı` küresiyle sınırlıydı. Asıl
kalite uçurumu ise eğitim KAMERALARININ hacmi: dışında fotoğraf kanıtı yok,
sahne sise ve floater gürültüsüne dönüyor. Ölçüm (RTX, standard/40 kare/10k):

- Deniz feneri yörüngesi (75° yay, kamera–pivot 2.0–2.6): eski sınır 3.93.
  Yayın 60° ötesi (pivottan 1.96, eski sınırın içinde) tanınmaz gürültü;
  yayın 25° ötesi bozuk ama okunur; kameralarla özne arası yakın çekim net.
- St. George (100° yay, kamera–pivot 1.1): eski sınır **29.1** (arka plan
  noktaları %90 yarıçapı 19'a şişirir), hız 7.3 birim/sn. Kameraların 3 katı
  uzakta görüntü dağılmış floater yığını.

Yeni sınır (`egitimControls.flySiniri`): çekim sırasıyla (cam_i, cam_i+1,
pivot) üçgen yelpazesi + `FLY_PAY` (0.35) × medyan kamera–pivot uzaklığı pay;
pay pivota doğru %10'a incelir (pivot öznenin üstünde, tam pay Q/E ile öznenin
içine batırıyordu). Kamera sınırda yüzey boyunca kayar; yörüngeden dışarıda
girilirse içeri serbest, dışarı kapalı (sıçrama yok). Hız ve tekerlek adımı
artık medyan kamera uzaklığına göre (0.5/sn, St. George'da 7.3 → 0.56).
`Egitim.yaricap` ve `sahneYaricapi` kaldırıldı, yerine `Egitim.kameralar`.
Gerçek arayüzde (tutulan WASDQE tuşları) iki sahnede sınıra kadar uçuldu:
geri/yan/yukarı sınırlarda sahne okunur kalıyor; St. George'da sınırın 1.5
birim ilerisi zaten çizgili (sınır gereksiz dar değil). Bilinen: kamera
yüksekliğinin altına pay kadar inilince alt yarı karanlık.

**Floater temizliği (dışa aktarım) YAPILMADI** — bkz.
`.superpowers/floater-flybound-report.md`: denenen üç süzgeç de ya bilinen iyi
çıktıyı bozdu (iri ölçek → deniz yüzeyi silindi; <2 kamera → ilk karenin
kenarında gerçek içerik oyuldu) ya da görünür floater'ı hiç azaltmadı
(0 kamera → gürültü kadraj İÇİNDE; yalnız kenar dolgusu siyaha döndü).

## 2026-09-26 — 3D eğit: yoğunlaştırma kısa bütçelerde de çalışır

**Kök neden.** splat.js refine'ı (ölü splat taşıma + Gaussian büyütme)
`iter > 1500` ve son refine'dan `refineEvery` sonra tetikler; varsayılan
2500, 60k iterasyonluk ufka göre seçilmiş. Varsayılan eğitici yalnız
`iter < 0.75 × maxIters` iken büyür ve taşır. `quick` (3k) ilk refine'ı
~2518'de görüyordu, pencere 2250'de kapanmıştı: **hiç büyüme, hiç taşıma**.
`standard` (10k) yalnız iki kez büyüyordu (2518, 5023).

**Düzeltme.** `egitimOturumAyari()` `createSession`'a
`refineEvery = max(300, round(maxIters / 8))` geçer (quick 375, standard
1250). Vendored dosyaya dokunulmadı. `growUntil` geçilmedi, varsayılanı zaten doğru.

**Ölçüm** (RTX 5070, `yay-100derece-stgeorge.mp4`, gerçek `egitimBaslat()`):

| katman | Gaussian önce → sonra | holdout PSNR önce → sonra |
|---|---|---|
| quick 3k (2+2 koşu) | 58 950 → 77 962 | 27.28 / 27.41 → 27.79 / 28.13 |
| standard 10k | 135 076 → 205 435 | 30.84 → 31.66 |

Koşu gürültüsü ~0.13 dB. Intel iGPU'da süre etkisi ölçülmedi (bkz.
`src/vendor/splat.js/VENDORED.md`). Kontrol: `scripts/verify-egitim-densify.mjs`
(refine takvimini vendored kapılarla simüle eder; vendored kapı değişirse düşer).

## 2026-09-26 — nesne ayırma: örnekleme grid'i özneye kırpılır

Grid bütçesi (384×384, 147.456 parçacık, sabit) nesne ayırma AÇIKKEN bile tüm
fotoğraf karesini kaplıyordu; çizilmeyen (shader/`splatOpacityGate` ile atılan)
arka plan aynı bütçeyi paylaşıyordu. Özne kare alanının küçük bir kısmıysa
bütçenin çoğu boşa gidiyordu (ölçüm: gerçek büst fotoğrafında maske %17.9 —
`verify-curtain.mjs`).

`src/engine/reconstruction/crop.ts` (`applySeparationCrop`) maskenin piksel
bbox'ını (+ %12 pay) hesaplar ve depth/maske/rgb'yi ÖRNEKLEMEDEN ÖNCE bu
bbox'a kırpar. Bu, `buildImportanceRemap`'in (14cfdfa/1fd9b87) YAPTIĞI
şeyden kasıtlı olarak FARKLI bir mekanizma: koordinatı bükmez, girdiyi
küçültür — grid yine 1:1 düzenli kalır, aynı basıklık/esneme hatasını
(stretch regresyonu) tekrar açmaz. `verify-photo-geometry.mjs` değişmeden
0 renk kayması ile geçiyor.

`Engine.setDepth` (fotoğraf dalı, `!videoTexture`) ve nesne ayırma toggle'ı
(`setObjectSeparation`, güncel depth+maskeyle yeniden örnekler) aynı kırpmayı
paylaşır: konum, renk/AO ve 'solid' kabuk mesh'i hep aynı bbox'ı görür. Kare
olmayan fotoğraflarda kısa eksendeki sıkışma da düzelir — dünya en/boy oranı
artık kırpılmış bölgenin oranından gelir, tam kareninkinden değil. Video/
kamerada dokunulmaz (bileşen analizini ~10 fps'te tekrarlamamak için).

Ölçüm (`verify-subject-crop.mjs`, sentetik büst ~%19 kare alanı): tam kare
grid'de özne yoğunluğu %15.0, kırpılmışta %55.5 (×3.7). Gerçek fotoğrafla
(`assets/thumbnail.jpg`, dev sunucu + tarayıcı) nesne ayırma AÇIK/KAPALI
karşılaştırması: yüz/gövde yüzeyi belirgin şekilde daha yoğun/pürüzsüz,
siluet kenarında bozulma yok; Solid ve Splat modları da aynı kırpmayı
kullandığı için tutarlı kaldı.

## 2026-09-25 — Z1-Z3 (Zeynep): çıktı akışı, yetenek/ön kontrol, mobil düzen

Dördü de aynı kuralın ayakları: **sessiz bozulma yerine sebep.**

**Sürüm görünürlüğü.** Başlıkta elle yazılmış bir gün etiketi duruyordu
("Gün A — ACES + bloom + FXAA + sis"); aradan onlarca değişiklik geçti, satırı
kimse güncellemedi. Sürüm artık `package.json`'dan build zamanında enjekte
edilir (`vite.config.ts` → `__APP_VERSION__`), başlık `spatial-canvas v1.0.0`
yazar ve elle tutulan ikinci kopya olmadığı için eskiyemez.

**Z1 · çıktı şeridi** (`ui/ExportBar.tsx`). PNG/PLY/WebM üç ayrı düğmeydi;
WebM süresi "saat" düğmesinin arkasında gizliydi (5→10→20 döngüsü), kayıt
sırasında hiçbir geri bildirim yoktu, sonuç yalnız log şeridinden okunuyordu.
Artık tek şerit: süre açıkça seçilir, kayıt geri sayımla ilerler ve o sırada
diğer çıktılar kilitlenir, sonuç şeridin kendi durum satırında görünür. Splat
yokken PLY sebebini söyler. Kapatılabilir **imza** (sağ alt köşe,
`spatial-canvas v<sürüm>`) hem PNG'ye hem WebM'e girer — kayıt ara canvas
üzerinden geçer, `engine/export.ts` değişmedi.

**Z1 · paylaşım** (`ui/paylasim.ts`, `Egitim3D`). Eğitim bitince tek düğme:
**tam bir tur dönen** 8 sn'lik imzalı klip (döngüye alındığında sıçrama
görünmesin diye tam tur) + künye panoya. Künye ölçülmeyeni uydurmaz, eksik
alanı atlar. **"Tek link" YAPILMADI:** link, 11 MB'lık `.ply`'ı ve
görüntüleyiciyi barındırmak demek; proje ücretsiz/yerel kalma kararında ve bunu
arayüz tek başına bozamaz. Barındırma kararı verilirse künye aynen link
açıklaması olur.

**Z2 · yetenek uyarısı** (`ui/YetenekUyarisi.tsx`). `yetenekRaporu()`'nun (E2)
arayüz karşılığı: `sebep === null` iken hiçbir şey çizilmez. Sorun varsa
rozetler (WebGPU / canlı derinlik / nesne tespiti) + sebep + kapat; sebep log
şeridine de düşer.

**Z2 · eğitim ön kontrolü** (`ui/egitimOnKontrol.ts`). WebGPU olmayan
tarayıcıda kullanıcı "eğitimi başlat"a basıyor, kare çıkarma başlıyor ve ancak
`ayarSec()` içinde patlıyordu — mesaj doğru, zamanı yanlıştı. Artık ön ayar
ekranı açılır açılmaz cihaz sorulur; WebGPU yoksa düğme kapalı gelir, sebep ve
**tarayıcıya özel** kurtarma adımları listelenir (Safari: sürüm/bayrak,
Firefox: about:config, Chrome/Edge: donanım hızlandırma + uzak masaüstü
uyarısı). Seçilen GPU ve ayar katmanı her cihazda görünür
("apple / metal-3 · hafif ayar (quick) · 24 kare · 3.000 iterasyon") — eskiden
yalnız Intel iGPU'ya özel ipucu vardı. Hata sonrası "tekrar dene" aynı dosyayla
ön ayara döner (oturum kapanır, GPU bırakılır).

**Z3 · mobil düzen.** 375 px ekranda sayfa 810 px'e uzuyordu: sabit 640×420
sahne, sabit 640 px node editörü, sarmayan mod satırı ve 220 px sabit sağ panel.

| ölçüm (emülasyon 375×812) | önce | sonra |
|---|---|---|
| sayfa genişliği | 810 px | **375 px** (yatay kaydırma yok) |
| sahne | kadrajdan taşıyor | 353×232, oran 1.52 korunuyor |

Motorun tuvali akıştan çıkarıldı (`position: absolute`): tuval kendi CSS
yüksekliğiyle konteyneri geri itiyor ve `aspect-ratio` hiç uygulanmıyordu
(ölçüldü: 353×302, oranın istediği 353×232). Kök grid `minmax(0, 1fr)` —
`auto` sütun içeriğin max-content'ine şişip alt öğelerdeki `min(640px, 100%)`
hesabını da bozuyordu. Dar ekranda sağ panel akışa girer ve katlanır
(varsayılan kapalı). Masaüstünde regresyon yok (1280×800: sahne 642×422, panel
sabit 220 px, örtüşme yok). **Sınır:** ölçümler tarayıcı emülasyonunda; gerçek
telefon kabulü yapılmadı.

**Siyah ekran düzeltmesi** (`ui/maskeKarari.ts`). Segmentasyon RMBG-1.4'ten
IS-Net'e geçince sentetik görselde maske kadrajın yalnız %4,7'sini özne saydı;
nesne ayırma otomatik açık olduğu için sahnenin gerisi siliniyordu (dolu piksel
%5,3 → %0,7) ve sebep hiçbir yere yazılmıyordu. Karar tek taraflıydı: üst uç
korunuyordu (%92 üstü "model pes etti"), alt uç yoktu. Ölçülen oranlar —
sentetik %4,7 · proje küçük resmi %17,9 · bina cephesi %45,6 — alt eşik %8.
Maske atılmaz (derinlik aşamaları ondan faydalanır), yalnız ayırma kapalı
başlar ve sebep söylenir.

**Doğrulama:** `npm run verify` zinciri 64 → **69** (yeni: `verify-cikti-imza`,
`verify-yetenek-uyarisi`, `verify-maske-karari`, `verify-egitim-onkontrol`,
`verify-paylasim`), hepsi geçiyor; `npm run typecheck` temiz.

## 2026-09-25 — 3D eğit: kare yakalama sonunda decoder asılı kalmaz

- Kök neden (vendor `splat.js/io/video.js` `runDecoder`): son seçilen kareden
  sonra durdurulunca pompa döngüsü hiç `await` etmiyor; async IIFE senkron
  bitip `finally { pumping = null }` çalıştırıyor, ARDINDAN dış atama bitmiş
  sözü `pumping`e yazıyordu. `pumping` bayat kalınca sonraki çıktı kareleri
  hiç kapanmıyor, decoder kare havuzu tükeniyor, `flush()` dönmüyordu —
  yalnız 90 sn bekçisi (`kareler seçiliyor: 90 sn ilerleme yok…`) bitiriyordu.
  Son seçim videonun bitişinden ~0.8 sn (≥ ~24 kare) önce kalınca tetikleniyor.
- Düzeltme: pompa IIFE'si `await null;` ile başlar; atama her zaman önce biter.
- Doğrulama (tarayıcı, WebCodecs): düzeltmesiz nyc24 son seçim bitişten 24
  kare önce → 3/3 asılı (90 sn bekçi), `cut3` + `shots: 'all'` → 1/2 asılı;
  düzeltmeyle aynı durumlar (12–30 kare) 5–7 sn'de biter, hiç kare sızmaz.
  Tek çekim klipler (nyc24, light8, yay-100derece) ve `cut3` varsayılan
  modda düzeltmeli/düzeltmesiz birebir aynı kare zamanı ve JPEG boyutu.
- Regresyon: `verify-egitim-decoder-drain` (sahte VideoDecoder, düzeltmesiz
  kırmızı).

## 2026-09-25 — Splat: nesne ayırma arka plan perdesini çizmez

- Kök neden: nesne ayırma AÇIK iken Point Cloud / ASCII / Neon arka plan
  texel'lerini (w = `BACKDROP_OPACITY` = 0.4) atıyor, splat modu atmıyordu —
  splat material'ında ayırma kolu yok, sıralama kapısı sabit 0.02. Büst
  fotoğrafında 147.456 splat'ın 121.057'si (%82) arka plandı; boyutları ön
  planla aynı (0.0026), ama komşuya değecek şekilde örtüştükleri için sürekli
  bir tabaka oluyor, yandan bakışta kavisli beyaz perde olarak okunuyordu.
  Veri/boyut hatası değil, ayırmanın splat'a hiç uygulanmaması.
- `splatOpacityGate`: ayırma AÇIK + köprü kaynağında kapı ≥ 0.5; Engine
  sıralamaya bunu verir, ayırma değişince sırayı tazeler. Ayırma kapalı ve
  `authored` Gauss'lar birebir eski davranış.
- Doğrulama (tarayıcı, 70° yan görüş): büst ve özüm'de perde kayboldu, Point
  Cloud ile aynı siluet; çizilen splat 147.456 → 26.399 (= ön plan sayısı).
  Ayırma kapatılınca tüm sahne geri gelir.
- Regresyon: `verify-splat-separation`.

## 2026-09-25 — Fotoğraf + canlı: yumuşak maske içi yüzü içe çökertmez

- Kök neden: `applyForegroundStretch` maske değeriyle harmanlıyor
  (`d + (hedef − d)·m`). IS-Net bazı yüzlerde (d93ef671: ıslak/parlak cilt,
  yatık kafa) çıplak cilde yalnız 0.51–0.65 güven veriyor, saç/kapüşon
  çerçevesi ~1.0. Yüz merkezi ~+0.4'lük stretch kaldırmasının ~%55'ini,
  çerçeve %100'ünü alıyordu; maskenin çukuru derinliğe ~0.15'lik kase olarak
  basılıyordu. İç yüz dışbükeylikten (+9.2e-3) içbükeye (−9.1e-3) tam stretch
  aşamasında dönüyordu. Model çıktısı dışbükey; detay/sobel/sınırlayıcı/baş
  detayı/kırpma neden değil.
- Yeni `fillSoftMaskInterior`: stretch + sobel ağırlığı
  `max(m, blur3(iç6))`; iç = 6 px içinde her piksel ≥ 0.5. Dış tüy (< 0.5)
  hiç yükselmez → siluet, sınırlayıcı bölgeleri, stretch aralık taraması ve
  yakın-kuyruk çarpıklık kapısı değişmez. Fotoğraf (gerçek özne maskesi) ve
  canlı yol (`postProcessLiveDepth`) ikisi de kullanır; maskesiz/depth-türevli
  maske yolları aynen.
- Ölçüm (gerçek model q8, iç yüz dışbükeyliği ×1e-3 / yüz iqr): d93ef671
  −10.7 → +20.5 / 0.104 → 0.173. özüm, büst, 66fe3981 yüzü aynı; karina
  16.9 → 17.0; 4cb24ad8 yüz iqr 0.080 → 0.080 (yakın-kuyruk düzeltmesi
  korunur). Bilinen yan etki: ayna selfie kot bölgesi (maske 0.78–0.87)
  ortalama +0.068 öne gelir, büst kaidesi −0.011. Canlı maliyet 2.3 ms
  (252×322).
- Regresyon: `verify-depth-mask [11]`.

## 2026-09-25 — Fotoğraf: kameraya uzanan uzuv yüz/gövde rölyefini ezmez

- Kök neden: maskenin %10'undan büyük bir yakın uzuv (kameraya uzanan kol/el)
  stretch aralığının p90'ını ele geçiriyordu; yüz/gövde 0..1'in ~%3'ünde
  kalıp 3B'de düz okunuyordu. Model rölyefi görüyor (kol kadraj dışında
  kalınca yüz iqr ×4.5), eğim sınırlayıcı/maske/kırpma geçişi neden değil.
- `applyForegroundStretch` yeni opsiyonel `nearTailClamp`: çarpıklık
  (p90−p50)/(p50−p10) > `NEAR_TAIL_MAX_SKEW` (= 2) ise üst sınır
  p50 + 2·(p50−p10)'a kelepçelenir (sürekli; eşik üstünde sıçrama yok).
  Yalnız fotoğraf yolunda ve gerçek özne maskesiyle açılır; canlı yol ve
  maskesiz çağrılar birebir eski davranış.
- Ölçüm (gerçek model, son derinlik, yüz iqr): 4cb24ad8 0.030 → 0.080,
  66fe3981 0.070 → 0.101. Bedel (kabul edildi): uzvun kendi şekli yumuşak
  üst kuyruğa sıkışır (kol iqr 0.540 → 0.047, masadaki el 0.132 → 0.014),
  uzuv önde kalır. Çarpıklık: pozitifler 7.36 / 3.38, negatifler ≤ 1.43;
  özüm, karina, ayna selfie, büst, d93ef671 son derinliği BİT-AYNI.
- Regresyon: `verify-depth-mask [10]`.

## 2026-09-25 — Fotoğraf: önem örneklemesi varsayılanı KAPALI (basık/yayık büst)

- `importanceSampling` artık opt-in (`sampleVolumePositions`,
  `sampleImageGrid`, `sampleAoGrid`, `buildShellMesh`,
  `fillPositionsFromDepth`, `fillImageColorTexture`). Remap yalnız örnekleme
  koordinatını büküyor, dünya xy'si düzgün grid'de kalıyordu: özne x/y'de
  büyütülüyor, z büyümüyordu. 16:9 büst (518×291) ölçümü: özne genişliği
  1.216 → 2.216 (×1.82), yükseklik ×1.56, z/x 0.40 → 0.21. Her render modu
  aynı konum texture'ını okuduğu için hepsinde görülüyordu.
- Uygulama çağrısı: `Engine.setDepth` fotoğraf konumlarına açıkça
  `importanceSampling: false` verir (eskiden `!videoTexture` = fotoğrafta
  açık; varsayılan değişikliği buraya ulaşmıyordu). Renk dolumları ve kabuk
  mesh varsayılanla (kapalı) aynı remap'i paylaşır.
- Regresyon: `verify-photo-geometry` (yeni) — kütüphane varsayılanı ve
  gerçek `Engine.setDepth` fotoğraf yolu: özne dünya genişliği siluetle %5
  içinde, z/x > 0.35, renk kayması 0 (her parçacığın rengi kendi pikseli).
  `verify-mesh` remap vakaları kolu açıkça açar. Eval `importanceSampling`
  kolu açık değer verdiği için etkilenmez.

## 2026-09-24 — 3D eğitim: GPU yönlendirmesi ve isteğe bağlı kalite yolları

- Intel Iris/UHD gibi tanınan entegre GPU'da eğitim paneli, Windows Grafik
  ayarlarından tarayıcıyı “Yüksek performans”a alma ve tarayıcıyı yeniden
  başlatma adımlarını gösterir. Intel Arc, AMD ve bilinmeyen adaptörler için
  entegre GPU uyarısı verilmez. Katman seçimi ölçülmüş NVIDIA/Intel yollarıyla
  sınırlı kalır.
- Intel iGPU'da güvenli 24 kare / 3.000 iterasyon varsayılanı korunur. Eğitim
  tamamlanınca aynı oturumda +4.000 iterasyon sürdürme seçeneği gelir; kare
  çıkarımı, SfM ve Gaussian tohumlama tekrarlanmaz. Tek St George / Intel
  `gen-12lp` koşusunda ayrılmış kare PSNR 27,1 → 27,9 dB, Gaussian sayısı
  58.803 → 67.624 oldu; ek süre 397 sn. Bu tek klip ölçümü olduğu için
  seçenek deneysel kalır.
- “Yalnız özneyi eğit” eğitim panelinde ayrı, varsayılanı kapalı bir seçenektir.
  Seçilen her kare için IS-Net yumuşak maskesi eğitimden önce hazırlanır;
  tam RGB SfM'ye kalır, maske kayıp hesabına ayrı verilir. Boş/geçersiz
  maskeli kareler atlanır; seçilenlerin en az %70'i ve en az 8 kare kalmazsa
  açık hata gösterilir. Tam sahneye sessiz dönüş yoktur. İptal ve geçici
  bitmap/canvas temizliği doğrulandı. St George tarayıcı denemesinde 24 kareden
  21'i maskelendi, 3'ü atlandı ve vendored yükleyici SfM özellik aşamasına
  geçti. Maskeli ve tam sahne PSNR
  değerleri farklı piksel kümelerinde hesaplandığı için doğrudan kıyaslanmaz.
- Yeni doğrulamalar: `verify-egitim-gpu-selection`, `verify-egitim-gpu-hint`,
  `verify-egitim-continue`, `verify-egitim-subject-mask`.

## 2026-09-24 — İnceleme düzeltmeleri: GPU güvenliği ve render/arayüz durumu

- Fotoğraf segmentasyonu GPU kuyruğunun dışındaydı; video oynarken fotoğraf
  bırakılınca iki WebGPU oturumu çakışabiliyordu. Kuyruğa giriş
  `segmentation.ts` içine taşındı, eşzamanlı model yüklemesi tek oturumda
  birleşir. Eğitim sürerken hızlı 3B harita, harita çalışırken `3D eğit`
  kilitlidir.
- Kaynak değişiminde eski async yollar artık yazmaz (nesil sayacı): kameraya
  çift tıklama iki akış açmaz, bayat fotoğraf sonucu yeni kaynağı ezmez,
  sürükle-bırak `busy`'ye bakar. Açılamayan dosya (HEVC `.MOV`, HEIC) log'a
  ne yapılacağını yazar; yarım kaynak bırakılır, aynı dosya yeniden seçilebilir.
- `onnxruntime-web` tam sürüme sabitlendi; `/ort` ve `/models` artık
  `immutable` önbellekte değil, karmalı `/assets` öyle. Build
  `THIRD_PARTY_NOTICES.txt` üretir (npm paketleri, splat.js, mediabunny,
  model ağırlıkları).
- Graf editörü ile sağ panel aynı değer için çakışmaz: panelde değişen değer
  graf kenarı kesilince geri dönmez; renderer parametresi başka modun
  material'ına sızmaz. Renk seçiciler reset sonrası çalışır. Grafta düğüm
  silinemez; Backspace artık düğümün bütün kenarlarını silmiyor.
- Düz video ton eğrisinden geçmez (önce beyaz ~227/255'e iniyordu); bu modda
  pozlama kolu etkisizdir. Fotoğraf/ASCII/neon nokta boyutu uyarlamalı DPR
  düşünce büyümez (`uDprScale`). Canlı videoda derinlik yazılır ve 0.3 alfa
  kesimi uygulanır: kamera dönünce uzak nokta yakının üstüne binmez; bedeli
  sert video sprite kenarlarıdır, boşluk eşiği ~3,9 nokta boyutuna çıktı.
- Yeni doğrulamalar: `verify-seg-queue`, `verify-source-guard`,
  `verify-release-hygiene`, `verify-graph-params`; `verify-live-engine-integration`
  ve `verify-video-point-footprint` genişletildi. Tarayıcıda gözle kontrol
  henüz yapılmadı.

## 2026-09-24 — Deploy: modeller build'de, `public/` yalnız yayınlanacak dosyalar

- Git'ten Vercel deploy'unda model yoktu: `vercel.json` yalnız `vite build`
  çalıştırıyordu, `public/models` ve `public/ort` gitignore'lı. Her model isteği
  404'e düşüyordu. `npm run build` artık önce `fetch:assets` çalıştırır.
- Yerel build'in ters sorunu vardı: `dist` 754 MB'tı; listeden çıkarılmış ve
  ticari kullanıma kapalı `briaai/RMBG-1.4` ile `depth-anything-v2-base`
  ağırlıklarını ve kişisel test videolarını içeriyordu. `fetch-assets` artık
  `public/models` ve `public/ort`'u listenin birebir aynası tutar ve
  `public/` içinde video bulursa build'i durdurur.
- Test klipleri `public/`'ten `assets/test-clips/`'e taşındı; dev sunucusu
  aynı dosyaları `/assets/test-clips/...` yolundan verir.
- Doğrulama: `public/` olmayan temiz kopyada `npm run build` 1 dk 19 sn'de
  geçti, 11 model dosyası indi. `dist` 754 MB'tan 253 MB'a indi. `vite preview`
  modelleri doğru tip ve boyutla sundu; kaldırılan RMBG yolu yalnız SPA
  fallback'ini döndürdü.

## 2026-09-24 — Canlı video: kadraj, nokta izi ve zamanlama

- Video bulutu sabit 2 birim yerine kameraya `contain` ölçeğiyle sığar (%94).
  Eski yükseklik görüntü alanının dikeyde yalnız ~%49,5'ini kaplıyordu.
- Video nokta boyutu ızgaranın ekrandaki fiziksel piksel aralığından türetilir
  (DPR, zoom, en-boy). Varsayılan 6'da gökyüzündeki dikey çizgiler kapandı.
  Fotoğrafın nokta boyutu formülü değişmedi.
- Video konumları her derinlik karesinde yeni hedefe doğrudan oturur. Yay
  takibi sabit bir adımda ~%55 aşım yapıyor, şekli renkten ayırıyordu.
  Fotoğrafta yay etkileşimi korunur.
- Maske video geometrisini değiştirmez: izdüşüm de derinlik son işlemesi de
  maskesiz aynıdır; maske yalnız nesne ayırma açıkken opaklığı etkiler. Döngüde
  maske korunur, yalnız kullanıcı seek'i yeniler. Duraklatılmış videoda gelen
  maske son derinlikle hemen uygulanır. Video segmentasyonu yalnız nesne ayırma
  açıkken koşar; önceden kapalıyken bile GPU kuyruğunu işgal ediyordu.
- Derinlik aralığı yumuşatması çıkarım hızına değil medya zamanına bağlıdır
  (yarı ömür 450/500 ms). Sahne kesmesi, seek/döngü ve zaman sıçraması durumu
  sıfırlar. Canlı videoda kırpık özne tahmini artık kadraja yayılmaz.
- Point Cloud'dayken video derinliği 147.456 Gaussian'ı her karede yeniden
  üretmez; köprü Splat/Crystal'a geçişte veya dışa aktarımda tazelenir.
  Crystal'a video üzerinde geçişte de tazelenir (kabuk olmadığı için erken
  dönüş yenilemeyi atlıyordu). Composer piksel oranı uyarlamalı DPR ile
  eşitlenir. Geliştirme modundaki tohum kontrolü (senkron GPU okuması) yalnız
  ilk tohumlamada koşar; video her karede tohumladığı için ölçümü bozuyordu.
- Log satırı kare yaşını gösterir. Tarayıcı denemesi (Intel iGPU): gs-test.mp4
  322×154, nyc.mp4 280×154; kare yaşı 120–230 ms, Engine'e CPU yüklemesi
  ~20 ms. Güncelleme hızı model çıkarımına bağlı kalır.
- Yeni regresyonlar: `verify-video-geometry`, `verify-video-point-footprint`,
  `verify-live-temporal-range`, `verify-live-engine-integration`.

## 2026-09-24 — Canlı video nokta bulutu hizalaması

- Ham video dokusunun düz UV'si ile önem örneklemesine göre bükülmüş derinlik
  UV'si ayrışıyordu. Video için aynı düz UV kullanılır; maskesiz manzara artık
  portre siluetinden kesilmez.
- Tam kare video noktaları başlangıç kamerasına göre geri izdüşürülür. Yakın
  binalar büyüyüp uzak gökyüzü daralarak kareyi parçalamaz.
- Modelin işlediği karenin RGB anlık görüntüsü derinlikle birlikte renk grid'ine
  yüklenir. Nokta bulutu sonraki video karesinin rengiyle boyanmaz; düz video
  modu akıcı orijinal videoyu göstermeye devam eder.
- Video kaynağında Point Cloud normal alfa harmanlama kullanır; yoğun tam kare
  ızgara additive'de beyaza doyuyordu. Fotoğraf ve preset'ler additive kalır. `verify-video-color-alignment` geometri, perspektif,
  tam kare opaklığı ve renk girdisini regresyona bağlar.
- `gs-test.mp4` tarayıcı denemesinde karenin rengi ve geometrisi görsel olarak
  hizalı; canlı derinlik yaklaşık 3,6 Hz. Bu tek klipteki gözlemdir.

## 2026-09-24 — Video önizleme ve değerlendirme panelleri

- Hızlı 3B haritanın ayrı video kullandığı ve gerçek 3DGS eğitimi olmadığı
  arayüzde açıklanır. Boş splat çıktısı başarı sayılmaz; eşzamanlı yakalamalar
  ve geç kalan dosya sonuçları sahneyi değiştiremez.
- Metrik paneli çevrimdışı deney raporunun kaynağını, veri kümesini ve bölmesini
  gösterir. Bu sayıların kullanıcının yüklediği videoya ait olmadığı açıklanır;
  hatalı rapor satırları reddedilir.
- Yakalanan Gaussian sahnesi artık sonraki canlı derinlik güncellemesinde
  nokta bulutu köprüsüyle ezilmez. Yeni medya kaynağı seçilince köprü yeniden
  etkinleşir.
- Canlı derinlik ön ısıtma ile yarışmaz; hızlı cihazda çözünürlük kontrollü
  yükselir, yavaşlarsa geri döner. Video için maske yalnız güvenilir bir ön plan
  bulunduğunda kullanılır ve GPU kuyruğunda gerektiğinde yenilenir. Devreden
  çıkan parlaklık kare geri çağrısı iptal edilir.
- `public/gs-test.mp4` ile 4 keyframe'de 25.429 splat üretildi; 3 poz hatası
  ve çözülemeyen ölçek arayüzde göründü. Aynı 4K klipte canlı derinlik
  yaklaşık 1,4–4,3 Hz gözlendi; %3 alanlı maske güvenilmez sayılıp atlandı.
  Bu ölçüm tek cihaz/klip gözlemidir, genel kalite veya gecikme kabulü değildir.

## 2026-09-24 — 3DGS kod incelemesi: iptal ve GPU ömrü

- SfM'nin özellik ve eşleşme Worker havuzları iptal veya hata durumunda
  sonlandırılır. Kapatma artık bekleyen SfM sözünü de iptal eder.
- Yükleme sırasında kare çözme de iptal sinyalini izler; açılmış bit eşlem
  kaynakları hata veya iptalde bırakılır.
- GPU aygıtı oturum kapandıktan sonra açılırsa hemen bırakılır; kapanmış
  oturum SfM'ye devam etmez.
- Bu durumlar için `verify-egitim-sfm-cancel`,
  `verify-egitim-gpu-lifecycle` ve `verify-egitim-frame-cancel` eklendi.

## 2026-09-24 — 3DGS etkileşim ve eğitim yaşam döngüsü

- Eğitim kanvasında fare tekerleği sayfayı kaydırmadan yakınlaştırır; yakınlık
  pivotun içinden geçmeyecek şekilde sınırlanır. İşaretçi iptali sürüklemeyi
  sonlandırır ve PLY indirme hatası arayüzde görünür.
- Eğitim zamanlayıcısı Worker açılamayan arka sekmelerde zamanlayıcıya düşer;
  döngü hataları ve 90 saniyelik ilerleme kesilmesi kullanıcıya bildirilir.
- Kare çıkarma ve SfM iptal sinyali alır; kapatma WebGPU kanvasını bırakır.
  Eğitim kaplaması açıkken alttaki WebGL motoru GPU işi yapmaz.
- `verify-egitim-scheduler`, `verify-egitim-cancel`, `verify-egitim-wheel` ve
  `verify-egitim-seek` bu davranışları doğrulama zincirine ekler.

## 2026-09-24 — Güncel 3DGS sözleşmesi ve lansman planı

- `docs/yol-haritasi.md` yeniden yazıldı: fotoğraf, surfel `video → 3B` ve
  gerçek `3D eğit` ayrı ürün yolları olarak tanımlandı. Eski sezgisel
  fotometrik Tur 3, 3DGS için gerekli iş listesinden çıkarıldı.
- `ARCHITECTURE.md` D.9, vendored `splat.js` eğitim/veri/render sınırını ve
  ana motorun `GaussianBuffer`'ından ayrılığını kaydeder. Video füzyonunun
  bugünkü Depth Anything varsayılanı ve luminance geri düşüşü yazıldı.
- README'deki `-base` model, sabit eski model boyutları/test sayısı ve E4'ün
  yeni 3DGS karşılaştırması gibi okunabilecek anlatımı düzeltildi. E4 kaydı
  tarihsel surfel ölçümü olarak işaretlendi; Brush hücreleri boş kalır.
- `verify-depth.mjs` ve `verify-curtain.mjs`, dağıtımdan çıkarılmış
  Depth Anything Base / RMBG yerine ürünün Small / IS-Net modellerini
  çalıştırır. Tam doğrulama zinciri artık güncel ağırlıkları sınar.

## 2026-09-23 — Tur 2 E3/E4 (Emre): Worker tracker ve karşılaştırma zemini

- Tracker'ın optik akış/kümeleme hesabı ile YOLOS nesne tespiti Worker'a
  taşındı. Ana iş parçacığı, küçültülmüş kareyi aktarır ve son HUD hedeflerini
  okur. Kaynak/mod değişimlerinde eski Worker cevabı nesil numarasıyla atılır;
  Worker veya Web Locks desteği yoksa önceki uygulama yolu çalışır.
- Canlı derinlik ve Worker tespiti, Web Locks ile aynı GPU model sırasına
  girer. Test: `verify-tracker-worker.mjs`, tip kontrolü, build ve gerçek
  NYC klibinde özellik/nesne modu.
- Aynı klipte tracker açık/kapalı FPS örnekleri
  [E3 ölçümünde](docs/benchmarks/E3-tracker.md). Brush'ın pozlu veri kümesi
  girdisi bu ortamda olmadığından onun süre/kalite hücreleri ölçülmedi;
  Spatial Canvas koşusu ve yeniden üretim yolu
  [E4 raporunda](docs/benchmarks/E4-brush.md).

---

> **ZEYNEP'E UYARI (Gün 7 kablosu — çakışma alanı):** `src/App.tsx`
> değiştirildi: yeni import (`engine/vision/videoPipe`), `fuseVideoToSplat`
> handler'ı ve üst buton satırına `video → 3B` butonu (kamera butonunun
> yanı). Bu dosyada AYNI ANDA çalışıyorsan önce en güncel hali çek
> (merge/pull), sonra kendi değişikliklerini uygula. `Engine.ts`, `splats.ts`
> ve material dosyalarına DOKUNULMADI — sendeki splat render şeridi aynen
> duruyor.

---

## 2026-09-23 — Viral sprint, render katmanı (Zeynep): tracker HUD, canlı fotoğraf, neon düzeltmesi

Sözleşme DEĞİŞMEDİ: yeni render modu, yeni ParamDef, yeni preset alanı ve yeni
graf düğümü YOK. Sprint kararı gereği iki yeni özellik de ad-hoc React
state'inde durur — preset'e kaydolmazlar.

**Tracker HUD overlay** (`src/ui/TrackerOverlay.tsx`, yeni) — motor canvas'ının
üstüne binen ayrı bir 2D `<canvas>`; maske overlay'iyle aynı desen, WebGL
sahnesine hiç girmiyor. Emre'nin `engine/vision/tracker.ts` sözleşmesini okur
(`TrackedTarget` = {id,x,y,w,h}, tracker'ın kendi piksel uzayı) ve kendi
boyutuna ölçekler. Köşe parantez / kutu / ikisi, glow, ID + koordinat etiketi,
yakın hedefler arası bağlantı çizgisi, LOCK vurgusu, sol üstte sayaç bloğu.
Kapalıyken mount edilmez — rAF döngüsü de kurulmaz.

Ham tracker verisi HUD için sertti: `everyNFrames` nedeniyle kutular 20 Hz'de
zıplıyordu. Kutular artık hedefe üstel yaklaşıyor (kare hızından bağımsız),
yeni ID'ler toplanarak beliriyor, düşen hedefler hayalet olarak sönüyor.

**"Canlı fotoğraf" paralaks sway** (`src/ui/ModeSelector.tsx`) — Emre'nin
`Engine.setAutoSway`'ine bağlı toggle + hız kolu. Yeni geometri yok; kamera
açıldığı andaki pozun etrafında salınır. Ölçüldü: yörünge yarıçapı sabit
(3.50), sürüklerken durup bırakılan YENİ pozdan devam ediyor, kapatınca kamera
olduğu yerde kalıyor. WebM export sway açıkken çalışıyor (4.97 sn, 1280×840,
2.3 MB). **Döngü uyarısı:** sway iki ayrı frekans taşıyor (yaw 0.6·hız, pitch
0.37·hız) — hiçbir hızda 5/10/20 sn'lik klip tam kapanmıyor. Gerçekten
loop'lanabilir klip için pitch'in yaw'ın harmoniği olması gerekir (Engine
tarafı, YAPILMADI).

**NEON MODU DÜZELTİLDİ — ekran siyahtı.** Mod, material, `uPositions` ve
görünürlük doğruydu; hata shader matematiğindeydi. Motorun kendi konum
texture'ı geri okunarak ölçüldü (sentetik görsel, 384×384 grid):

| ölçüm | değer |
|---|---|
| z aralığı | −1.000 .. 0.695 (sözleşmeye uygun) |
| en büyük komşu farkı | 0.799 |
| ESKİ ölçekte en güçlü kenar | 0.446 |
| ESKİ ölçekte ortalama kenar | 0.010 |
| ekranda en parlak piksel | **55/255, 60 üstü piksel YOK** |

Kök neden: Sobel normalizasyonu (0.125) komşu texel'ler arasında ~1.0'lık z
basamağı varsayıyordu. Sampler Gün B/C'den beri silüet-oranlı **sürekli** bir
hacim üretiyor — keskin basamak yok, gradyan 10-40 kat küçük. Kenar gücü rengi
doğrudan çarptığı için (tint · uGlowIntensity · vEdge) bu bant pratikte
siyahtı: mod çiziyordu, görünmeyecek kadar sönük çiziyordu.

Dört düzeltme (`src/shaders/neonWireMaterial.ts`): `EDGE_GAIN = 16` (ölçülen
0.02-0.45 bandı 0.3-1.0'e taşınır, eşik kolu yeniden anlamlı), `vEdge` artık
`smoothstep(eşik, eşik+0.25)`, `gl_PointSize` alt sınırı 1.5 px (varsayılan
kalınlık başlangıç mesafesinde 0.86 px'lik sprite veriyordu — çizgi rasterde
eriyordu), fotoğraf rengi kullanılırken ton korunup değer tavana çekilir.
**Sonuç: en parlak piksel 55 → 203, parlak piksel oranı %0 → %0.30.**

**İKİNCİ KÖK NEDEN — "ekran hâlâ neredeyse siyah".** Yukarıdaki düzeltmeden
sonra çizgiler görünür oldu ama kare hâlâ boştu: yalnız öznenin DIŞ HATTI
çiziliyordu. Sebep, kenarların tek kaynağı olması — derinlik. Sampler sürekli
bir hacim ürettiği için hacmin İÇİNDE keskin z sıçraması yok; tek gerçek
süreksizlik silüet. Sahnenin asıl yapısı (pencere, tabela, desen, yüz hatları)
derinlikte değil GÖRÜNTÜDE.

`uImageTexture` renk için zaten bağlıydı ve konum grid'iyle aynı uv'ye
eşlenmiş; parlaklığı aynı Sobel çekirdeğiyle taranır, güçlü olan kaynak kazanır
(`max`, toplam değil — toplam silüeti iki kez sayıp kalınlaştırırdı). Yeni kol:
**`uTextureEdge` / "doku kenarı"** (0..1, varsayılan 0.6; 0 = eski davranış,
yalnız derinlik).

Görüntü Sobel'i de kendi ölçeğini istedi. Bina cephesi test görüntüsünde ön plan
texel'leri: medyan 0.000 · %90 0.130 · %97 0.236 · en yüksek 0.430. Kazançsız
hâlde kol 0.6'dayken %90'lık kenar 0.078 ediyordu — eşiğin (0.1) ALTINDA, yani
kol açıkken bile hiçbir doku çizgisi geçmiyordu. `IMAGE_EDGE_GAIN = 4`.

**Sonuç (aynı cephe görüntüsü): parlak piksel oranı %0.36 → %2.21, en parlak
piksel 171 → 226.** Artık pencereler, tabela ve cephe hattı tek tek çiziliyor —
mod gerçekten "neon tel kafes" gibi görünüyor.

`NEON_PARAMS`'a yeni kol eklendi (preset şeması geriye uyumlu: eski preset'lerde
alan yoksa varsayılan kullanılır). `npm run verify` yeni kolla birlikte 29/29.

**Arayüz** (`src/App.tsx`) — üst şerit 13 kontrole çıkmıştı ve üç ayrı stil bir
aradaydı (tarayıcı varsayılanı, ad-hoc renkli toggle'lar, PNG/WebM'in koyu
stili). Hepsi koyu terminal diline çekildi; şerit sarıyor, gruplar ayraçla
bölündü, fps sağa alındı, çıplak dosya input'u butona döndü. Toggle vurgu
renkleri anlam taşıdığı için değişmedi.

**Regresyon:** `npm run typecheck` temiz; `npm run verify` zinciri 29/29 geçti.
Altı render modu da çiziliyor (aynı sahnede en parlak piksel / parlak piksel
oranı): points 241/%5.5 · ascii 214/%3.9 · neon 203/%0.3 · solid 219/%5.5 ·
splat 202/%8.1 · crystal 224/%2.2.

---

## 2026-08-14 — Gün 6 (Emre): ölçek hizalama + keyframe zinciri

Sözleşme: `ARCHITECTURE.md` → yeni "D.11 Ölçek Hizalama + Keyframe Zinciri
(Emre — Gün 6)".

Plan: "Triangüle seyrek noktalarla `d_metric ≈ a·d_pred + b` en küçük
kareler; keyframe seçimi (parallaks + takip kalitesi eşiği). Bitti sayılır:
30 sn'lik gerçek klipten 8-15 keyframe + tutarlı ölçekli pozlar çıkıyor."

**Yeni dosya:** `src/engine/vision/scale.ts` — `triangulateWorldPoint` (Gün
5'in göreceli `triangulateDepths`'i üzerine, MUTLAK D.2 poz çiftine
genelleştirilmiş), `fitScaleAlignment` (kapalı-form en küçük kareler,
`d_metric≈scaleA·d_pred+scaleB`), `alignKeyframeScale` (üçgenleme+hizalamayı
birleştiren üst fonksiyon), `selectKeyframes` (akış tabanlı, referans-
güncellemeli parallaks/izleme eşiği). `scripts/verify-scale.mjs` (zincirin
14. script'i, model YÜKLEMEZ).

**Sonuç:**

| Test | Sonuç |
|---|---|
| Üçgenleme (gerçek poz, tek nokta / 200 nokta RMS) | 6.24e-8 / 1.78e-7 dünya birimi |
| Üçgenleme (Gün 5'in tahmin ettiği zincirle) | 100/100 cheirality |
| Ölçek uydurma (sentetik a=2.7,b=-0.4) | â=2.6995, b̂=-0.4012 |
| Keyframe seçimi (60 kare, 150° yay) | 8 keyframe (D.8 hedefi 8-20 içinde) |

**Teşhis sırasında yapılıp düzeltilen bir hata (aynı desen, ikinci kez):**
İlk test taslağı üçgenleme için `toFirstKeyframeOrigin`'in MUTLAK (yeniden
çerçevelenmiş) pozlarını, sahne noktaları içinse HAM (`generateOrbitTrajectory`)
koordinatlarını kullanıyordu — iki farklı çerçeve karışınca üçgenleme hatası
2.91 dünya birimine çıktı. Bu, `verify-pose.mjs`'te bir tur önce bulunup
düzeltilen TAM AYNI hata deseniydi (bkz. Gün 5 girişi) — bu kez üçgenleme
testinde tekrarlandı. Düzeltme: üçgenleme HAM pozlarla yapılır (sahneyle aynı
çerçeve); yalnızca CHEIRALITY SAYISI (mutlak XYZ değil) kontrol eden bloklarda
karışık çerçeve zararsızdır (`triangulateWorldPoint` yalnızca GÖRECELİ pozu
kullanır, ortak rijit dönüşümden etkilenmez — gerekçe D.11'de).

**Bilinen sınır:** gerçek video/derinlik-modeli ile uçtan uca test EDİLMEDİ
— yalnızca sentetik yörünge + sentetik-bozulmuş "d_pred" ile (D.7 kesme
sırası madde 2 ile aynı gerekçe). Arayüz gerçek entegrasyonu kabul edecek
biçimde tasarlandı, ek sözleşme değişikliği gerekmiyor.

Doğrulama: `tsc --noEmit` ✓, `npm run verify` (14 script) ✓, `npm run build`
✓, commit/staging YOK.

---

## 2026-08-14 — Gün 5 (Emre): poz çözücü — essential matrix + RANSAC + ayrıştırma + cheirality

Sözleşme: `ARCHITECTURE.md` → yeni "D.10 Poz Çözücü (Emre — Gün 5)".

Plan: "Essential matrix (normalize 8-nokta) + RANSAC + R,t ayrıştırma +
cheirality kontrolü. `verify-pose.mjs`: Zeynep'in ürettiği sentetik yörünge
üzerinde bilinen poza karşı hata. Bitti sayılır: sentetikte rotasyon hatası
< 1-2°." Zeynep'in Gün 4 öğleden sonrası teslim ettiği `trajectory.ts`
(D.6b) doğruluk verisi olarak kullanıldı.

**Yeni dosyalar:** `src/engine/vision/linalg.ts` (genel simetrik N×N Jacobi
özçözücü + 3×3 SVD — essential matrix hem 9×9 hem 3×3 özayrışım istediği
için tek yerde), `src/engine/vision/pose.ts` (8-nokta, RANSAC, ayrıştırma,
cheirality, `chainPoseTrack`), `scripts/verify-pose.mjs` (zincirin 13.
script'i, model YÜKLEMEZ).

**Sonuç (D.7 ölçütü — adım başına rotasyon hatası):**

| Test | Hata |
|---|---|
| İzole çift, gürültüsüz | 0.00000° |
| 12-keyframe zincir, adım hatası (0.4px gürültü) | medyan 0.121° · maks 0.292° |
| %30 kaba aykırı değerle (RANSAC) | 0.183° |

Biriken (mutlak, ilk keyframe'e göre) zincir hatası GATE EDİLMEDİ — D.8
"loop closure yok, sürüklenme birikir" diyor, bu beklenen davranış.

**Bu turda 5 gerçek hata bulunup düzeltildi** (tam gerekçe ve ölçüm
`ARCHITECTURE.md` D.10'da): `svd3`'ün üçüncü tekil vektörü koşulsuz çapraz
çarpımla dolduruluyordu (genel matriste yanlış SVD); eşik mutlak değil σ₀'a
BAĞIL olmalıydı (essential matrix SVD'sinde `det(U)≈0` sessiz çöküşü);
rütbe-2 kısıtı denormalize edilmeden ÖNCE uygulanıyordu (Hartley T ortogonal
değil, tekil değerleri bozuyordu); **kök neden** — satır kurulumu (x,y,1)
sözleşmesi kullanıyordu ama kamera ışını bu projede z=-1 (kamera −z'ye
bakar), sonuçta E tek bileşenin işareti ters bir sözleşmeye aitti (saf yatay
dönmede tesadüfen ~0° hata veriyordu, bu ÇÜRÜTÜCÜ kanıt sanılmıştı; gerçek
düzlemsel-olmayan hareket 2-3°'ye düşüyordu); ve kök neden bulunmadan önce bu
hatayı telafi eden yanlış bir "R'yi ters al" hack'i (saf yatay dönmede
tesadüfen doğruydu, genel harekette yeni hata katıyordu) — kök neden
düzeltilince kaldırıldı. Test tarafında da bir hata vardı:
`toFirstKeyframeOrigin`'in MUTLAK pozu ile `recoverPose`'un İKİLİ GÖRECELİ
çıktısı yanlış yönde karşılaştırılıyordu (~80° sahte hata).

Doğrulama: `tsc --noEmit` ✓, `npm run verify` (13 script) ✓, `npm run build`
✓, commit/staging YOK.

---

## 2026-08-14 — Gün 7: füzyon + entegrasyon — D.4/D.9 (Emre)

Sözleşme: `ARCHITECTURE.md` → D.4 (keyframeIndex CPU kanalı) + D.9 (Gün 7
durumu). Girdilerin tamamı önceki günlerin teslimleri: flow (Gün 3) + poz
(Gün 5) + ölçek/keyframe (Gün 6) + Zeynep'in yörünge üreteci + `setGaussians`
kapısı. Matematik saf klasik CV, Math.random YOK — determinizm testte kanıtlı.

- **`src/engine/vision/fusion.ts`:** keyframe bulutlarını dünya çerçevesinde
  birleştirip GaussianBuffer'ı (D.1) doldurur.
  - `fuseKeyframes`: sesli girdiyle seyrek splat üretimi — her splat:
    d_pred (yoğun model çıktısı, pozitifse) → ölçek hizalamasından s →
    `p_world = R·(s·v) + t` (pinhole z=-1, D.2 yön) → a: xyz+opaklık=1,
    b: normal=görüş yönü + ölçek=s·pikselDünyaBoyutu·adım, c: rgb+AO=1,
    keyframeIndex (D.4). Konum NEGATİFSE cheirality — sesli atla.
  - Ölçek: TÜM keyframe çiftlerinin üçgenlemeleri TEK havuza
    (`triangulateWorldPoint`), `fitScaleAlignment` — tek çift yerine tüm
    çiftlerin ortak en küçük karesi (gürbüz). `scale: null` = hizalama yok
    (d_pred varyanssız) — dürüst kayıt, sessiz ölçek üretilmez.
  - `fuseVideoFrames`: video köprüsü — yoğun depth/rgb haritaları + flow
    eşleşmeleri + grid örneklemesi (sampleStep). **Canlı App bağlantısı
    YAPILMADI** (kapsam kararı: sentetik kanıt + köprü; UI entegrasyonu
    backlog — D.9'da kayıtlı).
- **D.4 kanalı:** `GaussianBufferData.keyframeIndex` (Uint16Array) +
  `createGaussianBufferData` (splatFixture.ts). GPU'ya GİTMEZ — material,
  sıralama, splats.ts dokunulmadı; timeline filtresi CPU'da okur.
- **`scripts/verify-fusion.mjs` — 5 grup (gerçek sayılar):**
  - uçtan uca: 12 kare → 6 keyframe (0,2,5,7,10,11); model bozması
    a=2.7/b=−0.4 ile **scaleA=0.3691 (beklenen 1/2.7=0.3704)**, **scaleB=
    0.1567 (beklenen 0.1481)**; 3583/3583 aday piksel splat.
  - splat→GT konum RMS **3.14e-3** dünya birimi; alignSim3 sonrası **ATE
    2.99e-3** (D.5 metrics.ate).
  - buffer sözleşmesi: kanal boyutları 4·count / 1·count, keyframeIndex
    aralık içi, NaN yok.
  - köprü: 115200 splat (step=4 → 160×120×6), renk taşıma ✓, matches
    boşken **scale=null** (dürüstlük kolu).
  - determinizm: iki koşu BİREBİR aynı; timing medyan **1.8 ms**.
- **TEST HATA GEÇMİŞİ (tekrar etmesin):** Gün 5/6'nın çerçeve-karıştırma
  dersinin YENİ varyantını yaptım — `poses` dizisini keyframe SIRASINDA
  kurup keyIdx'i orijinal kare indeksi sandım (poses[2] = kare 5'in pozu);
  ölçek 0.203'e saptı, yakalayıp düzelttim (poses orijinal uzunlukta).
  Köprüde aynı hatayı depth/rgb dizilerinde de yaptım. Ayrıca float32
  depolama: `Float32Array`'de 0.4 literal'ı 0.4000000059… olur, `===` ile
  karşılaştırılamaz — fiziksel doğruluk (1e-3) kullanıldı (test gevşetme
  değil).
- **Dürüstlük kaydı:** çıktı ekranda GÖRÜNMEZ — `setGaussians`'a bağlanmadı
  (App.tsx'e dokunulmadı). Splat modu Zeynep'in geçici köprüsüyle beslenmeye
  devam eder; gerçek füzyon verisi, video yolu entegrasyonu bitince oraya
  girer. Bu karar planda açıkça alındı (sentetik kanıt + köprü).

**Doğrulama:** `npm run typecheck` ✓ · `npm run verify` ✓ (16 zincir,
verify-fusion dahil) · `npm run build` ✓.

---

## 2026-08-14 — Gün 7 KABLO (App bağlantısı, Emre): "şimdi bağla" kararı

D.9'da "backlog" diye kaydedilen App bağlantısı kullanıcı kararıyla TAKILDI.
Bir satır değil, veri akışının altısı birden kuruldu:

- **`src/engine/vision/videoPipe.ts` (YENİ):** köprünün canlı ucu.
  - `captureKeyframes`: rVFC kare kimliğiyle, zaman kapılı (250ms) 8 keyframe,
    256×192 (video 640×480'nin 4:3'ü), TEK canvas reuse (allocation az),
    timeout'ta elinde olanla döner (donuk videoda dürüst sonuç). rVFC yoksa
    66ms interval fallback.
  - `buildFusionScene`: ardışık kareler `computeOpticalFlow` (300 köşe) →
    izlenebilir izler `PointMatch` → `chainPoseTrack` (8-nokta + RANSAC +
    cheirality, ilk kare orijini) → `fuseVideoFrames` (step=4 → 64×48×KF
    aday; d_pred = luminance; ÖLÇEK ÜÇGENLEMEDEN) → kamera uyumu.
  - `fitBufferToCamera`: ağırlık merkezi → orijin, maks köşegen → 2;
    konum ve b.w AYNI çarpanla (iç tutarlılık); kaynağın KOPYASINI ölçekler.
- **`App.tsx`:** `video → 3B` butonu — youtube davranışı yok, TEK dokunuş:
  yakala (2 sn) → build → `Engine.setGaussians` → `setCameraPose`
  (0, 0.35, 2.2 / orijin) → splat modu + log raporu (splat sayısı, ölçek,
  eşleşme, ms).
- **Dürüstlük kayıtları (videoPipe docstring — 1-3):** video yolunda yoğun
  derinlik luminance'tır (model video yolunda ÇALIŞMAZ — App tasarımı),
  ÖLÇEK/ŞEKİL fiziği üçgenlemeden gelir (luminance'tan değil); fit sunum
  ölçeğidir (ölçüm ölçeği değil). Kısıt: splat kalitesi = luminance kalitesi.
- **`scripts/verify-videopipe.mjs`:** saf zincir testi (capture DOM'a bağlı —
  localhost'ta elle). 11 kontrol: fit (merkez, köşegen, b.w orantısı, kaynak
  dokunulmazlığı, boş buffer), durağan kareler (scale=null — d_pred ölçeği,
  dürüstlük kolu), hareketli kareler (flow >100 iz, splat üretimi, keyframe
  sözleşmesi). Sentetik kayma testinde ölçek hizalaması da çözüldü
  (a=1.144, b=7.775).
- **HATA GEÇMİŞİ (tekrar etmesin):** (a) `fitBufferToCamera` çarpanı
  `2/√maxSq` idi — köşegen 4 oluyordu (docstring "köşegen → 2" ile tutarsız);
  `1/√maxSq` yapıldı + test yakaladı. (b) İlk sentetik test deseni TEK YÖNLÜ
  şeritlerdi (dikey çizgi) — Shi-Tomasi köşeleri kenar sayar, flow 0 iz
  döndü; 2B gri + renk dokulu 8px hücrelere geçildi. Test verisi hatası,
  üretim kodu hatası değil.

**Doğrulama:** `npm run typecheck` ✓ · `npm run verify` ✓ (17 zincir,
verify-videopipe dahil) · `npm run build` ✓.

---

## 2026-08-14 — Gün D/5-7 (render şeridi, Zeynep): poz görselleştirme, capture akışı, metrik paneli

Sözleşme: `ARCHITECTURE.md` → yeni **D.2b** (poz görselleştirme + D.4 timeline).
D.1/D.2/D.4/D.5 sözleşmeleri DEĞİŞMEDİ — bu tur tüketici uçlarını yazdı.

- **Gün 5 — keyframe/yörünge görselleştirme** (`src/shaders/trajectoryOverlay.ts`):
  poz zincirinden kamera frustum'ları + yörünge çizgisi + seçili keyframe
  vurgusu. Frustum, kayıt yönüyle (kamera→dünya) kurulur; tersini almak
  frustum'ları aynalardı ve hiçbir sayı patlamazdı — `verify-overlay.mjs`
  bunu geometrik olarak denetler (7 test).
- **Gün 5-6 — D.4 timeline filtresi** (`filterOrderByKeyframe`): seçili
  keyframe'in splat'ları. Sıralanmış diziyi yerinde sıkıştırır, arkadan öne
  sırasını korur; `keyframeIndex` GPU'ya gitmez.
- **Gün 6 — capture akışı** (`src/ui/CapturePanel.tsx`): video seç →
  keyframe yakala → akış+poz+füzyon → 3B harita → timeline. Aşamalar AYRI
  raporlanır (hangi adım yavaş/patladı belli olsun); keyframe, akış eşleşmesi,
  **başarısız poz** ve ölçek hizalaması (a, b, **rmse**) her koşuda gösterilir.
  Ölçek çözülemezse "metrik DEĞİL" yazar.
- **Gün 7 — metrik paneli** (`src/ui/MetricsPanel.tsx`): `eval-out/report.json`
  (D.5) okunur; dev sunucusunda otomatik, olmazsa elle yükleme. Uygulanmamış
  ablasyon kolları `uygulanmadı` yazar — `0` yazmak asılsız sayı üretmek olurdu.
- **Türetilen normal tabanı** (`NORMAL_MIN_NZ`, `splats.ts` köprüsü).

Ölçümler (tarayıcıda, `gl.readPixels` / senkron `renderFrame`):

| Metrik | Değer |
|---|---|
| overlay: 8 keyframe → frustum köşesi / yörünge noktası | 128 / 8 (8×8×2 = 128 ✓) |
| overlay pikselleri: kapalı → açık | 0 → 293 teal; seçim → +169 amber |
| capture zinciri (6 sentetik keyframe) | 779 akış eşleşmesi · 0 poz hatası · 18.432 splat · 386 ms |
| timeline bölümlemesi | 6 × 3.072 = 18.432 = toplam (kayıp/çoğalma yok) |
| türetilen normal: `\|n_z\| < 0.35` oranı | %15.87 → **%0** (min `\|n_z\|` = 0.380) |
| points vs splat kare maliyeti (aynı sahne, kamera sabit) | 0.3 ms vs 0.4 ms |

Bilinçli sınırlar (dürüstlük kayıtları):

- **"Delik oranı" ölçütüm GEÇERSİZ çıktı — iki denemem de işe yaramadı ve
  geri alındı/yeniden çerçevelendi.** Splat yüzeyinde satır-taramasıyla %9.68
  "delik" ölçtüm ve iki hipotez denedim: (1) grazing normaller — normal tabanı
  eklendi, grazing %15.87→%0 oldu, delik oranı **değişmedi** (9.68 → 9.68);
  (2) önem remap'i yüzünden düzensiz aralık — splat başına yarıçap türettim,
  ölçtüm ki türetilen yarıçapın min/maks/ortalaması **aynı** (0.0026), çünkü
  remap parçacığın DÜNYA konumunu bükmüyor (grid sözleşmesi) — bu değişiklik
  **geri alındı**. Gerçek sebep büyük olasılıkla metriğin kendisi: eşik üstü
  piksel sayıyorum, splat'lar nokta sprite'larından küçük ve sönük olduğu için
  arka plan pikselleri eşiğin altında kalıp "delik" sayılıyor. **Ölçüt
  yeniden tasarlanmadan "splat yüzeyi delikli" DENMEZ.** Normal tabanı yine de
  korundu: kendi başına savunulabilir (dejenere şerit üretmiyor), ama delik
  iddiasının kanıtı DEĞİLDİR.
- **Gün 7'nin "60 sn demo videosu" ve yan yana karşılaştırma STİLLERİ
  ÜRETİLMEDİ.** Tarayıcı paneli görüntülenmediği için ekran görüntüsü
  alınamıyor (rAF duruyor, kare kompozit edilmiyor); ölçümler `gl.readPixels`
  ile alındı. Panel açıldığında stiller alınabilir.
- **GERÇEK VİDEO ile koşuldu (1920×1080, 12.0 sn) ve İKİ GERÇEK SORUN çıktı —
  aşağıdaki ayrı bölüme bak.**
- **CapturePanel'in timeline'ı React state'ine bağlıdır:** Engine'e panel
  DIŞINDAN poz yüklenirse (konsol/preset) timeline yeniden çizilmez. Gerçek
  akışta capture sonucu `setState` tetiklediği için sorun değil.

### Gerçek video koşusu (1920×1080 · 12.0 sn) — iki bulgu

Boru hattı gerçek bir klipte uçtan uca çalıştırıldı. Sonuç: **çalışıyor**, ama
iki gerçek sorun görünür oldu.

**BULGU 1 — `videoPipe.captureKeyframes` bu koşulda 0 kare döndürdü.**
Sebep: rVFC/rAF yalnızca sayfa KOMPOZİT edilirken çalışır. Sayfa gizliyken
(`document.hidden`) video ilerlemiyor — ölçüldü: 12.4 sn'de rVFC 0, rAF 0,
`currentTime` 0 → 0, video kendiliğinden duraklıyor. Ayrıca oynatma yakalaması
klibin yalnızca ilk 2 saniyesini örnekliyordu (8 × 250 ms) — poz için taban
çok dar. Çözüm: **arama (seek) tabanlı yakalama** (`seekCapture.ts`, D.6c) —
görünürlükten bağımsız, klibin tamamına yayar. Ölçüm: **8 kare, 0.60 → 11.41 sn,
1.18 sn**; ardışık kare farkı 0.0068–0.0128 (kareler gerçekten farklı, kopya
değil). Canlı kaynak yolu (rVFC) DEĞİŞMEDİ.

**BULGU 2 — ölçek hizalaması gerçek klipte GEÇERSİZ sonuç veriyor.**
`d_metric ≈ a·d_pred + b` uydurması **a = −15.98**, b = 52.84, **rmse = 52.71**
döndürdü. Negatif eğim fiziksel olarak anlamsızdır ("tahmin derinleştikçe
gerçek mesafe azalıyor"); en küçük kareler her zaman BİR cevap verir, ama bu
cevap geçersizdir. Ek olarak poz zincirindeki ardışık kamera mesafeleri
**tam olarak 1** çıkıyor (monoküler ölçek belirsizliği: essential matrix
ötelemeyi birim uzunlukta verir) — yani yörünge şekli dönmelere bağlı, ölçek
D.2'nin `scaleA/scaleB`'sinden gelmeli ve bu klipte gelmiyor.
`scale.ts` Emre'nin modülü olduğu için **düzeltilmedi, raporlanıyor.**
CapturePanel artık `a ≤ 0` durumunu ayrı bir dalda KIRMIZI gösteriyor
("GEÇERSİZ … metrik DEĞİL") — sayıyı sessizce göstermek onu makul gibi okutur.

Gerçek klip zinciri (ölçüldü): 8 keyframe · **471 akış eşleşmesi** ·
**0 poz hatası** · **24.313 splat** · füzyon 430 ms. Timeline bölümlemesi tam:
keyframe başına 3.034–3.045, toplam 24.313 = tüm splat.

**Panel ELLE, uçtan uca doğrulandı (2026-08-16, kullanıcı makinesi, gerçek
klip).** Zincirin tamamı — dosya seçimi (React `onChange` → `run`) dahil —
tek tıkla çalıştı: **8 keyframe · 658 akış eşleşmesi · 1 poz hatası ·
24.576 splat · 2.186 ms**, timeline 0–7 düğmeleri ve yörünge/frustum anahtarı
göründü; metrik paneli `report.json`'ı okudu. Böylece önceki turda
doğrulanamayan tek halka kapandı.

**BULGU 4 — ölçek çözücüsü ÇÖZÜLDÜ: `fitScaleAlignment` artık dayanıklı
(robust).** Kök sebep düz en küçük karelerdi: `d_metric` üçgenlemeden gelir ve
hatası AĞIR KUYRUKLUDUR — ışınlar neredeyse paralelken (küçük parallaks,
epipole yakını nokta) üçgenlenen derinlik binlere fırlar ve kareler hatayı
ödüllendirdiği için tek bir böyle nokta bütün uydurmayı çeker.

Çözüm iki aşamalı ve **deterministik** (RANSAC yok, rastgelelik yok):
`d_metric` üzerinde MAD maskesi → OLS → artıklar üzerinde ikinci MAD maskesi →
yeniden OLS. `ScaleFit` artık `inliers`/`rejected` de taşır (sessiz temizlik
yok). Temiz veride her iki maske de her şeyi tutar → sonuç düz OLS ile
BİREBİR aynıdır, Emre'nin mevcut testleri değişmeden geçer.

Kanıt (yeni `[3b]` regresyon testi — 200 temiz + 10 patlamış nokta):

| | scaleA | scaleB | atılan |
|---|---|---|---|
| dayanıklı uydurma | **2.5000** (gerçek 2.5) | **−0.3000** (gerçek −0.3) | 10 |
| aynı veride düz OLS | **−13.36** | — | — |

10 zehirli nokta 210'un içinde düz OLS'i NEGATİF eğime düşürüyor — gerçek
klipte gördüğümüz imzanın aynısı.

Gerçek klipte etkisi (aynı 12 sn'lik video, 8 keyframe):

| | önce (düz OLS) | sonra (dayanıklı) |
|---|---|---|
| scaleA | **−15.98** (negatif) | **+15.54** |
| scaleB | 52.84 | 26.45 |
| rmse | 52.71 | **15.83** |
| inlier / atılan | — | 313 / 56 |

**Ama hâlâ metrik DEĞİL:** `rmse/|a| = 1.02`, panel eşiği olan 0.25'in çok
üstünde — panel bunu doğru şekilde GEÇERSİZ göstermeye devam ediyor. Kalan
sorun çözücüde değil GİRDİDE: video yolunda `d_pred` derinlik modelinden
değil LUMINANCE'tan geliyor (App tasarımı). Ölçek hizalamasının anlamlı
olması için video yoluna gerçek yoğun derinlik gerekir — bu fazın dışında.

**BULGU 3 — ölçek uyarım YETERSİZDİ (bu koşuda yakalandı).** Panel ölçeği
`a = +62.54, b = 561.99, rmse = 531.45` gösterdi ve eğim POZİTİF olduğu için
uyarı TETİKLENMEDİ — sayı ekranda makul gibi durdu. Oysa `d_pred ∈ [0,1]`
olduğundan uydurmanın kapsadığı aralık ≈ |a| = 62.5'tir; rmse = 531 bunun
**8.5 katı**, yani uydurma veriyi hiç açıklamıyor. İşaret kontrolü tek başına
yetmiyormuş. Eklendi: `rmse > 0.25·|a|` de GEÇERSİZ sayılır ve kırmızı
gösterilir (`judgeScale`). Not: video yolunda yoğun derinlik luminance'tan
geldiği için (model değil) ölçek çözücüsüne zaten zayıf veri gidiyor —
`scale.ts` yine de düzeltilmedi, Emre'nin modülü.

---

## 2026-08-14 — Gün D/1-4 (render şeridi, Zeynep): splat rasterizer + 5. mod + yörünge üreteci

Sözleşme: `ARCHITECTURE.md` → yeni **D.1b** (GaussianBuffer'ın render tarafı)
ve **D.6b** (sentetik yörünge üreteci). D.1/D.2/D.7 sözleşmeleri DEĞİŞMEDİ —
bu tur onların tüketici ucunu yazdı.

- **Gün 1 — splat spike** (`src/shaders/splatFixture.ts`,
  `src/shaders/splatMaterial.ts`): instanced quad + yönlü elips fragment.
  Spike verisi küre kabuğudur (normaller dışa bakar): yönelim yanlış
  kurulursa siluet kenarındaki splat ince çizgiye dönmez, hata gözle
  görülür. `gl_PointSize` BİLEREK kullanılmadı — nokta her zaman ekrana
  paraleldir, anizotropi taşıyamaz ve sürücü üst sınırında kırpılır.
- **Gün 2 — gerçek rasterizer**: kovaryans normal + ölçekten kurulur
  (Σ₃ = R·diag(s², s², (s·ε)²)·Rᵀ), perspektif Jacobian ile Σ₂'ye indirilir
  (EWA), özvektörler ekran elipsinin eksenleridir. Σ₂ köşegenine 0.3 px²
  prefilter: piksel altına inen splat tekilleşip kaybolmaz. Blend
  premultiplied "over", `depthWrite = false`. CPU derinlik sıralaması
  (`src/shaders/splatSort.ts`) — splat verisi yeniden dizilmez, yalnızca
  çizim indeksi sıralanır.
- **Gün 3 — 5. render modu** (`splat`): `registerRenderMode` +
  `SPLAT_PARAMS` (6 kol) + ModeSelector/EmbedView kaydı. Splat AYRI çizim
  nesnesidir (`src/engine/splats.ts`); `setPointsMaterial('splat')` material
  takası YAPMAZ — points geometrisinde `aCorner`/`aSplatIndex` yok, takılsaydı
  kırık render olurdu (solid modunun fallback deseninin aynısı). Mevcut dört
  mod dokunulmadı.
- **Gün 4 — sıralama performansı + yörünge üreteci**: iki sıralama yolu
  (`radix` tam / `bucket` yaklaşık) + yeniden sıralama kapısı (görüş yönü
  2°'den az döndüyse sıra kurulmaz). `src/engine/vision/trajectory.ts` —
  Emre'nin Gün 5 poz testi için bilinen yörünge + sahne + pinhole izdüşüm.
- **Testler** (`npm run verify` zincirine eklendi): `verify-splat.mjs`,
  `verify-trajectory.mjs`.

Ölçümler (çalıştırılan komutlardan, bu makine):

| Metrik | Değer |
|---|---|
| radix sıralama, 147.456 splat (medyan/11) | **2.93 ms** |
| kova sıralama, aynı girdi | **1.84 ms** |
| kova yaklaşıklığı: ardışık ters çift | 24.434/50.000 (%48.87) |
| kova: en büyük derinlik ihlali | 0.00175 dünya birimi (kova genişliği sınırında) |
| izdüşüm gürültüsü doğrulaması (σ = 1.5 px istendi) | ortalama sapma 1.886 px, Rayleigh beklentisi 1.880 |

Bilinçli sınırlar (dürüstlük kayıtları):

- **WebGPU compute sıralama YAPILMADI.** Repo WebGL2/`WebGLRenderer` üzerinde
  koşuyor, compute shader yok; ARCHITECTURE.md D.7 kesme sırasının 1. maddesi
  zaten "WebGPU sıralama → CPU sıralamada kal" diyor. İki CPU yolu ölçüldü ve
  ikisi de kare bütçesine sığıyor.
- **Kova yolu ardışık çiftlerin yarısını ters sıralıyor (%48.87).** Bu sayı
  tek başına korkutucu görünür ama anlamlı olan ihlalin BÜYÜKLÜĞÜDÜR:
  0.00175 dünya birimi, tipik splat yarıçapının kat kat altında. Yine de
  varsayılan `radix`tir — kova yalnızca ölçülmüş bir alternatiftir,
  "yeterince iyi" diye pazarlanmıyor.
- **GaussianBuffer'ı bugün FÜZYON DOLDURMUYOR** (Gün 7'de gelecek). Geçici
  köprü (`fillGaussiansFromPointCloud`) mevcut nokta bulutundan geçerli bir
  buffer türetir: normal komşu texel farkından, ölçek grid adımından. Bu
  gerçek çok-görüntü çıktısı DEĞİLDİR ve "3D Gaussian Splatting eğitimi"
  olarak sunulmuyor — rasterizer'ın veri yolu testidir. Füzyon geldiğinde
  yalnızca doldurucu değişir (`Engine.setGaussians`), material ve sıralama
  aynen kalır.
- **GPU tarafında otomatik regresyon TESTİ YOK.** Aşağıdaki GPU ölçümleri
  tarayıcıda elle (`gl.readPixels`) alınmıştır; GLSL'i Node'dan koşturan bir
  harness yok, yani özvektör hatasının benzeri yeniden girerse `npm run verify`
  YAKALAMAZ. Ölçüm yordamı ARCHITECTURE.md · D.1b'de yazılıdır.

### GPU doğrulaması (tarayıcıda ölçüldü) + bu turda bulunan hata

Dev sunucusu doğru depoya bağlandıktan sonra Gün 1/2 kabul ölçütleri
ölçüldü ve **gerçek bir shader hatası bulundu**:

- **HATA — elips 90° dönük çiziliyordu.** Σ₂ köşegen olduğunda (`b ≈ 0`)
  büyük özvektör formülü `(b, l₁−a)` 0/0'a düşüyor; köşegen dalda koşulsuz
  `vec2(1,0)` seçiliyordu. Σ₂ merkezdeki ve eksen hizalı HER splat'ta
  köşegendir — yani bu dal istisna değil kuraldı. Sonuç: kısalmanın MİKTARI
  doğru (cos θ), EKSENİ yanlıştı. Normal Y ekseni etrafında eğilen bir splat
  yatay yerine dikey sıkışıyordu. Düzeltme: `a >= d ? (1,0) : (0,1)`.
- **Düzeltme sonrası ölçüm** (tek splat, `gl.readPixels` ile ayak izi bbox'ı):

  | θ | 0° | 30° | 45° | 60° | 75° |
  |---|---|---|---|---|---|
  | ölçülen genişlik/yükseklik (normal Y ekseninde eğik) | 1.000 | 0.865 | 0.712 | 0.500 | 0.269 |
  | cos θ (beklenen) | 1.000 | 0.866 | 0.707 | 0.500 | 0.259 |

  Normal X ekseni etrafında eğikken kısalma DİKEY eksene geçiyor
  (h/w = 0.712 @45°, 0.269 @75°) — yönelim hem büyüklük hem eksen olarak
  doğru. Gün 1'in "kamera dönünce elipsler doğru yöneliyor" ölçütü **karşılandı**.
- **Kare maliyeti** (147.456 splat, senkron `renderFrame` + `gl.finish`,
  kamera her karede dönüyor → sıralama kapısı her karede tetikleniyor, EN KÖTÜ
  hâl): 640×420 → **3.7 ms** · 1280×720 → **3.5 ms** · 1920×1080 → **3.4 ms**;
  bunun 2.7-2.9 ms'i CPU sıralaması. Maliyet çözünürlükten neredeyse bağımsız:
  yük **fill-rate değil CPU sıralama** sınırlı. Referans: `points` modu aynı
  sahnede 0.40 ms. Gün 2'nin "147k splat, kabul edilebilir FPS" ölçütü
  **karşılandı** (canlı döngüde yeniden sıralama kapısı bu 2.7 ms'i her karede
  ödemez).
- **Ölçüm koşulları (dürüstlük):** bu sayılar bir GPU'da, senkron çizim
  ölçümüdür; vsync'li canlı döngü değildir ve `gl.finish()` sürücü kuyruğunu
  boşaltarak en kötü hâli ölçer. "Yanıp sönme (popping) yok" iddiası
  ÖLÇÜLMEDİ — o göz kararıdır ve sıralamanın doğruluğu CPU testinde
  kanıtlanmıştır (permütasyon bütünlüğü + artan derinlik).

---

## 2026-08-14 — Gün E: gövde/ayna fotoğraflarında düz 3B + topaklı maske (bulgu 1-2)

Sözleşme: `ARCHITECTURE.md` → "Derinlik Son-İşleme Maskesi (`depth.ts`, Gün E —
bulgu 1)" ve "Siluet Sözleşmesi" → *DİLASYON TEK YERDE*.

Kullanıcı gözlemi: yüz odaklı fotoğraflarda 3B iyi, **gövde odaklı ve ayna
selfie'lerinde sonuç 2D kalıyor**; nesne ayrımı topaklı/aşırı kesiyor. Denetim
ikisinin de tek bir mimari boşluktan beslendiğini gösterdi: **derinlik
son-işlemesi RMBG maskesini hiç görmüyordu.**

**Bulgu 1 — maske-kör derinlik son-işlemesi (`depth.ts`, `App.tsx`).**
`App.tsx` önce `estimateDepth`, sonra `segmentForeground` çağırıyordu; maske
yalnızca `Engine.setDepth`'e gidiyordu. `depth.ts` içindeki üç aşama kendi
depth-türevli sahte maskesini (`smoothstep(0.15, 0.8, D)`) kullanıyordu.

- Yüz yakın planında iki maske örtüşür → sorun görünmez.
- Gövde / ayna karesinde YAKIN ZEMİN de yüksek D taşır ve sahte maskeye girer:
  ölçümde özne boyutunun **%77'si kadar özne-dışı piksel** maskeye sızdı,
  `applyForegroundStretch`'in min/max taraması zemini kapsadı ve stretch fiilen
  etkisiz kaldı (özne derinlik aralığı **0.116 → 0.117**). Gerçek maskeyle aynı
  sahnede **0.116 → 0.850**.
- Ayrıca `limitDepthSlope` maskesiz çağrılıyordu (kendi docstring'inin
  uyardığı durum): özne↔arka plan sıçraması "aşırı eğim" sayılıp öznenin 4
  piksellik dış halkası arka plan seviyesine çekiliyordu — ortalama **0.750**
  derinlik kaybı (maks 0.780). Siluet kenarı 3B'de arkaya çöküyordu.

Düzeltme: `estimateDepth` opsiyonel `subjectMask` alır (depth boyutuna
resample edilir) ve stretch/sobel/eğim aşamalarında bunu kullanır; eğim
sınırlayıcı bölge-ayrık koşar (maske içi + maske dışı ayrı geçişler).
`App.tsx` segmentasyonu depth'ten ÖNCE çalıştırır; segmentasyon butonu
sonradan açılırsa depth maskeyle yeniden çıkarılır. **Maske verilmezse davranış
bit-bit eskisi gibidir** (kamera/video yolu etkilenmedi — doğrulandı).

**Bulgu 2 — maske iki yerde üst üste dilate ediliyordu (`Engine.ts`).**
`segmentation.ts` maskeyi kendi çözünürlüğünde 4 px dilate + tüy yapıp
döndürüyor; `Engine.setDepth` aynı fonksiyonu `round(4 × 1024/518)` = **8 px**
ile TEKRAR çağırıyordu. İki docstring'in hiçbiri diğerinden haberdar değildi.
Ölçek çarpanı da ters yöndeydi: küçültmeyi telafi etmek yarıçapı bölmeyi
gerektirir (4/1.98 ≈ 2), çarpmayı değil. Düzeltme: `Engine.setDepth` artık
yalnızca resample eder. `scripts/verify-curtain.mjs` bu ikinci geçişi hiç
çalıştırmıyordu — üretim yolu ile tek gerçek-fotoğraf testi ayrışmıştı, artık
aynı hesabı yapıyorlar.

**Ölçüm tablosu** (gerçek `depth.ts` / `silhouette.ts` fonksiyonları, sentetik
gövde sahnesi + kol–gövde boşluklu sentetik özne):

| Metrik | Önce | Sonra |
|---|---|---|
| Özne iç bölge rölyef std (gövde sahnesi) | 0.0307 | **0.2105 (×6.86)** |
| Özne iç bölge derinlik aralığı | 0.383 | **0.784** |
| Stretch maskesine sızan özne-dışı piksel | özne boyutunun %77'si | 0 |
| Özne kenar halkası derinlik kaybı | 1908 px × ort 0.243 | 0 (bölge-ayrık) |
| Maske alan şişmesi (ham özneye göre) | +%23.9 | **+%6.2** |
| 14 px kol–gövde boşluğu | DOLU (topak) | **AÇIK** |

Regresyon: maskesiz (kamera/video) yol eski çıktıyla **birebir aynı**;
`verify-curtain` gerçek fotoğraf sayıları değişmedi (maske %32.9, 48480 ön plan
/ 98976 arka plan, kütle merkezi Δ 0.001). `tsc --noEmit` ✓, `npm run verify`
(10 script) ✓, `npm run eval` iki koşuda anahtar metrikler birebir ✓,
`npm run build` ✓.

Kapsam dışı bırakılanlar (denetim listesinden seçilmedi): M9 metrik uzunluk
denetimi. (Bulgu 3 ve 4 sonradan seçildi — aşağıdaki girişe bakınız.)

---

## 2026-08-14 — Gün E: regresyon kilidi + zSpan kararı (bulgu 3-4)

Sözleşme: `ARCHITECTURE.md` → "Derinlik Son-İşleme Maskesi" → *Test kapsamı* ve
yeni "zSpan Sözleşmesi (`sampler.ts`, Gün E — bulgu 4)".

**Bulgu 3 — gerçek fotoğraf/regresyon korpusu yoktu.** Bulgu 1 ve 2, 10
script'lik yeşil zincirin altından geçmişti: gövde/geniş sahne vakası hiçbir
testte yoktu ve `verify-curtain.mjs` üretim yolundaki ikinci maske dilasyonunu
hiç çalıştırmıyordu (üretim yolu ile tek gerçek-fotoğraf testi ayrışmıştı).

- Yeni `scripts/verify-depth-mask.mjs` (zincirin **11.** script'i, model
  yüklemez, saniyenin altında, determinist): kontrollü sentetik yüz + gövde
  sahnelerinde yönlü iddiaları kilitler.
- `scripts/verify-curtain.mjs` genişletildi: gerçek fotoğrafta aynı metrikleri
  raporlar, kök nedenin orada da bulunduğunu doğrular, 0..1 sözleşmesini
  denetler. Kendi karenizi ölçmek için `node scripts/verify-curtain.mjs <yol>`.
- **Repoda gövde/ayna fotoğrafı YOK** (üretici model yasak, lisanslı görsel
  indirilmedi) — gerçek dünya doğrulaması kullanıcının kendi karesiyle yapılır.
  Bu boşluk kapatılmadı, açıkça bildirildi.

**Bulgu 4 — zSpan: denetim iddiası ÇÜRÜTÜLDÜ, sabit değiştirilmedi.**
Denetimde "gövde silueti 3.5× sığlaşıyor" yazılmıştı. Ölçüm:

| Kadraj | zSpan | varsayılan antropometri* | oran |
|---|---|---|---|
| yüz yakın plan | 0.922 | 1.553 | 0.59× (sığ) |
| ayakta tüm boy | 0.476 | 0.378 | 1.26× (derin) |
| yarım boy (ayna) | 0.724 | 0.575 | 1.26× (derin) |

\* bu sütun VARSAYIM'dır (gövde 45 cm geniş / 25 cm derin, yüz 18 cm / 20 cm),
ölçülmüş veri değildir — bu yüzden üzerine sabit kalibre EDİLMEDİ.

Ayrıca formülün ölçek-tutarlı olduğu kanıtlandı: aynı siluet 1.5× yakın
kadrajda `rx` ×1.500 iken `zSpan` ×1.500. Gövde cezalandırılmıyor; asıl
tutarsızlık yüzün sığ kalması. Tek sabit ikisini birden veremez (yüz
derinlik/genişlik ≈ 1.1, gövde ≈ 0.56); "düzeltmek" özne sınıflandırması veya
uydurma katsayı isterdi. **Karar: `ANATOMIC_DEPTH_RATIO` korundu, davranış
teste kilitlendi.**

**Ölçülen (yeni test çıktısı):**

| Kontrol | Değer | Eşik |
|---|---|---|
| Gövde iç rölyef kazancı | ×6.86 | ≥ ×4 |
| Sahte maskeye sızma (gövde / yüz) | %77 / %0 | gerçek maskede %0 |
| Bölge-ayrık sınırlayıcı kenar aşınması | 0.000000 | tam 0 |
| Maske alan şişmesi (üretim / eski) | +%6.2 / +%23.9 | ≤ %10 |
| Kol–gövde boşluğu | AÇIK | açık kalmalı |
| zSpan ölçek tutarlılığı | rx ×1.500 = zSpan ×1.500 | Δ < 0.02 |

**YENİ AÇIK MADDE (bu turda açıldı, bir sonraki girişte KAPANDI):** stretch
artık gerçekten çalıştığı için öznenin iç eğimleri büyüyor ve
`MAX_SLOPE_PER_PX` = 0.02 tavanına daha çok takılıyor. Ölçüm sonucu için
aşağıdaki "bulgu 5-6" girişine bakınız.

Doğrulama: `tsc --noEmit` ✓, `npm run verify` (11 script) ✓, `npm run eval` iki
koşuda anahtar metrikler birebir ✓, `npm run build` ✓, commit/staging YOK.

---

## 2026-08-14 — Gün E: özne kırpma çıkarımı + maske bileşen temizliği (bulgu 11-12)

Sözleşme: `depth.ts` → `mergeSubjectDetail` docstring'i; `silhouette.ts` →
`keepLargestComponent`.

**Bulgu 11 — model özneye hiç yakından bakmıyordu.** Model tüm kareyi 518²'ye
sıkıştırıp görür; özne karenin küçük bir parçasıysa (özüm.jpg %28) gövde modele
~200 px genişlikte gider ve modelin gövdenin KENDİ yüzey rölyefini çözecek
çözünürlüğü olmaz. Ölçüm (maske içi p25-p75, tam kare → özne kırpması):
özüm 0.120 → 0.259 (×2.17), ayna 0.177 → 0.192, KARINA 0.291 → 0.291 (özne
kareyi zaten dolduruyor).

Düzeltme: `estimateDepth`, özne maskesi varken bbox'ı kırpıp AYNI modeli ikinci
kez çağırır ve kırpma şeklini maske içine yazar. Literatür karşılığı: tek
görüntü derinlikte çok-çözünürlüklü birleştirme (Boosting Monocular Depth
Estimation, CVPR 2021). **Üretici model YOK** — aynı model, daha yakından.

İŞ BÖLÜMÜ (anatomi bu yüzden bozulmaz): ŞEKİL kırpmadan, GENLİK
`applyForegroundStretch` + `zSpan`'den. Kırpma yalnızca doğrusal (min/max
eşleme) olarak global'in bandına oturur; toplam kalınlığa karar vermez.

**Elenen tasarım (ölçümle):** ilk sürüm kırpmayı en küçük karelerle
(`a·c + b`) global'e hizalayıp frekans ayrımıyla birleştiriyordu. Ölçüm ×1.00
çıktı — hizalama, kırpmanın zengin rölyefini DÜZ global'e uydurmak için geri
küçültüyordu, yani düzeltme kendi kendini siliyordu. Tek görüntüden rölyefin
genliği bilinemez; bilinebilen şekildir. Doğrusal bant eşlemeye geçilince
stretch sonrası özüm p25-p75 **0.334 → 0.434 (×1.30)**.

Kırpma bbox'ı karenin %75'ini aşarsa atlanır (çözünürlük kazancı yok, KARINA
bu yola girmez) — ikinci çıkarım maliyeti boşa harcanmaz.

**Bulgu 12 — maske kopuk parçaları taşıyordu.** RMBG, özneye bitişik OLMAYAN
arka plan yapılarını da ön plan sayabiliyor. `keepLargestComponent` (4-komşu)
artık `segmentForeground` içinde dilate'ten ÖNCE koşuyor. Özne tek parçaysa
çıktı değişmez. Not: ayna selfie'sinde kapı özneye BİTİŞİK olduğu için bu adım
onu temizlemiyor (bbox %62 → %62) — bitişik kirlenme siluet katmanının işi.

Doğrulama: `tsc --noEmit` ✓, `npm run verify` (11 script) ✓, `npm run build` ✓,
commit/staging YOK.

---

## 2026-08-14 — Gün E: önem remap'i öznede DELİK açıyordu (bulgu 10)

Sözleşme: `sampler.ts` → `buildImportanceRemap` içi gerekçe bloğu.

Kullanıcı raporu: nesne ayırma AÇIKKEN Karina'nın eli ve yüzünün SAĞ YARISI
kayboluyor; kapalıyken tam görünüyor. Denetim sırası:

1. RMBG maskesi görsel olarak döküldü → **kusursuz** (el, yüz, hepsi içeride).
   Segmentasyon suçlu DEĞİL.
2. `buildSilhouette` gerçek derinlikle maskenin %99.6'sını koruyor → siluet
   suçlu DEĞİL.
3. Kalan tek yol: örnekleme. **Bütün testlerim `importanceSampling: false` ile
   koşuyordu, üretim ise `true` — o yol hiç sınanmamıştı.**

**Kök neden.** `buildImportanceRemap` AYRILABİLİR bir remap kurar: X ve Y için
ayrı 1B CDF (sütun/satır toplamları). Önem terimi `0.5·depth` içeriyordu, yani
öznenin İÇİNDEKİ yakın/uzak farkı sütun yoğunluğuna dönüşüyordu; öznenin uzak
kalan yarısının sütunları düşük yoğunluk alıp CDF örneklerini kaybediyor ve o
bölge nokta bulutunda DELİK oluyordu.

Eskiden zararsızdı çünkü maske içi derinlik neredeyse sabitti (özüm.jpg
p25-p75 = 0.135). **Bulgu 8 (stretch kırpması) aralığı ~6× açınca bu terim
baskın hâle geldi** — yani delikler benim bir önceki düzeltmemin yan etkisiydi.

Düzeltme: maske VARKEN `depth` terimi kullanılmaz (`near = 0`). Terimin amacı
maske yokken "yakın olan önemlidir" vekiliydi; maske varken bu işi zaten
`FG_IMPORTANCE_WEIGHT · fg` yapıyor. **Maskesiz yol aynen korunur.**

Ölçüm — siluetin kapsandığı sütun/satır oranı (örnek grid'i 384, tavan =
384/boyut):

| Foto | sütun kapsama | tavan | satır kapsama | tavan |
|---|---|---|---|---|
| AESPA-KARINA-5 (518×346) | %73.6 | %74.1 | %88.4 | %100 |
| özüm.jpg (389×518) | %95.3 | %98.7 | %92.6 | %74.1 |
| ayna selfie (291×518) | %98.5 | %100 | %74.8 | %74.1 |

Hepsi grid tavanına oturuyor — örnekleme artık tekdüze, starvation yok.

**Süreç dersi:** üretim varsayılanı (`importanceSampling: true`) hiçbir testte
çalışmıyordu; bu yüzden bulgu 8'in yan etkisi 12 script'lik yeşil zincirden
geçti. Test yazarken üretim varsayılanı ile koşmak esastır.

---

## 2026-08-14 — Gün E: stretch kırpması + dejenere maske koruması (bulgu 8-9)

Sözleşme: `ARCHITECTURE.md` → "Stretch Aralığı (`depth.ts`, Gün E — bulgu 8)"
ve "Dejenere Maske Koruması (`App.tsx`, Gün E — bulgu 9)".

Kullanıcı zSpan düzeltmesinden sonra da "hâlâ hiç derinlik yok" bildirdi ve yan
görünüm ekran görüntüleri verdi: sonuç iki ince LEVHA (özne düzlemi + duvar
düzlemi), hacim yok. Ayrıca "nesne ayırma fotoğrafın neredeyse hepsini
götürüyor".

**Bulgu 8 — stretch aralığı ham min/max olduğu için özne kütlesi açılmıyordu.**
Bileşen analizi özüm.jpg maskesinin TEMİZ olduğunu gösterdi (tek bileşen,
%99.5) — yani sorun maske kirlenmesi değil: öznenin kendi p25-p75'i 0.135 iken
min-max 0.844. Ham min/max uçlara kilitlendiği için stretch kazancı ≈ ×1.0.
Düzeltme: %10 histogram kırpması (her iki uçtan), kalanlar hedef banda
kelepçelenir.

Nokta bulutu z **p10-p90** (kütle yayılımı — doğru metrik):

| Foto | önce | sonra |
|---|---|---|
| özüm.jpg | 0.357 | **0.686** (+%92) |
| ayna selfie | 0.644 | **0.801** (+%24) |
| AESPA-KARINA-5 | 0.824 | **1.164** (+%41) |

**ÖLÇÜM TUZAĞI — bu düzeltme bir kez YANLIŞLIKLA GERİ ALINDI.** Aynı kırpma
daha önce yazılmış, sonra "ölçülebilir kazanç vermiyor" gerekçesiyle
kaldırılmıştı. Kullanılan metrik *toplam z aralığı*ydı ve o değer min/max'a
bağlı olduğu için her koşulda doygun görünüyordu (özüm 0.550 → 0.577). Doğru
metrik kütle yayılımıdır; onunla ölçünce kazanç ×1.9. Gerekçe ve tarama tablosu
`applyForegroundStretch` docstring'ine, tuzak uyarısı `verify-depth-mask.mjs`
[7] bloğuna yazıldı.

**Bulgu 9 — dejenere (tüm kare) maske koruması.** RMBG ayna selfie'sinde
ortalama-ton dolgusuyla **%100 ön plan** döndürüyor: maske hiçbir şey ayırmaz
ama stretch aralığını sahnenin tamamına açar ve siluet AND'i arka planı elemez.
Boş maske koruması vardı, "tüm kare" koruması yoktu. Artık ön plan oranı > %92
olan maske atlanır, depth maskesiz koşar, durum log'a yazılır.

Doğrulama: `tsc --noEmit` ✓, `npm run verify` (11 script) ✓, `npm run eval` iki
koşuda anahtar metrikler birebir ✓, `npm run build` ✓, commit/staging YOK.

---

## 2026-08-14 — Gün E: kadraj oranı artefaktı — dikey fotoğraflarda düz 3B (bulgu 4, DÜZELTİLDİ)

Sözleşme: `ARCHITECTURE.md` → "zSpan Sözleşmesi (`sampler.ts`, Gün E — bulgu 4)".

Kullanıcı gerçek çıktı ekran görüntüleri verdi: `özüm.jpg` (dikey yarım boy) ve
bir ayna selfie'sinde 3B neredeyse yok; `AESPA-KARINA-5.webp` (yatay, yüz
odaklı) sorunsuz. Test fotoğrafları `assets/` altına eklendi — bulgu 3'teki
"gerçek fotoğraf yok" boşluğu böylece kapandı ve uçtan uca ölçüm mümkün oldu.

**Kök neden: kadraj yönü derinliğe sızıyordu.** Dünya uzayında y hep ±`halfH`
ama x ±`(w/h)·halfH`'tir; dikey kadrajda dünya genişliği 1'in altına iner
(özüm 0.751, ayna 0.562) ve `min(rx, ry)` bu daralmış ölçekten beslenir. Üstelik
`min()` kadraja göre farklı fiziksel ekseni seçiyordu: karina'da yükseklik
(rx 1.499 > ry 0.997), dikey karelerde genişlik.

Düzeltme: yarı eksen kadrajın KISA kenarı biriminde ölçülür —
`zSpan = ANATOMIC_DEPTH_RATIO · 2 · min(rx, ry) / min(halfW, halfH)`.
Yatay kadrajda bölen 1, davranış aynen korunur. `ANATOMIC_DEPTH_RATIO`
değişmedi.

| Foto | oran | ön plan z aralığı önce | sonra |
|---|---|---|---|
| AESPA-KARINA-5.webp | 1.50 yatay | 1.342 | **1.342** (değişmez) |
| özüm.jpg | 0.75 dikey | 0.550 | **0.732** (+%33) |
| ayna selfie | 0.56 dikey | 0.513 | **0.913** (+%78) |

**Teşhis sırasında elenen iki hipotez (ölçüldü, koda ALINMADI):**

1. *Stretch min/max'ı duvar kuyruğu ele geçiriyor.* Doğrulandı ama etkisiz:
   özüm'de maske içi histogram tek tepeli (kovaların 10-13'ü piksellerin
   %66'sı), duvar kuyruğu %23. Yüzdelik kırpma taraması (0/1/5/10/15/20) son z
   aralığını neredeyse hiç oynatmadı — özüm 0.550 → 0.577, ayna 0.513 → 0.517,
   karina 1.342 → 1.363. Sebep: stretch çıktısı zaten ~0.85 span'a doyuyor,
   darboğaz orada değil. Kod geri alındı, gerekçe `applyForegroundStretch`
   docstring'inde.
2. *`min(rx,ry)` yerine yükseklik / geometrik ortalama.* Ölçülen alternatifler
   sunuldu; kadraj artefaktını kaldırma seçildi çünkü anatomik oranı bozmadan
   gerçek bir artefaktı kaldırıyor ve yatay çıktıları hiç değiştirmiyor.

**Denetim geçmişi (dürüstlük kaydı):** bu madde daha önce İKİ KEZ yanlış
kapatıldı — bir kez yanlış çerçeveleme ("gövde 3.5× sığlaşıyor"), bir kez
varsayılan antropometriye dayanarak ("formül doğru"). İkisi de gerçek çıktı
ölçülmeden verilmiş kararlardı; doğru teşhis ancak gerçek fotoğraflar uçtan uca
ölçülünce çıktı.

Doğrulama: `tsc --noEmit` ✓, `npm run verify` (11 script) ✓, `npm run eval` iki
koşuda anahtar metrikler birebir ✓, `npm run build` ✓, commit/staging YOK.
`verify-curtain` (kare fotoğraf) çıktısı değişmedi — bölen 1.

---

## 2026-08-14 — Gün E: M9 uzunluk denetimi + eğim tavanı kararı (bulgu 5-6)

Sözleşme: `ARCHITECTURE.md` → "Derinlik Son-İşleme Maskesi" → *EĞİM TAVANI
KARARI*; `metrics.ts` başındaki M9 gerekçe bloğu.

**Bulgu 5 (M9) — piksel metriklerinde uzunluk eşitliği denetimi eklendi.**
`absRel` / `rmse` / `delta125` / `iou` `pred.length` üzerinde dönüp `gt[i]`
okuyordu. Diziler farklı uzunluktaysa `gt[i]` `undefined` olur; `undefined > 0`
ve `undefined >= 0.5` ikisi de `false` döndüğü için eksik GT SESSİZCE
"geçersiz piksel" (absRel/rmse/delta125) veya "arka plan" (iou) sayılıyordu —
fonksiyon hata fırlatmadan SAYI üretiyordu. `ate`/`rpe` bu denetimi zaten
yapıyordu; piksel metrikleri yapmıyordu (tutarsızlık).

Düzeltme: dördü de uzunluk eşit değilse `NaN` döner — `ate`/`rpe` ile AYNI
sözleşme. NaN sessiz kalmaz: D.5 "sonuç satırında NaN YASAK" kuralı gereği
`verify-eval.mjs` rapor doğrulaması patlar, hata SESLİ olur. Eşit uzunlukta
davranış değişmedi (regresyon nöbetçisi testte). Yeni test bloğu:
`verify-eval.mjs` → `[M9]`.

**Bulgu 6 — eğim tavanı: şüphe ÖLÇÜLDÜ, premis çürüdü, sabit değişmedi.**
Önceki girişte "sınırlayıcı, düzeltmenin kazandırdığı rölyefin bir kısmını geri
alıyor" diye açık madde bırakılmıştı. Bu iddia kırpılan PİKSEL SAYISINDAN
çıkarılmıştı; rölyef ölçümü yapılınca yanlış olduğu görüldü:

| Ölçüm | Tavanlı (0.02) | Tavansız | Fark |
|---|---|---|---|
| Rölyef std — sentetik gövde | 0.2105 | 0.2104 | %−0.07 |
| Rölyef std — gerçek büst fotoğrafı | 0.2044 | 0.2012 | %−1.63 |
| Aykırı sivrilme komşu farkı | 0.0309 | 0.4951 | ×16 bastırma |

Kazanç-ölçekli tavan da denendi (0.02 × stretch kazancı = 0.146): kırpılan
piksel 15897 → 32 düşüyor ama **rölyef std aynı kalıyor (0.2105)**, buna
karşılık sivrilme bastırması 0.0309 → 0.0928'e zayıflıyor. Yani ölçekleme,
ölçülebilir hiçbir kazanç vermeden korumayı gevşetirdi.

**Karar: `MAX_SLOPE_PER_PX` = 0.02 korundu.** Kırpılan piksel sayısı tek başına
kusur göstergesi değildir; karar rölyef ölçümüne dayanır. `verify-depth-mask.mjs`
[6] bloğu kararı kilitler (rölyef maliyeti %5'i aşarsa veya sivrilme bastırması
×4'ün altına düşerse test patlar). `verify-curtain.mjs` gerçek fotoğrafta
tavanın maliyetini her koşuda raporlar.

Doğrulama: `tsc --noEmit` ✓, `npm run verify` (11 script) ✓, `npm run eval` iki
koşuda anahtar metrikler birebir ✓, `npm run build` ✓, commit/staging YOK.

---

## 2026-08-14 — Gün 4: akış tabanlı zamansal derinlik — D.6 (kalan yarı)

Sözleşme: `ARCHITECTURE.md` → "D.6 Akış Sözleşmesi (G3 + G4)". flow.ts'e
DOKUNULMADI (G3 kilitli). `temporal.ts` saf klasik CV, Math.random YOK —
her hesaplama deterministik. Tüm sabitler 2026-08-14 ölçüm taramasından
(diag-temporal*.mjs; karar öncesi ölçüm), tek sayı uydurulmadı.

- **`src/engine/vision/temporal.ts`:** seyrek→yoğun akış alanı +
  backward warp + ileri-geri oklüzyon + EMA karışımı.
  - `densifyFlow`: NN yayılım (radius 64 px). **IDW elendi ölçümle**
    (1/d², yarıçap 20): max hata 3.2 px vs NN 0.058 px (55×) — köşede
    kendi değerini BİREBİR geri verir (round-trip kanıtı).
  - `warpField`: kenar kelepçeli bilinear, backward yön (panTexture ile
    aynı sözleşme — çift yön çelişkisi yok).
  - `forwardBackwardOcclusion`: round-trip |fwd + bwd(P−fwd)| ≤ eşik.
    **fbThreshold = 0.1 px = ölçülen iyi dağılım max 0.063 × 1.5**.
  - `stabilizeDepth`: oklüzyon = FB AND NN mesafe ≤ 28 px (ölçülen: dama
    çekirdeği NN mesafesi ≥ 38 px → tam dışlanır; normal sahne kapsamı
    %88). depth = (1−α)·warp(prev) + α·raw; güvenilmezse raw aynen.
    **α = 0.3** (grid 0.25/0.3/0.4/0.5 → medyan RMSE 0.0224/0.0229/
    0.0241/0.0260). FB tek başına yetmezdi — ölçüldü: uyumsuz bölgede
    round-trip 0.029 px (medyanla aynı mertebe), NN taşması yüzünden.
- **`scripts/verify-temporal.mjs` — 5 grup (+2b adversarial, gerçek sayılar):**
  - round-trip: 262 köşe; yoğun alan köşede orijinal (u,v)'yi float32
    doğruluğuyla (≤1.2e-7) verir; warp(pan) vs GT: iç bölge max **0.009 px**.
  - 3'lü kıyas (N=6, salınımlı kayma 2.2/1.1 px/kare + korelasyonlu
    gürültü (0.03+0.012·sin(0.9i))·sin(0.7x)+(0.03+0.012·sin(1.7i))·sin(0.5y),
    yumuşak taban — ölçülen kazanan senaryo): **(a) ham 0.0308, (b) naif
    EMA 0.0250, (c) flow-warped EMA 0.0229 (%74)**; assert
    med(c) < 0.97·med(b) VE < 0.97·med(a).
  - oklüzyon: 8px dama bölgesi çekirdeği 0/225 maske 1, çıktı−ham |Δ| = 0
    (α=0 etkisi); bölge dışı maske 1 oranı **%98.4**.
  - determinizm: iki koşu BİREBİR aynı (JSON eşitliği).
  - timing: medyan **10.7 ms** (10 koşu; 3× densify ~3.9 ms her biri —
    60 fps bütçesi içinde; G3'teki flow 60 ms ile birlikte raporlanır).
- **BİLİNEN SINIR (bug değil, belgelendiği gibi raporlandı):** sert kenar
  sahneleri (lab gtDepth net/flu keskin sınır; yalnız basamak aynı sonuç):
  (b) 0.0318, (c) 0.0343 — warp KAZANAMAZ. Alt-piksel akış hatası
  (~±0.009 px) × kenar atlaması (0.55) → 2-4 px kenar bandı; bandın RMSE
  katkısı EMA gürültü kazancını yutar. Naif EMA'nın aynı pikselde
  karıştırması salınımlı harekette ~yarı hata bırakır. Çözüm kenar-korumalı
  warp — backlog; 2b testte assert YOK (belgeleme ölçümü, test gevşetme
  değil). D.6 teslimi yumuşak-derinlik varsayımına dayanır (gerçek
  monoküler derinlik düşük frekanslıdır).
- **Verimlilik:** stabilizeDepth başta 4× densify'ydı (19.1 ms) — FB
  maskesi yoğun alanlardan hesaplanacak şekilde çekirdeğe ayrıldı: 3×
  densify (10.7 ms), sonuçlar birebir aynı.

**Doğrulama:** `npm run typecheck` ✓ · `npm run verify` ✓ (10 zincir,
verify-temporal dahil).

---

## 2026-08-14 — Gün 3: optik akış — D.6

Sözleşme: `ARCHITECTURE.md` → "D.6 Akış Sözleşmesi (G3)". Üretici model
yoktur; flow.ts saf klasik CV (Shi-Tomasi + piramidal LK), Math.random YOK —
her hesaplama deterministik.

- **`flow.ts`:** Shi-Tomasi köşe tespiti (min-özdeğer, NMS minDistance=7,
  maxCorners=500) + piramidal Lucas-Kanade, **320×180**, default
  `pyramidLevels=3`, `windowRadius=7`, `errorThreshold=0.055` (ölçülen
  iyi/kötü RMS dağılımının geometrik ortası — [0,1] luminance domaininde;
  iyi eşleşme üst sınırı ≈0.027, alakasız desen alt sınırı ≈0.113).
  `status=0` yolları: pencere taşması, det < 1e-4, pencere RMS aşımı.
- **`scripts/verify-flow.mjs` — 6 test grubu (ölçülen sayılar, 2026-08-14):**
  - pan (3.2, −1.7) px: status=1 köşelerde |Δu| ≤ **0.0454 px**, |Δv| ≤
    **0.0580 px** (alt-piksel; eşikler ölçülen max × 1.5).
  - rotate θ=0.01 rad: çerçeve-içi köşeler (kenar bandı hariç) **263/276
    (%95.3)** status=1; başarılı köşelerin max sapması 0.058 px; status=0
    kalanların HAM hatası **medyan 1.09 px, max 1.60 px** (küçük piksel
    mertebesi — "birkaç piksel" gerçek ıraksama YOK).
  - fotometrik uyumsuzluk (8px dama, 40×40 bölge): **11/11** status=0
    (errorThreshold kabul kanıtı).
  - sınır taşması: kenar köşeler **53/53** status=0 (statik kaba-seviye
    yolu ayrıştırıldı: 53 statikte 0, 0 yalnız pan'la).
  - determinizm: iki koşu BİREBİR aynı (JSON eşitliği).
  - timing: medyan **66.4 ms** (10 koşu; hedef ~10 ms — rapora gider,
    assert gevşek < 200 ms).
- **BİLİNEN SINIR (bug değil):** piramit seviye sayısı (3) × windowRadius (7)
  ile belirlenen **±28 px kenar bandındaki** köşeler büyük (>~8 px)
  hareketlerde status=0 döner — bu LK'nin belgeli yakalama sınırı
  (flow.ts `lkLevel` pencere-taşması yolu; θ=0.05 rad rotate'de 8.3 px
  kaymanın ıraksattığı köşeler üzerinden ölçüldü — o yüzden rotate testi
  gerçekçi 60 fps mertebesi θ=0.01'de yapılır). Gerçek video akışında bu
  bant üretim kodunda (bir sonraki karede yeniden köşe tespiti) yönetilir;
  flow.ts'in KENDİSİ bunu telafi etmez.
- **Timing 66 ms/kare, hedef ~10 ms** — optimizasyon (vektörleştirme / erken
  çıkış) Gün 3 kapsamında DEĞİL, backlog.

**Doğrulama:** `npm run typecheck` ✓ · `npm run verify` ✓ (9 zincir,
verify-flow dahil).

---

## 2026-08-14 — Gün 2: ablasyon genişletmesi (smoothing / stretch / importance ölçümleri + bilinçli null kollar)

Sözleşme: `ARCHITECTURE.md` → "D.5 Metrik Rapor Formatı" (Gün 2 kolları +
null gerekçeleri). Davranış değişikliği yalnızca **export katmanı**nda:
fotoğraf yolu fonksiyonları yalıtılmış kol ölçümü için dışa açıldı; hiçbir
üretim çağrısı/logiği değişmedi. Üretici model yoktur (tüm kollar klasik CV).

- **`depth.ts` — 3 export açıldı (imza/sıra değişmedi):** `smoothDepthSteps`
  (bilateral adım yumuşatması), `foregroundMask` (smoothstep ön plan maskesi),
  `applyForegroundStretch` (ön plan min/max açılımı). `estimateDepth`'teki
  çağrı zinciri (169/176/178 bölgesi) TEYİT EDİLDİ — dokunulmadı.
- **`metrics.ts` — yeni export `foregroundPointShare`**: `w ≥ 0.7` nokta
  payı; boş girdi → NaN (sessiz 0 değil). `MetricColumn` şemasına yeni değer
  EKLENMEDİ — seg kolonuna sığar.
- **`lab.ts` — yeni sahne `makeSmallSubjectLab`**: merkezde alanın ~%17'sini
  kaplayan daire (r=30 @128², kesin 2827 piksel); fg 0.8 / bg 0.2; GT fg
  maskesi daire. `makeSyntheticLab` DEĞİŞMEDİ (determinizm korunur).
- **`eval.mjs` — 6 yeni YALITILMIŞ kol + 6 rapor dosyası:** girdiler lab GT
  KOPYALARIDIR (in-place fonksiyonlar taze girdi ister); ON/OFF yalnızca
  ilgili işlemde ayrışır (tek değişken).
  - `smoothOn/Off`: GT'ye deterministik yapısal gürültü (i%4∈{0,2} → ±0.03),
    smoothing açık/kapalı; karşılaştırma GT = ORİJİNAL lab (gürültüsüz).
  - `stretchOn/Off`: ön plan bandı (x < mid) yapay [0.6, 0.7] aralığına
    sıkıştırılır; stretch açık/kapalı; aynı GT'ye karşı.
  - `importanceOn/Off`: küçük özne sahnesinde `sampleVolumePositions`
    (gridSize 64 ve 32 ayrı ayrı, split `g64`/`g32`; fgShare + medianMs).
  - Rapor: `report-smoothOn/Off.json`, `report-stretchOn/Off.json`,
    `report-importanceOn/Off.json` — params'ta yalnızca ilgili kol 1|0,
    diğer 6 kol null (D.5 "fazladan anahtar yasak" korunur).
- **`verify-eval.mjs` — yeni assert'ler (gevşetme YOK):** bilateral YÖN
  kanıtı (8×8 elle kurulu: 0.53 gürültü 0.5 ortama çekilir, 0.8 sıçrama
  korunur — |ΔD| ≫ σ_r kenar yemez); stretch span açılımı + tek-ton
  dokunulmazlığı; `foregroundPointShare` el hesabı (3 senaryo + boş NaN);
  9 raporun TAMAMI mevcut `validateReport` kapısından; kollar "gerçekten
  ölçülebilir fark üretir" denetimi; koşular arası determinizm yeni
  kollarda da (timing hariç — OS/JIT varyansı metrik değildir).

Ölçümler (hepsi 2026-08-14 `npm run eval`, commit 7c93caf; metrikler iki
koşuda BİREBİR aynı — determinizm kanıtı; rapor dosyaları kaynaklı):

| Metrik (synthetic-lab, GT = lab) | ON | OFF | Fark |
|---|---|---|---|
| depthSmoothing — AbsRel | 0.0235 | 0.0338 | −%31 |
| depthSmoothing — RMSE | 0.0147 | 0.0212 | −%31 |
| depthSmoothing — δ<1.25 | 1.000 | 1.000 | aynı (uzak hata yok) |
| depthSmoothing — medianMs | 0.783 ms | 0 (işlem yok) | — |
| foregroundStretch — AbsRel (sıkıştırılmış bant girdi) | 0.0813 | 0.1181 | −%31 |
| foregroundStretch — RMSE | 0.0550 | 0.1434 | −%62 |
| foregroundStretch — δ<1.25 | 1.000 | 0.594 | +0.41 |
| foregroundStretch — medianMs | 0.201 ms | 0 | — |
| importanceSampling — fgShare (g64) | 0.3860 | 0.1748 | ×2.21 |
| importanceSampling — fgShare (g32) | 0.3906 | 0.1758 | ×2.22 |
| importanceSampling — medianMs (g64 / g32) | 4.20 / 3.67 ms | 3.04 / 2.76 ms | +%38 / +%33 |

Bilinçli sınırlar (dürüstlük kayıtları):

- **OFF kollarında `medianMs = 0`** "işlem uygulanmadı" demektir — ölçülecek
  işlem yoktur; 0 değeri sahte ölçüm DEĞİL, yokluğun işaretidir. D.5 timing
  metodolojisi (1 ısınma + 20 tekrar MEDYAN) yalnızca ON kollarına uygulanır.
- **Küçük özne sahnesinde önem örneklemesi payı %39'a çıkıyor ama arka plan
  noktası TAMAMEN yok olmuyor** (g64: 0.386 < 1): remap CDF'si ön plana
  yığılır, `BACKDROP_OPACITY` (0.4) arka plan örneklerini korur — bu
  TASARIM GEREĞİDİR (Gün B: remap arka planı kaybetmez).
- **δ<1.25 smoothing kollarında ayırt edici DEĞİL** (iki koşuda 1.000):
  ±0.03 sapma 1.25 eşiğinin çok altında; AbsRel/RMSE farkı ayrışmayı
  kanıtlıyor — "bir kol ancak ÖLÇÜLEBİLİYORSA raporlanır" denetimi
  (inert kol yasağı) AbsRel/RMSE üzerinden geçer.
- **Timing iki eval koşusu arasında oynar** (örn. focusOn 1.04 vs 0.80 ms):
  beklendik OS/JIT varyansı; metrikler (AbsRel/RMSE/δ/fgShare) birebir aynı.

Test güncellemeleri (gevşetme YOK — yeni testler eklendi):
`verify-eval.mjs` (§1c bilateral yön, §1d stretch span, §1e pointShare, §2b
küçük özne determinizmi, §3 yeni 6 rapor şeması, §4b kol fark denetimi, §5
yeni kol determinizmi). Tek düzeltme KAYAN NOKTA TEMSİLİNEDİR: Float32'de
`0.7` literal'i 0.69999998…'dir ve `≥ 0.7` eşiğinin ALTINDA kalır — eşik
sınır testi `0.7000001` ile yazıldı (gerçek davranış, test gevşetmesi değil).

Sözleşme: `ARCHITECTURE.md` → "Koordinat Uzayı" (silüet oranlı z uzamı),
"Siluet Sözleşmesi" (yeni bölüm), "Kamera / Video Yolu" (eğim sınırlayıcı).
Dört madde de klasik CV/geometridir — üretici model (diffusion/inpainting)
YOKTUR.

- **Maske-farkında bağlantı (`silhouette.ts`, `keepForeground`):**
  `connected(p,q)` koşuluna maske güveni eklendi — iki piksel de
  `foregroundMask ≥ 0.5` ise bağlantı kurulur. Gerçek bir uzuv (kalkık kol)
  yüzden öne çıktığı için `|Δd| > GRADIENT_BREAK` (0.15) oluyor, bileşen
  "severed" sayılıp eleniyordu (kullanıcı fotoğrafında kol + kürk siliniyordu).
  Duvar reddi korunur: duvarın maskesi düşüktür. Maske yoksa davranış aynı.
- **Maske otoritedir (`silhouette.ts`, aday koşulu):** maske verildiyse adaylık
  YALNIZCA `mask ≥ 0.5`; `SILHOUETTE_BIN_LO` (0.05) devre dışı. Maske özneyi
  doğru bulsa bile derinliği düşük kalan bölge (koyu saç, arkaya giden kol)
  depth eşiğinde siliniyordu. Sızma koruması yeri değişmedi (SON AND).
- **Silüet oranlı z uzamı (`sampler.ts` + `mesh.ts`):** yeni export
  `ANATOMIC_DEPTH_RATIO = 0.7`; `zSpan = 0.7 · 2 · min(rx, ry)`,
  `zUnit = zSpan/2`, ön plan `z = (d − 0.5)·zSpan + …`. Eskiden uzam sabit
  `range` (2) idi: derinlik her zaman bulut yüksekliğinin tamamıydı. z
  uzayındaki tüm sabitler kullanım yerinde `zUnit` ile ölçeklendi
  (`EDGE_WALL_Z`, `THIN_SHELL_Z`, kavis, `MESH_MIN_WALL_Z`, mesh arka kapak) —
  sabitlerin kendileri değişmedi. Arka plan dalı (`BACKDROP_Z_PIN`) ve
  `[−1, +1]` kırpması DEĞİŞMEDİ; `mesh.depthScale` (0.7) ayrı kol olarak kaldı
  (zSpan `range`in yerine geçer, depthScale'in üstüne değil). `body = null` →
  eski davranış.
- **Tek yönlü eğim sınırlayıcı (`depth.ts`):** yeni export `limitDepthSlope` +
  `MAX_SLOPE_PER_PX = 0.02`. `d[i] = min(d[i], min(4-komşu) + maxStep)`,
  4 geçiş, TEK YÖNLÜ (çukur öne çekilmez). `estimateDepth`'te en son aşama
  (detay/stretch/sobel'den SONRA), `mask = null` ile — imza değişmedi.
  Video/luminance yolu değişmedi.

Ölçümler (hepsi çalıştırılan komutlardan; `assets/thumbnail.jpg` + gerçek
RMBG + Depth-Anything-V2 boru hattı, ya da adı geçen sentetik girdi):

| Metrik | ÖNCE | SONRA |
|---|---|---|
| z uzamı / siluet genişliği (sentetik büst 128²) | 1.4542 | **0.6712** |
| `buildSilhouette` ön plan pikseli (gerçek foto, maskeli, 518²) | 84.622 (maskenin %95.95'i) | **88.196 (%100.00)** → +3.574 (+%4.22) |
| `buildSilhouette` ön plan pikseli (maskesiz yol — regresyon kapısı) | 251.724 | 251.724 (AYNI) |
| `verify-curtain` ön plan noktası (384² grid) | 46.526 | **48.480** (+1.954) |
| `verify-curtain` nokta/maske kütle merkezi sapması | 0.025 | **0.001** |
| Eğim sınırlayıcı: >0.02 yukarı-eğim taşıyan piksel (tüm kare) | 10.939 | **5.667** (−%48) |
| Eğim sınırlayıcı: >0.02 eğim, maske içi (maskeli yol) | 9.573 | **5.249** (−%45) |
| Eğim sınırlayıcı: değişen piksel (maskesiz yol, 518²) | — | 12.986 (%4.84), maks düşüş 0.6071 |

Bilinçli sınırlar (dürüstlük kayıtları):

- **Maksimum komşu |Δd| DEĞİŞMEDİ (0.5567 → 0.5567).** Sebep yapısaldır: en
  büyük sıçrama gerçek siluet sınırıdır (özne ↔ uzak arka plan) ve tek yönlü
  sınırlayıcı yalnızca YÜKSEK tarafı çeker — çektikçe aşınma cephesi bir
  piksel içeri kayar ve cephede her zaman artık bir basamak kalır. Geçiş
  sayısı ölçüldü: `passes` 1/2/4/8/16/32 → maks eğim 0.5567/0.5567/0.5567/
  0.5525/0.3984/0.1580, değişen piksel 10.939/11.892/12.986/15.112/18.834/
  23.582. Yani daha çok geçiş = daha çok aşınma; 4 geçiş bilinçli bir denge.
  Sınırlayıcının gerçek etkisi maksimumda değil, YAYGINLIKTA görülür
  (>0.02 eğim taşıyan piksel yarıya iner).
- **Maskesiz `estimateDepth` yolu siluet kenarını aşındırır:** maske İÇİ
  88.196 pikselin 11.683'ü (%13.25) maskesiz sınırlamada değişti; maske içi
  ortalama derinlik 0.5127 → 0.5015. Bunun tasarım gereği olduğu
  `limitDepthSlope`'un `mask` parametresiyle kabul edilmiştir —
  `estimateDepth` segmentasyon maskesini görmez (o `Engine.setDepth`'te
  üretilir), maskeli çağrı yolu export ile açıktır ama bugün kullanılmıyor.
- **(a) ölçümündeki "ÖNCE" değeri (1.4542) ALT sınırdır:** eski formülün z'si
  `[−1, +1]` sözleşmesinde kırpıldığı için gerçek uzam daha büyüktü; kırpma
  olmasaydı oran daha yüksek çıkardı.

Test güncellemeleri (gevşetme YOK — formül değişti, beklenen değerler yeni
formülden yeniden hesaplandı, hesaplar test yorumlarında):
`verify-sampler.mjs` (T2/T3/T6/T7/T10/T16/T21), `verify-positions.mjs`
(T1/T2), `verify-mesh.mjs` (T3/T5/T6). Sınır testlerinde eşikler
GEVŞETİLMEDİ, aksine daraltıldı: mesh duvar güvencesi `z ≥ −0.78` →
`z ≥ −0.26446875` (ölçekli `minWallZ`), sampler sınır bandı `(−0.81, −0.25)`
→ `(−0.27125, −0.084765625)` (ölçekli duvar hedefi ↔ ölçekli kabuk tavanı).

---

## 2026-08-13 — Gün D/1: CV fazı iskeleti + eval harness (Emre)

Sözleşme: `ARCHITECTURE.md` → "Gün D" maddelerinin kod iskeleti. "Eval
harness ASLA KESİLMEZ" kuralının ilk somut adımı: `npm run eval` tek satır
sayı basar, rapor D.5 şemasında `eval-out/report.json`'a yazılır.

- **`src/engine/vision/` (yeni):** `types.ts` — D.2 PoseTrack kaydı
  (`{ id, R quat xyzw sağ el KAMERA→DÜNYA, t y-up, timeMs, scaleA, scaleB,
  fovY }`), D.3 intrinsik varsayımı (60° dikey → `ParamDef`'e gidecek), D.6
  akış noktası, D.5 rapor şeması (EvalReport / MetricColumn) + 7 sabit
  ablasyon kolu.
  `metrics.ts` — AbsRel / RMSE / δ<1.25 / IoU / ATE / RPE / meanMs / medianMs;
  GT = 0 bölgeleri maskeli hesaba alınır; boş küme NaN döner (sessiz 0 değil).
  `lab.ts` — sentetik lab sahnesi: sol NET ön plan (2px şerit, yüksek gradyan
  enerjisi) / sağ FLU arka plan (aynı min/max [0.15, 0.85] ve aynı parlaklık
  ortalaması 0.5, düşük frekans sinüs). Parlaklık vekili iki yarıyı AYIRAMAZ;
  yalnızca netlik (defocus) ipucu ayırır — focusBoost kolunun kanıt düzeneği.
- **`src/depth.ts`:** `heightMapFromLuminance` export edildi — video depth
  borusunun canvas'sız çekirdeği (sobel/box-blur/focus/centerBoost/normalize).
  `luminanceHeightMap` resimden piksel çıkarıp buraya çağırır; davranış
  birebir (tarayıcı yolu değişmedi). Node emniyeti: Vite'a özgü
  `import.meta.env.DEV` ifadesi `VITE_DEV` sabitine alındı (tarayıcıda aynı
  değer üretir).
- **`npm run eval` (`scripts/eval.mjs`):** sentetik lab'de YALITILMIŞ kol
  çalışmaları — üçünde de `smoothingRadius = 1` ortak, kollar tek anahtarda
  ayrışır: focusOn (focusBoost 0.55) / focusOff (baz) / edgeOn (edgeStrength
  0.35, bazı focusOff). Raporlar: `report.json` (varsayılan),
  `report-focusOff.json`, `report-edgeOn.json`; commit hash her raporda.
  Zamanlama 1 ısınma + 20 tekrarın MEDYANI. Tek satır özet; harness hata
  durumunda da satır basar (asla kesilmez).
- **`scripts/verify-eval.mjs` → `npm run verify` zincirine:** metriklerin el
  hesabıyla birebir eşleşmesi (ATE/RPE dahil), lab determinizmi, uçtan uca
  eval + ÜÇ raporun D.5 şeması (tam 7 kol, fazladan anahtar yok), kolların
  ölçülebilirliği ve koşular arası determinizm. focusBoost kanıtı:
  **AbsRel 0.377 (on) / 0.763 (off), RMSE 0.174 / 0.398, IoU 0.808 / 0.348,
  δ<1.25 0.570 / 0.063.** edgeStrength kolu: **AbsRel 0.768, RMSE 0.431,
  δ<1.25 0.313, IoU 0.348** (bazı focusOff) — piksel düzeyinde en büyük fark
  0.122.
- `eval-out/` gitignore'da (raporlar üretilmiş çıktıdır).

Bilinçli sınırlar (dürüstlük kayıtları):

- **edgeStrength kolu bu sahnede İYİLEŞTİRMİYOR:** AbsRel 0.768 vs baz 0.763,
  RMSE 0.431 vs 0.398 (biraz kötü), δ<1.25 0.313 vs 0.063 (belirgin iyi),
  IoU değişmiyor. Kol ölçülüyor ve sonucu karışık — "işe yarıyor" denmiyor.
- **δ<1.25 kolları ayırıyor** (0.570 / 0.063) ama mutlak değerler düşük:
  sentetik GT iki düzeyli (0.85 / 0.30) ve boru hattı çıktısı min/max
  normalize edildiği için oran metriği ölçek kaymasına duyarlı. Sıralama
  bilgisi geçerli, mutlak seviye gerçek veri kümesine kadar anlamlandırılmaz.
- 5/7 ablasyon kolu (ao, letterbox_vs_distort, importanceSampling,
  depthSmoothing, foregroundStretch) uygulama sırası bekliyor — "uygulanmadı
  (null)" olarak raporlanır, asılsız sayı üretilmez. Gerçek model + ölçek
  hizalama Gün 4-5'te; mevcut ölçülebilir kollar: focusBoost + edgeStrength.
- **`seg` kolonu bu turda segmentasyon modülünü ÖLÇMEZ:** maske, normalize
  depth'in 0.5 eşiğidir (RMBG yolu çalışmıyor). IoU sayısı bu eşiğin GT ön
  planla örtüşmesidir.
- Pose kolonu Gün 1'de raporlanmaz (pose zinciri Gün 3'te gelir); ATE/RPE
  fonksiyonları hazır ve `verify-eval.mjs`'te bilinen değerlerle testli
  (Sim(3) geri kazanımı, el hesabı ATE 0.117851 / RPE 0.353553).
- Zamanlama medyanları kollara göre gerçekten farklı: focusOn 0.92 ms,
  focusOff 0.37 ms, edgeOn 0.32 ms — focus kolu Sobel + geniş blur eklediği
  için pahalı. (Önceki tek örnekli ölçüm 10.4 / 1.2 / 0.24 ms diyordu; bu
  fark JIT ısınmasıydı, boru hattı maliyeti değil.)

### Bağımsız denetim düzeltmeleri (aynı gün, commit'ten önce)

Gün 1 çıktısı dış denetimden geçti; kapatılan maddeler:

- **S1 — `edge` kolu hiçbir şey ölçmüyordu.** `BASE_OPTS.smoothingRadius = 0`
  iken low-pass girdinin kopyası olur, `edgeStrength · (data − low)` terimi
  matematiksel olarak sıfırlanır: edgeOn çıktısı focusOff ile piksel piksel
  AYNIYDI (maks fark 0), rapor yine de sayı basıyordu. Düzeltme: üç kol da
  `smoothingRadius = 1` ile çalışır (baz dahil), kollar tek anahtarda ayrışır.
  Yeni fark ölçüldü: maks piksel farkı 0.122, δ<1.25 0.313 vs 0.063.
- **S2 — şema dışı anahtar.** `report-edgeOn.json` `params.edgeStrength`
  taşıyordu ama D.5 altı kol tanımlıyordu. Karar: kolu **şemaya aldık (7 kol)**,
  çünkü harness onu gerçekten ölçüyor — anahtarı silmek ölçülen kolu
  görünmez yapardı. `verify-eval.mjs`'e yapısal doğrulayıcı eklendi: üç rapor
  da tam 7 kol taşımalı, fazlası hata; sonuç satırlarında `null` yasak (NaN
  JSON'da null'a döner, o da "kol uygulanmadı" anlamıyla çakışırdı).
- **S3 — uydurma referans.** `metrics.ts`'te ATE için "Harris-Quatérin
  sekansı" diye var olmayan bir kaynak yazılıydı; silindi. ATE/RPE
  docstring'leri "yönelim" diyordu, oysa ikisi de KONUM (translation) ölçüyor.
- **S4 — ATE literatür tanımına çıkarıldı.** Eskiden `mean(‖e−g‖)` idi
  (hizalamasız, ortalama). Artık Sim(3) hizalaması (Horn kapalı form, birim
  quaternion + Jacobi özçözüm) sonrası RMSE. Monoküler ölçek belirsizliği
  hizalamanın parçası. Ad değiştirme (ikinci tercih) gerekmedi.
- **S5 — zamanlama JIT artefaktıydı.** Tek örnek yerine 1 ısınma + 20 tekrar,
  MEDYAN raporlanıyor; `medianMs` metriği eklendi (`meanMs` duruyor).
- **S6 — `PoseTrackRecord` sözleşmeyi karşılamıyordu.** `scale` tek terimdi,
  D.2 ise `a·d + b` diyor: `scaleA` + `scaleB` alanlarına geçildi (tip
  sözleşmesi değişikliği, D.2 metni tiple birebir eşitlendi).
- **M1 — quaternion yönü tanımsızdı.** Kayıt artık `kamera→dünya`
  (`world_from_camera`); aynı cümle `types.ts` ve D.2'de.
- **M2 — D.1 kanal bütçesi çelişkisi.** "Ölçek → quat" geçişi 4 dolu kanalda
  imkânsızdı; D.1'e tek tutarlı geçiş senaryosu yazıldı (ölçek `gSplatA.w`,
  opaklık `gSplatC.a`, AO ayrı texture) ya da geçilmez.
- **M6 — harness kırılganlığı.** (a) Özet satırı `find(...).value` ile
  kuruluyordu: eksik metrikte çökerdi. Güvenli arama + `n/a` + `main()`
  çevresinde try/catch — satır her koşulda basılır. (b) `src/depth.ts`
  `@huggingface/transformers`'ı statik import ediyordu; eval hiç kullanmadığı
  ML kütüphanesini yüklüyordu. Import tembelleştirildi (`loadDepthModel` /
  `estimateDepth` içinde), `env` ayarları pipeline'dan önce aynı yerde kalır.
- **M7 — ATE/RPE testsizdi** ("hazır ve testli" iddiası yanlıştı). Bilinen
  girdilerle testler eklendi: aynı yörünge → 0; gt'nin Sim(3) dönüşümü →
  ~0 (hizalama geri kazanıyor, ölçek 0.5 bulunuyor); el hesabı ATE 0.117851;
  RPE 0.353553; dejenere girdilerde NaN.
- **M11 — δ notu düzeltildi.** Önceki metin "δ kol ayrımı vermez" diyordu;
  denetim sırasında ölçülen değerler 0.297/0.313 ile TERS yöndeydi. S1'den
  sonra (blur açık) δ artık DOĞRU yönde ve belirgin ayırıyor: 0.570 / 0.063.
  Not, ölçülen son duruma göre yeniden yazıldı — eski cümle de yeni cümle de
  aynı sahnenin farklı yapılandırmasına aitti.

**Doğrulama:** `npm run typecheck` ✓ · `npm run verify` ✓ (8 zincir,
verify-eval dahil) · `npm run eval` ✓ (iki koşu, metrikler birebir aynı) ·
`npm run build` ✓.

---

## 2026-08-13 — Gün D: CV dönüşümü — pose + splat + eval fazı, Gün 0 sözleşmesi (Emre)

Karar: 7 günlük CV fazının Gün 0 sözleşmesi imzalandı. Maddeler
`ARCHITECTURE.md` → "Gün D — CV Dönüşümü" bölümünde:

- **GaussianBuffer sözleşmesi (gSplat):** `gSplatA` (RGBA32F: xyz + opaklık),
  `gSplatB` (RGBA32F: normal + ölçek), `gSplatC` (RGBA8: rgb + AO). Yazan:
  veri katmanı (füzyon), okuyan: render katmanı; uPositions kuralının aynısı.
- **PoseTrack:** `{ id, R, t, timeMs, scale, fovY }`; dünya orijini = ilk
  keyframe; `scale` depth hizalamasından (`d_metric ≈ a·d_pred + b`).
- **İntrinsik:** varsayılan 60° dikey, ParamDef'e girer; değişim poz zincirini
  geçersiz kılar.
- **Füzyon:** GaussianBuffer + `keyframeIndex` kanalı; delik = NA sentinel,
  diffusion/inpainting YASAK.
- **Eval:** `eval-out/report.json` şeması (metrik/değer/dataset/split/column;
  kolonlar depth | seg | pose | timing; 6 sabit ablasyon kolu).
- **Akış (G3):** `flow.ts` sözleşmesi (320×180, 300–500 nokta) + `verify-flow.mjs`.
- Node graph'a `pose` + `fusion` düğümleri; 5. render modu `splat`
  (`SPLAT_PARAMS`). Yeni verify: `verify-pose.mjs`.
- Kesme sırası + sınır bildirimi (loop closure yok; kapsam 30–60 sn, 8–20
  keyframe, statik sahne).

Not: render katmanını ilgilendiren maddelerde (gSplat, splat modu) Zeynep'in
onayı ilk sabah senkronunda teyit edilir. Bu tur yalnızca sözleşme metni —
kod değişikliği yok; iskelet Gün 1'de.

**Doğrulama:** doküman değişikliği — `npm run verify` / typecheck / build
durumu değişmedi.

---

## 2026-08-13 — Gün C: denetim turu — solid kabuk düzeltmesi, 3D okunurluk, video derinliği (Emre + Zeynep)

Tüm dosyaların uçtan uca denetimi. Aşağıdaki maddelerin ilk üçü **hata**, geri
kalanı kalite/performans; hiçbiri üretici (generative) model kullanmaz.

### Hatalar (kök neden → düzeltme)

1. **Solid kabuk DİKEY TERS kuruluyordu (`mesh.ts`).** Köşe satırı `remap.yOf`'a
   ve satır koordinatına `v` (alttan üste, aUv sözleşmesi) veriliyordu; oysa
   `yOf` SATIR koordinatı bekler (üstten alta — `sampler.ts` ile aynı). Sonuç:
   fotoğrafın üstü dünyanın altına düşen bir geometri, üzerine DOĞRU yönde
   boyanmış fotoğraf dokusu. `t = j/N` ayrıldı, `v = 1 − t` yalnızca dünya/uv
   için kullanılıyor. Regresyon testi: `verify-mesh.mjs` "dikey hiza" (üst yarısı
   yakın depth → mesh'in üst köşeleri öne çıkar).
2. **Ön yüzün sarımı İÇE dönüktü (`mesh.ts`) → solid modda fotoğraf hiç
   görünmüyordu.** Hücre köşeleri döngüsel sırada (sol-üst → sağ-üst → sağ-alt →
   sol-alt) dünya koordinatında SAAT yönündedir; `computeVertexNormals` bu
   sarımdan ön yüz normallerini −z'ye çeviriyor, `solidMaterial`'ın duvar
   sınıflaması (`n.z < 0 → duvar`) ön yüzün TAMAMINI `uWallColor`'a boyuyordu.
   Yani ekranda görünen şey düz gri bir kütle, fotoğraf dokusu ise yalnızca
   görünmeyen arka kapağın üstündeydi. Sarım ters çevrildi (ön yüz +z'den CCW =
   dışa), arka kapak eski sarımı aldı, duvar şeridi formülü aynı kaldı (kenar
   yönü front'tan türetilir). `verify-mesh.mjs` artık yönü de doğruluyor.
   Yan kazanç: kabuk dışa yönlü olduğu için material `FrontSide` çiziyor —
   solid modun fragment maliyeti yarıya indi (eskiden `DoubleSide` zorunluydu).
3. **"Maskeyi göster" hiç çalışmıyordu (`App.tsx`).** Overlay canvas'ı
   `showMask &&` ile koşullu render ediliyor, çizim ise aynı tıklama içinde
   yapılıyordu: React henüz mount etmediği için `segOverlayRef.current` null
   dönüyor ve fonksiyon sessizce çıkıyordu. Çizim mount sonrası `useEffect`'e
   taşındı; maske yoksa sebebi log'a yazılıyor (sessiz boş kutu yok).
4. **Neon kenarları parçacıklardan KAYIYORDU (`neonWireMaterial.ts`).** Sobel,
   depth texture'ını GRID uv'siyle örnekliyordu: konum grid'i önem remap'iyle
   büküktür, depth ise ham görüntü uzayında (üstelik texel adımı depth
   çözünürlüğünden alınıyordu, grid'den değil). Kenarlar artık `uPositions`'ın
   z'sinden türetiliyor — hiza tanım gereği garanti. `uDepth`/`uTexelSize`/
   `uHasDepth` uniform'ları ve `setDepthTexture` API'si (+ `App.pushDepthToNeon`
   borusu) tamamen kalktı. Normalizasyon 0.25 → 0.125 (z aralığı depth'in iki
   katı) — `uEdgeThreshold`'un anlamı ve varsayılanı değişmedi.
5. **PNG export'u siyah inebiliyordu (`export.ts` + `App.tsx`).** WebGL çizim
   tamponu compositing sonrası temizlenir (`preserveDrawingBuffer` kapalı);
   `toBlob` tıklama görevinde çağrıldığında tampon boş olabiliyordu. Yeni
   `Engine.renderFrame()` aynı görev içinde tek kare çizip capture'ı besliyor.
6. **RMBG letterbox aynası yanlış içerik dolduruyordu (`segmentation.ts`).**
   5 argümanlı `drawImage(image, dx, dy, dw, dh)` kaynak olarak canvas'ın
   TAMAMINI alıp hedefe sıkıştırır: kenar şeridi yerine küçültülmüş bütün kare
   aynalanıyordu. 9 argümanlı biçime geçildi (kaynak dikdörtgeni açık).
7. **Video yolunda kare başına tahsis (`depth.ts`).** `boxBlurInPlace` havuzu
   ASLA dolmuyordu (`tmpPool !== tmp` koşulu ilk çağrıda null olduğu için hiç
   yazmıyordu) → her karede yeni `Float32Array`. Havuz modül düzeyine alındı;
   `sobelMagnitude`'un havuzlu/havuzsuz iki kopya gövdesi tek gövdeye indi.
8. **Sızıntılar:** `App` cleanup'ında `materials.solid.dispose()` eksikti;
   `embed.ts` kayıtlı material'ların YANINDA beşinci bir point cloud material'ı
   üretip takıyordu (hem sızıntı hem registry adı eşleşmemesi) ve hiçbirini
   bırakmıyordu. Embed'in `mode` attribute'u `observedAttributes`'ta ilan
   edilmiş ama hiçbir yerde okunmuyordu (ölü API) — artık uygulanıyor.
9. **Ölü kod:** `reconstruction/volume.ts` (`calculateVolumeMaps`) uygulamanın
   hiçbir yerinden çağrılmıyordu (yalnızca kendi testi vardı) — dosya,
   `verify-volume.mjs` ve `npm run verify` zincirindeki adımı kaldırıldı.
   `sampler.ts`'te kullanılmayan `isForeground` çözümlemesi ve
   `Engine.adaptResolution`'daki `lowFpsCount - 0` no-op satırı da gitti.
10. **Render preset kaymasi (`renderPreset.ts`).** Bu dosya ParamDef
    listelerinin ELLE yazılmış ikinci kopyasıdır ve Gün 6'da eklenen
    ışık/fresnel/normal kolları buraya işlenmemişti: hazır preset'ler ve render
    preset kaydı o değerleri sessizce düşürüyordu. Eksikler tamamlandı (yeni
    alanlar opsiyonel — eski kayıtlar açılmaya devam eder). **Açık iş:** bu
    katmanın da `ParamDef` listeleri üzerinden yürütülmesi (tek kaynak).

### 3D okunurluk (odak 1)

11. **Bakılı oklüzyon (`sampler.computeAoMap` + `sampleAoGrid`).** Depth
    haritasından ucuz bir kapanma yaklaşımı: 8 yön × 3 yarıçap, komşu ne kadar
    daha yakınsa merkez o kadar kapalı; sonuç `[0.35, 1]`'e kırpılır ve
    yumuşatılır. Taşıyıcı **renk grid'inin ALPHA kanalı** —
    `fillImageColorTexture` `a = ao·255` yazar; ek texture, ek bant genişliği,
    ek draw call YOK. `pointCloudMaterial` ve `solidMaterial` `uAoStrength`
    (0.6 / 0.7) ile tüketir; video dokusunda alpha = 1 olduğu için efekt
    kendiliğinden kapanır, `uAoStrength = 0` nötrdür. Çukurlar (göz boşluğu,
    çene altı, saç sınırı, kol-gövde arası) kararıyor — yönlü ışık + fresnel
    tek başına yüzeyi kabartma gibi okutmuyordu. Test: `verify-sampler.mjs`
    "bakılı oklüzyon" (kabartma dibi kararır, tepe ve uzak düz alan nötr).
12. **Kabuk normalleri geometriden geliyor (`mesh.ts` → `ShellMeshData.normals`).**
    `computeVertexNormals` KULLANILMIYOR: front/back/duvar köşeleri paylaşıldığı
    için ortalama normal siluet sınırında ön yüzü duvarla karıştırıyordu. Ön yüz
    normali z alanının merkezi farkından (`−dz/dx, −dz/dy, 1`), arka kapak
    (0, 0, −1). Ek olarak köşe başına **kabuk kimliği** (`aShell`: front 1,
    back 0) taşınıyor — duvar/kapak sınıflaması artık normal tahmininden değil
    bu attribute'tan yapılıyor (dik yüzeyler, burun kanadı/çene profili, yanlış
    duvar sayılmıyor).
13. **Kabuk çözünürlüğü 128 → 192 (`MESH_GRID_SIZE`).** Kabuk yalnızca fotoğraf
    yüklenişinde bir kez kurulur; 2.25× köşe yüzey detayını taşıyor.
    **Ölçüm** (Node, 518×518 depth, tam kadraj ön plan — en kötü durum):
    `computeAoMap` 64 ms · `sampleAoGrid` (remap + 384² grid dahil) 77 ms ·
    `buildShellMesh(192)` 182 ms / 131.360 üçgen. Aynı yolda depth çıkarımı
    tarayıcıda saniyeler sürüyor; kare başına maliyet YOK (video mesh üretmez).
14. **Solid gölgelemesi:** Blinn spekülar vurgu (`uSpecular`, 0.15) ve daha
    güçlü diffuse (`uLightStrength` 0.45 → 0.55) eklendi — katı, kavisli kütle
    okuması. İkisi de SOLID_PARAMS'ta (preset'e girer).

### Video girdisi (odak 2)

15. **İşaretli mikro rölyef (`luminanceHeightMap`).** Eskiden `|Sobel|`
    doğrudan z'ye ekleniyordu; büyüklük her kenarda POZİTİF olduğu için her
    kenar bir SIRT oluyordu (yüz hatları kabartma değil tel kafes; arka plan
    detayı öne fırlıyordu). Artık işaretli yüksek frekans (`raw − low-pass`)
    kullanılıyor — fotoğraf yolundaki `applyDetail` ile aynı ilke.
16. **Netlik (defocus) ipucu — yeni `focusStrength` (0.55).** Parlaklık kötü bir
    derinlik vekilidir (beyaz duvar öne fırlar, siyah saç dibe çöker). Videoda
    ise neredeyse her zaman geçerli bir ipucu var: özne NET, arka plan FLU.
    Yerel gradyan enerjisi geniş yarıçapla yumuşatılıp kare ortalamasına
    normalleştiriliyor (net → 1, flu → 0) ve z tabanı bununla harmanlanıyor.
    `centerBoost` 0.5 → 0.3 (merkez varsayımının payı azaldı).
17. **Zamansal kararlı normalizasyon (`stableRange`, EMA α = 0.15).** Kare
    başına min/max normalizasyonu, tek bir parlama/gölgede sahnenin TAMAMININ
    z eşlemesini kaydırıyordu (bulut nefes alıyordu). Uçlar kareler arasında
    taşınıyor; kaynak değişiminde `resetLuminanceState()` sıfırlıyor.
18. **Hareket duyarlı temporal harman (`App.tsx`).** Sabit α = 0.1 gürültüyü
    söndürüyordu ama gerçek hareketi de ~10 kare geciktiriyordu (el sallamada
    hayalet iz). Piksel başına fark büyükse katsayı 1'e açılıyor: durgun bölge
    kararlı, hareketli bölge anında takip ediyor.

### FPS (kaliteden ödün vermeden)

19. **Kimlik pass'leri artık çizilmiyor.** `uBloomStrength = 0` iken
    UnrealBloomPass tüm mip zincirini (5 downsample + 5 upsample + luminosity)
    boşuna çiziyordu; `uFeedbackAmount = 0` iken feedback iki tam ekran geçişi,
    `uAmount = 0` iken chromatic bir geçiş yapıyordu — üçü de varsayılan
    ayarda MATEMATİKSEL KİMLİK. Pass'ler `chainEnabled` (graf kolu) + parametre
    kontrolünü `update()` kancasında birleştirip `enabled`'ı kendileri
    hesaplıyor; Engine artık `enabled`'a doğrudan yazmıyor. Feedback atlanan
    karelerde birikimi bayat bırakmasın diye `needsClear` işaretliyor.
20. **Uyarlamalı DPR tabanı 0.75 → 1.0.** CSS pikselinin altında örneklemek
    görünür bulanıklıktır; uyarlama yalnızca DPR > 1 fazlalığını geri alıyor.
21. **`willReadFrequently`** okuma yapan tüm 2D context'lerde (tarayıcı uyarısı
    gerçek bir yavaş yol işaretiydi).

### Yapılmayanlar (bilinçli, açık iş)

- **Video için gerçek depth modeli.** Kalitede en büyük atlama Depth-Anything'i
  video karelerinde düşük hızda çalıştırmak olurdu (üretici model değil,
  ayrıştırıcı — yasak kapsamında değil). Ana iş parçacığında kare başına
  ~300-800 ms takılma yaratacağı için Web Worker şart; bu turun kapsamı dışında
  bırakıldı. Luminance yolu bunun yerine netlik ipucuyla güçlendirildi.
- **Solid modun video/kamerada çalışması.** Kabuk kare başına ~180 ms (192
  ızgara) + siluet maliyeti demek; ayrıca her karede yeni BufferGeometry
  tahsisi. Fotoğraf-only sözleşmesi korundu, ama artık SESSİZ değil: mod
  seçildiğinde sebebi log'a yazılıyor (`Engine.solidAvailable`).
- **`renderPreset.ts`'in ParamDef'e taşınması** (yukarıda madde 10) — eksik
  alanlar tamamlandı, yapısal birleştirme sonraya.
- **`Engine.ts` yorumlarındaki çift kodlanmış UTF-8 artığı** (`sÃ¶zleÅŸme`
  gibi) dokunulmadı: davranışı etkilemiyor ve düzeltmek dosyanın tamamını
  diff'e sokardı.

**Doğrulama:** `npm run typecheck` ✓ · `npm run build` ✓ · `npm run verify` ✓
(7 zincir; volume zinciri kaldırıldı, mesh + sampler + position zincirleri
büyüdü).
GPU tarafı `src/dev-smoke.ts` ile ölçüldü (gitignore'lu; tarayıcı konsolundan
`(await import('/src/dev-smoke.ts')).smoke()`): dört material'ın GLSL'i
uyarısız derleniyor, kabuk ÖN yüzü kameraya bakıyor (`coveredFrac` 0.21) ve
fotoğraf dokusunun rengini taşıyor — düzeltmeden önce burada duvar grisi
vardı; AO alpha'sı 1 → 0.35 arasında pikseli 183 → 99'a düşürüyor
(`mix(1, 0.35, 0.7)` ile birebir).

Canlı motor tanısı için dev-only kanca: `window.__engine` (yalnızca
`import.meta.env.DEV`). Sentetik görselle ölçülen durum — kabuk geometrisi
`position/uv/normal/aShell`, 18.848 köşe / 37.692 üçgen, ön normallerin
9424/9424'ü DIŞA (+z), arka kapağın 9424/9424'ü −z, `side = FrontSide`,
mesh görünür + nokta bulutu gizli; "maskeyi göster" overlay'i 256×256 çiziyor
(21.351 ön plan / 41.185 arka plan pikseli).

---

## 2026-08-13 — Gün B (temizlik): Relief / clean shell (Emre + Zeynep)

**Sorun (üç şikâyet):** solid mesh "buruşuk kağıt + kutu gibi uzamış" görünüyordu.
Kök nedenler: ① segmentasyon varsayılan KAPALI olduğundan maske yoktu — siluet
eşiği `depth ≥ 0.05`'e düşüyor, arka plan da 3B oluyor ve büst "içi doldurulmuş
yastık"a dönüyordu (silüet kesme mesh.ts'te zaten vardı, maskenin KENDİSİ
üretilmiyordu). ② Z hesabı ham depth'i doğrudan örnekliyordu. ③ arka kapak ve
duvar şeridi front ile aynı UV'yi paylaşıyordu → fotoğraf dokusu sünüyordu.

1. **Depth smoothing + ekstrüzyon sönümü (`mesh.ts`):** Z hesabı artık ham
   depth'i değil, ayrılabilir 3×3 box blur'dan geçirilmiş haritayı örnekler
   (`boxBlur3x3`, kenar kelepçeli; düz bölgeler birebir korunur). Yeni seçenek
   `depthScale` (varsayılan **0.7**): `(d − 0.5)·range` terimi %30 sönümlenir,
   kavis bileşeni ölçeklenmez → yüz hatları sivri/patlak değil. Siluet/remap/
   kaide ham depth'ten beslenir (maske keskinliği korunur), parçacık yolu
   etkilenmez.
2. **Duvar/arka kapak koyulaştırma (`solidMaterial.ts`):** sınıflama normalden
   yapılır — duvar şeritleri dikey (n.z ≈ 0), arka kapak −z'ye bakar (n.z < 0);
   yalnızca ön yüzey fotoğraf dokusunu taşır. `col = mix(col, uWallColor, wallAmt)`
   renk seçiminden sonra, ışıktan ÖNCE → duvarlar koyu mat kaide rengine oturur,
   diffuse ışık + fresnel üstünde çalışır (plastik büst kenarı). `uWallColor`
   (#23262e) SOLID_PARAMS + render preset'ine girdi. NORMALDEN sınıflama
   bilinçli: ayrı duvar köşeleri üretmek yönlü kenar dengesini (su geçirmezlik)
   bozardı — geometri dokunulmadı. Ayrıca solid fragment'teki
   `uObjectSeparation > 0.5 → discard` guard'ı KALDIRILDI: mesh zaten silüetle
   kesilmiş; otomatik segmentasyonda objectSeparation hep AÇIK gelince mesh
   tamamen siliniyordu (latent hata).
3. **Otomatik segmentasyon (`App.tsx`):** fotoğraf yükleme yolu her seferinde
   `segmentForeground` çalıştırır: maske depth'e gider, parçacıklar da arka
   planı atar (`setObjectSeparation(true)`, buton state'i AÇIK görünür). Boş
   maske güvenliği: hiç ≥ 0.5 piksel yoksa maske atlanır (sentetik görsel
   sahneyi sıfırlamaz); hata yolda da maske olmadan devam, say() ile duyurulur.
   `toggleSegment` aynen kalır (kapat/aç). Video/kamera etkilenmez (solid
   fotoğraf-only).
4. **Doğrulama (`verify-mesh.mjs`):** yeni ekstrüzyon sabitleri — köşe z
   0.2 → 0.14, merkez 0.2896 → 0.2296, maskeli 0.2176, iç köşe −0.14;
   `depthScale: 1` ile eski matematiğin (0.2896) korunduğu ayrıca doğrulanır.
   Blur düz/yarım sahnelerin iç bölge değerlerini bozmaz (sabit ortalaması
   kendisidir). Su geçirmezlik sayımı, determinizm (deterministik blur) ve
   diğer zincirler değişmedi.

**Doğrulama:** `npm run typecheck` ✓ · `npm run build` ✓ · `npm run verify` ✓
(9 zincir). Manuel: fotoğraf yükle → Solid → yalnızca büst, pürüzsüz yüz, koyu
çerçeve; video/kamerada kırık render yok.

---

## 2026-08-13 — Gün B: `solid` kapalı kabuk modu + mesh doğrulaması (Emre)

**Sözleşme:** dört mod oldu — `'points' | 'ascii' | 'neon' | 'solid'` (ModeSelector
`RenderMode`, Engine `registerRenderMode`, editör `EditorRenderMode`). Solid
fotoğraf-only: depth grid'ini kapalı bir z-kabuk meshine çevirir, nokta bulutu
yerine GEOMETRİ çizilir.

- **`buildShellMesh` (`reconstruction/mesh.ts`):** 512×512-ish grid → `2(N−1)²`
  quadrilater'ü çıkarır; gövde (front, z pozitif içe) + kapak (back, z negatif
  içe, gövde kenar rengiyle aynı) + duvar şeridi (siluet sınırında, z katmanı
  arası) öncelik sırası: gövde → duvar → kapak. Köşeler `((N−1)k + i) * 2`
  index şemasıyla `vertices / normals / uvs(indices)` çıktısı. Fotomerkez
  koordinat `(u·(S−1), v·(S−1))` — grid köşeler UV uzayında texel merkezinde
  (bilinear doku örneklemesi köşe rengini 4 texelin ortalaması verir).
  `importanceSampling` seçeneği: `true` (varsayılan) = remap konsantrasyonu,
  `false` = düz örgü.
- **`Engine.setShellGeometry`:** lazy `THREE.Mesh` (mesh material solid),
  geçerli geometriyi dispose eder, `syncRenderVisibility` ile nokta
  bulutunu/meshi gizler — solid mod + hazır kabuk → mesh görünür, nokta
  bulutu gizli; aksi halde nokta bulutu görünür (video/kamera solid'e meshi
  vermez, graceful fallback). `releasePhoto` kabuğu bırakır.
- **`solidMaterial.ts`:** ShaderMaterial — depth rampası / doku grid'i
  (`sampleImageGrid` çıktısı, LINEAR filtre), diffuse ışık + fresnel kenar
  parlaması (points ailesi), opak, DoubleSide, depthWrite açık. SOLID_PARAMS
  render preset'ine girdi (uBrightness/uLightStrength/uFresnelStrength/
  uNearColor/uFarColor).
- **UI:** ModeSelector + editör renderer düğümü + ControlPanel Solid grubu
  (dört mod), `embed.ts` solid kaydı, renderPreset state/serialize/apply
  solid bloğu, hazır preset'lere DEFAULT_SOLID.
- **Doğrulama (`scripts/verify-mesh.mjs`, `npm run verify` zincirine girdi):**
  düz sahne köşe z değerleri (Front/EDGE_WALL/Back), süreklilik (cap z =
  wall z', wall z = front z'), census (yönlü kenar dengesi = su geçirmezlik),
  yarım düzlem / masked (remap açık/kapalı) köşe adetleri, UV yüzey alanı
  genişliği, öncelik sayaçları, determinizm. Mesh tarafında bulunan iki hata
  bu turda kapandı: sign haritasının cell döngüsünün içine taşınması (front
  tris sayacıyla yürüyüş back kenarlarını da sayıyordu) + back yüz sargısının
  front'un birebir tersi yapılması (census dengesi). Test tarafında bulunan
  iki hata: köşe index formülü ve back z toleransı (Float32).
- **Düzeltme (solid vertex shader derleme hatası):** ShaderMaterial vertex
  öneki `position`/`normal`/`uv` attribute'larını, `modelViewMatrix`/
  `projectionMatrix`/`cameraPosition` uniform'larını zaten bildirir —
  solidMaterial.ts bunları elle yeniden bildiriyordu (diğer shader'lar
  yalnızca üçünün görmediği `aUv`'yi bildirir, o yüzden onlar derleniyordu);
  WebGL2'de three.js `#define attribute in` uygulayınca ikili bildirim
  "redefinition" ile vertex derlemesini öldürüyordu. Yeniden bildirimler
  kaldırıldı — varying'ler (vUv/vNormal/vViewDir/vViewDepth/vDepth) iki
  uçta birebir uyumlu, uniform tipleri sözleşmeyle aynı.

**Doğrulama:** `node scripts/verify-mesh.mjs` ✓ · `npm run typecheck` ✓ ·
`npm run verify` ✓ (9 zincir, verify-mesh dahil).

---

## 2026-08-13 — Gün B: Önem-tabanlı örnekleme mask-aware + doğrulama (Emre)

**Sözleşme:** önem remap'i artık segmentation fg maskesini de görür — formül
`0.5·depth + 0.3·center + 0.2·contrast + FG_IMPORTANCE_WEIGHT(0.4)·fg`
(`sampler.ts` `buildImportanceRemap`). "Yüz/ön plan garantisi" depth/merkez
varsayımlarından değil maskenin kendisinden gelir; arka plan bölgesine
örnekleme çekilmez.

- **Mask-aware:** `foregroundMask` remap'e iletilir (önceden yalnızca siluet
  AND'inde kullanılıyordu). Renk grid'i hizası kapatıldı: `sampleImageGrid` +
  `fillImageColorTexture` aynı maskeyi alır; `Engine.setDepth` işlenmiş maskeyi
  `lastFgMask`'ta saklar, `setPhoto` sonradan gelse de renkler parçacıklardan
  kaymaz. Kıyas: maskeli önem AÇIK modda ön plan texel oranı kapalı moddan
  yüksek (verify-sampler 24f).
- **Boyut güvenliği:** fgMask boyutu depth ile uyuşmuyorsa `RangeError` —
  sessiz yanlış sonuç yerine sert hata (volume.ts stili).
- **Doğrulama (açık iş 475 kapanır):** verify-sampler'a bölüm 24 eklendi —
  CDF monotonluğu + aralık, yoğunluk kayması (zonlu depth → medyan kayar),
  yoğunluk clamp'ı (eğim oranı sınırı uçtan uca), mask-aware kayma, RangeError.
  `buildImportanceRemap` test için export edildi; `invCdf` uç değer kelepçesi
  eklendi (q=1 taşması — sözleşme [0, n−1]).
- Gün 3 (satır 475) "uygulanmadı" kaydı güncellendi: temel remap zaten
  varsayılan AÇIK çalışıyordu; Gün B yalnızca maskeyi bağladı + doğruladı.

**Doğrulama:** `node scripts/verify-sampler.mjs` ✓ (bölüm 24 dahil) ·
`npm run typecheck` ✓ · `npm run build` ✓ · `npm run verify` ✓.

---

**Sözleşme:** render artık ham çizilmiyor — zincir ACES tonemapping ile
kapanıyor, görünüm üç yeni eksende kontrol ediliyor. İki önemli şema
değişikliği:

1. `feedback` düğümü "post-pass zinciri"ne iki üye ekledi: bloom
   (BLOOM_PARAMS — uBloomStrength/uBloomRadius/uBloomThreshold) parametre
   listesine giriyor; FXAA parametresiz ve her zaman açık. Giriş kenarı
   kesilince ikisi de `pass.enabled = false` ile kapanır (yeni zincir:
   `RenderPass → FXAA → Feedback → ChroAber → Bloom → Grain → Output`).
2. `output` düğümü "sonuca dokunmaz" olmaktan çıktı: **global look**
   kollarını taşıyor (LOOK_PARAMS — uExposure, uFogDensity, uFogColor,
   `src/shaders/look.ts`). Sözleşmenin "output sonuca dokunmaz" cümlesi
   kaldırıldı (graph.ts, ARCHITECTURE.md).

- **ACES + exposure:** `renderer.toneMapping = ACESFilmicToneMapping`, zincir
  sonunda `OutputPass` (tonemapping + sRGB). Exposure her karede
  `Engine.pushLookUniforms` ile lookUniforms köprüsünden geçer.
- **Global look köprüsü:** `Engine.lookUniforms` tek doğruluk kaynağı —
  UI/preset köprüye yazar, Engine her karede üç render material'ına
  (points/ascii/neon: uFogDensity/uFogColor aynı adlarla) + renderer'a işler.
  Sis üstel: `1 − exp(−d²·k)`; `uFogDensity = 0` iken görünüm bit-birebir
  korunur.
- **Bloom:** `src/shaders/bloomPass.ts` — UnrealBloomPass sarmalayıcı,
  BLOOM_PARAMS sözlüğü `update(time)` kancasında iç parametrelere senkron
  edilir (TickablePass deseni; preset/UI uniform adlarını bilmez).
- **FXAA:** `src/shaders/fxaaPass.ts` — antialias kapatıkken nokta kenarı
  pırıltısını keser; RenderPass'ten hemen sonra (efekt kenarlarını bozmaz).
  Resolution uniform'ı setSize kancasında güncellenir.
- **Bloom ssot:** varsayılanlar tek kaynakta (`BLOOM_DEFAULTS` — güç **0**,
  yarıçap 0.5, eşik 0.85); sarmalayıcı da BLOOM_PARAMS da oradan okur.
  Güç 0 olduğundan bloom anahtarı olmayan eski preset'ler bit-birebir
  orijinal görünümünü korur ("varsayılan görünüm değişmez" kuralı).
- **Output aktiflik sözleşmesi:** look kolları `setGraph`'ta aktiflikten
  BAĞIMSIZ uygulanır — feedback kenarı kopuk olsa da (output inaktif olsa da)
  graf editörü değişikliği ve preset round-trip (`toPreset` → `applyPreset`)
  yazılır. Kopuk zincirde kaydedilip geri yüklenen preset look'unu korur
  (bölüm 5 tunç testi).
- Eski preset'ler uyumlu: applyParams bilinmeyen anahtarı atlar → bloom
  varsayılanları (0/0.5/0.85) ve look varsayılanları (1/0) uygulanır.
  Tunç testi `verify-preset.mjs` bölüm 1-2'de bloom + look round-trip'i.

**Doğrulama:** `npm run typecheck` + `npm run build` + `verify-preset.mjs`
(bölüm 1: uBloomStrength/uExposure/uFogDensity tungsten; bölüm 2: geri
kurulum; bölüm 5: kopuk zincirde look round-trip). Görsel doğrulama
`npm run dev`'de manuel — "Look (ACES + sis)" ve "Bloom" bölümleri kanlı
canlı (bloom varsayılan kapalı).

---

## 2026-08-13 — Gün 8: Mod takası tek kapıya (Emre)

**Sözleşme:** render modu artık üç koldan (ModeSelector, ControlPanel, graf
editörü) değiştirilebilir ve **üçü de aynı sonucu doğurur** — graf yalnızca
kayıt anında değil, her takasta `params.mode` ile güncellenir. "Graf = tek
doğruluk kaynağı" ilkesi mod seçimi için de tutar.

- `Engine.selectRenderMode(mode)`: renderer düğümünün `params.mode`'unu graf
  üzerinde günceller. Material takası yalnızca `setPointsMaterial`'ın işidir;
  sıra: önce takas, sonra bu çağrı (böylece sonraki `setGraph` aynı material'ı
  tekrar takmaya çalışmaz — setPointsMaterial dispose eder).
- `App.changeMode(next)`: tek kapı — `setPointsMaterial` → `selectRenderMode`
  → UI state → `graphTick`. ModeSelector `onChange`, ControlPanel `setMode`
  ve editör `onRenderModeChange` hep buraya düşer.
- Editörün renderer düğümü artık üç modu da sunar (points/ascii/neon; eskiden
  points/ascii). Mod değişimi `onRenderModeChange` ile dışarı bildirilir.
- Editör tazelenmesi (`graphTick`) düğüm seçimini sıfırlamaz — düğüm id'leri
  her grafta sabittir, panel değeri her render'da engine'den okunur. Mod
  değişimi sonrası seçimli düğümün paneli kapanmaz (önceden kapanırdı).

**Doğrulama:** `npm run typecheck`; `verify-preset.mjs` bölüm 2.5 —
selectRenderMode sonrası kaydedilen/geri yüklenen preset doğru modu taşır.
UI akışı `npm run dev`'de manuel (ModeSelector ↔ editör ↔ ControlPanel
üçlüsünde mod senkronu).

---

## 2026-08-13 — Gün 7: Post-pass zinciri (Zeynep)

**Sözleşme:** `feedback` graf düğümü artık post-pass zincirinin tamamını
yönetir — feedback birikimi + chromatic aberration + grain/vignette. Üç pass
da aynı düğümden açılır/kapanır; parametreleri düğümde düz sözlükle yaşar
(FEEDBACK_PARAMS + CHROMATIC_PARAMS + GRAIN_PARAMS). `neon` yanlış anlaması
düzeltildi: neon bir render MODE'udur (renderer düğümü), pass değildir.

**Engine** (`src/engine/Engine.ts`):
- `FeedbackPass` ve `ChromaticAberrationPass` composer'a zincire eklendi:
  `RenderPass → Feedback → ChroAber → Grain → Output` (sıra: ARCHITECTURE.md).
- `feedback` düğümü aktif → üç pass da açık; giriş kenarı kesik → feedback +
  chromatic `pass.enabled = false`, grain `removePass` (geri açılınca aynı
  indekse `insertPass`). Böylece kenar koparma kanıt akışı zincirin tamamını
  kapsar.
- Feedforward kuralı: `uFeedbackAmount = 0` iken feedback çıkışı girişe
  bit-birebir eşit, `uAmount = 0` iken chromatic aynı koşul — varsayılan
  görünüm değişmez.
- Uniform adları ParamDef listelerinde yaşar: `FEEDBACK_PARAMS`
  (`src/shaders/feedbackPass.ts`), `CHROMATIC_PARAMS`
  (`src/shaders/chromaticPass.ts`), `GRAIN_PARAMS` (`src/shaders/grainPass.ts`);
  ayrı bir settings dosyası YOKTUR — listeler Engine, preset ve editörün
  ortak doğruluk kaynağıdır.
- Preset akışı to/apply için `node.params` eşlemesi güncellendi: feedback
  düğümü üç paramdef listesini birden seri/yükler; eski preset'ler (tek
  grain listesi) uyumlu kalır (`applyParams` bilinmeyeni sildiğinden
  feedback/chromatic değerleri varsayılana döner).

**UI** (`src/ui/NodeGraphEditor.tsx`, `src/App.tsx`):
- Feedback düğümü artık feedback + chromatic + grain/vignette sliderlarını
  bir arada gösterir (param paneli ParamDef'den üretildiği için değişiklik
  yalnızca `nodeDefs` eşlemesinde).
- Sağ panel Feedback ve Chromatic bölümleri (`ControlPanel` yeni `feedback`
  ve `chromatic` uniform prop'ları).

**Doğrulama:** `scripts/verify-preset.mjs` feedback/chromatic tungsten,
grain `uGrainAmount` ile birlikte round-trip'i kanıtlıyor (3. bölüm).

---

## 2026-08-12 — Gün 6: Export + Embed, video 3D, hacim ve ışık (Emre)

Fotoğraf yolu + video yolu render kalitesi paketi. Sözleşme değişikliği YOK
(texture formatları, w = opaklık, y-flip, GPGPU ping-pong aynı). Render
katmanını doğrudan etkileyenler aşağıda "Render katmanına" başlığında.

### Export + Embed (Gün 6 görevi)

- **PNG export** — `canvas.toBlob`, o anki frame'i indirir. `preserveDrawingBuffer`
  gerekmez: EffectComposer WebGL RT'lerine çizdiği için canvas her karede
  günceldir. Opsiyonel `scale` (2x vs.) — daha büyük PNG.
- **WebM export** — `MediaRecorder` + `canvas.captureStream(60)`. VP9 desteklenmezse
  VP8/varsayılan. Süre döngüsel buton: 5/10/20 sn. 8 Mbps.
- **Embed modu** — `<spatial-canvas>` custom element (`src/embed.ts`). Aynı
  bundle, UI mount edilmez, depth modeli yalnızca `src` attribute'u varsa
  `import('./depth')` ile lazy yüklenir. WebGL yoksa statik görsel fallback.
  Vite config'te ikinci giriş (`rollupOptions.input.embed`) → `dist/assets/embed-*.js`
  (~3.6 kB). Attribute yoksa URL parametreleri (`?src=`, `?preset=`).
- **Preset dosya indir/yükle** — `preset.ts` `downloadPresetFile` +
  `parsePresetFile`; UI'da "dosya ↓ / dosya ↑". localStorage slotlarına ek,
  onların yerine değil. JSON, sürüm korumalı (aynı `applyPreset` yolu).

### Video 3D (video oynatıcı mantığı geliştirmesi)

1. **Luminance yükseltme** (`depth.ts` `luminanceHeightMap`): ham parlaklık
   yerine ① hafif box blur (codec gürültüsü) ② Sobel kenar kabartma
   (`edgeStrength`, yüz hatları z'de belirgin) ③ merkeze radyal Gaussian vurgu
   (`centerBoost`, özne arka plandan ayrışır) → sonra 0..1 normalize.
   `LuminanceOptions` ile ayarlanır; `App.tsx` video döngüsü varsayılanları
   (0.35 / 0.5) kullanır.
2. **Home blend** — video/kameralarda depth her karede değişiyor; home
   toptan yazılırsa yay parçacığı her karede dürtülür (titreme, atalet kaybı).
   `fillPositionsFromDepth` artık `opts.blend` alır: `dynamicHome` açıkken
   home `0.8 yeni + 0.2 eski` lerp ile yazılır. `w` (iki seviyeli opaklık)
   saf yazılır — ara opaklık değeri üretilmez (shader'lar nesne ayırmayı
   yarı-opak sanmasın). `Engine.dynamicHome` bayrağı yalnızca video döngüsünde
   true; fotoğraf yolu eski davranış (toptan yaz).
3. **Grab (home çekişi)** — simülasyona `uGrabStrength` uniform'u
   (`SIM_PARAMS`'a satır: "grab (home çekişi)" 0..0.5). Fare ALTINDAKİ
   parçacıklar home yönünde ekstra kuvvet alır — video modunda deformasyon
   akışla çakışmaz; imleç gezdiği yeri "temizler". UI'da kuvvet satırına slider.
4. **Otomatik DPR** (`Engine.adaptResolution`) — FPS < 30 → pixel ratio ×0.75
   (2.25x az piksel), ≥ 45 sürekli → geri yüksel. Histerezisli (salınım yok),
   `adaptiveDpr = false` ile kapatılır. DPR değişiminde `composer.setSize` +
   grain `uResolution` tazelenir (zaten `resize()`'da).
5. **Luminance buffer havuzu** — `scratchBlur`/`scratchMag` ara kareleri:
   video döngüsünde her kare yeni Float32Array alloc yok (GC baskısı düştü).

### Nesne ayırma düzeltmesi (önemli — render katmanını ilgilendirir)

Şikayet: RMBG maskesi 1024²'de üretilip depth boyutuna bilinear ölçeklenince
kenar bandı 0.4-0.6 yumuşak değerlere iniyor; `buildSilhouette`'teki sert
`>= 0.5` AND eşiği kenarları (saç, el, ince uzuvlar) siliyordu — kalan yalnızca
özne çekirdeği ("sadece orta seçiliyor").

- **Çözüm YANLIŞ denendi, geri alındı**: eşiği 0.5 → 0.35 gevşetmek arka
  planı da (RMBG 0.0-0.2) ön plana sokuyordu, ayırma kayboluyordu.
- **Doğru çözüm**: eşik 0.5'te AYNEN kalır (`silhouette.ts` iki yerde);
  Engine'de maskeyi depth uzayına ölçekledikten SONRA
  `dilateAndFeatherMask(mask, w, h)` uygulanır (`Engine.setDepth`) — bilinear
  bandındaki yumuşak kenarlar morfolojik olarak geri kazanılır, uzak arka plan
  (RMBG 0.0-0.1) dilate'ten etkilenmez. Ayırma çalışır ama agresif değildir.
- Not: `dilateAndFeatherMask` 4px morf RMBG çözünürlüğünde (1024²) zaten
  vardı; yeni çağrı DEPTH çözünürlüğünde ek bir güvence bandı.

### 3D yapı iyileştirmesi — yüzey normalleri + ışık + fresnel (points modu)

Point cloud hâlâ düz (renk rampası + sahte döküm gölgesi). Depth gradyanından
yüzey normali türetip ışık/fresnel eklendi — **yalnızca `pointCloudMaterial.ts`**
(kod tekrarını önlemek için ascii/neon'a taşınmadı; onların kendi estetiği var).

- Vertex: `uPositions` komşu texellerinin z farkından
  `normal = normalize(-D·dzdx, -D·dzdy, 1)` (CPU/ek texture yok; GPGPU
  bozulmaz). Normal, extrude ÖNCESİ yüzey z'sinden — hacim parçacıkları da
  yekpare ışık alır. Yeni varying: `vNormal`, `vViewDir`.
- Fragment: `diffuse = 0.5 + 0.5·(n·L)` UVStrength ile karışım; fresnel
  `pow(1-|n·v|, 1+uFresnelStrength·5)·fresnel·2` additive ekleme. Duvar
  parçacıkları (w < 0.5) kenar parlamasında ×0.35 sönük.
- Yeni uniform'lar + `POINTS_PARAMS` satırları (sözleşme kuralı):
  `uLightStrength` (ışık gölgesi 0..1, varsayılan 0.45), `uLightDir`
  (vector3, sabit üst-sol ön), `uFresnelStrength` (kenar parlaması 0..1,
  varsayılan 0.35), `uNormalScale` (normal ölçeği 0..2, varsayılan 0.8).
- ControlPanel/POINTS_PARAMS'tan otomatik slider'lar; eski preset'ler
  (bu alanlar yoktu) `applyParams` ile güvenle atlanır, yeni görünüm alırlar.
- Ascii/neon davranışı DEĞİŞMEDİ (ışık/fresnel yalnızca points'te).

### Diğer

- `volume.ts` — runtime'da kullanılmıyor (yalnızca verify testi), Gün 7
  temizliğine bırakıldı.
- Buffer havuzu + otomatik DPR ile video yolunda FPS koruması.

### Render katmanına (kodu devralan için özet)

1. **Points shader'ına 4 yeni uniform** (yukarıda) — listeye satır ekledim,
   panel/preset otomatik. ShaderMaterial uniform objesindeki başlangıç değerleri
   `createPointCloudMaterial` içinde.
2. **`w` hâlâ opaklık (iki seviyeli)** — home blend'de de saf korunur.
3. **Nesne ayırma** — maske artık depth çözünürlüğünde dilate; shader eşiği
   (`w < 0.5`) DEĞİŞMEDİ.
4. **ASCII/neon'a dokunulmadı** — ışık/fresnel points'e özel.

### Doğrulama

`npm run typecheck` ✓ · `npm run verify` ✓ (7 script: positions, depth, preset,
volume, sampler, seg, curtain) · `npm run build` ✓

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
- Önem-tabanlı partikül dağılımı (yüz/ön planda yoğunluk remap) → **uygulandı**
  (Gün B 2026-08-13: mask-aware + doğrulama; yukarıya bak).

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
