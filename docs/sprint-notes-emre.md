# Sprint Notları — Emre'nin Şeridi (Day 1 discovery)

Tarih: 2026-08-16 · Branch: feat/splat-render · Başlangıç: `npm run verify` 19/19 yeşil.

## Modül → sorumluluk tablosu

| Modül | Sorumluluk | Kritik sabitler (KODDAKİ değerler) |
|---|---|---|
| `src/engine/vision/flow.ts` | Shi-Tomasi köşe + piramidal LK | MAX_CORNERS=500 (varsayılan), MIN_CORNERS=300, qualityLevel=0.01, minDistance=7, pyramidLevels=3, windowRadius=7, errorThreshold=0.055, epsilon=0.01 |
| `src/engine/vision/pose.ts` | Essential matrix + RANSAC + cheirality | RANSAC: 500 iterasyon, pixelThreshold=1.5px (odak uzaklığıyla normalize-uzaya çevrilir), seed=0xc0ffee; Hartley normalizasyonu VAR; Sampson mesafesi normalize uzayda (kare) |
| `src/engine/vision/scale.ts` | d_metric ≈ a·d_pred + b uydurma | İKİ AŞAMALI deterministik MAD (k=3.5) + OLS refit; `inliers/rejected` kalan noktalardan; <2 sonlu çift ya da varyanssızsa null |
| `src/engine/vision/videoPipe.ts` | Kare yakalama + füzyon köprüsü | KEYFRAME_WIDTH=256, KEYFRAME_HEIGHT=192; buildFusionScene: maxCorners=300 (videoPipe.ts:177), sampleStep=4, VIDEO_FOV_Y |
| `src/engine/vision/seekCapture.ts` | Dosya videosu seek tabanlı yakalama | maxFrames varsayılanı **8** (kullanıcı CapturePanel'de ayarlar); startFrac 0.05, endFrac 0.95 |
| `src/engine/vision/fusion.ts` | Keyframe füzyonu → GaussianBuffer | sampleStep: buildFusionScene'de 4, fuseVideoFrames varsayılanı 2; ölçek hizalaması TÜM çiftlerin üçgenleme havuzundan |
| `src/engine/vision/trajectory.ts` | Sentetik yörünge (test) | scaleA=1/scaleB=0 kayıt biçimi |
| `src/engine/vision/temporal.ts` | Zamansal derinlik (foto) | flow.ts seyrek çalışır (300-500 köşe) |
| `src/engine/vision/metrics.ts` | Metrikler | medianMs, Sim3Fit |
| `src/depth.ts` | MiDaS depth + normalizasyon | transformersPromise modül seviyesi cache (rejection'ı KALICI saklar — E1.4); estimator `if (estimator) return` (device lock yok, pipeline hatasında null kalır); MODEL_INPUT_SIZE=518; normalizeDepth percentile=1 |
| `src/engine/reconstruction/mesh.ts` | Solid kabuk mesh | frameShortHalf zSpan (Gün E) |
| `src/engine/splats.ts` | Splat sıralama/sort | radix + kova |

## Brief ile kodun çeliştiği yerler (kayıt zorunluluğu)

1. **Keyframe sayısı**: plan/brief "~12 keyframe" der; kodda varsayılan **8**'dir (seekCapture.ts:51 `opts.maxFrames ?? 8`, CapturePanel `maxFrames=8`). Kullanıcı arayüzden 2..N ayarlayabilir — ölçümlerde hangi değerin kullanıldığı kaydedilmeli.
2. **Hartley normalizasyonu**: E3.1 brief'i "8-nokta öncesi Hartley normalizasyonu ekle" der; kodda ZATEN VAR (pose.ts:92-108, `hartleyNormalize` — 2026-08-14 düzeltmesi). E3.1'de bu madde yapılmış sayılır, tekrar iş açmaz.
3. **Sampson mesafesi**: E3.1 "inlier ölçütü piksel değil, normalize koordinatlarda Sampson" der; kod zaten normalize ışın uzayında Sampson karesi kullanıyor (pose.ts:163-175) ve pixelThreshold odak uzaklığıyla normalize uzaya çevriliyor (pose.ts:205). Kalan iş: ADAPTİF iterasyon sayısı + homografi dejenere detektörü.
4. **maxCorners**: flow.ts varsayılanı 500, ama videoPipe çağrısı **300** geçiyor (videoPipe.ts:177) — E2.1'in hedefi bu çağrı sitesidir.
5. **Flow çözünürlüğü**: FLOW_WIDTH=320/FLOW_HEIGHT=180 sabitleri yalnızca lab/test içindir; üretim hattı keyframe çözünürlüğünde (256×192) koşar.

## Veri noktaları (ölçüm)

- Köşe tespiti: makeFlowTexture (320×180) ~500 köşe, düz doku 0 köşe.
- Pan 3.2/-1.7px: status=1 263/500, |Δu| medyan 0.0089, |Δv| medyan 0.0070.
- Rotate 0.01 rad: çerçeve-içi geçiş %95.3, status=0 ham hata ≤ 1.6px.
- Flow medyan süre: 70.2 ms (10 koşu, hedef ~10 ms — raporlama amaçlı).
- RANSAC: gürültüsüz izole rotasyon hatası ~0°, %30 aykırıda 0.183°, adım medyan 0.121°.
- Füzyon: keyframe başına 256×192/4² = 3072 aday splat; 12 keyframe → 36.864.
- verify tabanı: **19 script, tamamı yeşil** (0 assertion hatası).

## Yapılan/yapılacak notlar

- E1.2 sözleşme dondurma: PoseResult/ScaleVerdict/CaptureDiagnostics/DepthProvider tipleri; recoverPose kaynak/dejenere alanları (başarısızlıkta null korunur — F2 davranışı); chainPoseTrack kaynak etiketi (donme-fallback <8 eşleşmede basarisiz).
- E1.4: transformersPromise rejection cache'i düşürme (retry) — test fake loader ile.
- E2.1: videoPipe maxCorners 300→800; grid bucketing; FB tutarlılık (>1px at); minEigThreshold; pyramid 3→4; 256×192→384×288 (KEYFRAME sabitleri — seekCapture otomatik takip eder).