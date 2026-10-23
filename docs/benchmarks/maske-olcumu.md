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

