# Çekim kalitesi: tamamlanan karşılaştırma (2026-10-24)

7. maddedeki yarım kalan kod, `gs-cekim` çalışma kopyasındaki kaydedilmemiş
değişikliklerden kurtarıldı. Önceki taban/pozlama koşuları korundu; kabul kararı
için 6. maddenin yeni varsayılanı `scaleReg=0.1` üzerinde yeni eşleşmiş koşular
alındı. [Sayısal kanıt](data/cekim-kalitesi-2026-10-24.json).

## Kullanıcıya açık davranış

- 20 saniyeden kısa çekimde kapsama hatırlatması; bu bir kalite garantisi veya
  eğitime başlama engeli değildir.
- SfM sonrasında düşük kamera yer değiştirmesiyle birlikte yüksek dönme varsa
  yerinde dönme uyarısı. Taranan karelerin %25'inden fazlası komşularına göre
  bulanık işaretlendiyse bulanıklık uyarısı. Mutlak netlik eşikleri kullanılmaz.
- Bilinmeyen geometri ölçüleri uyarı üretmez; sorunsuz çekimde not çizilmez.
- Eğitim varsayılanındaki ölçek cezası 0.1; AbsGS kapalı. 6. maddenin iki
  klip/iki tohum ölçümleri `gezinme-entegrasyon.md` içinde korunuyor.

## Deneysel yollar

`olc-gezinme.mjs --secim netlik`, mevcut seçicinin kare bütçesi ve seçtiği
kesintisiz çekim içinde eşit zaman kutularının en net adaylarını alır.
Bulanık işaretli aday ancak kutuda başka aday yoksa seçilir. Yeni bir 100–300
kare zorlaması yapılmaz: cihazın mevcut bütçesi korunur. Normal arayüzdeki
seçici değişmez.

`--pozlama`, SfM noktalarının eğitim karelerindeki renk oranlarından kanal
kazançları kestirir. Ölçüm için ayrılmış karelerden renk gözlemi alınmaz;
hedefleri de değiştirilmez. Az gözlemde kazanç 1, düzeltme en fazla 1.5 kat.
Pozlama dengeleme varsayılan kapalıdır.

## Ölçüm protokolü

Görünür Chrome, `nvidia / blackwell`, sidecar otomatik başlatma kapalı;
sentetik orman yolu, quick, 24 eğitim + 6 ayrılmış kare, 3000 adım,
`trainer-seed=7`, `geometri=model`, `scaleReg=0.1`. Ayrılmış kare zamanları
aynıdır. PSNR ve SSIM satırları bu altı karenin aritmetik ortalamasıdır.
Parlaklık hizalanmış PSNR, her ayrılmış görüntüde kanal başına tek kazançla
hizalama yapar; ham PSNR ayrıca korunur. Bu hizalama yalnız değerlendirmededir.

Önceki NYC tabanında yalnız 2/30 kamera kaydedilebildi. Bu klip seçenekler
arasında geçerli bir kalite karşılaştırması sayılmadı. Sonuç üretmeden açık
kalmış NYC pozlama süreci ve yalnız ona ait tarayıcı çocukları kapatıldı.
Koşuların eğitim süreleri performans karşılaştırması olarak kullanılmaz:
başta bu eski GPU işi de açıktı. Hız veya iGPU bellek kazancı iddia edilmez.

| Yeni koşu | Kayıt | Ham PSNR ↑ | Hizalı PSNR ↑ | SSIM ↑ | Splat |
|---|---:|---:|---:|---:|---:|
| Taban | 30/30 | 35.665 | 35.918 | 0.94909 | 78 531 |
| Pozlama | 30/30 | 35.620 | 35.784 | 0.94812 | 78 531 |
| Netlik seçimi | 30/30 | 35.658 | 35.784 | 0.94299 | 77 627 |

Karar: iki deneysel yol da **varsayılan kapalı** kalır. Pozlama hizalı PSNR'da
0.133 dB geride; netlik seçimi ham PSNR'ı değiştirmiyor ama SSIM'i 0.0061
düşürüyor. Bu tek sentetik çift kesin bir genelleme değildir; açmak için kazanç
kanıtı da değildir. Önceki gerçek kliplerin yalnız ham PSNR'ı var: ormanda
34.166→32.180, deniz fenerinde 31.786→30.963. Pozlama değiştiğinden bu eski
sayılar hizalı kalite kararı gibi sunulmaz; JSON'da tarihsel kanıt olarak tutulur.

## Sınırlar

Bu çalışma LPIPS veya Intel üzerinde eğitim ölçümü eklemez. Sentetik netlik
koşusu, bulanık gerçek video üzerindeki kazancı kanıtlayamaz. Pozlama için
örtülme ve görüş yönüne bağlı renkler yanlış kazanca yol açabilir; bu nedenle
testleri geçmesi varsayılan açılması için yeterli değildir. MoGe ve VDA'nın
URL bayraklarıyla açılma davranışı korunur; bu çalışma onları varsayılan yapmaz.

## Tekrarlama

```powershell
node scripts/olc-gezinme.mjs assets/test-clips/sentetik-orman-yolu.webm --gt assets/test-clips/sentetik-orman-yolu.gt.json --etiket cekim-taban --katman quick --kare 24 --iter 3000 --trainer-seed 7 --chrome --basli --geometri model
# Aynı komuta --pozlama veya --secim netlik ekleyin; ayrı etiket kullanın.
```

Doğrulamalar: `verify-pozlama-dengeleme`, `verify-kare-secimi`,
`verify-cekim-notlari`, `verify-gs-duzenleyici`, `verify-gezinme-training-bench`.
Pozlama testi bilinen kazançları, örtülme aykırılarını, sabit pozlamayı,
kırpmayı, kayıp dışı piksel nöbetçisini ve ayrılmış karelerin hariç tutulmasını
sınar. Arayüz testi uyarıların eğitimi engellemediğini de kontrol eder.
