# Tasarım kuralları

Güncellendi: 2026-09-26 (2. tur) · Sahiplik: Zeynep (render katmanı: `src/ui/`, `src/shaders/`)

Bu dosya arayüz kararlarının **tek referansı**. Yeni bir panel, düğme ya da akış
eklerken önce buraya bakılır; buradaki bir kuralı bozmak gerekiyorsa gerekçesi
koda yorum olarak yazılır (projenin "sessiz sapma yok" kuralı).

Sabitler burada TEKRARLANMAZ: boşluk, yarıçap, tipografi ve renk ölçeği
[`src/ui/tema.ts`](../src/ui/tema.ts) içindedir. Bu dosya *neden* öyle
olduğunu anlatır.

---

## Bağlam uyarlaması

Kural listesi WordPress admin arayüzleri için yazılmıştı. Spatial Canvas bir
**yaratıcı araç**: ekranın çoğunu canlı bir sahne kaplar, kullanıcı ayar
çevirip sonucu anında izler. İki fark:

| WP admin varsayımı | Bizdeki karşılığı |
|---|---|
| Tablo/liste ağırlıklı yönetim ekranı | Canlı sahne + yanında kumandalar |
| "Add New" / çöp kutusu / üst bar konvansiyonu | Yaratıcı araç konvansiyonu: sol canvas, sağ modül rafı, altta transport |
| Kaydet → sayfa yenile | Anında uygulanır, kayıt yalnız preset/çıktı için |

Jakob yasası bu yüzden "WP admin'e benze" değil, **"tanıdık yaratıcı araca
benze"** olarak uygulanır (After Effects/TouchDesigner/Figma ailesi).

---

## Yasalar ve bizdeki uygulaması

### Estetik–kullanılabilirlik etkisi
Düzenli görünen arayüz *kolay* hissettirir.
- Boşluk 4'ün katları (`bosluk` ölçeği), köşe yarıçapı 3 kademe, tipografi 5 kademe.
- Ayrım için kutu değil **ince kenar + yüzey basamağı** kullanılır.
- **Ölçülebilir:** aynı ekranda 3'ten fazla farklı köşe yarıçapı ya da 2'den
  fazla farklı kenar rengi olmayacak.

### Hick yasası
Görünür seçenek arttıkça karar süresi uzar.
- Efekt rafı **akordeon**: aynı anda tek kart açık.
- Gelişmiş kollar varsayılan kapalı.
- **Ölçülebilir:** ilk ekranda görünen BİRİNCİL kontrol (araç çubuğu +
  transport) ≤ 12. Açık kartın kolları ve kütüphane kapakları bu sayıya
  girmez — onlar kullanıcının kendi açtığı içerik.

### Jakob yasası
Kullanıcı zamanının çoğunu başka araçlarda geçirir.
- Yerleşim: **solda canvas, sağda modül rafı, altta transport** — tanıdık şema.
- Oynat/duraklat, dışa aktar, preset kütüphanesi beklenen yerlerde.

### Fitts yasası
Hedef büyük ve yakınsa hızlı tıklanır.
- Kontrol yüksekliği **≥ 32 px**, onay kutusu **18 px**, ikon-only hedef yok
  (ya etiket var ya da 22 px+ ve gruplanmış).
- Sık kullanılan işlem (mod değişimi, çıktı) canvas'ın **hemen altında**.

### Yakınlık yasası
Yakın duran şeyler ilişkili sanılır.
- Araç çubuğu gruplara ayrılır (**kaynak | analiz | çıktı**), gruplar arası
  ayraç çizgisi.
- Her kart kendi kollarını taşır; kartlar arası boşluk kart içi boşluktan büyük.

### Benzerlik yasası
Aynı görünen şey aynı davranır.
- Tüm toggle'lar aynı bileşen dilinde: dolgu = açık, kenar = kapalı.
- Vurgu rengi **anlam taşır**: yeşil = nesne ayırma, turuncu = maske tanısı,
  mavi = tracker/seçili.

### Miller yasası
Kısa süreli bellek 7±2 parça tutar.
- Ayarlar modüllere bölünür (render · feedback · chromatic · bloom · look · grain).
- **Ölçülebilir:** bir grupta 9'dan fazla kol varsa alt başlığa bölünür.

### Zeigarnik etkisi
Yarım kalan iş akılda kalır; durumu göster.
- Kayıt/üretim işlerinde **ilerleme**: WebM geri sayımı, "önizleme üretiliyor · <ad>".
- Sonuç satırı: `✓ ...` / `✕ sebep`.

### Hedef-gradyanı etkisi
Bitişe yaklaştıkça motivasyon artar.
- 3D eğitimde ilerleme çubuğu + `iter/3000` sayacı + tahmini durum.
- Çok adımlı akışta sıradaki adım vurgulanır (ön kontrol → başlat → sonuç).

### Doherty eşiği
400 ms altı etkileşim akışı korur.
- 400 ms'den uzun süren her iş **görsel durum** gösterir (yalnız log satırı yetmez).
- Model yükleme, RMBG, derinlik çıkarımı, kapak üretimi bu kapsamda.
- **Ölçülebilir:** uzun iş sırasında sahne üzerinde çalışma göstergesi olmalı.

---

## Son denetim (2026-09-26, tarayıcıda ölçüldü)

| kural | hedef | önce | sonra |
|---|---|---|---|
| Fitts | kontrol ≥ 32 px | mod 28 · çıktı 24 · süre **17** · kol 24 | **ihlal yok** |
| Estetik | ≤ 3 köşe yarıçapı | 6 farklı (2/3/5/6/10/14) | **2 kademe** (6/10) + panel 14 |
| Doherty | 400 ms üstü işte gösterge | yalnız log satırı | sahne üstünde "işleniyor…", iş bitince kalkıyor |
| Fitts | onay kutusu | 15 px | 18 px |

Ölçüm yöntemi: görünür `button/input/select` düğümlerinin `getBoundingClientRect`
yükseklikleri ve `borderRadius` değerleri; gösterge için `busy` durumunda
ekranda metin aranması.

## Son denetim — 2. tur (2026-09-26, Z görevleri)

| kural | bulgu | sonuç |
|---|---|---|
| Jakob | mod seçici bloğu `minWidth: 0` ile sıfıra kadar küçülüyordu: altı mod 47 px'lik bir sütuna çöküp şeridi **432 px** yapıyordu | `flex: '1 1 auto'` → şerit **148 px**, üç temiz satır (araçlar / modlar / çıktı) |
| Fitts | temizleme aracı ve hata sınırı yeni kontrol getirdi | temizleme düğmeleri 32 px, kurtarma düğmeleri 36 px — verify'da denetleniyor |
| Zeigarnik | silme geri dönüşü olmayan bir iş gibi duruyordu | şeritte `kalan / toplam` sayacı + `geri al (N)` adım sayısı |
| Doherty | eğitim uzun sürüyor ama yalnız yüzde vardı (geçen ZAMAN, kalite değil) | transport şeridinin altında PSNR eğrisi + Gaussian sayısı + dB/1k eğimi |
| Hedef-gradyanı | grafiğin X ekseni son iterasyona kadar gitseydi bitişe ne kaldığı görünmezdi | X ekseni 0..BÜTÇE; ilerleme grafiğin zemini olarak da çizilir |
| Benzerlik | AR düğmesi cihaz desteklemiyorsa gizlenecekti | gizlenmez: kapalı ve sebepli durur — gizli düğme "uygulamada AR yok" diye okunur, oysa sorun cihazda |
| Estetik | seçim vurgusu için parlama (glow) denendi | dolgu opaklığı yeterli ayrımı veriyor; "tek ışık kaynağı" kuralı korundu |

**Araç modu kuralı (yeni).** Sahnenin üstüne olay yakalayan bir katman koyan
her araç, kamerayı kilitlemeyen bir **`gez`** moduyla gelir ve o mod
VARSAYILANDIR. Ölçüldü: temizleme katmanı olayları yakalarken sahne
döndürülemiyor, oysa floater'ı bulmanın yolu döndürmek. Seçim modlar arasında
KORUNUR — seç → gez → doğrula → sil akışı bozulmaz.

**Kapalı düğme kuralı (yeni).** Bir yetenek cihazda yoksa düğme GİZLENMEZ;
kapalı kalır ve sebebi söylenir. Gizli düğme kullanıcıya "bu uygulamada bu
özellik yok" der; oysa doğru bilgi "bu CİHAZDA yok" ve çoğu zaman bir yol var.

## Denetim listesi (yeni arayüz işinden önce)

1. Yeni kontrol ≥ 32 px mi, etiketi var mı? (Fitts)
2. İlk ekranda görünen kontrol sayısı 12'yi geçti mi? (Hick)
3. Bu kontrol hangi gruba ait, doğru komşularının yanında mı? (Yakınlık)
4. Aynı işi yapan başka bir kontrolle aynı mı görünüyor? (Benzerlik)
5. 400 ms'den uzun sürebilir mi — sürüyorsa göstergesi var mı? (Doherty)
6. İş yarıda kalırsa kullanıcı nerede kaldığını görüyor mu? (Zeigarnik)
7. Yeni renk/yarıçap/boşluk değeri icat ettim mi? (`tema.ts` dışına çıkma)
8. Sahnenin üstüne olay yakalayan katman koyuyorsam `gez` modu var mı ve
   varsayılan mı? (Araç modu kuralı)
9. Cihazda olmayan bir yetenek için düğmeyi gizliyor muyum? (Kapalı düğme kuralı)
