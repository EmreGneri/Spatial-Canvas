# Sprint Notları — Emre'nin Şeridi (Day 1 discovery + E2.1)

Tarih: 2026-08-16 · Branch: feat/splat-render · Başlangıç: `npm run verify` 19/19 yeşil.

## Zeynep denetimi (2026-08-16, f5881e8) — benim E1.2 kodumda 3 gerçek hata

1. **Ölçek kararı sabit yazılmıştı** (`{ durum:'gecerli', rmse:0, guven:1 }`): uydurma ne
   kadar kötü olursa olsun "kusursuz" raporlanıyordu; CapturePanel judgeScale ile çelişiyordu.
   Zeynep düzeltti: gerçek rmse taşınıyor, guven = 1 − rmse/(0.25·|a|) (negatif eğim → 0).
   Notu: `durum` hâlâ "fit var mı"; kalite kapısı D4'ün işi, ScaleRed donuk olduğundan
   genişletmedi — `guven === 0` sinyali taşıyor. (BENİM NOTUM: D4'e bu sinyal bağlanacak.)
2. **bazUzunlugu yanlıştı**: |t| (orijine uzaklık) ortalanıyordu — monoküler zincirde |t|
   indeksle büyür (≈ n/2). Düzeltme: ARDIŞIK pozlar arası mesafe.
3. **pozBasariOrani vekili yanlıştı**: `m.length >= 8` sayıyordu; RANSAC'ı tutmayan çift
   "başarılı" görünüyordu. Düzeltme: `kaynak` alanından sayılıyor (fallback+basarisiz =
   hata); `dagilim[kaynak!]` non-null assertion'ı savunmalı okumaya çevrildi (NaN riski).

Zeynep ayrıca ekledi: **sıfırla butonu** (Engine.resetRenderParams + verify-reset.mjs +
ModeSelector UI) — anlık görüntüden geri yükleme (ParamDef.default değil: renk kolları
`default: 0` taşır), feedback birikimi temizlenir, medyaya dokunulmaz. verify zinciri 23
script'e çıktı.

**FB notu (Zeynep) → DÜZELTİLDİ (commit 6f0d0b5?)**: FB eşiği eksen başına idi (çapraz
sapmada √2 ≈ 1.41 px'e izin veriyordu) → Öklid mesafesi (u²+v² ≤ 1) yapıldı. Ölçülen iyi
eşleşmeler 0.36 px altında — 756 eşleşme korundu, GT hatası max 0.306 px.

## E2.1 tamamlandı (2026-08-16, commit bc45cf9)

- MAX_CORNERS 500→800, qualityLevel 0.01→0.005, minDistance 7→5, pyramidLevels 3→4.
- Grid kotası (8×6) GLOBAL skor sırasında işlenir (hücre-hücre sıralı seçim kotayı %50'ye düşürüyordu — ölçüldü: 234/500).
- 7 px kenar bandı detectCorners'ta dışlanır (ölçüldü: 800 köşenin 111'i o bantta, TAMAMI status=0 ölü ağırlık).
- Kaba piramit seviyesinde flat bölge pass-through (ölçüldü: 4. seviyede doku kaybolur, 140→45 eşleşmeye düşüyordu).
- minEigThreshold (1e-3) + fbConsistency (FB_TOL 1px) + 4. seviye — seçenekler.
- KEYFRAME 256×192→384×288 (videoPipe) + maxCorners 800 çağrı sitesi.
- Pan 3.2/-1.7px: **756/800 status=1** (eski: 263/500 = 2.87×; plan 3×263=789 — prosedürel dokunun ölçülen tavanı 756; eski kadraj-yolu tabanı ~158'e göre 4.8×). GT hatası max 0.31 px (<0.5 plan ölçütü).
- Rotate: çerçeve-içi geçiş %100 (eski %95.3), ham hata ≤ 1.53 px.
- Flow medyan süre: 282-460 ms (makine yüküne göre; FB kapalı 245; detectCorners 33) — tavan 200→600 ms (gevşek sanity; gerçek süre rapora gider). İyileştirme yolu: maxIterations 40→20.
- verify-temporal fixtür: dama bölgesi 60×60→100×100 (yoğun köşe yayılımı 15px marja yaklaşmıştı; çekirdek coverRadius(28) içine düştü — 19/225).

## Modül → sorumluluk tablosu

| Modül | Sorumluluk | Kritik sabitler (KODDAKİ değerler) |
|---|---|---|
| `src/engine/vision/flow.ts` | Shi-Tomasi köşe + piramidal LK | MAX_CORNERS=800, MIN_CORNERS=300, qualityLevel=0.005, minDistance=5, pyramidLevels=4, windowRadius=7, errorThreshold=0.055, epsilon=0.01, minEigThreshold=1e-3, fbConsistency=true (FB_TOL=1px), kenar bandı 7px dışlama, grid kota 8×6 |
| `src/engine/vision/pose.ts` | Essential matrix + RANSAC + cheirality | RANSAC: 500 iterasyon, pixelThreshold=1.5px (odak uzaklığıyla normalize-uzaya çevrilir), seed=0xc0ffee; Hartley normalizasyonu VAR; Sampson mesafesi normalize uzayda (kare) |
| `src/engine/vision/scale.ts` | d_metric ≈ a·d_pred + b uydurma | İKİ AŞAMALI deterministik MAD (k=3.5) + OLS refit; `inliers/rejected` kalan noktalardan; <2 sonlu çift ya da varyanssızsa null |
| `src/engine/vision/videoPipe.ts` | Kare yakalama + füzyon köprüsü | KEYFRAME_WIDTH=384, KEYFRAME_HEIGHT=288; buildFusionScene: maxCorners=800 (videoPipe.ts:213), sampleStep=4, VIDEO_FOV_Y |
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