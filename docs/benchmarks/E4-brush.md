# E4 · eski surfel yolunun kısmi ölçümü

**Tarihsel kayıt (2026-09-23):** Aşağıdaki Spatial Canvas sayıları yalnız
`video → 3B` keyframe füzyonu/surfel yolunundur. 2026-09-24'te eklenen
`3D eğit` gerçek 3DGS yolunun süresi, splat sayısı veya PSNR'ı değildir.
Brush ile iki sütunlu karşılaştırma tamamlanmadı; bu tablo hız/kalite
üstünlüğü kanıtı olarak kullanılmaz. Yeni protokol
[yol haritasında](../yol-haritasi.md).

Klip: `public/nyc.mp4`, SHA-256 `d9dd01d211534911edea3f08fcb8367086a1bc0234b77072c2735c39bfd54ae4`.

| Ölçüt | Spatial Canvas `video → 3B` | Brush |
|---|---:|---:|
| Ham MP4 ile başlama | Evet | Hayır; COLMAP veya Nerfstudio veri kümesi gerekir |
| Bu koşuda yapılan kurulum adımı | 2 (MP4 yükle, `video → 3B`) | Ölçülmedi |
| Yakalama + işleme | 21.374 ms | Ölçülmedi |
| Splat | 52.252 | Ölçülmedi |
| Ayrılmış kare PSNR | Ölçülmedi | Ölçülmedi |

Spatial Canvas ölçümü uygulamanın kendi `performance.now()` süresidir ve sekiz
oynatma keyframe'ini yakalama, akış, poz ve füzyonu kapsar. Başlangıç yaklaşık
43,7 saniyelik oynatma konumuydu. Bu kareler dışa kaydedilmedi; sahne ölçeği
üçgenleme yetersizliği nedeniyle hesaplanamadı. Sayılar yalnız bu koşuya aittir.

Brush koşusu ve kalite karşılaştırması yapılmadı. [Brush'ın resmi README'si](https://github.com/ArthurBrussee/brush/blob/main/README.md)
eğitim girdisi olarak COLMAP veya Nerfstudio veri kümesi istiyor. Resmi
[v0.3.0 Windows çalıştırılabilir dosyası](https://github.com/ArthurBrussee/brush/releases/tag/v0.3.0)
geçici dizine indirildi ve `brush_app.exe --help` başarıyla çalıştı; bu
makinede aynı klibin pozlu görüntü veri kümesi bulunmadı. Aynı MP4'ün farklı kareleriyle
iki süreyi yan yana yazmak, ya da Brush'ın yayımlanmış başka bir sahne PSNR'ını
bu klibin sonucu gibi göstermek geçersiz olur. Bu **eski surfel koşusunda**
ayrılmış kare çizimi olmadığı için PSNR hesaplanmadı. Yeni `3D eğit` yolu
kendi renderer'ında ayrılmış kare PSNR'ı hesaplıyor; onun koşuları bu
tablodaki değerlerle karıştırılmamalı.

Tekrarlanabilir tam karşılaştırma için aynı keyframe görüntülerini ve kamera
pozlarını bir kez dışa aktarın, kare kümesini SHA-256 ile sabitleyin, Brush'ı
aynı veri kümesiyle eğitin ve iki ürünün çıktılarını aynı ayrılmış karede aynı
çözünürlük/renk uzayında ölçün. `scripts/compare-brush.mjs` klip hash'ini
kontrol eder; kare kümesi hash'i eşleşmeden kalite üstünlüğü yazmaz. Brush
koşusu JSON'u verildiğinde rapor yeniden üretilir:

```powershell
node scripts/compare-brush.mjs public/nyc.mp4 docs/benchmarks/e4-spatial-nyc.json <brush-run.json>
```
