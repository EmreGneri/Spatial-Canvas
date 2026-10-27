# Fotoğraf hazırlığı ve dışa aktarım ölçümü

## Vercel indirme yolu

DAViD int8 maskesi, sabit revizyon ve SHA-256 ile build listesine eklendi. Tarayıcı aynı dosyayı önce `/models/microsoft-david/<revision>/...` adresinden alır; Vercel HTTP sıkıştırması uygulayabilir. Dosya yoksa mevcut Hugging Face adresine geri döner. Önceki ziyaretçinin HF anahtarı altında önbelleklenmiş aynı dosyası varsa yeniden indirilmez. Model ağırlıkları değişmedi. `fetch-assets` ve `npm run build` yerelde çalıştırılmadı; mevcut yerel dosyanın SHA-256 değeri uzak depo metadatasıyla eşleştirildi.

Canlı video modeli ısıtması artık yalnız kamera/video kaynağı olduğunda çalışır; açılışta ve fotoğraf yüklerken ayrı canlı model oturumu kurulmaz.

## Erken önizleme

Varsayılan fotoğraf yolu, sahne modelinin ilk çıkarımını maskelerden önce gösterir. Aynı çıkarım sonucu nihai kalite hattında yeniden kullanılır; BiRefNet, DAViD, parça/özne/baş ayrıntıları ve yüz rölyefi daha sonra tamamlanır. Önizleme sırasında arayüz bunu belirtir ve dışa aktarma düğmeleri nihai sonuç hazır olana kadar kapalıdır. Deneysel MoGe ve perspektif kalibrasyonu mevcut sırayı korur. Karşılaştırma için `?onizleme=0` eski sırayı kullanır.

BiRefNet'in gerekli dosyası fotoğraf yüklenirken derinlik dosyasıyla paralel indirilir. Paylaşılan tek indirme sonucu oturum kurulurken tüketilir; GPU kurulumu ve çıkarımı önizleme sonrasında aynı sırayı kullanır. Böylece önizleme için nihai kaliteye giden indirmeler gereksiz yere art arda bekletilmez. Yardımcı çalışıyorsa, WebGPU yoksa veya BiRefNet zaten hazırsa bu indirme başlatılmaz.

Fotoğrafın kalite hesabı sırasında tam hızlı sahne animasyonu GPU'ya iş göndermeyi bırakır; önizleme saniyede bir yeniden çizilir. Tamamlanma, hata ve kaynak değişiminde normal çizim geri açılır. Nihai çıktı veya bitmiş sahnenin animasyon hızı değiştirilmez.

`metadata.previewReadyMs` önizleme geometrisinin hazırlanmasına kadar geçen süredir; GPU'nun fiziksel ekrana sunduğu kare zamanı değildir. `totalMs` nihai kalite hazır olana kadar devam eder. `depth.pipeline` artık ertelenen maske hattını da kapsayabilir; aşama sürelerini toplamayın. Bu değişiklik ilk görünen sonucu erkene alır; nihai dışa aktarımın hızlandığı ayrıca ölçülmeden iddia edilmez.

`?olcum=1` ölçümü açar. Örneğin `http://localhost:5173/?olcum=1` veya mevcut sorguya `&olcum=1` eklenir. Ölçüm model seçimini, kaliteyi veya işlem sırasını değiştirmez; hazırdaki işlemleri süreler ve mevcut tarayıcı kayıtlarını okur. Bu bayrak dışında oturum/Resource Timing observer kurulmaz.

Raporlar yalnız bu sayfanın belleğinde tutulur:

```js
window.__photoMeasurements?.at(-1)
window.__outputMeasurements?.at(-1)
```

Console kayıtları `[photo-measurement]` ve `[output-measurement]` öneklerini kullanır. En fazla son **10** rapor saklanır. Rapor gönderilmez; otomatik dosya veya model indirilmez. Kaynak URL'lerin kullanıcı/parola, query ve hash bölümleri rapordan çıkarılır; host ve sürüm içerebilen yol korunur. Sayfa yenilenince geçmiş kaybolur.

## Fotoğraf oturumu

```ts
import { beginPhotoMeasurement, currentPhotoMeasurement } from './engine/photoMeasurement.ts';

const trace = beginPhotoMeasurement({ generation: 1, width: 1122, height: 1402 });
const result = trace
  ? await trace.measure('photo.stage', () => existingOperation())
  : await existingOperation();
trace?.finish('ready', { backend: 'existing-backend' });
```

`beginPhotoMeasurement(meta, enabled?)`, bayrak kapalıysa `null` döner. İkinci argüman Node doğrulaması için açık/kapalı seçimini sabitler; uygulama bayrağı kullanır. `currentPhotoMeasurement()` yalnız hâlen açık oturumu döndürür. Asenkron yükleyici bu referansı **ilk await'ten önce** yakalamalıdır; işlem tamamlandığında yeniden global oturum okunursa eski fotoğrafın işi yeni fotoğrafa yazılabilir.

`measure(name, asyncOperation)` ve `measureSync(name, operation)` işlemin değerini ve fırlattığı hatayı korur. `finish('ready' | 'failed' | 'cancelled', metadata?)` raporu sonlandırır, observer'ı bırakır ve tekrar çağrılırsa aynı raporu döndürür. Yeni oturum başlatılması açık eski oturumu `cancelled` yapar. Bitiş sırasında hâlen çalışan span'ler o anda kesilmiş süreleriyle `cancelled` yazılır; gerçek işlem iptal edilmez. Eski oturuma geç gelen span/indirme kayıtları son raporu veya yeni oturumu değiştirmez.

Rapor alanları:

- `id`: sayfa içi artan ölçüm kimliği; `meta`: kaynak kuşağı ve boyutları.
- `startedAt`, `endedAt`: `performance.now()` zaman çizgisinde milisaniye; `totalMs`: oturumun duvar saati süresi.
- `status`, `metadata`: hazırlık sonucu ve çağıranın verdiği kısa tanı bilgileri.
- `spans`: aşama adı, başlangıç/bitiş, `durationMs`, `ok/failed/cancelled` durumu. Kayıt sırası tamamlanma sırasıdır.
- `downloads`, `downloadBytes`: aşağıdaki bilinen yükleyici gövde okumaları.
- `resources`, `resourceBytes`: aşağıdaki bağımsız Resource Timing gözlemi.

İç içe aşamalar **kapsayıcıdır**. Örneğin ana derinlik işlemi altındaki model çalıştırma sürelerini de içerir. Span sürelerini toplayıp toplam bekleme süresi diye sunmayın; gerçek toplam `totalMs`'tir. `ready` sınırının hangi uygulama aşamasında çağrıldığı, rapordaki aşama adları ve metadata ile birlikte değerlendirilmelidir; salt inference süresi değildir.

Uygulamadaki pencere, çözülmüş fotoğraf `run()` işlemine girince başlar ve
geometri/tohumlama bitince kapanır. Dosya seçimi, görüntü çözme ve ilk ekran
karesinin sunulması bu toplama dahil değildir. `geometry.*` süreleri CPU
işi ve GPU komutu gönderiminin duvar saatidir; GPU timestamp ölçümü değildir.
`depth.main/tile/subject/head` estimator çağrılarına ön/son işlem dahildir;
`mask.*.run`, `david.*.run` doğrudan ORT çağrısıdır. Kuyruk bekleme bu alt
span'lerin dışında, kapsayıcı pipeline süresinin içindedir. Yanlış veya eksik
modelde fallback kurulumu estimator çağrısının içine girebilir. Deneysel MoGe
için ayrı kernel span'i eklenmedi; yalnız kapsayıcı pipeline görülür.

## Baytların anlamı

Yükleyici aşağıdaki kayıt API'sini kullanır:

```ts
trace?.recordDownload({
  url, label, source: 'fetch', bodyBytes,
  startedAt, endedAt, status: 'ok',
});
```

`source: 'cache-storage'`, uygulamanın Cache Storage yanıtından okuduğu gövdedir. `source: 'fetch'`, fetch yanıtından okunan gövdedir; fetch tarayıcının HTTP önbelleğini kullanmış olabilir. Bu nedenle **fetch gövde baytı = internetten indirilen bayt** denmez. Yarım kalmış okumaların bilinen gövde baytları da `status: 'failed'` ile kayda ve toplama katılır.

`downloadBytes.cacheStorageBodyBytes` ve `downloadBytes.fetchBodyBytes` bilinen bu iki gövde okuma toplamıdır. HTTP başlıklarını kapsamazlar. Aynı model tekrar okunursa iki gerçek okuma olarak görünür; benzersiz model dosyalarının disk boyutu değildir.

Resource Timing kaydı, başlangıcı fotoğrafın `[startedAt, endedAt]` penceresinde kalan istekleri kapsar. Arka plan işlerini de içerebilir; önceden başlayıp pencere içinde bitenleri kapsamaz. Observer ve tarayıcı tamponundan iki kez gelen aynı kayıt tekilleştirilir.

- `transferBytes > 0`: tarayıcının bildirdiği HTTP başlıkları dahil transfer boyutu. `resourceBytes.observedTransferBytes` bu gözlenebilen pozitif değerleri toplar.
- `transferBytes: null`: tarayıcı `transferSize=0` bildirmiştir; önbellek, görünürlük sınırı veya cross-origin `Timing-Allow-Origin` eksikliği ayırt edilemiyor. **Önbellek isabeti diye sayılmaz.** `unknownTransferCount` bu kayıtların sayısıdır.
- `encodedBodyBytes` / `decodedBodyBytes`: tarayıcının verdiği ek gövde boyutları; cross-origin kısıtında sıfır olabilir.

**Yükleyici gövde toplamını Resource Timing transfer toplamına eklemeyin.** Aynı istek iki farklı katmandan gözleniyor olabilir. Sunucu tarafında zaten yüklü DirectML modelleri tarayıcıya taşınmaz; yardımcı HTTP yanıtı tarayıcıdan gözlenebilir, sunucunun disk/model yükleme miktarı bu rapordan çıkarılamaz.

## Dışa aktarım

`measureOutput(format, task, metadata?)` ayrı `window.__outputMeasurements` kaydı üretir. Bayrak kapalıysa doğrudan `task()` döner; ekstra Promise sarımı eklenmez. Açıkken `wallMs`, `ok/failed` durumu ve en son `ready` fotoğraf oturumunun `lastPhotoId` değeri kaydedilir. Fotoğraf hazırlık toplamına eklenmez.

Bu ölçüm kapsanan fonksiyonun duvar saati süresidir. PNG `toBlob` çevresiyse blob üretimini; WebM kayıt fonksiyonunun çevresiyse gerçek zamanlı kayıt, kare bekleme ve tamamlama işlemlerini birlikte kapsar. WebM duvar süresini **salt codec/encoding maliyeti** olarak yorumlamayın. `lastPhotoId` son başarılı hazırlıktır; dışa aktarılan medyanın kimliğiyle kesin eşleştiği iddiası değildir.

## Doğrulama

```powershell
node scripts/verify-photo-measurement.mjs
```

Test; açık/kapalı davranışı, senkron/asenkron hatalar, iç içe aşamalar, resource tekilleştirme ve bilinmeyen transfer, ayrı cache/fetch gövde toplamları, URL temizleme, iptal/supersede temizliği, geç olay izolasyonu, sınırlı geçmiş ve ayrı dışa aktarım ölçümünü sahte saat/kayıt sınırında doğrular. Model çıktısı taklit edilmez ve ağ isteği yapılmaz.
