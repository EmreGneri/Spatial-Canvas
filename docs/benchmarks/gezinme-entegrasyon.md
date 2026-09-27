# Gezilebilir 3DGS: entegrasyon ölçümü (2026-09-27)

Bu ölçümler `feat/splat-render` üzerinde Chrome ve bu makinenin GPU'suyla
alındı. Sentetik orman yolunun gerçek kamera pozları ve analitik engel geometrisi
biliniyor. Gerçek orman klibinde engel GT'si yok. Kısa, 15 iterasyonlu eğitimler
bağlantı testi içindir; nihai görüntü kalitesini temsil etmez.

## Ölçüm yolu

`scripts/olc-gezinme.mjs` aynı klipten seçilen kareleri çözer, eğitir, ayrılan
kareleri ve baş/orta/son konumlarında 69 sondayı ölçer. Offscreen PNG'ler artık
WebGPU kanvasından `drawImage` ile değil, çizim dokusundan GPU okumasıyla alınır;
sentetik koşunun 138 PNG'si incelendi ve siyah kare hatası giderildi.

| Koşu | Kare | Çift | Kayıt | SfM süresi | GT poz RMS / yol |
|---|---:|---:|---:|---:|---:|
| Varsayılan | 24 | 276 | 24/24 | 77,1 sn | %0,027 |
| Sıralı grafik | 24 | 127 | 24/24 | 77,1 sn | %0,030 |

Çift sayısı %54 azaldı; bu GPU'da uçtan uca SfM süresi kısalmadı. Sıralı
grafik, yenilik seçimi ve odak alt örneklemesi bu nedenle isteğe bağlı kaldı.
Başka donanımda ve gerçek kliplerde hız ile kayıt başarısı ayrıca ölçülmeli.

## Derinlik ve gezinme

Depth Anything V2 çıktısı SfM noktalarının ölçeğine uydurulur, kareler arası
tutarlılıkla süzülür ve çoklu kare kanıtıyla boş alan ızgarasına çevrilir.
Tahmin edilen yüzeyin önündeki son %8 ışın boş sayılmaz; kamera merkezi için
en az yol ölçeğinin %4'ü kadar açıklık aranır. Arayüz, mevcut gezinme sınırının
izin verdiği adımı korur; boş alan daha uzağa güvenilir bir adım verirse onu
kullanır. Deneysel seçenek varsayılan olarak kapalıdır.

| Sentetik koşu | 12 kare, 15 iter | 24 kare, 15 iter |
|---|---:|---:|
| Derinlik hizalanan eğitim karesi | 12 | 24 |
| Orta, sağa yeni sınır / yol | 0,111 | 0,121 |
| Orta, sola yeni sınır / yol | 0,035 | 0,118 |
| Ham boş vokselde GT engel ihlali | 21/461 | 90/722 |
| Açıklık eşiğini geçen vokselde GT ihlali | 0/62 | 1/175 |

Voksel örneklemesi eski raporlarda her 251. hücreyi alır. Yeni raporlarda her
17. hücreyi alır; iki örnekleme oranının sayıları doğrudan kıyaslanmamalı.
Bozulmuş tek göz derinliğiyle saf testte ham boş vokselin yaklaşık %10'u GT
engelin içindeydi; çoğu zeminin altında. Bu yüzden boş alan **çarpışma garantisi
değildir** ve gerçek kliplerde otomatik olarak açılmaz. 12 kareyle yolun uçları
az örtüşür; boş alan tek başına eski sınırdan dar kalabilir.

Gerçek `forest-3679072.mp4` klibinde 12/12 eğitim karesinin derinliği hizalandı,
toplam 40,7 sn sürdü, bunun 8,0 sn'si derinlik hazırlığıydı. Eğitim ve 69
sonda çizimi tamamlandı. Bu kısa koşuda GT olmadığı için engel güvenliği ve
yan bakış görüntü kalitesi hakkında başarı iddiası çıkarılamaz.

Derinlik kaybı GPU sayısal gradyan denetiminden geçti. Sentetik 12 kare/15
iterasyonda ayrılan karelerin ortalama PSNR'ı derinlik kısıtı olmadan 17,578,
λ=0,2 ile 17,623 dB oldu (+0,045 dB). Bu fark varsayılanı değiştirecek
düzeyde değil. Bölgesel yoğunlaştırma ve derinlik kaybı yalnız ölçüm
bayraklarıyla açılır.

## Yeniden çalıştırma

```powershell
node scripts/sentetik-klip.mjs --chrome
node scripts/olc-gezinme.mjs assets/test-clips/sentetik-orman-yolu.webm --gt assets/test-clips/sentetik-orman-yolu.gt.json --etiket taban --katman quick --kare 24 --iter 3000 --chrome
node scripts/olc-gezinme.mjs assets/test-clips/sentetik-orman-yolu.webm --gt assets/test-clips/sentetik-orman-yolu.gt.json --etiket derinlik --katman quick --kare 24 --iter 3000 --geometri sentetik --derinlik-kisiti 0.2 --chrome
node scripts/olc-gezinme.mjs --karsilastir olcum-out/taban/sentetik-orman-yolu/rapor.json olcum-out/derinlik/sentetik-orman-yolu/rapor.json
```

Üretim varsayılanı için kapı: aynı sabit kare/iterasyon bütçesinde yan yöndeki
"iyi" mesafe en az %20 artsın, ayrılan kare PSNR kaybı en fazla 0,2 dB olsun,
GT engel ihlali erişilebilir bölgede sıfır olsun. Gerçek kliplerde görüntüler
elle de incelenmeli. Şu an bu kapı karşılanmış sayılmıyor.
