# Gün E — Özne Derinliği Denetimi (2026-08-14)

Bu doküman **Zeynep'in Claude'u** için: bu branch'te (`feat/anatomic-depth`)
neyin, neden değiştiğinin hızlı özeti. Detay ve ölçümler `CHANGELOG.md`'de
(başlıklar "Gün E" ile başlıyor), sözleşmeler `ARCHITECTURE.md`'de.

## Şikayet neydi

Yüz odaklı fotoğraflarda 3D iyi. Gövde odaklı ve ayna selfie fotoğraflarında
sonuç neredeyse düz (2D'ye yakın), nesne ayırma bazı karelerde özneyi bozuyor.

## Kök nedenler (bulunma sırası, hepsi ölçüldü)

1. **Derinlik son-işlemesi RMBG maskesini hiç görmüyordu** — `estimateDepth`
   depth'ten SONRA segmentasyon çağrılıyordu; stretch/eğim aşamaları kendi
   sahte (depth-türevli) maskesini kullanıyordu, gövde/ayna karesinde bu maske
   yakın zemini de içine alıp özneyi sıkıştırıyordu.
2. **Maske iki yerde üst üste dilate ediliyordu** (`segmentation.ts` +
   `Engine.setDepth`) — kol-gövde gibi ince boşlukları kapatıp topaklaşmaya
   sebep oluyordu.
3. Regresyon testi yoktu — gerçek fotoğraf yoktu, sentetik testler bulgu 1-2'yi
   yakalayamadı.
4. **zSpan kadraj yönüne duyarlıydı** — dikey fotoğrafta dünya genişliği
   1'in altına indiği için `min(rx,ry)` farklı fiziksel ekseni seçiyordu, aynı
   özne yalnızca kadraj yüzünden sığ çiziliyordu. (Bu madde İKİ KEZ yanlış
   kapatıldı önce — CHANGELOG'da dürüstlük kaydı var.)
5. M9: piksel metrikleri (absRel/rmse/delta125/iou) uzunluk uyuşmazlığında
   sessizce yanlış sayı üretiyordu — artık NaN.
6. Eğim tavanı (`MAX_SLOPE_PER_PX`) ölçüldü, DEĞİŞTİRİLMEDİ — rölyefe maliyeti
   yok, aykırı sivrilmeyi ×16 bastırıyor.
7. **Stretch aralığı ham min/max'a kilitleniyordu** — maskeye sızan arka plan
   (duvar/kapı) veya öznenin uç pikselleri aralığı ele geçirip özne kütlesini
   sıkıştırıyordu. %10 histogram kırpması eklendi.
8. **Dejenere maske koruması** — RMBG bazı karelerde kareyi %100 ön plan
   sayabiliyor; artık >%92 ise maske atlanır.
9. **Önem-örneklemesi (`buildImportanceRemap`) öznede DELİK açıyordu** —
   ayrılabilir CDF'in `depth` terimi, stretch gerçekten çalışınca öznenin uzak
   yarısını (Karina'nın eli/yüzü) aç bırakıyordu. Maske varken bu terim artık
   kullanılmıyor.
10. **Model özneye hiç yakından bakmıyordu** — kadraj küçükse (özüm.jpg %28)
    gövde modele ~200px gidiyor, yüzey rölyefi çözülemiyor. Çözüm: özne bbox'ı
    kırpılıp AYNI model ikinci kez çağrılıyor, kırpma ŞEKLİ (genlik değil)
    maske içine yazılıyor — literatür karşılığı "Boosting Monocular Depth
    Estimation" (CVPR 2021) çok-çözünürlüklü birleştirme fikri.
11. Maske bazen kopuk parçalar (kapı kasası gibi) taşıyordu —
    `keepLargestComponent` eklendi.

## Anatomi neden korunuyor

Kritik tasarım kararı: **ŞEKİL kırpma çıkarımından, GENLİK anatomik yoldan**
(`applyForegroundStretch` + `zSpan`, siluet genişliğinden türer). Kırpma
çıktısı sadece doğrusal (min/max) olarak global derinliğin bandına oturtulur;
öznenin toplam kalınlığına karar vermez. İlk denenen "en küçük kareler
hizalaması" bu yüzden atıldı — ölçüm ×1.00 verdi (düzeltme kendi kendini
siliyordu), CHANGELOG'da "elenen tasarım" olarak kayıtlı.

## Değişen dosyalar (kod)

`src/depth.ts`, `src/App.tsx`, `src/engine/Engine.ts`,
`src/engine/reconstruction/{sampler,segmentation,silhouette}.ts`,
`src/engine/vision/metrics.ts`

Yeni test: `scripts/verify-depth-mask.mjs` (12. script, model yüklemez,
deterministik). `scripts/verify-curtain.mjs` genişletildi: gerçek fotoğrafta
aynı metrikleri raporluyor.

## Bilinen açık iş

- Repoda gövde/ayna test fotoğrafı YOK (kişisel olduğu için commit edilmedi) —
  gerçek dünya doğrulaması kullanıcının kendi fotoğraflarıyla yapıldı, sonuç
  konuşmada paylaşıldı, dosyalar repoya girmedi.
- Ayna selfie'sinde RMBG maskesi kapıyı özneye BİTİŞİK olarak alıyor —
  `keepLargestComponent` bunu temizlemiyor (kopuk değil, bitişik). Ayrı iş.
- `ANATOMIC_DEPTH_RATIO` (0.7) hâlâ sabit — estetik ayar, dokunulmadı.

Tüm doğrulama: `tsc --noEmit` ✓, `npm run verify` (12 script) ✓,
`npm run build` ✓. Detaylı ölçüm tabloları için `CHANGELOG.md`.
