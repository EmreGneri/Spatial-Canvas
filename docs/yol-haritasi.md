# Lansman yol haritası

Güncellendi: 2026-09-24 · Dal: `feat/splat-render`

Bu dosya ileriye dönük iş sırasıdır. Geçmiş ölçümler ve kararlar `CHANGELOG.md`,
`docs/benchmarks/` ve `src/vendor/splat.js/VENDORED.md` içinde kalır. Bir işin
kodda bulunması, kullanıcı akışının veya yayın kabulünün geçtiği anlamına gelmez.

## Bugünkü ürün: üç ayrı yol

| Yol | Girdi → çıktı | Motor | Durum |
|---|---|---|---|
| Fotoğraf | Fotoğraf → derinlik → stilize 3B görünüm | `Engine`, Depth Anything V2 Small, IS-Net | Çalışıyor; cihaz ve tarayıcı QA'sı sürüyor |
| `video → 3B` | Video keyframe'leri → poz/derinlik füzyonu → surfel sahne | `videoPipe.ts`, `GaussianBuffer`, WebGL | Hızlı önizleme; gerçek 3DGS eğitimi değil |
| `3D eğit` | Video → keskin kareler → SfM → tohum → WebGPU 3DGS eğitimi → `.ply` | `egitim3dgs.ts`, vendored `splat.js` | Uygulamaya bağlı; gerçek eğitim ve ayrı rasterizer |

`3D eğit` sahnesi ana motorun `GaussianBuffer`'ına çevrilmez. Eski surfel
renderer'ı anizotropik Gaussian ölçeklerini, dönüşünü ve SH rengini kayıpsız
taşıyamaz. Eğitim görüntüsü ve `.ply` çıktısı `splat.js` yolundadır.

## Önceki turların gerçek durumu

| İş | Durum | Kanıt / açık nokta |
|---|---|---|
| E1 · surfel `.ply` export | Kodlandı | `src/engine/export.ts`, `verify-ply.mjs`; `3D eğit` ayrıca kendi `.ply` çıktısını verir |
| E2 · WebGPU/canlı derinlik/tespit raporu | Kodlandı | `vision/yetenek.ts`; rapor henüz 3DGS eğitiminin kullanılabilirliğini açıklamıyor |
| E3 · tracker CV + tespit Worker | Kodlandı, ölçüldü | [E3 FPS ölçümü](benchmarks/E3-tracker.md); Web Locks yoksa ana iş parçacığına döner |
| E4 · Brush karşılaştırması | **Tamamlanmadı** | [Eski surfel koşusu](benchmarks/E4-brush.md) yalnız `video → 3B` içindir; Brush süresi ve ortak kalite ölçümü yok |
| Z1 · paylaşılabilir çıktı | Kısmi | PNG/WebM ve iki ayrı `.ply` indirme yolu var; 3DGS sonucunu tek linkle paylaşma akışı yok |
| Z2 · yetenek uyarısı | Kısmi | Sebep uygulama günlüğüne yazılıyor; eğitim için kullanıcıya görünür ön kontrol yok |
| Z3 · mobil düzen | Açık | Ana sahne 640×420, node editörü 640 px sabit; gerçek telefon kabulü yapılmadı |
| Z4 · karşılaştırma sunumu | Bekliyor | Önce karşılaştırılabilir E4 verisi üretilmeli |

Eski Tur 3'teki renk/opaklık artığı dağıtma ve `renderFromPose` sözleşmesi,
**surfel yoluna özgü bir öneriydi**. Gerçek 3DGS eğitimi artık var; bu öneri
3DGS kalitesi için kritik yol değildir. Surfel yoluna ayrı yatırım kararı
verilmedikçe uygulanmaz.

Canlı video derinliği ayrı bir önizleme hattıdır. Modelin yakaladığı karenin
renkleri artık aynı derinlik sonucuyla çizilir; maskesiz manzarada portre
silueti kullanılmaz ve başlangıç kamerasındaki perspektif korunur. `gs-test.mp4`
ile gözlenen canlı derinlik hızı yaklaşık 3–4 güncelleme/sn; renk ve geometri
birlikte ilerlediği için nokta görünümü videonun doğal kare hızından düşük
tempoda yenilenir. Sonraki kalite işi yakalama/çıkarım/Engine yükleme sürelerini
ayrı ölçmek, hareketli sahneye uygun derinlik yeniden kullanımı geliştirmek ve
farklı kliplerde görüntü kabulünü tekrarlamaktır.

## Sıradaki iş sırası

### 1. Eğitimi yayın için sağlamlaştır — Emre + Zeynep

- **Emre:** Sabit, yeniden dağıtılabilir test klibiyle Intel ve NVIDIA
  koşularını kaydet: kare sayısı, GPU, aşama süreleri, Gaussian sayısı, eğitim
  ve ayrılmış kare PSNR, `.ply` boyutu. Var olan geliştirici ölçümleri
  [vendor kaydında](../src/vendor/splat.js/VENDORED.md); yayın kapısı için
  uygulama içi koşu ve çıktı dosyası da saklanmalı.
- **Emre:** İptal, arka sekme zamanlayıcısı, eğitim ilerleme bekçisi ve kanvas
  temizliği kodlandı. Farklı tarayıcı ve GPU'larda sekme değiştirme, SfM
  sırasında kapatma ve cihaz kaybından sonra tekrar koşma davranışı gerçek
  donanımda ölçülmeli; tarayıcı kapanırsa eğitim oturumu kalıcı değildir.
- **Zeynep:** Eğitimin WebGPU ön kontrolünü, seçilen GPU/ayar katmanını,
  aşamaları, iptal sonucunu ve kurtarma yolunu kullanıcıya açık göster.
- **Ortak kabul:** İki GPU sınıfında video yükle → `3D eğit` → tamamlanma →
  döndürme → `.ply` indirme uçtan uca geçer; hata/iptal sonrası tekrar koşu
  sayfa yenilemeden güvenle başlar veya neden başlayamadığı söylenir.

### 2. Tek ziyaretçiye anlaşılır demo ve paylaşım — Zeynep + Emre

- **Zeynep:** Fotoğraf, hızlı `video → 3B` ve gerçek `3D eğit` seçeneklerini
  süre ve çıktı farkıyla adlandır. Mobil sahne/araç çubuğu düzenini gerçek
  telefonda test et. 3DGS için indirmenin yanı sıra paylaşılabilir önizleme
  akışını tasarla.
- **Emre:** Canlı demo build'inde gereken model ağırlıkları ve WebGPU yolunu
  temiz kurulumdan doğrula; örnek sahneyi kayıt istemeden hemen göster.
- **Ortak kabul:** İlk ziyaretçi örnek sonucu 5 saniye içinde görür; kendi
  videosuyla eğitimin dakika ölçeğinde süreceği baştan anlaşılır. Telefon,
  WebGPU'suz tarayıcı ve model yükleme hatası için açık durum mesajı vardır.

### 3. E4'ü yeni 3DGS yolu için yeniden ölç — Emre; sunum Zeynep

- **Uçtan uca deney:** İki ürüne aynı ham klibi ver; Brush'ın
  [resmî girdi sözleşmesi](https://github.com/ArthurBrussee/brush/blob/main/README.md)
  COLMAP veya Nerfstudio veri kümesi istediği için onun poz/kare hazırlığını
  da toplam süreye ve gerçek kurulum adımlarına kat. Spatial Canvas'ın
  otomatik kare seçimi ve SfM'si kendi süresine dahildir.
- **Eğitim/kalite deneyi:** Aynı seçilmiş kareler, kamera pozları ve ayrılmış
  test kareleriyle ikinci, sabit veri kümesi hazırla. Mevcut `3D eğit` UI'ı
  dışarıdan poz almıyor; bu deney için `splat.js` oturumunun hazır
  rekonstrüksiyon girişini kullanan ölçüm düzeneği gerekir. Böylece poz
  çözümündeki fark eğitim kalitesiyle karışmaz.
- Her koşuda cihaz, çözünürlük, kareler, iterasyon/kalite hedefi, hazırlık
  adımları, eğitim süresi, `.ply` boyutu ve aynı ayrılmış karelerde aynı
  çözünürlük/renk uzayında PSNR kaydet. Uçtan uca süreyi, hazırlığı ve
  yalnız eğitimi ayrı sütunlarda raporla.
- [Eski E4 tablosu](benchmarks/E4-brush.md) yalnız surfel önizlemenin tarihsel
  ölçümü olarak kalır; 21.374 ms / 52.252 splat değerleri 3DGS satırına
  taşınmaz. Eş koşu yokken hız veya kalite üstünlüğü iddia edilmez.
- **Kabul:** Tekrarlanabilir komutlar ve ham ölçüm dosyalarıyla iki sütun
  doldurulur; Zeynep aynı veriden README/demo görseli üretir.

### 4. Yayın kapısı — ortak QA

- Temiz kurulum (`npm install`, `npm run fetch:assets`, `npm run verify`,
  `npm run typecheck`, `npm run build`) ve gerçek tarayıcı/GPU denemeleri geçer.
- Güncel model ve vendored kod lisansları dağıtılan dosyalar üzerinden
  yeniden denetlenir; demo dağıtımı ve model ağırlıklarının sunumu netleşir.
- README, mimari sözleşme ve ekran görüntüleri gerçek iki video yolunu ve
  sınırlamalarını anlatır. Canlı link çalışır; ardından kısa demo videosu ve
  duyuru hazırlanır.

**Yayın kararı:** Bu kapılar geçmeden “her cihazda gerçek 3DGS” veya Brush'tan
daha hızlı/kaliteli olduğumuz söylenmez. Ölçülen GPU ve klip açıkça belirtilir.
