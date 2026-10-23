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

## DA3Mono-Large ile V2-small karşılaştırması (2026-10-10)

Soru: gezinme derinliğinde (anahtar kare başına) V2-small yerine DA3Mono-Large
(yerel yardımcı, `sidecar/server.py`, DirectML) daha iyi mi? Ayar: `--katman quick
--kare 24 --iter 3000 --trainer-seed 7 --chrome`, RTX 5070 Laptop. SfM iki modelde
de aynı (GT hizalama rms 0,0014), yani fark yalnız derinlikten. `derinlikCihazi`
raporda `sidecar` görünüyor: DA3 gerçekten kullanıldı, sessiz V2 düşüşü yok.

| Klip | Model | Geçerli piksel | Medyan uyum | En kötü uyum | Bilinmeyen voksel | GT engel ihlali | Erişilebilir ihlal |
|---|---|---|---|---|---|---|---|
| sentetik | V2 | 0,655 | 0,241 | 1,198 | 0,785 | %4,80 | %0,47 (n=3008) |
| sentetik | DA3 (kayma 0,5) | 0,662 | 0,221 | 1,247 | 0,787 | %5,17 | %0,67 (n=2534) |
| sentetik | DA3 (saf 1/d) | 0,682 | 0,224 | 1,703 | 0,777 | %5,00 | %0,62 (n=2905) |
| forest-3679072 | V2 | 0,513 | 0,392 | 3,620 | 0,808 | – | – |
| forest-3679072 | DA3 (kayma 0,5) | 0,382 | 0,569 | 3,355 | 0,854 | – | – |
| forest-3679072 | DA3 (saf 1/d) | 0,385 | 0,569 | 3,113 | 0,854 | – | – |

Ayrılan kare PSNR'ı derinlik kısıtı olmadığı için modelden bağımsız (34,0–35,3 dB, gürültü içinde).

Sonuç: **DA3 bu yolda V2'yi geçmiyor.** Gerçek klipte medyan uyum %45 kötü ve geçerli
piksel 0,51'den 0,38'e düşüyor; sentetikte güvenlik metrikleri (GT engel ihlali)
kötüleşiyor. Varsayılan V2'de kaldı. DA3 yalnız ölçüm bayrağıyla açılır:
`--geometri model-da3 --yardimci` (yardımcı sunucu çalışıyor olmalı). Fotoğraf
yolundaki 1/(d+0,5·medyan) kayması SfM'in `1/z = a·d + b` uydurmasını bozacağı için
bu yol saf 1/d kullanır (`da3Kayma: 0`); bu da sonucu değiştirmedi.

## Otomatik yüzen temizleme ve erişilebilir boş alan (2026-10-23)

İki ek, PlayCanvas splat-transform'dan (MIT) uyarlandı:

- `yuzenTemizleme.ts` — `filterFloaters` mantığı CPU'da: voksel yoğunluğu
  (Beer–Lambert, opaklık ≥ 0,1 → dolu), hiçbir dolu voksel merkezine ≥ 1/255
  katkı vermeyen splat silinir. Sahne metrik olmadığı için voksel = oran × D
  (D = kameradan SfM noktalarına medyan uzaklık); yalnız kamera AABB'si ± D
  içindeki splat'lar değerlendirilir. `Egitim.yuzenleriTemizle()` tek
  `temizle` + geri alma jetonu; `egitimBaslat(…, { yuzenTemizle })` eğitim
  bitince çalıştırır. **Varsayılan kapalı.**
- `erisilebilirAlan` (bosAlan.ts) — eğitim kameralarından 6-komşulu doldurma;
  yalnız `bos` ve açıklığı ≥ yarıçap olan vokseller. `bosAlanSiniri(…, tohumlar)`
  maskeyi kurar, `serbestAdim` ek kısıt olarak uygular; arayüz güven kapısını
  (`serbestGezinmeUygun`) korur, üstüne başlangıç kamerasının erişilebilir
  olmasını ister. Çarpışma garantisi değildir.

Ölçüm: `--katman quick --kare 24 --iter 3000 --geometri model --trainer-seed 7
--yuzen 0.06,0.03,0.015,0.01 --chrome`, RTX 5070 Laptop (Chrome'un gördüğü GPU
"nvidia / blackwell"). Önce/sonra AYNI eğitilmiş modelde ölçülür (her oran
sonrası geri alınır), yani eğitim gürültüsü farka girmez. Aynı tohumla iki ayrı
koşunun ayrılan kare PSNR'ı 0,045 dB farklıydı.

| Klip | Oran | Voksel / D | Silinen / canlı | Ayrılan PSNR Δ | GT sonda PSNR Δ | Süre |
|---|---:|---:|---:|---:|---:|---:|
| sentetik | 0,06 | 0,06 | 13 / 72 683 | −0,002 dB | −0,004 dB | 92 ms |
| sentetik | 0,03 | 0,03 | 43 / 72 683 | −0,006 dB | −0,007 dB | 101 ms |
| sentetik | 0,015 | 0,015 | 128 / 72 683 | −0,001 dB | −0,010 dB | 660 ms |
| forest-3679072 | 0,015 | 0,015 | 23 / 51 142 | +0,000 dB | – | 1,3 sn |

Ayrılan SSIM ve sonda kaplaması dört basamakta değişmedi. Sonuç: bu kliplerde
temizlenecek yüzen neredeyse yok; silme gürültü içinde ve GT sondalarda hafif
negatif. Kabul kapısı (Gaussian sayısı belirgin düşsün, PSNR kötüleşmesin)
karşılanmadı; varsayılan kapalı kaldı. 600k splat'ta CPU süresi ~4 sn (ana
iş parçacığı) — açılırsa worker'a taşınmalı.

Erişilebilir alan (sentetik, V2 derinlik, yarıçap 0,04·yol): açıklık kümesi
51 239 → erişilebilir 50 312 voksel (−%1,8; hacim/birim³ 0,0703 → 0,0690).
Örneklenen GT ihlali 14/3008 → 14/2951: kalan ihlaller kameralara bağlı
bölgede, maske yeni ihlal eklemiyor ama mevcutları da gidermiyor. Orta bölge
yan mesafe 0,149 → 0,147 yol. Gerçek orman klibinde −%0,9. İki klipte de güven
kapısı kapalı (en kötü hizalama artığı yüksek), yani arayüzde serbest gezinme
zaten açılmazdı.

```powershell
node scripts/olc-gezinme.mjs assets/test-clips/sentetik-orman-yolu.webm --gt assets/test-clips/sentetik-orman-yolu.gt.json --etiket yuzen-b --katman quick --kare 24 --iter 3000 --geometri model --trainer-seed 7 --yuzen 0.06,0.03,0.015,0.01 --chrome
```
