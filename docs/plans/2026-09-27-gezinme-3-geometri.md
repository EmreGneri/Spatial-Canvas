# Gezinme Parça 3 — Gerçek Geometri ve Boş Alan: Uygulama Planı

> Görev başına uygulayıcı alt-ajan + denetim; paralel görevlerin dosyaları
> ayrıktır, `package.json` ve git ana ajandadır.

**Hedef:** Gezinme sınırını kamera yoluna uzaklıktan değil, sahnede
doğrulanan yüzey ve boş alandan hesaplamak. Seçilen karelerin derinliği SfM
noktalarıyla aynı ölçeğe hizalanır, kareler arası tutarlılıkla süzülür ve bir
hacim ızgarasında birleştirilir: her voksel `bos` (ışınların güvenle geçtiği
yer), `dolu` (yüzey) ya da `bilinmiyor`. Zemin düzlemi ve engeller buradan çıkar.

**Derinlik kaynağı takılabilir:** `model` = uygulamanın Depth Anything V2'si
(`src/depth.ts` `estimateDepth`, disparite: büyük = yakın). Bu ortamda
HuggingFace kapalı olduğundan model koşamaz; sentetik sahnede `sentetik` kaynak
kullanılır: GT derinliği (analitik ışın kesişimi) tek-göz modelinin tipik
bozulmalarıyla (kare başına afin disparite, düşük frekanslı eğilme, kenar
taşması, gürültü) üretilir. Gerçek klip + model ölçümü kullanıcının makinesinde.

**Mevcut parçalar:** `src/engine/vision/scale.ts` `fitScaleAlignment` (MAD'li,
deterministik afin uydurma; ters derinlik uzayında `1/z = a·d + b` kuralı
`depthProvider.ts`'te belgeli), `hizalama.ts`, `sentetikSahne.ts`.

## Görev 1: Analitik ışın kesişimi (sentetik GT derinlik) — model: sonnet

**Dosyalar:** `src/bench/sentetikSahne.ts` (ekleme), `scripts/verify-sentetik-sahne.mjs` (ekleme).

- `isinKes(o: Vec3, d: Vec3, tohum?): number` — en yakın pozitif kesişim
  uzaklığı (gövde: sonlu dikey silindir yan yüzeyi + üst kapak; çalı: küre;
  zemin: y = ZEMIN_Y düzlemi sınırları içinde; fon: z = FON_Z düzlemi); yoksa Infinity.
- `gtDerinlik(k: GsKamera, w, h, tohum?): Float32Array` — piksel merkezinden
  kamera ışını, kamera uzayı z (ışın uzunluğu değil) = derinlik.
- Test önce: bilinen bir gövdeye yatay ışın → merkez uzaklığı − r; aşağı
  bakan ışın zemine `ZEMIN_Y / dy`; her GT pozunda `gtDerinlik` ile `ciz`'in
  aynı pikselde gördüğü nesne tutarlı (Node'da `ciz` yok → yerine: derinlik
  sonlu, zemin pikselleri kamera altındaki yarı düzlemde, fon uzaklığı ≈ FON_Z − Cz).

## Görev 2: Tek-göz derinliğini hizalama + tutarlılık — model: sonnet

**Dosyalar:** oluştur `src/engine/reconstruction/derinlikHizalama.ts`, `scripts/verify-derinlik-hizalama.mjs`.

- `kareyiHizala(disparite: Float32Array, w, h, kamera: GsKamera, noktalar: Vec3[])`
  → `{ derinlik: Float32Array /* metrik z, NaN = geçersiz */, uydurma: ScaleFit | null, kullanilan: number }`:
  noktaları kameraya izdüşür (önde, görüntü içinde), `dPred = disparite(piksel)`,
  `dMetric = 1/z` → `fitScaleAlignment`; `z = 1/(a·d + b)`, `a·d+b ≤ 1e-6` → NaN;
  uydurma `null` ya da `inliers < 20` ise tüm kare NaN.
- `tutarlilikSuz(kareler: { derinlik, kamera }[], { komsu = 2, esik = 0.05, enAz = 1 })`
  → her kare için maske: pikselin 3B noktası en yakın `komsu` kareye (çekim
  sırasında) izdüşürülür; orada görünür ve `|z_ref − z_proj| / z_ref < esik`
  olan komşu sayısı ≥ `enAz` ise geçerli. Tutarsız pikseller NaN yapılır.
- Sentetik bozucu `tekGozBenzetimi(gtZ, w, h, tohum)` (bench dosyasında değil,
  test yardımcısı olarak `src/bench/tekGozBenzetimi.ts`): `d = s/z + o` (s, o
  kare başına rastgele), üstüne ekran uzayında düşük frekanslı çarpımsal
  eğilme (±%8), derinlik süreksizliklerinde 2 px taşma, %1 gürültü; sonra
  [0,1]'e normalize (modelin çıktısı gibi).
- Test önce: GT noktalarla `kareyiHizala` bozulmuş dispariteden metrik
  derinliği medyan göreli hata < %6 ile geri kurar; aykırı SfM noktaları
  (%10 rastgele) sonucu bozmaz; `tutarlilikSuz` bilerek bozulan bir yamayı
  (%30 derinlik ofseti) reddeder, temiz pikselleri %90+ tutar.

## Görev 3: Boş alan ızgarası — model: opus

**Dosyalar:** oluştur `src/engine/reconstruction/bosAlan.ts`, `scripts/verify-bos-alan.mjs`.

- `bosAlanKur(kareler: { derinlik, kamera }[], secenek: { voksel, sinir?: { min: Vec3; max: Vec3 }, adimPx = 4, yukari: Vec3 })`
  → `BosAlan` (düz `Uint16Array` sayaçları `bos`, `dolu`; `min`, `boyut`, `voksel`).
  Sınır verilmezse kamera merkezleri ± (yol uzunluğu × 0.5) yatay, yukarıda
  0.3, aşağıda zemin + 0.2 payı; sonsuz/uzak derinlikler `sinir` dışında
  kesilir (fon duvarı ızgarayı şişirmez). Her örnek piksel için kameradan
  yüzeye 3B DDA: yüzeyden `voksel` kadar öncesine kadar `bos++`, yüzey
  vokseli `dolu++`.
- `durum(alan, p)`: `bos ≥ 2` ve `dolu ≤ 0.1·bos` → `'bos'`; `dolu ≥ 2` →
  `'dolu'`; aksi → `'bilinmiyor'`. `aciklik(alan)`: `'bos'` olmayan her
  vokselden 3B öklid uzaklık dönüşümü (Felzenszwalb–Huttenlocher, ayrılabilir),
  metre (SfM birimi); `aciklikAt(alan, p)` trilineer.
- `zeminBul(alan, yukari)`: `dolu` vokseller üzerinde deterministik
  (tohumlu) RANSAC düzlemi, normal `yukari` ile ≤ 15°; en çok destekli olan.
  Döner `{ n, d, destek }` ya da null.
- `serbestAdim(alan, aciklikIzgarasi, C: Vec3, hedef: Vec3, yaricap)` →
  hedef `'bos'` ve açıklık ≥ `yaricap` ise hedef; değilse C→hedef doğrusu
  üzerinde ikili aramayla izin verilen en uzak nokta (C zaten dışarıdaysa
  yalnız açıklığı artıran hareketlere izin).
- Test önce (Node, sentetik sahne + `gtDerinlik`, 24 GT pozu): patika
  şeridinin ortası `'bos'`; gövde içleri `'dolu'`/`'bilinmiyor'`, hiçbiri
  `'bos'` değil; `'bos'` vokselerin %99'unda GT `engelUzakligi > −voksel`;
  zemin düzlemi normali YUKARI'ya ≤ 2°, yüksekliği ZEMIN_Y ± voksel;
  `serbestAdim` bir gövdeye doğru yürürken gövde yüzeyinin `yaricap` önünde
  durur; patika boyunca ileri yürüyüş serbest.

## Görev 4: Bağlama, gezinme sınırı ve ölçüm — model: sonnet (1–3'ten sonra)

**Dosyalar:** `src/engine/reconstruction/egitim3dgs.ts`, `src/ui/egitimControls.ts`,
`src/bench/gezinmeSayfasi.ts`, `scripts/olc-gezinme.mjs`.

- `Egitim.geometriKur(kaynak: 'model' | ((kamera, kareAdi) => Promise<Float32Array disparite>), ilerleme?)`
  → eğitim karelerinin derinliği, hizalama, tutarlılık, `bosAlanKur` → `Egitim.bosAlan`.
  `model` kaynağı eğitim karesinin görüntüsünü `estimateDepth`'e verir.
- `flyStep`'e isteğe bağlı `bosAlan` parametresi: verilirse sınır `serbestAdim`
  ile (yarıçap = 0.02 × ölçüm birimi), verilmezse bugünkü davranış bit bit aynı.
- Ölçüm sayfası `--geometri sentetik|model`: her bölge × yön için bugünkü sınır
  ile boş-alan sınırı mesafeleri, GT varsa boş-alan sınırının GT engellere
  girip girmediği (ihlal sayısı), sondaların boş-alan sınırı içindeki "iyi"
  oranı. `ozet.md` tablosuna iki sütun.

## Kabul

Sentetik klipte: boş-alan sınırı yan yönde bugünkü `YOL_PAY` sınırından geniş
(patika şeridi ~0.9 m), GT engel ihlali 0, zemin doğru. Gerçek klip + model
ölçümü kullanıcının makinesinde; boş-alan sınırı varsayılan değildir, 5.
parçada serbest gezinme ile birlikte açılır.
