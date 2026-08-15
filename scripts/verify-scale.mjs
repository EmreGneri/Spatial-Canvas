// GÜN 6 (Emre) — üçgenleme + ölçek hizalama + keyframe seçimi testi.
// Zeynep'in sentetik yörüngesine (D.6b) karşı: Gün 5'in gerçek `chainPoseTrack`
// çıktısı zincirlenip üçgeleniyor, sentetik-bozulmuş "d_pred" ile hizalanıyor,
// keyframe seçimi akış üzerinde ölçülüyor.
//
// Model YÜKLEMEZ, GPU gerekmez: saf CPU, deterministik.
//   node scripts/verify-scale.mjs
import assert from 'node:assert/strict';
import {
  generateOrbitTrajectory,
  generatePointCloudScene,
  projectScene,
  toFirstKeyframeOrigin,
} from '../src/engine/vision/trajectory.ts';
import { chainPoseTrack } from '../src/engine/vision/pose.ts';
import { alignKeyframeScale, fitScaleAlignment, selectKeyframes, triangulateWorldPoint } from '../src/engine/vision/scale.ts';
import { mulberry32 } from '../src/engine/vision/linalg.ts';

const W = 640;
const H = 480;

function buildMatches(frameA, frameB) {
  const out = [];
  for (let i = 0; i < frameA.visible.length; i++) {
    if (!frameA.visible[i] || !frameB.visible[i]) continue;
    out.push({ x1: frameA.x[i], y1: frameA.y[i], x2: frameB.x[i], y2: frameB.y[i] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. ÜÇGENLEME — gerçek pozla (Gün 5 hatasız zincir varsayımıyla önce GT
//    pozlarla) sentetik sahnenin gerçek 3D noktalarını geri kazanıyor mu?
// ---------------------------------------------------------------------------
{
  // ÜÇGENLEME için HAM pozlar kullanılır — `generatePointCloudScene` origin
  // merkezlidir, `toFirstKeyframeOrigin` bu çerçeveyi bozar (poz zincirini
  // kamera0'ın ORİJİNAL konumuna göre yeniden çerçeveler); sahne noktaları
  // buna göre TAŞINMAZ. `raw` + `scene` aynı dünya çerçevesindedir, `gt` +
  // `scene` DEĞİLDİR (bulgu: bir tur önce `verify-pose.mjs`'te aynı hatayı
  // yapıp düzeltmiştim, burada tekrarlanmış — kayıt için).
  const raw = generateOrbitTrajectory({ count: 3, arc: (60 * Math.PI) / 180, rise: 0.35 });
  const scene = generatePointCloudScene(200, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0);
  const matches = buildMatches(frames[0], frames[1]);
  const K = { width: W, height: H, fovY: raw[0].fovY };

  let idx = -1;
  for (let i = 0; i < 200; i++) if (frames[0].visible[i] && frames[1].visible[i]) { idx = i; break; }
  assert.ok(idx >= 0, 'görünür nokta yok — senaryo bozuk');
  const m = { x1: frames[0].x[idx], y1: frames[0].y[idx], x2: frames[1].x[idx], y2: frames[1].y[idx] };

  const tri = triangulateWorldPoint(raw[0], raw[1], m, K);
  assert.ok(tri, 'üçgenleme null döndü (cheirality başarısız) — senaryo bozuk');
  const trueX = [scene[idx * 3], scene[idx * 3 + 1], scene[idx * 3 + 2]];
  const err = Math.hypot(tri.point[0] - trueX[0], tri.point[1] - trueX[1], tri.point[2] - trueX[2]);
  console.log(`[1] üçgenleme hatası (gerçek poz, gürültüsüz): ${err.toExponential(2)} dünya birimi`);
  assert.ok(err < 1e-6, `üçgenleme gerçek 3D noktayı geri kazanamadı: ${err}`);

  // Tüm eşleşmelerle toplu doğruluk (RMS).
  let sqSum = 0;
  let cnt = 0;
  for (let i = 0; i < 200; i++) {
    if (!frames[0].visible[i] || !frames[1].visible[i]) continue;
    const mi = { x1: frames[0].x[i], y1: frames[0].y[i], x2: frames[1].x[i], y2: frames[1].y[i] };
    const t = triangulateWorldPoint(raw[0], raw[1], mi, K);
    if (!t) continue;
    const tx = [scene[i * 3], scene[i * 3 + 1], scene[i * 3 + 2]];
    const d = Math.hypot(t.point[0] - tx[0], t.point[1] - tx[1], t.point[2] - tx[2]);
    sqSum += d * d;
    cnt++;
  }
  const rms = Math.sqrt(sqSum / cnt);
  console.log(`[1] toplu üçgenleme RMS (${cnt} nokta): ${rms.toExponential(2)} dünya birimi`);
  assert.ok(rms < 1e-6, `toplu üçgenleme RMS beklenenden yüksek: ${rms}`);
}

// ---------------------------------------------------------------------------
// 2. ÜÇGENLEME — Gün 5'in GERÇEK (tahmin edilmiş, essential-matrix zincirinden
//    gelen) pozlarıyla — birikimli poz hatası üçgenlemeye ne kadar taşınıyor?
// ---------------------------------------------------------------------------
{
  // Not: `est` (chainPoseTrack çıktısı) ve `frames` (ham `raw` pozlarla
  // izdüşürülmüş) FARKLI çerçevelerdedir (`est` kamera0-orijinli, `frames`
  // ham dünya çerçeveli) — ama triangulateWorldPoint yalnızca GÖRECELİ
  // (Rrel,trel) kullanır, bu her iki çerçevede de AYNIDIR (ortak rijit
  // dönüşüm relatif ilişkiyi değiştirmez); bu blok yalnızca cheirality SAYISI
  // kontrol ettiği için (mutlak XYZ değil) çerçeve karışıklığı zararsızdır.
  const raw = generateOrbitTrajectory({ count: 6, arc: (100 * Math.PI) / 180, rise: 0.35 });
  const scene = generatePointCloudScene(400, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0.4, 0x9e0);
  const frameMatches = [];
  for (let i = 0; i < frames.length - 1; i++) frameMatches.push(buildMatches(frames[i], frames[i + 1]));
  const K = { width: W, height: H, fovY: raw[0].fovY };
  const est = chainPoseTrack(frameMatches, K, raw.map((p) => p.timeMs), { pixelThreshold: 1.0, iterations: 400, seed: 0xc0ffee });

  // Son keyframe çiftini (en çok poz hatası birikmiş olan) üçgenle.
  const last = est.length - 1;
  const matches = buildMatches(frames[last - 1], frames[last]);
  let sqSum = 0;
  let cnt = 0;
  for (const m of matches.slice(0, 100)) {
    const t = triangulateWorldPoint(est[last - 1], est[last], m, K);
    if (!t) continue;
    cnt++;
  }
  console.log(`[2] tahmini pozla üçgenleme: ${cnt}/100 nokta cheirality geçti (poz zinciri gürültülü, tam 100 beklenmez)`);
  assert.ok(cnt >= 60, `tahmini pozla üçgenleme beklenenden az başarılı: ${cnt}/100`);
}

// ---------------------------------------------------------------------------
// 3. ÖLÇEK HİZALAMA — d_pred = a_true·d_metric_gt + b_true + gürültü (bozulmuş
//    sentetik "derinlik modeli" çıktısı); fitScaleAlignment a_true,b_true'yu
//    geri buluyor mu?
// ---------------------------------------------------------------------------
{
  const rnd = mulberry32(0x5ca1e);
  const aTrue = 2.7;
  const bTrue = -0.4;
  const pairs = [];
  for (let i = 0; i < 200; i++) {
    const dMetric = 0.5 + 3 * rnd(); // 0.5..3.5 aralığında rastgele "gerçek" derinlik
    const noise = (rnd() - 0.5) * 0.02; // ±0.01 gürültü
    const dPred = (dMetric - bTrue) / aTrue + noise; // ters çevir + gürültü ekle
    pairs.push({ dPred, dMetric });
  }
  const fit = fitScaleAlignment(pairs);
  assert.ok(fit, 'fitScaleAlignment null döndü');
  console.log(`[3] uydurulan scaleA=${fit.scaleA.toFixed(4)} (gerçek ${aTrue}) · scaleB=${fit.scaleB.toFixed(4)} (gerçek ${bTrue}) · RMSE=${fit.rmse.toExponential(2)}`);
  assert.ok(Math.abs(fit.scaleA - aTrue) < 0.05, `scaleA sapması çok büyük: ${fit.scaleA}`);
  assert.ok(Math.abs(fit.scaleB - bTrue) < 0.05, `scaleB sapması çok büyük: ${fit.scaleB}`);

  // Dejenere: d_pred sabit → eğim tanımsız → null (sessiz yanlış sayı YOK).
  const degenerate = fitScaleAlignment([{ dPred: 1, dMetric: 2 }, { dPred: 1, dMetric: 3 }]);
  assert.equal(degenerate, null, 'sabit d_pred için null dönmeli (dejenere)');
  console.log('[3] dejenere (sabit d_pred) → null ✓');
}

// ---------------------------------------------------------------------------
// 4. ÖLÇEK HİZALAMA — uçtan uca: gerçek poz + gerçek üçgenleme + sentetik
//    "derinlik modeli" (gerçek derinliği bilinen doğrusal dönüşümle bozar).
// ---------------------------------------------------------------------------
{
  const raw = generateOrbitTrajectory({ count: 3, arc: (60 * Math.PI) / 180, rise: 0.35 });
  const gt = toFirstKeyframeOrigin(raw);
  const scene = generatePointCloudScene(300, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0);
  const matches = buildMatches(frames[0], frames[1]);
  const K = { width: W, height: H, fovY: raw[0].fovY };

  const aModel = 0.6; // "derinlik modeli" ölçeği (keyfi, d_metric ile ilgisiz)
  const bModel = 0.15;
  const rnd = mulberry32(0xdead);
  const noiseAmp = 0.005;
  // getPredictedDepth: gerçek üçgenlenmiş derinliği (test kolaylığı için
  // önceden hesaplanmış bir haritadan) doğrusal bozup gürültü ekler.
  const depthMap = new Map();
  for (let i = 0; i < 300; i++) {
    if (!frames[0].visible[i] || !frames[1].visible[i]) continue;
    const mi = { x1: frames[0].x[i], y1: frames[0].y[i], x2: frames[1].x[i], y2: frames[1].y[i] };
    const t = triangulateWorldPoint(gt[0], gt[1], mi, K);
    if (!t) continue;
    const key = `${Math.round(mi.x1)},${Math.round(mi.y1)}`;
    depthMap.set(key, aModel * t.depthA + bModel + (rnd() - 0.5) * noiseAmp);
  }
  const getPredictedDepth = (x, y) => depthMap.get(`${Math.round(x)},${Math.round(y)}`) ?? -1;

  const fit = alignKeyframeScale(gt[0], gt[1], matches, K, getPredictedDepth);
  assert.ok(fit, 'alignKeyframeScale null döndü');
  // Hizalama d_pred'i d_metric'e taşır: scaleA ≈ 1/aModel, scaleB ≈ -bModel/aModel.
  const expectedA = 1 / aModel;
  const expectedB = -bModel / aModel;
  console.log(`[4] uçtan uca hizalama scaleA=${fit.scaleA.toFixed(4)} (beklenen ${expectedA.toFixed(4)}) · scaleB=${fit.scaleB.toFixed(4)} (beklenen ${expectedB.toFixed(4)}) · RMSE=${fit.rmse.toExponential(2)}`);
  assert.ok(Math.abs(fit.scaleA - expectedA) < 0.05, 'uçtan uca scaleA sapması büyük');
  assert.ok(Math.abs(fit.scaleB - expectedB) < 0.05, 'uçtan uca scaleB sapması büyük');
}

// ---------------------------------------------------------------------------
// 5. KEYFRAME SEÇİMİ — D.8 hedefi (8-20 keyframe), parallaks + izleme eşiği.
// ---------------------------------------------------------------------------
{
  // 60 "kare"lik akış: yavaş dönen kamera, count=60 küçük adımlarla arc=150°.
  const raw = generateOrbitTrajectory({ count: 60, arc: (150 * Math.PI) / 180, rise: 0.35, frameMs: 500 });
  const scene = generatePointCloudScene(500, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0.2, 0x9e0);
  const K = { width: W, height: H, fovY: raw[0].fovY };

  const kf = selectKeyframes(frames.length, (ref, cand) => buildMatches(frames[ref], frames[cand]), {
    minParallaxPx: 25,
    minTrackedCount: 50,
  });
  console.log(`[5] 60 kareden seçilen keyframe sayısı: ${kf.length} → indeksler: [${kf.join(', ')}]`);
  assert.equal(kf[0], 0, 'ilk kare her zaman keyframe olmalı');
  assert.equal(kf[kf.length - 1], frames.length - 1, 'son kare her zaman keyframe olmalı');
  for (let i = 1; i < kf.length; i++) assert.ok(kf[i] > kf[i - 1], 'keyframe indeksleri artan olmalı');
  // D.8 hedef kapsamı: 8-20 keyframe (30-60 sn el kamerası klip varsayımı).
  assert.ok(kf.length >= 8 && kf.length <= 20, `keyframe sayısı D.8 hedefi dışında: ${kf.length} (beklenen 8-20)`);

  // Ardışık keyframe'ler arası GERÇEK parallaks eşiği karşılıyor mu (son
  // keyframe hariç — o eşik tetiklenmeden zorunlu eklenmiş olabilir, D.8).
  for (let i = 1; i < kf.length - 1; i++) {
    const m = buildMatches(frames[kf[i - 1]], frames[kf[i]]);
    const disps = m.map((p) => Math.hypot(p.x2 - p.x1, p.y2 - p.y1)).sort((a, b) => a - b);
    const median = disps[Math.floor(disps.length / 2)];
    assert.ok(median >= 25 || m.length < 50, `keyframe ${kf[i]} parallaks eşiğini karşılamıyor: ${median.toFixed(1)}px`);
  }
}

// ---------------------------------------------------------------------------
// 6. KEYFRAME SEÇİMİ — kenar durumlar (tek kare, boş akış).
// ---------------------------------------------------------------------------
{
  assert.deepEqual(selectKeyframes(0, () => []), [], 'boş akış → boş liste');
  assert.deepEqual(selectKeyframes(1, () => []), [0], 'tek kare → yalnızca kendisi');
  console.log('[6] kenar durumlar (0 ve 1 kare) ✓');
}

// ---------------------------------------------------------------------------
// 7. DETERMİNİZM.
// ---------------------------------------------------------------------------
{
  const raw = generateOrbitTrajectory({ count: 20, arc: (150 * Math.PI) / 180, rise: 0.35 });
  const scene = generatePointCloudScene(300, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0.2, 0x9e0);
  const build = (ref, cand) => buildMatches(frames[ref], frames[cand]);
  const a = selectKeyframes(frames.length, build, { minParallaxPx: 25, minTrackedCount: 50 });
  const b = selectKeyframes(frames.length, build, { minParallaxPx: 25, minTrackedCount: 50 });
  assert.deepEqual(a, b, 'selectKeyframes determinist değil');
  console.log('[7] determinizm: birebir');
}

console.log('OK ölçek hizalama + keyframe zinciri (Gün 6)');
