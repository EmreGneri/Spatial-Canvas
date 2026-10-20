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
