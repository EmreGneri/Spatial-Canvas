# Eval Raporu — Sentetik Lab (Gün D/1 + Gün 2)

Rapor şeması: `ARCHITECTURE.md` → D.5 (`eval-out/report-*.json`). Tüm değerler
2026-08-14 `npm run eval` çıktısıdır (commit `7c93caf`); metrikler iki ayrı
koşuda **birebir aynı** (determinizm). Timing = medyan (1 ısınma + 20 tekrar).
Set: `synthetic-lab` (`makeSyntheticLab`, 128²: sol net / sağ flu, GT 0.85/0.3)
ve `synthetic-small-subject` (`makeSmallSubjectLab`, 128²: merkez daire %17,
GT 0.8/0.2).

| Kol | Durum | Ölçüm | Değer (ON vs OFF) | Kaynak rapor |
|---|---|---|---|---|
| `ao` | **null** (bilinçli) | — ölçülmez: bu faz sahnelerinde fark üretmiyor; sayı ile doldurmak yasak (D.5) | — | — |
| `focusBoost` | 0.55 | AbsRel / RMSE / IoU | 0.377 / 0.174 / 0.808 — vs focus kapalı 0.763 / 0.398 / 0.348 | `report.json`, `report-focusOff.json` |
| `edgeStrength` | 0.35 | AbsRel / IoU | 0.768 / 0.348 (edge kapalı baza eşit koşul) | `report-edgeOn.json` |
| `letterbox_vs_distort` | **null** (bilinçli) | — tanımsız: FOV 60° sözleşmesi kolları örtüştürüyor; gerçek video kümesiyle doldurulacak | — | — |
| `importanceSampling` | 1 | foregroundPointShare (g64 / g32) | **0.3860 / 0.3906** — vs kapalı 0.1748 / 0.1758 (×2.2) | `report-importanceOn.json`, `report-importanceOff.json` |
| `importanceSampling` | 1 | medianMs (g64 / g32) | 4.20 / 3.67 ms — vs kapalı 3.04 / 2.76 ms | aynı |
| `depthSmoothing` | 1 | AbsRel / RMSE | **0.0235 / 0.0147** — vs kapalı 0.0338 / 0.0212 (−%31) | `report-smoothOn.json`, `report-smoothOff.json` |
| `depthSmoothing` | 1 | medianMs | 0.783 ms — vs 0 (işlem yok) | aynı |
| `foregroundStretch` | 1 | AbsRel / RMSE / δ<1.25 | **0.0813 / 0.0550 / 1.000** — vs kapalı 0.1181 / 0.1434 / 0.594 | `report-stretchOn.json`, `report-stretchOff.json` |
| `foregroundStretch` | 1 | medianMs | 0.201 ms — vs 0 (işlem yok) | aynı |

Girdi kurulumları (kollar yalnızca kendi işleminde ayrışır):

- **depthSmoothing:** GT'ye deterministik yapısal gürültü (her 4. pikselde
  ±0.03); ON = bilateral `smoothDepthSteps`; OFF = işlemsiz. Karşılaştırma GT
  orijinaldir (gürültüsüz).
- **foregroundStretch:** ön plan bandı (x < mid) yapay [0.6, 0.7] aralığına
  sıkıştırılır; ON = `foregroundMask` + `applyForegroundStretch` (span
  [0.1, 0.95] hedefine açılır); OFF = sıkıştırılmış girdi.
- **importanceSampling:** küçük özne sahnesinde `sampleVolumePositions`,
  grid 64 ve 32 ayrı ayrı (`split: g64/g32`); fgShare = w ≥ 0.7 nokta payı.

Doğrulama: `npm run verify` tüm zincir yeşil (9 rapor D.5 şeması, kol fark
denetimi, koşular arası determinizm — `scripts/verify-eval.mjs`).