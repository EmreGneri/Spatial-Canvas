# DAViD insan derinliği füzyonu (`?derinlik=david`)

Deneysel, varsayılan KAPALI. Sahne derinliği varsayılan zincirde kalır (DA3 yardımcı →
tarayıcı DA3 → V2-small); bitmiş derinlikte kişi maskesi içi DAViD şekliyle değiştirilir.
**Bu ölçüm bir kalite kazancı kanıtlamaz**: yer gerçeği yok, yalnız göz kararı.

## Model

- Microsoft DAViD (ICCV 2025), kod + ağırlık **MIT** (README: "DAViD models and runtime
  code are licensed under the MIT License"; model kartları MIT). SynthHuman verisi CDLA-2.0, dağıtılmaz.
- Tarayıcı: ViT-B/16, resmî FP32 ONNX, değiştirilmeden:
  - `depth-model-vitb16_384.onnx` 449 231 953 B, sha256 `c8dc4982…4b883b`
  - `foreground-segmentation-model-vitb16_384.onnx` 449 231 719 B, sha256 `2bf71a47…6c489d`
  - Kaynak: `https://facesyntheticspubwedata.z6.web.core.windows.net/iccv-2025/models/<dosya>`
    (MD5, sunucunun `Content-MD5` başlığıyla eşleşti). `VITE_DAVID_PHOTO=1 node scripts/fetch-assets.mjs` indirir.
- Giriş 512×512, BGR, [0,1], NCHW (model kartı). Çıktı: derinlik `[1,512,512]`, maske `[1,1,512,512]` (sigmoid, 0..1).
- Op'lar standart (MatMul, LayerNormalization, Erf, Softmax, Resize, ConvTranspose…); Chrome WebGPU'da FP32 sorunsuz.
- **FP16 kullanılmadı**: `onnxconverter_common` dönüşümü geçersiz graf üretti (Cast tip
  hatası) ve asıl sorun hassasiyet: ham derinlik tüm karede 0.418..0.429 (aralık ≈0.011).
  FP16'nın 0.42 civarındaki adımı ≈0.00024 → kişi bütün kareye ~45 seviye; şekil kaybolur.
- **Kutup ölçüldü**: ham derinlik YAKIN = BÜYÜK (öne uzanan el en parlak). Resmî runtime'daki
  `is_inverse` (-1) uygulanmaz; yanlış kutup füzyonun korelasyon kapısında reddedilir.

## Füzyon (`src/engine/vision/davidFuzyon.ts`)

Maske m = DAViD yumuşak maskesi ∩ uygulamanın özne maskesi (BiRefNet/IS-Net). Kesişim
şart çıktı: DAViD maskesi `d93ef…` karesinde sandalye ve duvar desenini de aldı (çekirdek %83).
Çekirdek (m ≥ 0.9) piksellerde ölçek = (p90−p10)sahne / (p90−p10)DAViD, kayma = medyan farkı;
çıktı = m·uydurulmuş + (1−m)·sahne. En küçük kareler bilerek yok: ölçeği r·σs/σd yapar,
sahne kişiyi düz gördükçe DAViD rölyefini küçültür (aynı gözlem `mergeSubjectDetail` başlığında).
Red (uyarı + füzyonsuz sonuç): çekirdek < %1, DAViD sabit/NaN, korelasyon < 0, oturum/çıkarım hatası.

Yüz rölyefi (MediaPipe, ×1.5) DAViD'den SONRA yine uygulanır (Engine değişmedi): rölyef oval
içinde şekli değiştirir, yani yüz iki yolda da ağdan gelir. Görsel karar: yakın portrede
(`HUUpP…`) rölyefsiz DAViD yüzü maske kenarında sert bir basamak ve abartılı burun verdi;
rölyefli hâli varsayılana yakın. Bilinen kusur: `HQ3…` karesinde rölyefli yüz DAViD saçının
önünde kopuk duruyor.

## Ölçüm (2026-10-24)

`node scripts/bench-david-real.mjs --chrome <fotoğraflar>`; çıktılar `olcum-out/david/browser/`
(gitignored). Satırlar: varsayılan + rölyef, DAViD + rölyef, DAViD rölyefsiz; sütunlar derinlik,
0°/45°/90° ortografik (yalnız özne noktaları, motorun `fillPositionsFromDepth`'i, kırpma yok).
Yardımcı kapalıydı → varsayılan sahne modeli V2-small (tarayıcı). Adaptör (`requestAdapter().info`,
Playwright Chrome): nvidia / blackwell; cihaz adı Chrome'ca gizlendi. Kullanıcının günlük
Chrome'unda iGPU'ya düşebilir (bkz. bellek notu) — süreler orada ölçülmedi.

| Foto | Çekirdek | Korelasyon | Gözlem |
|---|---:|---:|---|
| 0-HUUpP (yakın portre, yalnız yüz maskesi) | 0.23 | 0.84 | Rölyefle varsayılana yakın; rölyefsiz yüz kenarında basamak. |
| 1-66fe (öne uzanan el) | 0.28 | 0.76 | El gövdeden ayrılıp öne çıkıyor; varsayılanda el dizlerle/zeminle kaynaşık. Daha inandırıcı. |
| 2-d93ef (yüksek açı selfie, oturan) | 0.71 | 0.75 | **Kötü**: DAViD başı gövdenin ARKASINA koyuyor; varsayılanda baş en önde (kamera yukarıda, doğrusu bu). |
| 3-HQ3 (ayakta, diz üstü) | 0.45 | 0.46 | Gövde hacimli ve yuvarlak; karın/göğüs profilde abartılı şişkin. Yüz rölyefi önde kopuk. |
| 4-özüm (oturan, küçük özne) | 0.24 | 0.87 | Gövdeye göğüs/karın kavisi geliyor, saç arkaya düşüyor; varsayılan levha gibi. Daha inandırıcı. |
| 5-4658 (ayna selfie, yüz telefonla kapalı) | 0.12 | 0.72 | Gövde/kalça hacimli, telefon kolu önde; varsayılan ince. Yüz bulunamadı → rölyef yok. |

Özet: gövde düzlüğü şikâyetine 4/6 karede görünür katkı (66fe, özüm, 4658, kısmen HQ3);
1 karede açıkça yanlış (d93ef, baş/gövde sırası), 1 karede nötr (HUUpP). Genlik silüetten gelen
sahne yayılımına eşitlendiği için HQ3'te fazla; ayar düğmesi `DAVID_SINIR.altYuzde/ustYuzde`.

Süre (aynı makine, yerel dosya, ağ yok): iki oturumun kurulması 14.1–14.5 s (2×449 MB);
ilk çıkarım (iki model) 2.5–2.9 s; sıcak 0.5–1.6 s (iki koşu, 6 foto). `estimateDepth`
toplamları koşudan koşuya ±2 s oynadığı için fark olarak verilmedi. Üretimde asıl maliyet indirme: **~898 MB**. Yardımcı (DirectML, ORT 1.24.4,
ayrı venv) ViT-B derinlik sıcak 0.04 s/çağrı, CPU 1.0 s — yardımcı entegrasyonu YAPILMADI.

## Varsayılan yol değişmedi kanıtı

`node scripts/bench-david-real.mjs --chrome --hash <6 foto>`: `estimateDepth(FOTO_KALITE + özne
maskesi)` çıktısının SHA-256'sı 086b844'te (depth.ts dokunulmadan, iki koşu, belirlenimci) ve
bu dalda bayraksız aynı (6/6, ör. HUUpP `7397847e…`, 66fe `33a37f45…`). `FOTO_KALITE`
bayraksız `{ tileDetay: true, kenarHizalama: 0.5, model: 'da3-mono' }` (verify-david-fuzyon).
App/Engine/embed değişmedi; DAViD kodu dinamik `import()` ile yalnız bayrakla yüklenir.

## Açık riskler

- 898 MB tarayıcı indirmesi; mobil/iGPU'da bellek ve süre ölçülmedi.
- Yüksek/alçak kamera açısında baş-gövde sırası yanlış olabiliyor (d93ef); korelasyon kapısı
  bunu yakalamadı (0.75).
- Normal haritası ile yüksek frekans detayı denenmedi (opsiyoneldi; 3. 449 MB model).
- ViT-L (1.38 GB/model) yardımcı yolu denenmedi: bağlantı ≈0.6 MB/s, 2.7 GB indirme ≈75 dk.
