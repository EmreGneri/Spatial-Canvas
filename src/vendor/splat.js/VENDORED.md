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
