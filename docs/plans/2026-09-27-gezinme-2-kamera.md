# Gezinme Parça 2 — Daha Sağlam ve Hızlı Kamera Çözümü: Uygulama Planı

> Uygulama yöntemi: görev başına uygulayıcı alt-ajan + denetim; paralel
> görevlerin dosyaları ayrıktır, `package.json` ve git ana ajandadır.

**Hedef:** Aynı klipte SfM süresini düşürmek; kayıtlı kare sayısı ve poz
tutarlılığı korunarak. Üç bağımsız, isteğe bağlı değişiklik: yenilik/paralaks
tabanlı kare seçimi, sıralı + seçilmiş uzak bağlantılı eşleştirme (başarısızlıkta
yoğun eşleştirmeye dönüş), odak aramasının alt örnekle yapılması. Varsayılanlar
DEĞİŞMEZ; kullanıcının gerçek klip ölçümü kazanç gösterirse ayrı bir commit'le
açılır.

**Bu ortamdaki ilk ölçüm (sentetik orman yolu, quick, 24 kare, SwiftShader):**
24/24 kayıt, ATE yol uzunluğunun %0,01'i, odak hatası %0,6. SfM 141 sn:
öznitelik 7 sn + kurtarma 14 sn, eşleştirme 276 çift 95,5 sn (GPU taklidi —
gerçek GPU'da çok daha hızlı), odak araması 6 aday ~5 sn, kayıt + BA ~20 sn.
Çift sayısı donanımdan bağımsız bir maliyet ölçüsüdür; mutlak süreler gerçek
GPU'da ölçülür.

**Mevcut kancalar (vendor'a dokunmadan):** `extractSharpFrames` →
`review` (tarama puanları + küçük resimler `thumbs` ile seçimi değiştirir),
`forceTimes` / `forceExcludeSec`; SfM → `opts.graph`, `opts.searchSubsetAbove`,
`opts.focalScales`. Eksik olan tek kanca: özel çift listesi ve ona bağlı geri
dönüş — küçük bir vendor yaması (VENDORED.md'ye yazılır).

## Görev 1: Özel çift listesi + yoğun eşleştirmeye geri dönüş — model: opus

**Dosyalar:** `src/vendor/splat.js/sfm/sfm.js` (yama), `src/vendor/splat.js/VENDORED.md`,
oluştur `src/engine/reconstruction/ciftGrafigi.ts`, `scripts/verify-cift-grafigi.mjs`.

- `sfm.js`: `runSfMOnce` içinde `const pairs = opts.pairs ? opts.pairs(n) : buildPairs(...)`
  (`opts.pairs`: `(n) => [i, j][]`, i < j, geçersizler süzülür, yinelenenler
  atılır). `runSfM`'de: `opts.pairs` verildi ve ilk geçiş (a) `< opts.pairsFallbackRatio
  ?? 0.9` oranında kayıt yaptı ya da (b) çekim sırasında `>= 3` ardışık kayıtsız
  kare bıraktıysa, aynı öznitelikleri (`_feats`) yeniden kullanarak `opts.pairs`
  olmadan (varsayılan yoğun grafik) yeniden çözer ve daha çok kaydedeni tutar;
  log satırı: `custom pair graph registered X/N (gap G) — falling back to the default graph`.
  Mevcut `pairRelax` yeniden denemesi bundan SONRA, değişmeden çalışır.
- `ciftGrafigi.ts`: `siraliCiftler(n, { pencere = 6, uzakAdim = 3, uzakCarpan = 2 })`
  → her i için i+1..i+pencere; ek olarak her `uzakAdim`'ıncı i için
  i + pencere·uzakCarpan, i + 2·pencere·uzakCarpan, … (n'e kadar). `ciftSayisi(n, profil)`
  karşılaştırma için (varsayılan grafiğin çift sayısını `buildPairs` kuralıyla hesaplar:
  n ≤ 30 hepsi, üstünde 'dense').
- Test önce: n = 24 → çift sayısı, yinelenme yok, i<j, her komşu (i, i+1) var,
  en uzak bağlantı ≥ n/2; n = 2, 7 kenar durumları; `ciftSayisi(24,'dense') = 276`.
- Doğrulama: `npx tsc --noEmit`; vendor dosyası için `node --check`.

## Görev 2: Yenilik/paralaks tabanlı kare seçimi — model: sonnet

**Dosyalar:** oluştur `src/engine/reconstruction/kareSecimi.ts`, `scripts/verify-kare-secimi.mjs`.

- Saf çekirdek `yenilikSec(adaylar: { t: number; netlik: number }[], hareket: (a: number, b: number) => number,
  { esik, enAz, enCok, enUzunAralikSn })`: ilk adayı al; ardından son seçilene göre
  `hareket(son, aday)` (0..1, kare genişliğinin kesri) `esik`'i geçen ilk adayı değil,
  eşiği geçen ilk pencerede NETLİĞİ en yüksek adayı seç (pencere: eşiğin geçildiği
  adaydan sonraki 3 aday). `enUzunAralikSn` aşılırsa hareket beklemeden seç.
  Sonuç `enCok`'u aşarsa eşiği ×1.25 artırıp yeniden dene (≤ 12 kez), `enAz`'ın
  altındaysa ×0.7 azalt (≤ 8 kez).
- Tarayıcı tarafı `yenilikIncelemesi({ genislik = 320 })`: `extractSharpFrames`'in
  `review` kancasına verilecek fonksiyonu döndürür; `thumbs` küçük resimlerinden
  (`thumbs: { width: 320, count: min(360, tarama) }`) lüminans çıkarır,
  `computeOpticalFlow` (src/engine/vision/flow.ts) ile iki kare arasındaki izlenen
  noktaların akış büyüklüğünün 75. yüzdeliğini / genişlik olarak `hareket` verir
  (ileri yürüyüşte ortalama kayma ~0 iken dağılan akış büyüklüğü paralaksı yakalar).
  İzlenen nokta oranı %40'ın altına düşerse `hareket = 1` (yeni görüş).
  Küçük resim eşlemesi: `frames[i].t`'ye en yakın küçük resim.
- Test önce (saf çekirdek): sabit hızlı yürüyüşte eşit aralıklı seçim; durup
  bekleyen bölümde seçim yok (maks. aralık dışında); hızlanan bölümde sık
  seçim; netlik penceresi en net olanı seçer; enCok/enAz sıkıştırması.

## Görev 3: Bağlama + ölçüm modu — model: sonnet (Görev 1–2 ve Parça 1 ölçüm sayfasından sonra)

**Dosyalar:** `src/engine/reconstruction/egitim3dgs.ts`, `src/bench/gezinmeSayfasi.ts`,
`scripts/olc-gezinme.mjs`, `scripts/olcum-rapor.mjs`.

- `egitimBaslat` options'a `kamera?: { secim?: 'yenilik'; eslestirme?: 'sirali'; odakAlt?: number }`:
  `secim` → `extractSharpFrames({ ..., review: yenilikIncelemesi(), thumbs })`,
  `enCok = ayar.maxFrames`, `enAz = min(12, maxFrames)`; `eslestirme` → `sfm.pairs =
  (n) => siraliCiftler(n)`; `odakAlt` → `sfm.searchSubsetAbove = odakAlt`. Verilmezse
  bugünkü yol bit bit aynı.
- Ölçüm: `olc-gezinme.mjs --yalniz-sfm` (eğitim yok: kare seçimi + SfM, rapora
  `sfm: { kayitli, toplam, ciftSayisi, sureler, rmsBA, medErr }`, GT varsa ATE
  (umeyama rms / yol uzunluğu), `--referans <rapor.json>` verilirse ortak zaman
  damgalı kareler üzerinden referans pozlara göre tutarlılık (aynı ölçü).
  Seçenek bayrakları: `--secim yenilik`, `--eslestirme sirali`, `--odak-alt N`.
- Sayfanın SfM-only yolu ile `egitimBaslat`'ın kare seçimi ve SfM çağrıları AYNI
  fonksiyonları kullanır (ortak bir `kameraCoz` yardımcısı egitim3dgs.ts'te).

## Görev 4: Ölçüm ve karar — ana ajan

- Sentetik klipte (bu ortam): varsayılan / sıralı / yenilik / odak-alt / hepsi,
  quick 24 ve standard 40 kare. Tablo: kayıt, ATE, çift sayısı, aşama süreleri.
- `docs/benchmarks/gezinme-2-kamera.md`: sonuçlar + kullanıcının RTX/iGPU'da
  koşacağı komutlar (orman 3679072, Pixabay 29721, St George) ve karar kuralı:
  kayıt ≥ varsayılan, tutarlılık ≤ yol uzunluğunun %0,5'i, SfM süresi en az
  %20 kısa → o seçenek varsayılan yapılır (ayrı commit).
- CHANGELOG + VENDORED.md.
