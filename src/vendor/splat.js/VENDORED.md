# splat.js (vendored)

Kaynak: https://github.com/arrival-space/splat.js
Commit: 88efe9aaf32279b0b9bcb781ea0deb4d60c49dff
Lisans: MIT (LICENSE dosyasi)
Indirme: 2026-09-23

DEGISTIRILMEDI. Guncellemek icin ayni komutu yeni commit ile kos.

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
3. `device.lost` izlenir; kayipta kullaniciya DURUSTCE soylenir, asili kalinmaz.
4. Egitim sirasinda bizim GPU islerimiz (canli derinlik, tespit) durdurulur -
   splat.js bizim Web Locks kuyrugumuzu bilmiyor.

Bunlar yetmezse `CHUNK_WORDS` kucultulur - AMA once gercek GPU'da olculerek.
