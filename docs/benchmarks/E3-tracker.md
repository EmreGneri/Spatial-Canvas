# E3 · Tracker Worker FPS kontrolü

Yerel geliştirme sunucusu, aynı `assets/test-clips/nyc.mp4` klibi, düz video görünümü,
özellik modu. Canlı derinlik modeli devraldıktan sonra arayüzdeki 1 saniyelik
motor FPS sayacı okundu. Ana iş parçacığı karşılaştırması için
`?trackerBackend=main` yalnız geliştirme yapısında etkin; normal yol Worker.

| Yol | Tracker kapalı FPS örnekleri | Kapalı medyan | Açık FPS örnekleri | Açık medyan | Fark |
|---|---|---:|---|---:|---:|
| Ana iş parçacığı | 75, 85, 74, 89, 79, 75 | 77 | 48, 29, 32, 29, 29, 32, 32, 31 | 31,5 | −45,5 |
| Worker | 88, 82, 84, 91, 90, 86 | 87 | 96, 75, 57, 51, 53, 54, 47, 44 | 53,5 | −33,5 |

Worker açık durumda ana iş parçacığı yolundan 22 FPS yüksek medyan verdi.
İlk saniyeler ısınma ve canlı derinlik çıkarımından etkileniyor; bunlar
kontrollü laboratuvar ölçümü değil. İşlemci/GPU yükü ile klip zamanı tam
eşitlenmediğinden bu tablo ürün geneline ait FPS garantisi değildir.

Nesne modu Worker içinde gerçek klipte etiketli hedefler verdi (10–19 hedef
görüldü). Worker'daki model kurulumu ve ana sayfadaki canlı derinlik Web Locks
üzerinden sıraya giriyor; tarayıcıda hata kaydı görülmedi. Worker veya Web
Locks olmayan tarayıcılar eski ana iş parçacığı yolunu kullanır.
