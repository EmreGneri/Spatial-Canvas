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

## gsplat düzenleyicileri: ölçek/opaklık L1, AbsGS, sert bütçe (2026-10-24)

Kaynak: nerfstudio-project/gsplat (Apache-2.0) — `losses.py`
(`opacity_reg_loss`, `scale_reg_loss`), `strategy/default.py` (`absgrad`),
`strategy/mcmc.py` (`cap_max`). Her biri ayrı seçenek; bench bayrakları
`--opacity-reg W`, `--scale-reg W`, `--abs-grad TAU`, `--max-splats N`.

Eğiticide zaten olan / yeni olan:

- **Opaklık L1** — zaten vardı (`opacityReg`, eski motorda varsayılan 0,01).
  gsplat: `L += w·mean(σ(o))`; bizde Adam çekirdeği (`shaders.js`) logit
  gradyanına `w·σ(1−σ)` ekler. Fark: gsplat `mean()` (splat başına w/N), bizim
  kayıp piksel toplamı olduğu için ağırlık splat başına sabit; aynı sayı aynı
  güç DEĞİL, değerler deneysel taranır.
- **Ölçek L1** — zaten vardı (`scaleReg`, varsayılan 0). gsplat:
  `L += w·mean(exp(s))`; bizde log-ölçek gradyanına `w·exp(s)`. Yalnız
  bench/oturum geçişi eklendi.
- **AbsGS** — yeni (`opts.absGrad = tau`, `trainer.js` `_refineLegacy`). Render
  geçişi zaten piksel başına `|∂L/∂μx| + |∂L/∂μy|` toplamını gradP yuva 12'ye
  yazıyordu (mutlak değer toplamdan ÖNCE: zıt işaretli piksel gradyanları
  birbirini silmez). `absGrad` açıkken istatistik derlenir (`useStats`), refine
  bunu gather ile okur; büyüme donörleri `istatistik ≥ tau × medyan` olanlarla
  sınırlanır (growRegion ile kesişim), büyüme sayısı aday sayısını aşmaz;
  taşıma (relocation) etkilenmez. gsplat mutlak `grow_grad2d` eşiğini absgrad
  için 0,0002 → 0,0008 (×4) yükseltir; bizim kayıp normalize olmadığından
  mutlak eşik taşınamaz, medyana göreli eşik bu ×4'ü kendiliğinden emer
  (`_refineV3` ile aynı yol). Sapma: pencere toplamı görünür görüş sayısına
  bölünmez.
- **Sert bütçe** — zaten vardı: `cap = min(n0·capMult, maxSplats)`, büyüme
  `limit − n` ile kesilir, cap doluyken MCMC taşıması sürer. growRegion/absGrad
  yalnız donör havuzunu daraltır, tavanı değiştirmez (`verify-gs-duzenleyici`
  bunu sınar).

Ölçüm: `--katman quick --kare 24 --iter 3000 --trainer-seed 7 --chrome
--geometri model` (+ eşleşmiş `--trainer-seed 11`), RTX 5070 Laptop
(Chrome'un gördüğü adaptör `nvidia / blackwell`). Ayrılan kare ortalaması.
Aynı ayarla taban tekrarı: sentetik 35,298 / 35,257 (0,041 dB), orman
34,076 / 34,096 (0,020 dB). Eğitim süresi aynı GPU'yu paylaşan başka işler
yüzünden ±3 sn oynuyor; yalnız tutarlı eğilim olarak okunmalı.

| Klip / tohum | Seçenek | PSNR | SSIM | Gaussian | Eğitim |
|---|---|---:|---:|---:|---:|
| sentetik / 7 | taban (2 koşu ort.) | 35,278 | 0,9443 | 78 531 | 16,3 sn |
| sentetik / 7 | scale-reg 0,01 | 35,706 | 0,9462 | 78 531 | 15,3 sn |
| sentetik / 7 | **scale-reg 0,1** | **35,714** | **0,9489** | 78 531 | 13,0 sn |
| sentetik / 7 | opacity-reg 0 (varsayılan 0,01 yerine) | 35,211 | 0,9464 | 78 531 | 18,5 sn |
| sentetik / 7 | opacity-reg 0,05 | 35,365 | 0,9412 | 78 531 | 17,4 sn |
| sentetik / 7 | abs-grad 1 | 35,395 | 0,9442 | 78 531 | 19,9 sn |
| sentetik / 7 | abs-grad 2 | 35,482 | 0,9440 | 78 531 | 19,5 sn |
| sentetik / 7 | abs-grad 4 | 35,373 | 0,9439 | 78 531 | 20,6 sn |
| sentetik / 7 | max-splats 70 000 | 35,063 | 0,9411 | 70 000 | 19,1 sn |
| sentetik / 7 | max-splats 65 000 | 34,810 | 0,9388 | 65 000 | 25,6 sn |
| sentetik / 7 | scale-reg 0,1 + abs-grad 2 | 35,544 | 0,9480 | 78 531 | 12,7 sn |
| sentetik / 11 | taban | 35,257 | 0,9423 | 78 531 | 15,6 sn |
| sentetik / 11 | **scale-reg 0,1** | **35,416** | **0,9469** | 78 531 | 11,6 sn |
| sentetik / 11 | abs-grad 2 | 34,957 | 0,9421 | 78 531 | 17,2 sn |
| sentetik / 11 | scale-reg 0,1 + abs-grad 2 | 35,375 | 0,9465 | 78 531 | 12,5 sn |
| orman / 7 | taban (2 koşu ort.) | 34,086 | 0,8857 | 79 816 | 27,8 sn |
| orman / 7 | scale-reg 0,01 | 34,077 | 0,8853 | 79 816 | 25,0 sn |
| orman / 7 | **scale-reg 0,1** | **34,106** | 0,8832 | 79 816 | 22,9 sn |
| orman / 7 | abs-grad 2 | 34,265 | 0,8864 | 79 816 | 29,6 sn |
| orman / 7 | scale-reg 0,1 + abs-grad 2 | 34,003 | 0,8844 | 79 816 | 25,0 sn |
| orman / 11 | taban | 33,918 | 0,8823 | 79 816 | 27,2 sn |
| orman / 11 | **scale-reg 0,1** | **34,073** | **0,8831** | 79 816 | 23,2 sn |
| sentetik / 7 | yeni varsayılan (bayraksız) | 35,733 | 0,9494 | 78 531 | 11,9 sn |

Kabul kapısı (PSNR gürültü ötesinde kötüleşmesin VE sayı düşsün ya da PSNR
artsın):

- **scale-reg 0,1: GEÇTİ → varsayılan açık** (`egitimOturumAyari`,
  `VARSAYILAN_SCALE_REG`). Dört eşleşmiş çiftte PSNR +0,44 / +0,16 / +0,02 /
  +0,16 dB, hiçbiri negatif; SSIM üçünde arttı, ormanda tohum 7'de −0,0025.
  Eğitim her çiftte ~%15–20 kısa (küçük splat'lar daha az döşeme girişi).
  Gaussian sayısı değişmez (büyüme takvimi sabit, düzenleyici budamaz).
  0,01 sentetikte benzer, ormanda etkisiz; 0,1 seçildi. `--scale-reg 0` eski
  davranışı verir.
- **opacity-reg**: varsayılan 0,01 korunur; 0 ve 0,05 gürültü içinde/karışık
  (0,05 SSIM −0,003).
- **abs-grad: KALDI, varsayılan kapalı.** Tohum 7'de +0,20 (sentetik) ve
  +0,18 (orman), ama sentetik tohum 11'de −0,30; scale-reg ile birlikte her
  koşuda scale-reg'in tek başınasından kötü. Sayıyı da düşürmedi: istatistik
  ağır kuyruklu, tau 4'te bile aday sayısı büyüme kotasını (%15·n) aşıyor,
  yani yalnız donörleri yeniden yönlendiriyor.
- **Sert bütçe**: beklendiği gibi sayıyı sınırlar ama kalite bedeli var
  (70k −0,22, 65k −0,47 dB) → kazanç değil, değiş tokuş; mevcut
  `maxSplats` seçeneği olarak kalır. Basit MCMC taşıması zaten vardı.

Doğrulama: `node scripts/verify-gs-duzenleyici.mjs` (seçenek geçişi, AbsGS
donör havuzu, cap + growRegion + absGrad), `verify-grow-region.mjs`
(`absGrad` yokken eski `_refineLegacy` ile birebir).

```powershell
node scripts/olc-gezinme.mjs assets/test-clips/sentetik-orman-yolu.webm --gt assets/test-clips/sentetik-orman-yolu.gt.json --etiket sr --katman quick --kare 24 --iter 3000 --trainer-seed 7 --chrome --geometri model --scale-reg 0.1
```
