# Maske ölçümü: delik doldurma (DAVIS 2017)

Tarih: 2026-10-10 · Araç: `scripts/olc-maske.mjs` (+ `src/bench/maskeSayfasi.ts`, `src/bench/maskeOlcut.ts`)

## Soru

Özne maskesindeki kapalı delikleri derinlik sürekliliğiyle doldurmak (`delikleriDoldur`,
`src/engine/reconstruction/maskeDelik.ts`) maskeyi iyileştiriyor mu, yoksa gerçek
boşlukları mı dolduruyor? Tek bir fotoğrafta (d93ef…) işe yaramıştı; genelde?

## Yöntem

DAVIS 2017 trainval 480p (annotations CC BY 4.0; tüm nesneler tek ön plan, DAVIS 2016
gibi). A = IS-Net maskesi (uygulamanın video yolu). B = A + yalnız doldurulan pikseller
(çözünürlük farkı karışmasın diye). J = IoU, F = kontur F (tolerans 0,008·köşegen; resmi
araçtan tek fark: görüntü kenarındaki ön plan pikselleri kontur sayılıyor — A ve B için
aynı, karşılaştırmayı etkilemez). Derinlik: tarayıcı V2-small.

## Sonuç

| Bölüm | Kare | A J&F | B J&F | Doldurma isabeti | B < A dizi |
|---|---|---|---|---|---|
| val (her 5. kare) | 405 | 0,681 | 0,677 | %16,2 | 21 / 30 |
| train (her 10. kare) | 441 | – | – | %22,2 | – |

Delik başına kayıt (val 555, train 521 delik): deliklerin piksel bazında yalnız
%15 (val) / %21 (train)'i gerçekten özne. Derinlik farkı, delik alanı, model olasılığı
ve birleşimleriyle hiçbir kural iki bölümde birden %35 isabeti geçmedi
(`fark ≤ 0,01`: train %52, val %21 — tutarsız).

**Karar:** delik doldurma video yoluna uygulanmadı; fotoğraf yolunda varsayılan
**kapalı** (`estimateDepth(..., { delikDoldur: true })` ile bilerek açılır).
Zor kadrajlarda maskeyi asıl iyileştiren yol yerel yardımcıdaki BiRefNet (sidecar/README.md).

## Yeniden çalıştırma

```powershell
node scripts/olc-maske.mjs --davis <DAVIS kökü> --adim 5 --etiket maske-val --chrome
node scripts/olc-maske.mjs --davis <DAVIS kökü> --bolum train --adim 10 --etiket delik-train --delik-kaydi --chrome
```

## Tarayıcı BiRefNet: devam ölçümü (2026-10-23)

Önceki çalışma `d439be2` commit'inde entegrasyonu tamamlamış, DAVIS verisi
olmadığı için kalite ölçümünü tamamlayamamıştı. Veri artık
`C:\Users\Emre\datasets\DAVIS` altında. Çalışma kopyası
`.claude/worktrees/agent-aa5c90a7f2366712b`, dal
`worktree-agent-aa5c90a7f2366712b`; ana checkout değiştirilmedi.

### Model ve dağıtım

- Seçilen dosya: `public/models/jiabins0303/birefnet-lite-1024-webgpu/onnx/model_fp16.onnx`.
- Kaynak: [sabit revizyondaki model](https://huggingface.co/jiabins0303/birefnet-lite-1024-webgpu/resolve/1ad01cef0f4101a285c5a3e0bd7f15597d93403f/onnx/model_fp16.onnx).
- Boyut: **114.834.127 bayt**; yerel dosyada yeniden doğrulandı.
- SHA-256: `4059896039dfccb0f15b9080ff06d11d90e499449bb045e797055eb8901cf5f4`;
  yerel dosya [model kartındaki](https://huggingface.co/jiabins0303/birefnet-lite-1024-webgpu) özetle eşleşiyor.
- Girdi `input_image`: float32 `[1,3,1024,1024]`, kareye esnetilmiş RGB,
  ImageNet normalizasyonu. Çıktı `output_image`: float32 `[1,1,1024,1024]`
  logit; sigmoid uygulanıyor. Bu dosya sabit 1024 çözünürlüklü; 512 ölçülmedi.
- [jiabins0303 deposu](https://huggingface.co/jiabins0303/birefnet-lite-1024-webgpu/tree/main):
  `README.md` (8.739 bayt), `.gitattributes` (1.519 bayt), `config.json` (81 bayt),
  `preprocessor_config.json` (391 bayt), `onnx/model_fp16.onnx` (114.834.127 bayt),
  `scripts/patch_deform.py` (10.792 bayt), `scripts/patch_split.py` (6.195 bayt),
  `scripts/verify_patch.py` (3.233 bayt). Liste HF API ile yeniden doğrulandı.
  Ayrı `LICENSE` dosyası yok; kart metadata'sı ve lisans bölümü **MIT** diyor.
- Alternatif [runes deposu](https://huggingface.co/runes/birefnet-lite-webgpu/tree/main):
  `.gitattributes` (1.519 bayt), `README.md` (3.044 bayt),
  `birefnet_lite_webgpu_fp16.onnx` (**123.224.205 bayt**, HF API ile doğrulandı).
  Kart metadata'sı **MIT**; ayrı `LICENSE` yok.
  Seçilen model çalıştığı için alternatif indirilmedi ve ölçülmedi.
- **Eğitim verisi uyarısı:** jiabins0303 kartı DIS5K veri setinin ticari kullanım
  kısıtlamasını açıkça belirtiyor. MIT beyanı eğitim verisine ilişkin belirsizliği
  gidermiyor. Aynı not notices üreticisinde ve `THIRD_PARTY_NOTICES.txt` içinde.
- `fetch-assets.mjs` revizyonu ve beklenen byte sayısını sabitliyor; hygiene
  kontrolü model adı ve DIS5K bildirimini doğruluyor.

Fotoğraf sırası yardımcı BiRefNet → tarayıcı BiRefNet → IS-Net; video IS-Net.
Yeni model klasörü worktree içinde gerçek klasör, mevcut model klasörleri ve
runtime klasörleri ana checkout'a junction. Junction hedeflerini değiştiren
`fetch:assets` bu çalışma kopyasında çalıştırılmadı. `npx vite build` başarılı;
`dist/models/.../model_fp16.onnx` dosyası da 114.834.127 bayt.
`fetch-assets.mjs` ayrıca `.bench-tmp/fetch-assets-check` içinde, ağırlıklar ve
runtime kaynakları gerçek dosyalara kopyalanarak çalıştırıldı: başarılı.
Bu kontrol hazır ağırlıkları atlama, runtime kopyalama ve mirror adımlarını
kapsar; internetten sıfırdan indirme kolunu kapsamaz.

Dağıtım denenmedi. [Vercel limits](https://vercel.com/docs/limits) belgesindeki
100 MB (Hobby) / 1 GB (Pro) sınırı CLI ile **kaynak yüklemeye** ilişkin;
build sırasında indirilen bu dosyanın kesinlikle yasak olduğu sonucu bundan
çıkarılamaz. Git tabanlı gerçek Vercel build'i ve modelin HTTP üzerinden
sunulması bu görevde doğrulanmadı. Model fotoğraf başına indirilmez, oturumda
saklanır; ilk ziyaretçinin internetten 114,8 MB indirme maliyeti ayrıca vardır.

### Ölçüm yöntemi

```powershell
node scripts/olc-maske.mjs --davis C:/Users/Emre/datasets/DAVIS --adim 5 --etiket birefnet-val-20261023 --chrome --birefnet
```

30 val dizisi, her 5. kare, toplam 405 kare. A mevcut tarayıcı IS-Net/video
yolu; C fotoğraf yolu (BiRefNet ve gerektiğinde IS-Net yedeği dahil). Yardımcı
`SIDECAR_OTOMATIK=0` ve `?inference=browser` ile kapalı. İki yöntemde de
uygulamanın aynı bileşen temizliği, genişletme ve kenar yumuşatması çalışıyor.
J/F tanımları yukarıdaki ölçümle aynı; bu bir resmi DAVIS leaderboard sonucu
değil. Gecikme `segmentForeground` çağrısının tamamı; ilk çağrı yerel sunucudan
model aktarımı, derleme ve ilk çıkarımı içerir, internet/Vercel indirme süresini
temsil etmez. Sonraki çağrıların medyanı ayrıca raporlanır.

### Doğrulamalar

- `npx tsc --noEmit -p .`: başarılı.
- `verify-seg`: gerçek IS-Net/CPU çıkarımı ve çıktı sözleşmesi başarılı.
- `verify-seg-queue`: dört kuyruk/kurulum testi başarılı.
- `verify-seg-birefnet`: altı test grubu başarılı; sigmoid, geçersiz maske,
  WebGPU yokluğu, kurulum hatası, çıktı şekli, çıkarım sırasında OOM/shader
  hatası ve oturum bırakma. CPU yedeğinin açılmadığı da kontrol ediliyor.
- WebGPU yokken geri düşüş nedeninin loglanmaması için regresyon testi önce
  `0 !== 1` ile başarısız oldu; kontrol ortak hata yakalama yoluna alınınca geçti.
- `verify-release-hygiene`, `verify-indirme-ilerleme`, `verify-maske-karari`,
  `verify-maske-olcut`, `verify-sidecar-client`: başarılı.
- `verify-maske-birefnet-bench`: IS-Net yedeğine düşen karenin C kalite
  ortalamasından dışlanmasını yakalar. Gerçek rapor toplama koduyla test önce
  `undefined !== 1` ile başarısız oldu; düzeltme sonrası başarılı. Verify
  zincirine eklendi.
- `gen-third-party-notices` tekrar üretildi; izlenen içerik değişmedi.
- `npx vite build`: başarılı (chunk boyutu, dinamik/statik import ve gelecekteki
  native config loader hakkında mevcut uyarılar var).
- Tam `npm run verify` zinciri ve bilinen flaky `verify-gezinme-training-bench`
  çalıştırılmadı; yukarıda listelenen hedefli kontroller çalıştırıldı.

### DAVIS sonuçları (IS-Net yedeği dahil)

İlk tam koşu 1.848 saniyede bitti; 405 kare, sıfır hata. Ancak önceki benchmark
BiRefNet'in reddettiği 9 kareyi C skorundan dışlıyordu: 396 karedeki 0,732
J&F'yi 405 karedeki IS-Net ile doğrudan karşılaştırmak adil değildi. Bu hata
giderildi. `bmx-trees`, `drift-chicane`, `drift-straight` aynı `--adim 5` ile
yeniden ölçüldü (37 kare, 138 saniye, sıfır hata); aynı 9 kare IS-Net'e düştü.
Üç dizinin A/J ve A/F değerleri ilk koşuyla 1e-6 toleransında eşleşiyor.
Tablo diğer 27 diziyi ilk koşudan, bu üç diziyi düzeltilmiş koşudan alır.
Her iki sütun da aynı 405 kareyi içerir; kare atılmadı. Kesin sayılar ve
iki koşunun gecikme/adapter kayıtları [JSON raporunda](birefnet-val-20261023.json).

```powershell
node scripts/olc-maske.mjs --davis C:/Users/Emre/datasets/DAVIS --dizi bmx-trees,drift-chicane,drift-straight --adim 5 --etiket birefnet-fallback-20261023 --chrome --birefnet
```

| Dizi | Kare | IS-Net J | F | J&F | Fotoğraf J | F | J&F | Delta J&F | IS-Net yedek |
|---|---|---|---|---|---|---|---|---|---|
| bike-packing | 14 | 0.605 | 0.669 | 0.637 | 0.718 | 0.794 | 0.756 | 0.118 | 0 |
| blackswan | 10 | 0.812 | 0.905 | 0.859 | 0.848 | 0.958 | 0.903 | 0.044 | 0 |
| bmx-trees | 16 | 0.385 | 0.524 | 0.454 | 0.455 | 0.626 | 0.541 | 0.086 | 2 |
| breakdance | 17 | 0.526 | 0.580 | 0.553 | 0.242 | 0.328 | 0.285 | -0.268 | 0 |
| camel | 18 | 0.814 | 0.914 | 0.864 | 0.820 | 0.936 | 0.878 | 0.014 | 0 |
| car-roundabout | 15 | 0.919 | 0.932 | 0.926 | 0.924 | 0.958 | 0.941 | 0.016 | 0 |
| car-shadow | 8 | 0.878 | 0.935 | 0.907 | 0.889 | 0.970 | 0.929 | 0.023 | 0 |
| cows | 21 | 0.830 | 0.869 | 0.849 | 0.845 | 0.892 | 0.869 | 0.019 | 0 |
| dance-twirl | 18 | 0.698 | 0.754 | 0.726 | 0.772 | 0.869 | 0.821 | 0.094 | 0 |
| dog | 12 | 0.864 | 0.905 | 0.885 | 0.878 | 0.944 | 0.911 | 0.027 | 0 |
| dogs-jump | 14 | 0.501 | 0.650 | 0.575 | 0.534 | 0.687 | 0.611 | 0.035 | 0 |
| drift-chicane | 11 | 0.370 | 0.424 | 0.397 | 0.535 | 0.634 | 0.584 | 0.187 | 4 |
| drift-straight | 10 | 0.674 | 0.648 | 0.661 | 0.747 | 0.760 | 0.753 | 0.092 | 3 |
| goat | 18 | 0.824 | 0.845 | 0.835 | 0.829 | 0.894 | 0.862 | 0.027 | 0 |
| gold-fish | 16 | 0.361 | 0.440 | 0.400 | 0.532 | 0.628 | 0.580 | 0.180 | 0 |
| horsejump-high | 10 | 0.395 | 0.488 | 0.442 | 0.498 | 0.646 | 0.572 | 0.131 | 0 |
| india | 17 | 0.159 | 0.257 | 0.208 | 0.351 | 0.418 | 0.384 | 0.177 | 0 |
| judo | 7 | 0.763 | 0.779 | 0.771 | 0.846 | 0.888 | 0.867 | 0.096 | 0 |
| kite-surf | 10 | 0.537 | 0.607 | 0.572 | 0.482 | 0.698 | 0.590 | 0.018 | 0 |
| lab-coat | 10 | 0.914 | 0.883 | 0.899 | 0.916 | 0.896 | 0.906 | 0.008 | 0 |
| libby | 10 | 0.412 | 0.578 | 0.495 | 0.602 | 0.763 | 0.683 | 0.188 | 0 |
| loading | 10 | 0.706 | 0.717 | 0.711 | 0.713 | 0.703 | 0.708 | -0.003 | 0 |
| mbike-trick | 16 | 0.757 | 0.748 | 0.752 | 0.805 | 0.815 | 0.810 | 0.057 | 0 |
| motocross-jump | 8 | 0.779 | 0.786 | 0.782 | 0.862 | 0.896 | 0.879 | 0.097 | 0 |
| paragliding-launch | 16 | 0.569 | 0.454 | 0.512 | 0.576 | 0.397 | 0.486 | -0.025 | 0 |
| parkour | 20 | 0.663 | 0.768 | 0.715 | 0.740 | 0.871 | 0.805 | 0.090 | 0 |
| pigs | 16 | 0.861 | 0.895 | 0.878 | 0.879 | 0.912 | 0.895 | 0.018 | 0 |
| scooter-black | 9 | 0.714 | 0.690 | 0.702 | 0.845 | 0.847 | 0.846 | 0.144 | 0 |
| shooting | 8 | 0.790 | 0.763 | 0.776 | 0.787 | 0.773 | 0.780 | 0.003 | 0 |
| soapbox | 20 | 0.759 | 0.776 | 0.768 | 0.523 | 0.630 | 0.577 | -0.191 | 0 |
| **Kare ortalaması** | 405 | **0.657** | **0.705** | **0.681** | **0.687** | **0.757** | **0.722** | **0.041** | 9 |
| **Dizi ortalaması** | 405 | **0.661** | **0.706** | **0.684** | **0.700** | **0.768** | **0.734** | **0.050** | 9 |

### Gecikme, adapter ve karar

| Koşu / yöntem | İlk çağrı (sn) | Sonrakiler medyan (sn) | Sonrakiler ortalama (sn) |
|---|---|---|---|
| Tam koşu, IS-Net | 3,34 | 0,309 | 0,340 |
| Tam koşu, fotoğraf/BiRefNet + yedek | 20,10 | 3,609 | 3,846 |
| 37 kare tekrar, IS-Net | 1,91 | 0,282 | 0,279 |
| 37 kare tekrar, fotoğraf/BiRefNet + yedek | 13,69 | 2,700 | 2,662 |

İlk koşunun ORT `env.webgpu.adapter` alanı boş çıktı; varsayılan
`requestAdapter` **nvidia / blackwell** döndürdü. Bu, tek başına ORT'nin kullandığı
adapter'ı kanıtlamaz. Native ORT bu alanı yayımlamayabildiğinden betik,
seçeneklerini değiştirmeden `requestAdapter` / başarılı `requestDevice`
çağrılarını izliyor. 37 karelik tekrarda **gerçek cihaz adapter'ı nvidia /
blackwell** olarak kaydedildi. Intel iGPU performansı ölçülmedi. Zaman farkı
gözlendi; iki koşunun gecikmeleri tek bir sayıymış gibi birleştirilmedi.

**Karar: `TARAYICI_BIREFNET = true` kaldı.** IS-Net yedeği dahil tüm karelerde
J&F +0,0414 (4,14 yüzde puan); eşit ağırlıklı dizi ortalamasında +0,0500
(5,00 yüzde puan). 26/30 dizi iyileşiyor. Ölçülen 2,7–3,6 sn sıcak medyanı tek
fotoğraf için kabul edilebilir buluyorum; video için bu maliyet uygun değil
ve video yolu IS-Net olarak kalıyor. Bu karar ölçülen GPU/veriyle sınırlı.

Açık riskler:

- Kalite her karede artmıyor. `breakdance` J&F 0,553 → 0,285;
  `soapbox` 0,768 → 0,577. Diğer gerilemeler `loading` (−0,003) ve
  `paragliding-launch` (−0,025). Makul görünen ama yanlış nesneyi seçen maske,
  yalnız alan/NaN kontrolüyle yakalanamıyor.
- 9/405 kare (%2,22) BiRefNet tarafından makul bulunmayıp IS-Net'e düştü;
  bu kareler son tabloda skora dahil. Sayılan geri düşüşler model hatası
  sayacından ayrıdır; iki benchmark da sıfır kare hatasıyla bitti.
- Yerel ilk çağrı 13,7–20,1 sn. Vercel ziyaretçisinde 114,8 MB internet
  indirmesi ek maliyet; soğuk açılış ve arayüz tepkiselliği ayrıca önem taşıyor.
- Intel iGPU, gerçek Vercel dağıtımı ve UI tepkiselliği doğrulanmadı.
  Bir video da açılırsa IS-Net ve BiRefNet oturumları birlikte bellekte kalabilir.
- MIT beyanına rağmen model kartındaki DIS5K eğitim verisi uyarısı sürüyor.

## Uzuv dostu bileÅŸen seÃ§imi ve zamansal ortalama (2026-10-24)

DAVIS 2017 val, her 5. kare (30 dizi, 405 kare), IS-Net (A), `--sade`. "Eksik bÃ¶lge" =
GT'nin maskenin kaÃ§Ä±rdÄ±ÄŸÄ±, GT alanÄ±nÄ±n >= %0,5'i kadar baÄŸlÄ± parÃ§alarÄ±nÄ±n toplam alanÄ± / GT alanÄ±.

### 1) `keepLargestComponent` -> `keepMainComponents` (segmentation.ts, KABUL EDÄ°LDÄ°)

En bÃ¼yÃ¼k bileÅŸen + ona <= 12 px (3 x dilate yarÄ±Ã§apÄ±) iÃ§indeki, alanÄ± ana bileÅŸenin >= %0,2'si
olan parÃ§alar (zincirleme). Uzak/kÃ¼Ã§Ã¼k benekler yine dÃ¼ÅŸer.

| | J | F | J&F (kare) | J&F (dizi) | Eksik bÃ¶lge | Ä°Ã§ delik |
|---|---|---|---|---|---|---|
| Ã–NCE (en bÃ¼yÃ¼k bileÅŸen) | 0,657 | 0,705 | 0,681 | 0,684 | %18,1 | %1,6 |
| SONRA (ana + yakÄ±n parÃ§alar) | 0,658 | 0,714 | 0,686 | 0,689 | %17,4 | %1,5 |

Uzuvlu/parÃ§alÄ± dizilerde (J&F, eksik bÃ¶lge Ã¶nce -> sonra): horsejump-high 0,442 -> 0,479
(%28,5 -> %20,1), kite-surf 0,572 -> 0,620 (%15,5 -> %10,4), dogs-jump 0,575 -> 0,596
(%43,6 -> %41,5), breakdance 0,553 -> 0,572 (%36,7 -> %34,0), paragliding-launch 0,512 -> 0,544,
bmx-trees 0,454 -> 0,471. Gerileyenler: cows -0,011, libby -0,013 (diÄŸer dizilerde |fark| < 0,003).
Ortalama J&F dÃ¼ÅŸmedi, eksik bÃ¶lge azaldÄ±: kabul.

### 2) Zamansal ortalama (D, son 3 maske) â€” BAÄLANMADI

AynÄ± 8 dizi (breakdance, dance-twirl, dog, judo, parkour, horsejump-high, soapbox, blackswan),
HER kare (567 kare), ardÄ±ÅŸÄ±k kareler:

| | J | F | J&F | ArdÄ±ÅŸÄ±k IoU | Alan dalgalanmasÄ± | Eksik bÃ¶lge |
|---|---|---|---|---|---|---|
| A | 0,678 | 0,738 | 0,708 | 0,722 | %1,23 | %12,0 |
| D (3 kare ort.) | 0,644 | 0,587 | 0,616 | 0,798 | %0,84 | %15,2 |

ArdÄ±ÅŸÄ±k IoU artÄ±yor ama J&F 0,09 dÃ¼ÅŸÃ¼yor (F 0,738 -> 0,587: hareketli konturda gecikme).
Kabul Ã¶lÃ§Ã¼tÃ¼ (J&F gÃ¼rÃ¼ltÃ¼den fazla dÃ¼ÅŸmemeli) baÅŸarÄ±sÄ±z. AyrÄ±ca gerÃ§ek video yolunda
`captureMask` her kare deÄŸil, yalnÄ±z Ã¶lÃ§Ã¼len kayma sonrasÄ± (saniyeler arayla) Ã§alÄ±ÅŸÄ±r; o aralÄ±kta
3 maske ortalamasÄ± eski sahneyi karÄ±ÅŸtÄ±rÄ±r, kare baÅŸÄ± titreÅŸim sorunu bu yolda zaten yok.
`maskeZamansal.ts` + testi duruyor, uygulamaya baÄŸlÄ± DEÄÄ°L; bench'te D olarak Ã¶lÃ§Ã¼lebilir.
Her 5. karede D: J&F 0,522 (A 0,681) â€” beklenen, kareler 5 aralÄ±klÄ±.

