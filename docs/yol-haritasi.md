# Yol Haritası — viral sprint sonrası, lansman öncesi

Tarih: 2026-09-23 · Branch: `feat/splat-render`

Bu dosya ikimiz içindir. Sprint bitti, elimizde çalışan bir motor var; buradan
sonrası **eksikleri kapatmak**, sonra **tanıtım**. Sıra bilerek böyle: tanıtımın
ön şartı dışarı çıkarılabilir bir çıktı ve tıklanabilir bir link.

## Neredeyiz — dürüst tespit

Piyasa araştırması (2026-09) iki şeyi netleştirdi:

1. **"Tarayıcıda, bulutsuz" tek başına farkımız değil.** Brush (Rust + WebGPU,
   açık kaynak) tarayıcıda gerçek 3DGS EĞİTİMİ yapıyor. Ama girdi olarak
   COLMAP pozları + görüntü ZIP'i istiyor.
2. **Gerçek farkımız ön işlemenin olmaması.** Video ver, sonucu gör. Bir de
   rekonstrüksiyon araçlarının vermediği stilize çıktı (ASCII/neon/crystal/
   tracker HUD).

Buna karşılık en büyük zayıflığımız: **splat'larımız optimize edilmiyor.**
`fuseVideoFrames` poz + derinlik + renkten splat YERLEŞTİRİYOR; fotometrik
optimizasyon yok. Yani çıktı "renkli nokta bulutu" kalitesinde. Gerçek 3DGS
ile yan yana konursa fark anında görülür. Tur 3 bunu kısmen kapatmayı hedefler.

Diğer bilinen eksikler: `.ply`/`.splat` export yok · WebGPU yoksa sessizce
parlaklık vekiline düşüyoruz · CV ana thread'de (16-23 ms/hesap karesi) ·
mobil düzen yok · paylaşılabilir çıktı akışı ham · metrik ölçek yok
(ARCHITECTURE D.8 zaten bildiriyor).

---

## Tur 1 — bağımsız, paralel

### E1 · `.ply` export  (Emre, `src/engine/export.ts`)
GaussianBuffer'ı standart 3DGS `.ply` formatına yaz.
Dönüşümler: opaklık → logit · ölçek → log · renk → SH DC katsayısı ·
normal + ölçek → quaternion (format quaternion ister, bizde normal var).

**Kabul ölçütü:** dosya SuperSplat'ta açılıyor ve sahne tanınabilir duruyor.
Bu doğrulanmadan "bitti" denmez.

### Z1 · Paylaşılabilir çıktı akışı  (Zeynep, `src/ui/`)
Tek tık: kaydet → indir. Kayıt sırasında görsel geri bildirim, süre seçimi,
çıktıya opsiyonel küçük proje imzası.
`export.ts`'in mevcut API'si yeterli — E1'i beklemez.

**Kabul ölçütü:** kullanıcı 3 tıkta paylaşılabilir dosya alıyor.

### E2 · Yetenek raporu  (Emre, `src/depth.ts` / `liveDepth.ts`)
Tek fonksiyon, tek doğruluk kaynağı:

```ts
{ webgpu: boolean; canliDerinlik: 'acik'|'kapali'; tespit: 'acik'|'kapali'; sebep: string|null }
```

### Z2 · Yetenek uyarısı arayüzü  (Zeynep, `src/ui/`)
E2'nin raporunu kullanıcıya göster: "Tarayıcın WebGPU desteklemiyor → canlı
derinlik kapalı, parlaklık vekili çalışıyor." Sessiz bozulma biter.
Arayüz tarafı sahte raporla önden yazılabilir (Gün 1'deki mock deseni).

---

## Tur 2 — Tur 1 bitince

### E3 · CV + tespiti Worker'a taşı  (Emre, `src/engine/vision/`)
Ölçüldü: tracker hesap karesi 16-23 ms, ana thread'de; tespit de aynı yerde.
Worker'a taşınca jank biter, tespit derinlikle GPU kuyruğunda çekişmez.

**Kabul ölçütü:** tracker açık/kapalı fps farkı ölçülür, öncesi/sonrası
tabloya yazılır.

### Z3 · Mobil düzen  (Zeynep, `src/ui/`)
Şu an sabit 640×420 tuval + 13 kontrollü şerit — telefonda kullanılamaz.
Gündelik yakalamanın çoğu telefonda oluyor.

**Kabul ölçütü:** gerçek telefonda tek elle kullanılabiliyor.

### E4 · Karşılaştırma ölçümü  (Emre, `scripts/`)
Aynı klip üzerinde biz vs Brush: toplam süre, kurulum adımı sayısı, çıktı
kalitesi. Rakamlar üretilir.

### Z4 · Karşılaştırmanın sunumu  (Zeynep)
E4'ün rakamlarını yan yana görsel tabloya çevir — README, ileride landing.

---

## Tur 3 — birlikte: kısa fotometrik iyileştirme

**Kapsam, baştan dürüstçe:** gerçek 3DGS eğitimi YAPMIYORUZ. O, türevlenebilir
rasterizasyon + milyonlarca parametreye Adam demek; WebGL hattımızda gerçekçi
değil. Yaptığımız: geometriyi dondurup **renk/opaklığı gerçek karelere göre
yeniden oturtmak** ve işe yaramayan splat'ları budamak. Görünür kazanç
çoğunlukla buradan gelir (yıkanmış renk, hayalet, çöp splat) ve türev
gerektirmez.

**Fikir:** her keyframe için mevcut splat'ları O KARENIN POZUNDAN çiz →
gerçek kareyle farkı al → farkı splat'lara geri dağıtıp rengini/opaklığını
düzelt → 2-3 tur tekrarla.

### Emre
- Düzeltme döngüsü: keyframe gezme, tur sayısı, zaman bütçesi, iptal.
- Artık hesabı: çizilen kare ile gerçek kare farkı, piksel başına hata.
- Güncelleme kuralı: splat merkezini kareye izdüşür, çevresindeki artığı oku,
  rengi/opaklığı o yöne ufak adımla it. Adım boyu + kelepçe.
- Budama: hiç katkı vermeyen splat'ları at.
- Ölçüm: held-out keyframe üzerinde PSNR öncesi/sonrası → `eval-out/report.json`
  (D.5 şeması zaten var).

### Zeynep
- **Poz-serbest offscreen çizim** — bugün render etkileşimli kameraya bağlı.
  Verilen herhangi bir pozdan, verilen çözünürlükte render target'a çizen yol.
  **KRİTİK YOL: bu iş olmadan Emre başlayamaz.**
- **Aynı matematik garantisi:** offscreen çizim ekrandakiyle birebir aynı
  rasterizasyonu kullanmalı. Farklıysa başka bir renderer'a göre optimize
  edilir, ekranda başka şey görünür.
- Kapsama çıktısı: hangi splat hangi pikseli ne ağırlıkla boyadı.
- Fark görünümü: yan yana + hata ısı haritası (hem hata ayıklama aracı hem
  tanıtım görseli).

### Ortak sözleşme — kod yazmadan önce imzalanır
```ts
renderFromPose(pose, w, h) -> { color: Uint8Array; coverage: Float32Array | null }
```
- Zeynep sağlar, Emre tüketir.
- Güncelleme YALNIZ mevcut GaussianBuffer yazma yolundan geçer (Emre yazar,
  Zeynep okur). Yeni texture kanalı imzasız açılmaz.
- Bütçe: toplam ≤2 sn, iptal edilebilir, etkileşimli fps düşmemeli.
- **Başarı ölçütü baştan kararlaştırılır:** held-out karede PSNR en az X dB
  artmalı.

**Risk:** gerçek geri yayılım olmadan artığı splat'a dağıtmak bir
YAKLAŞIMDIR. Ölçüm kazanç göstermezse üst üste hack yığma — dur, mimariyi
sorgula (3 başarısız düzeltme kuralı).

---

## Sonra: demo zinciri

1. Canlı link — küçük modelle ayrı "demo build" (model ağırlıkları ~120 MB ve
   gitignore'lu; CDN yok kuralı yalnız demo build'de gevşer).
2. README'nin işveren/ziyaretçi sürümü: tek cümle + GIF + link, teknik günlük
   aşağı iner.
3. 60-90 sn demo videosu.
4. Show HN + Reels/TikTok + r/GaussianSplatting.

Kural: her tanıtım tek bir linke gitsin ve o link **kayıt istemeden 5 saniyede
sonuç göstersin.**
