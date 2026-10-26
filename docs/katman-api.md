# Otomatik katmanlar: motor API'si

Katmanlar fotoğraf ve ana motorun video derinlik ızgarası içindir. Gerçek
3DGS eğitim görüntüleyicisine veya çok görüntülü füzyon sahnesine uygulanmaz.
Yeni arayüz eklenmedi; mevcut nesne ayırma davranışı korunur.

```ts
engine.setLayerGap(0.25);       // Ön +0.25, orta 0, arka -0.25 dünya z birimi.
engine.setLayerVisible(0, false); // 0 ön, 1 orta, 2 arka; geometriyi yeniden örneklemez.
console.log(engine.getLayers());  // Kaynak yoksa null; oran, eşik, boyut ve ayarlar.
engine.setLayerVisible(0, true);
engine.setLayerGap(0);          // Varsayılan konum üretimine geri dön.
```

`gap` sonlu ve 0–2 aralığında olmalıdır. Katman içinde mevcut z farklılıkları
korunur. Bu sanatsal bir ayrıştırmadır; gerçek mesafe ölçümü değildir.
Fotoğrafta katmanlar son kırpım ve yüz rölyefi sonrasında hesaplanır.
Özne maskesi varsa özne ön plandır, kalan derinlik histogramı iki kümeye
ayrılır. Maskesiz üç küme kullanılır. Sabit derinlikte orta katman seçilir.
Yumuşak ağırlıklar yalnız dar derinlik bandında hesaplanır; uzamsal bulanıklaştırma
ve mevcut depth-edge filtresine müdahale yoktur.
Gap açıkken farklı katmanları bağlayan kabuk üçgenleri çizilmez; aynı katmandaki
normaller korunur. Kesim sınırlarına yeni yan kapak üretilmez: açık katmanlar
kapalı, su geçirmez bir mesh dışa aktarımı olarak kullanılmamalıdır.

Varsayılan: `gap=0`, üç katman görünür. Konum dizileri ve shader kaynakları eski
yolla birebir aynıdır. Görünürlük kapalı değilse ek texture yüklenmez veya
shader örneklemesi yapılmaz. Video katmanları yalnız bir kontrol etkinse
hesaplanır. Video eşikleri EMA (0.1) ile izlenir; boyut/maske türü değişince
veya eşik sıçraması 0.2'yi geçince önceki eşikler bırakılır. Bu basit koruma
tam bir sahne kesimi algılayıcısı değildir.

Görünürlük uniform ile uygulanır; ilk gizleme shader varyantını derler,
sonraki görünürlük değişimleri yeniden örnekleme yapmaz. Üçü yeniden görünür
olunca özgün shader kaynağı geri yüklenir. Nokta, ASCII, neon, splat ve
solid/crystal yüzeyleri aynı kaynak UV'sini kullanır. Opak solid/crystal
malzemelerinde karışık sınır ağırlıkları tam saydamlık üretmez; sıfır ağırlıklı
katman fragmentleri atılır. `nesne ayırma` tarafından zaten gizlenen arka planı
katman görünürlüğü geri getirmez.

Ayarlar motor oturumuna aittir, preset'e kaydedilmez. Kaynak değişiminde katman
haritası ve eşik geçmişi bırakılır. Arayüz kaynak işleme tamamlandıktan sonra
`getLayers()` ile kontrolü etkinleştirebilir. Gap değişimi fotoğraf geometrisini
yeniden üretir; mevcut video karesini de hemen yeniler, sonraki karelerde
ayar korunur. Gap kolunu sürüklerken kesintisiz 60 Hz çağrı garantisi yoktur;
arayüz değişiklikleri seyrekleştirebilir veya bırakılınca uygulayabilir.

Kontroller: `node scripts/verify-layers.mjs`,
`node scripts/verify-layer-shaders.mjs`. İlk test eski HEAD'den alınmış SHA-256
konum parmak izleri, gap=0 özdeşliği, sabit z ofseti, maske ve EMA sözleşmesini
kontrol eder. Gerçek tarayıcı ölçümleri yerel teslim raporundadır.
