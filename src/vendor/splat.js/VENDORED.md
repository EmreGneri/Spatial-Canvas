# splat.js (vendored)

Kaynak: https://github.com/arrival-space/splat.js
Commit: 88efe9aaf32279b0b9bcb781ea0deb4d60c49dff
Lisans: MIT (LICENSE dosyasi)
Indirme: 2026-09-23

Yerel degisiklikler (2026-09-24): `session.js` arka sekmede rAF/Worker
zamanlayici yedegi, gorunur egitim hatasi, gec gelen GPU aygitini birakma ve
temiz dispose; `sfm/sfm.js` iptalde Worker havuzlarini sonlandirir; `io/video.js`
iptal sinyali ve arka sekmede durmayan seek tabanli element yedegi. Guncellerken bu yamalari yeni
upstream commit uzerine yeniden uygula veya upstream karsiligini kontrol et.
- 2026-09-25 `io/video.js` `runDecoder`: pompa IIFE'si `await null;` ile baslar
  (dur sonrasi dongu senkron bitip `pumping`i bayat birakiyor, sonraki kareler
  kapanmiyor, `flush()` asili kaliyordu); `runDecoder` test icin export edildi
  (`scripts/verify-egitim-decoder-drain.mjs`).
- 2026-09-27 `sfm/sfm.js` ozel cift grafigi + guvenli geri donus (Gezinme
  Parca 2: yuruyus kliplerinde sirali eslestirme). `opts.pairs = (n) => [i, j][]`
  varsa `runSfMOnce` `buildPairs` yerine onu kullanir (`sanitizePairs`: tamsayi,
  `0 <= i < j < n`, yinelenen atilir; log `matching N image pairs (custom graph)`).
  `runSfM` -> `runSfMCustomPairs`: ozel grafik `< opts.pairsFallbackRatio ?? 0.9`
  oraninda kayit yaparsa, cekim sirasinda `>= 3` ardisik kayitsiz kare birakirsa
  ya da hata atarsa, AYNI oznitelikleri (`_feats`; hata durumunda yeni
  `opts._onFeats` kancasi yakalar) kullanarak `opts.pairs` OLMADAN (varsayilan
  grafik) yeniden cozer ve cok kaydedeni tutar, esitlikte varsayilani. Geri
  donusten once `feats[].x/y` algilanan noktalara geri yuklenir (eslestirme
  `runGeometry`'nin geri yuklemesinden once kosuyor): geri donus sonucu, yamasiz
  varsayilan cozumle bit bit ayni (sentetik sahnede dogrulandi). Mevcut `pairRelax`
  yeniden denemesi bundan SONRA, tutulan gecisin opts'uyla (grafigiyle) degismeden
  calisir. `opts.pairs` verilmezse yol bugunkuyle ayni. Varsayilan grafik 'dense'
  KALIR: sfm.js'teki not (`'dense' since 2026-08-21`) seyrek uzak-bag izgarasinin
  250 karelik dongude iki kume kaymasina (egitimde hayalet kamyon) yol actigini,
  yogun uzak baglarin truck-250 ATE'yi %2,18 -> %0,00'a indirdigini soyler;
  sirali grafik bu dongu kapanisini zayiflatabilecegi icin yalniz istege bagli ve
  geri donuslu. Yardimcilar `src/engine/reconstruction/ciftGrafigi.ts`
  (`siraliCiftler`, `ciftSayisi`); test `scripts/verify-cift-grafigi.mjs`
  (`buildPairs` ve `sanitizePairs`'i kaynak metinden okuyup karsilastirir).

## Lisanslar (ticari kullanim denetimi, 2026-09-24)

- splat.js: **MIT** (Copyright 2026 Stratum1 GmbH) - LICENSE dosyasi korunur.
- vendor/mediabunny.min.mjs: **MPL-2.0** (Vanilagy). Ticari kullanima acik.
  Yukumluluk YALNIZ bu dosyayi DEGISTIRIRSEK dogar (degistirilen dosyanin
  kaynagi paylasilir). Degistirmiyoruz; lisans basligi dosyada duruyor.

## Bilinen risk: GPU zaman asimi (olculdu, 2026-09-24)

Test: `assets/test-clips/yay-100derece-stgeorge.mp4` (4096x1974, 12.2 sn).
- Kare cikarma CALISTI: 40 kare 66 sn, 24 kare 48 sn (WebCodecs yolu,
  367 kare puanlandi, bulanik kare yok).
- SfM `standard` katmaninda (8000 SIFT ozelligi, oktav -1) GPU esleştirme
  sirasinda `DXGI_ERROR_DEVICE_HUNG` (Windows TDR, ~2 sn sinir). Cihaz
  kayboldu ve `solve()` sozu HIC DONMEDI - sessizce asili kaldi.
- ARDINDAN Chrome tarayici oturumu boyunca WebGPU adaptoru vermeyi REDDETTI
  (`requestAdapter()` -> null). Bu, bizim canli derinlik ve nesne tespitimizi
  de oldurur. Tarayici yeniden baslamadan geri gelmiyor.

KOK NEDEN: `sfm/gpumatch.js` isi BELLEK boyutuna gore parcaliyor
(`CHUNK_WORDS = 24_000_000`, ~96 MB cikti), SUREYE gore degil. Tek parca
cok sayida goruntu ciftini tek `dispatchWorkgroups` cagrisinda kosturuyor;
zayif GPU'da bu cagri TDR sinirini asiyor.

KORUMA (entegrasyonda uygulanacak, kod DEGISTIRMEDEN):
1. Varsayilan `quick` katmani (3900 ozellik, oktav 0) - cift basina ~4x az is.
2. Kare tavani (<= 24).
3. `device.lost` ve ilerleme izlenir; kayipta kullaniciya sebep soylenir.
4. Egitim sirasinda bizim GPU islerimiz (canli derinlik, tespit) durdurulur -
   splat.js bizim Web Locks kuyrugumuzu bilmiyor.

Bunlar yetmezse `CHUNK_WORDS` kucultulur - AMA once gercek GPU'da olculerek.

## Ilk basarili egitim (olculdu, 2026-09-24)

Ayni klip, KORUMALI ayar: `quick` katmani, 24 kare, maxIters 3000.
GPU: Intel Iris Xe (gen-12lp, entegre) - bkz. asagidaki hibrit GPU notu.

| asama | sure |
|---|---|
| kare cikarma (24) | 14.1 sn |
| yukleme | 2.6 sn |
| SfM | 18.8 sn - 24/24 kamera, 3459 nokta, BA rms 0.41 px |
| seed | 0.5 sn - 58 803 Gaussian |
| egitim (3000 iter) | ~314 sn, 12-15 iter/sn |

Sonuc: egitim PSNR 27.52, **holdout PSNR 27.29** (egitimde gorulmeyen
kare 12). Iki deger yakin = ezber yok. `.ply` 11.4 MB.
Gaussian sayisi 3000 iterasyonda hic artmadi (densify bu surede tetiklenmedi).

Yani GPU cokmesinin sebebi `standard` katman + 40 kareydi; `quick` + 24
kare en zayif sinif GPU'da bile GECTI.

HIBRIT GPU NOTU: gelistirici laptopu RTX 5070 Laptop + Intel iGPU. Chromium
Windows'ta `powerPreference: 'high-performance'` istense bile Intel'i verdi
(olculdu). splat.js zaten high-performance istiyor - sorun kodda degil.
Kullaniciya "Windows Grafik ayarlarindan tarayiciyi Yuksek performans'a al"
ipucu gosterilmeli; `adapter.info.vendor` ile entegre GPU tespit edilebilir.
Ayrica: bugunku `session.solve()` GPU eslestiriciye oturum cihazini gecer;
bir surucu kaybinda WebGPU sozu yine donmeyebilir. SfM icin ayri ilerleme
bekcisi ve iptal sinyali gerekir.

## RTX 5070 Laptop olcumu (2026-09-24)

Windows Grafik ayarinda uygulama "Yuksek performans"a alindiktan sonra
adaptor `nvidia / blackwell`. Ayni klip:

| ayar | cikarma | SfM | egitim | Gaussian | holdout PSNR | .ply |
|---|---|---|---|---|---|---|
| Intel iGPU, quick, 24 kare, 3k iter | 14 sn | 19 sn | 314 sn | 58 803 | 27.29 | 11.4 MB |
| RTX, quick, 24 kare, 3k iter | 10 sn | 17 sn | 27 sn | 58 950 | 27.38 | - |
| RTX, standard, 40 kare, 10k iter | 44 sn | 107 sn | 95 sn | 135 076 | **30.98** | 26.3 MB |

- Egitim RTX'te ~12x hizli (12-15 -> 125-160 iter/sn). SfM hizlanmadi:
  buyuk kismi islemcide (kayit + BA).
- `standard` + 40 kare RTX'te GPU'yu COKERTMEDI (Intel'i cokerten ayar).
- Yogunlastirma (densify) ilk kez 2529. iterasyonda tetiklendi; 3k
  iterasyonluk kosular bu yuzden hic buyumuyordu.
- Kalite farki buyuk: holdout +3.6 dB (27.4 -> 31.0). Toplam ~4.2 dk.

Sonuc: katman GPU'ya gore secilmeli. Entegre GPU -> quick/24/3k,
ayri GPU -> standard/40/10k. `adapter.info.vendor` + ilk olcum bunu secer.

## Intel iGPU uzerinde ayni oturumda devam egitimi (olculdu, 2026-09-24)

Klip: `assets/test-clips/yay-100derece-stgeorge.mp4`; adaptor:
`intel / gen-12lp`; varsayilan `quick`, 24 kare. Uygulamadaki deneysel
`surdur +4.000` dugmesi ayni splat.js oturumunu kullanir. Kare secimi, SfM
ve Gaussian tohumlama tekrarlanmaz. Asagidaki holdout degerleri arayuzun
tek ondaliga yuvarladigi degerlerdir:

| asama | toplam sure | Gaussian | holdout PSNR |
|---|---:|---:|---:|
| 3.000 iterasyon | 397 sn | 58 803 | 27.1 dB |
| ayni oturumda 7.000 iterasyon | 794 sn | 67 624 | 27.9 dB |

Fark: +397 sn, +8 821 Gaussian ve +0.8 dB. Devamdan sonra `.ply` disari
aktarma da arayuzde basarili oldu. Ilk 3k kosusunda buyume olmadi; devam
kosusunda yaklasik 5.220. iterasyonda Gaussian sayisi 58 803'ten 67 624'e
cikti. 4k ek iterasyon, 2.500 iterasyonluk sonraki refine olayini 7k
ufkunun %75'lik buyume penceresine sokar. 3k ek iterasyon bu pencereden
sonra gelen refine nedeniyle buyumeyi tetiklemezdi. Bu **tek klipte tek
deneme**; farkli videolarda kalite artisi
garanti degildir. Varsayilan 3k korunur ve devam dugmesi deneysel kalir.
Yukaridaki 27.1 dB, onceki tabloda kaydedilen 27.29 dB'den ayri bir
calistirmanin yuvarlanmis sonucudur.

## Yogunlastirma takvimi: `refineEvery` butceyle olceklenir (olculdu, 2026-09-26)

Vendored dosyaya DOKUNULMADI; yalniz `egitimOturumAyari()` (egitim3dgs.ts)
`createSession`'a `refineEvery: max(300, round(maxIters / 8))` gecer.

KOK NEDEN. `session.js` refine'i `iter > 1500` VE son refine'dan
`refineEvery` (varsayilan 2500, 60k ufka gore) sonra tetikler. Varsayilan
motor (`engine` v2 degil) `_refineLegacy`'yi kosar: buyume `iter < growUntil`
(varsayilan **0.75** x ufuk; 0.5 olan `_refineV3` yalniz `engine: 'v2'`de)
ve tasima `iter < 0.75 x ufuk` iken. `lastRefine` 0'dan basladigi icin ilk
refine ~2518'de gelir:
- quick (3k): pencere 2250'de kapanmis -> refine BOS doner (tasima da yok,
  log satiri bile yok). Yukaridaki "densify hic tetiklenmedi" gozlemi bu.
- standard (10k): 2518 ve 5023'te iki buyume; 7528 pencere disi.

`growUntil` gecilmedi: onerilen 2200 varsayilan 2250'den KUCUK olurdu.

Olcum: RTX 5070 Laptop (`nvidia / blackwell`), `yay-100derece-stgeorge.mp4`,
gercek `egitimBaslat()` (katman `ayar` ile zorlandi). SfM iki kosuda ayni
(quick 58 950, standard 102 136 tohum).

| kosu | refineEvery | buyuyen refine | Gaussian | holdout PSNR |
|---|---:|---|---:|---:|
| quick 3k, once (2 kosu) | 2500 | yok | 58 950 | 27.28 / 27.41 |
| quick 3k, sonra (2 kosu) | 375 | @~1520, @~1900 | 77 962 | 27.79 / 28.13 |
| standard 10k, once | 2500 | @2518, @5023 | 135 076 | 30.84 |
| standard 10k, sonra | 1250 | @1523 ... @6568 (5) | 205 435 | **31.66** |
| quick 3k + devam 4k, sonra | 375 | +6 (3034 ... 4952) | 180 334 | 29.31 |

Kosular arasi gurultu (ayni ayar): ~0.13 dB. Kazanc quick +0.6 dB,
standard +0.8 dB. Egitim suresi bu olcumde GUVENILIR DEGIL: ayni GPU'yu
paylasan baska bir oturum iter/sn'yi 190'dan 30-115'e oynatti. Intel iGPU'da
sure etkisi (daha cok splat = iterasyon basina daha pahali) OLCULMEDI;
ozellikle deneysel devam dugmesi artik ~3x Gaussian uretir.

## Derinlik denetimi: `depthWeight` + `frame.depth` (2026-09-27, Gezinme Parca 4 Gorev 1)

Yerel yama (upstream'de yok). `gs/shaders.js`, `gs/trainer.js`, `gs/gradcheck.js`,
`session.js`. Kapaliyken (varsayilan `depthWeight` 0 ya da hicbir karede
`frame.depth` yok) uretilen WGSL eskisiyle BAYT BAYT ayni (render tum mod /
tileGrad / subgroup / batch / stats / cov / randBg kombinasyonlari + zincir,
`scripts/gradcheck-derinlik.mjs` [1]); adim basina is ayni (istatistik tamponu
16 bayt kalir, pipeline'lar degismez).

- Girdi: `frame.depth` Float32Array, egitim cozunurlugunde (tw x th) kamera
  uzayi z; NaN / <= 0 gecersiz. `undistortFrames` onu alpha gibi en yakin
  komsuyla yeniden orneklendirir (cerceve disi NaN). Secenek: oturum
  `depthWeight` (egitici `opts.depthWeight`'e gecer) ya da dogrudan egitici
  secenegi. Metrik: `trainer.depthLoss` (readLoss; agirliksiz ortalama) ve
  oturum `metrics` olayinda `depthLoss`; `_evalPass` de `depthLoss` dondurur.
- Kayit: yeni tampon YOK (render 8 depolama baglamasinda). Hedef derinlik
  `bufTarget`'ta RGBA blogundan sonra f32 bitleri (`total + meta.offset`);
  taban piksel indeksi kamera uniform'u `R0.w` (u32 bitleri), lambda `R1.w`
  (derinliksiz kamera 0 = uniform atlama). gradP yuva 14 = dL/dz; tileGrad
  paylasimli yuvasi NS (10 ya da 13) bosaltmada 14'e eslenir (K<=18); zincir
  `dpc.z += gz` (kamera poz gradyani da buradan gelir). stats[4] agirliksiz
  kayip x4096 (titretilmis, stats[6] tasima), stats[5] piksel sayisi;
  agirlikli kayip stats[1]'e (gradcheck) eklenir.
- Kayip (mod 0; SSIM/SSAA'da bir kez log + yok sayilir): D = sum T a z,
  O = 1 - T, Dn = D / max(O, 1e-4); hedef gecerli ve O > 0.5 iken
  e = (Dn - Dt)/Dt, L = lambda (sqrt(e^2 + 0.01^2) - 0.01). Geri: turetme
  `shaders.js`'te `makeRenderSrcRaw` ustunde. Renk hedefi gecersiz ama
  derinlik gecerli pikselde geri gecis gC = 0 ile calisir; refine "rendered
  mass" istatistigi yalniz renk-gecerli pikselleri sayar; RobustNeRF oylamasi
  derinlik gradyanini da dusurur.
- Dogrulama (SwiftShader, bu ortam): `node scripts/gradcheck-derinlik.mjs` —
  WGSL ozdesligi, gradCheckSmall derinliksiz/derinlikli/yalniz-derinlik (+
  tileGrad kapali, K=1, useStats, subgroup, poz), 50 adim determinizm (eski
  kodla kayip dizisi ve son parametreler birebir), sentetik GT derinlikle 100
  adimda depthLoss dususu. Sonuclar asagida.

| denetim (SwiftShader) | sonuc |
|---|---|
| WGSL ozdesligi, derinlik kapali | 8480 varyant, 0 fark |
| gradCheckSmall taban / renk+derinlik (lambda 4) / yalniz derinlik (lambda 4) | gecti; en kotu grup medyani 0.019 / 0.011 / 0.010 (tol 0.05) |
| yalniz derinlik: tileGrad kapali, K=1, useStats, subgroup | gecti (ayni medyanlar) |
| gradCheckPose yalniz derinlik (lambda 4) | tum eksenler <= 0.3 % |
| mutasyon: gOd / SD terimi / zincirde gz kaldirilinca | 76 / 70 / 12 ornek tol ustu, BASARISIZ (denetim duyarli) |
| determinizm, 50 adim (12 kamera 320x240, 12k splat) | kayip dizisi + son parametre ozeti eski kodla birebir |
| 100 adim depthLoss (tum kameralar, agirliksiz) | lambda ~0: 0.0693 -> 0.0252; 0.2: -> 0.0199; 1: -> 0.0122 (PSNR 21.28 / 21.44 / 21.64) |

Not: yogun gradcheck sahnesinde (derinlik riginde) RENK kaybinin rot.x/rot.y
poz turevi 4-46 % sapiyor; ayni sapma DEGISTIRILMEMIS egiticide de birebir
var (derinlikten bagimsiz, onceden var olan; seyrek taban rigde yok).
Gercek GPU'da derinlikli adim maliyeti OLCULMEDI.
