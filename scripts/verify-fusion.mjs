// GÜN 7 (Emre) — füzyon + entegrasyon testi.
// Sentetik yörüngede (D.6b — Zeynep) uçtan uca: keyframe bulutları dünya
// çerçevesinde birleşiyor, model-bozulmuş derinlik ölçek hizalamasıyla
// metrik ölçeğe taşınıyor, GaussianBuffer (D.1) + keyframeIndex (D.4)
// doğru dolduruluyor. Video köprüsü (fuseVideoFrames) yoğun haritalarla
// doğrulanır (canlı entegrasyon ayrı iş — kapsam kaydı).
//
// ÇERÇEVE NOTU (Gün 5/6 dersi): `generatePointCloudScene` HAM dünya
// çerçevesindedir; splat üretimi MUTLAK poz kullandığı için pozlar DA
// ham çerçevede geçilir (toFirstKeyframeOrigin DEĞİL — o çerçeveyi bozar,
// GT sahne taşınmaz). Üretimde poz zinciri ilk-keyframe orijinliyse
// sahnenin kendisi o çerçevede kurulur; burada GT sabittir, onu bozmayız.
//
// Model YÜKLEMEZ, GPU gerekmez: saf CPU, deterministik.
//   node scripts/verify-fusion.mjs
import assert from 'node:assert/strict';
import {
  generateOrbitTrajectory,
  generatePointCloudScene,
  projectScene,
} from '../src/engine/vision/trajectory.ts';
import { selectKeyframes } from '../src/engine/vision/scale.ts';
import { fuseKeyframes, fuseVideoFrames } from '../src/engine/vision/fusion.ts';
import { alignSim3, applySim3, ate, medianMs } from '../src/engine/vision/metrics.ts';

const W = 640;
const H = 480;
const FOV = (60 * Math.PI) / 180;
const K = { width: W, height: H, fovY: FOV };
const N_POINTS = 600;

function buildMatches(frameA, frameB) {
  const out = [];
  for (let i = 0; i < frameA.visible.length; i++) {
    if (!frameA.visible[i] || !frameB.visible[i]) continue;
    out.push({ x1: frameA.x[i], y1: frameA.y[i], x2: frameB.x[i], y2: frameB.y[i] });
  }
  return out;
}

function quatToMatrix3(R) {
  const [x, y, z, w] = R;
  const xx = x * x, yy = y * y, zz = z * z;
  return [
    1 - 2 * (yy + zz), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (xx + zz), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (xx + yy),
  ];
}

// Tek senaryo: yörünge + sahne + izdüşümler + keyframe zinciri (D.8 hedefi).
const raw = generateOrbitTrajectory({ count: 12, arc: (120 * Math.PI) / 180, rise: 0.35 });
const scene = generatePointCloudScene(N_POINTS, 1, 0x51ce4e);
const frames = projectScene(raw, scene, W, H, 0);
const kf = selectKeyframes(frames.length, (ref, cand) => buildMatches(frames[ref], frames[cand]), {
  minParallaxPx: 25,
  minTrackedCount: 50,
});

// Sentetik "derinlik modeli" (Gün 6 deseni): d_pred = aModel·d_true + bModel.
// d_true = kameradan EKSEN derinliği (−cz) — triangulateWorldPoint.depthA ile
// AYNI tanım. Piksel başına deterministik eşlemeler: d_pred / renk / GT nokta.
const aModel = 2.7;
const bModel = -0.4;
const dPredMap = new Map(); // "k,x,y" → d_pred
const rgbMap = new Map(); // "k,x,y" → [r,g,b]
const gtMap = new Map(); // "k,x,y" → sahne nokta indeksi
for (const k of kf) {
  const pose = raw[k];
  const m = quatToMatrix3(pose.R);
  for (let i = 0; i < N_POINTS; i++) {
    if (!frames[k].visible[i]) continue;
    const px = Math.round(frames[k].x[i]);
    const py = Math.round(frames[k].y[i]);
    if (px < 0 || px >= W || py < 0 || py >= H) continue;
    const dx = scene[i * 3] - pose.t[0];
    const dy = scene[i * 3 + 1] - pose.t[1];
    const dz = scene[i * 3 + 2] - pose.t[2];
    const dTrue = -(m[2] * dx + m[5] * dy + m[8] * dz);
    const key = `${k},${px},${py}`;
    if (dPredMap.has(key)) continue; // aynı piksele ilk nokta (deterministik)
    dPredMap.set(key, aModel * dTrue + bModel);
    const len = Math.hypot(dx, dy, dz) || 1;
    rgbMap.set(key, [0.5 + 0.5 * (dx / len), 0.5 + 0.5 * (dy / len), 0.5 + 0.5 * (dz / len)]);
    gtMap.set(key, i);
  }
}
const matches = [];
for (let j = 0; j < kf.length - 1; j++) {
  matches.push({ a: kf[j], b: kf[j + 1], matches: buildMatches(frames[kf[j]], frames[kf[j + 1]]) });
}
const splatPixels = [];
for (const key of dPredMap.keys()) {
  const [k, x, y] = key.split(',').map(Number);
  splatPixels.push({ keyIdx: k, x, y });
}
// keyIdx = ORİJİNAL kare indeksi (kf listesinden, sıra yeniden numaralanmaz);
// bu yüzden poses dizisi de orijinal uzunlukta tutulur (poses[i] = kare i).
const poses = raw;
const fusionArgs = {
  poses,
  splatPixels,
  matches,
  getDepthAt: (k, x, y) => dPredMap.get(`${k},${Math.round(x)},${Math.round(y)}`) ?? -1,
  getColorAt: (k, x, y) => rgbMap.get(`${k},${Math.round(x)},${Math.round(y)}`) ?? null,
  K,
};

// ---------------------------------------------------------------------------
// 1. UÇTAN UCA FÜZYON — model bozması geri alınıyor mu, dünya bulutu GT
//    sahneyle çakışıyor mu? (ölçek + konum RMS + ATE)
// ---------------------------------------------------------------------------
{
  const res = fuseKeyframes(fusionArgs);
  assert.ok(res.scale, 'ölçek hizalaması null — senaryo bozuk');
  const expectedA = 1 / aModel;
  const expectedB = -bModel / aModel;
  console.log(
    `[1] keyframe ${kf.join(',')} (${kf.length}) · scaleA=${res.scale.scaleA.toFixed(4)} (beklenen ${expectedA.toFixed(4)}) scaleB=${res.scale.scaleB.toFixed(4)} (beklenen ${expectedB.toFixed(4)}) · splat ${res.data.count}/${splatPixels.length}`,
  );
  assert.ok(Math.abs(res.scale.scaleA - expectedA) < 0.02, `scaleA sapması büyük: ${res.scale.scaleA}`);
  assert.ok(Math.abs(res.scale.scaleB - expectedB) < 0.02, `scaleB sapması büyük: ${res.scale.scaleB}`);
  assert.ok(res.data.count >= 300, `yeterli splat üretilmedi: ${res.data.count}`);

  // Splat konumları → GT sahne noktaları (birebir eşleme üzerinden).
  const est = [];
  const gt = [];
  for (let i = 0; i < res.data.count; i++) {
    const sp = splatPixels[i];
    const idx = gtMap.get(`${sp.keyIdx},${Math.round(sp.x)},${Math.round(sp.y)}`);
    if (idx === undefined) continue;
    const o = i * 4;
    est.push([res.data.a[o], res.data.a[o + 1], res.data.a[o + 2]]);
    gt.push([scene[idx * 3], scene[idx * 3 + 1], scene[idx * 3 + 2]]);
  }
  assert.ok(est.length >= 300, `GT eşleşmesi eksik: ${est.length}`);
  let sq = 0;
  for (let i = 0; i < est.length; i++) {
    sq += Math.hypot(est[i][0] - gt[i][0], est[i][1] - gt[i][1], est[i][2] - gt[i][2]) ** 2;
  }
  const rms = Math.sqrt(sq / est.length);
  console.log(`[1] splat→GT konum RMS: ${rms.toExponential(2)} dünya birimi (${est.length} nokta)`);
  assert.ok(rms < 0.02, `splat konumları GT sahneye oturmuyor: ${rms}`);

  // ATE: Sim3 hizalaması sonrası kalan translasyon hatası (metrics.ate — D.5).
  const fit = alignSim3(est, gt);
  assert.ok(fit, 'alignSim3 null döndü');
  const ateVal = ate(est.map((p) => applySim3(fit, p)), gt);
  console.log(`[1] alignSim3 sonrası ATE: ${ateVal.toExponential(2)} dünya birimi`);
  assert.ok(ateVal < 0.01, `ATE beklenenden yüksek: ${ateVal}`);
}

// ---------------------------------------------------------------------------
// 2. BUFFER SÖZLEŞMESİ (D.1 + D.4) — boyutlar, keyframeIndex aralığı, NaN yok.
// ---------------------------------------------------------------------------
{
  const { data } = fuseKeyframes(fusionArgs);
  assert.ok(data.count > 0, 'buffer boş');
  assert.equal(data.a.length, data.count * 4, 'a kanalı 4·count değil');
  assert.equal(data.b.length, data.count * 4, 'b kanalı 4·count değil');
  assert.equal(data.c.length, data.count * 4, 'c kanalı 4·count değil');
  assert.equal(data.keyframeIndex.length, data.count, 'keyframeIndex 1·count değil');
  const kfMin = Math.min(...kf);
  const kfMax = Math.max(...kf);
  for (let i = 0; i < data.count; i++) {
    const ki = data.keyframeIndex[i];
    assert.ok(ki >= kfMin && ki <= kfMax, `keyframeIndex aralık dışı: ${ki}`);
    for (const arr of [data.a, data.b, data.c]) {
      assert.ok(Number.isFinite(arr[i * 4]), `NaN/Inf değer splat ${i}`);
    }
  }
  console.log(`[2] buffer sözleşmesi ✓ (count=${data.count}, keyframeIndex aralığı [${kfMin}, ${kfMax}])`);
}

// ---------------------------------------------------------------------------
// 3. VİDEO KÖPRÜSÜ — fuseVideoFrames yoğun haritalarla çalışıyor mu?
//    (matches boş → ölçek YOKTUR; dürüstlük: scale null + splatlar d_pred'in
//    kendi ölçeğinde. Veri yolu testi — canlı entegrasyon ayrı iş.)
// ---------------------------------------------------------------------------
{
  const step = 4;
  // keyIdx = ORİJİNAL kare indeksi (köprü de öyle arar) → 12 uzunluklu dizide
  // kare indeksine yerleştir (kf sırasına push DEĞİL — indeks karışıklığı).
  const depth = new Array(raw.length);
  const rgb = new Array(raw.length);
  for (const k of kf) {
    const pose = raw[k];
    const m = quatToMatrix3(pose.R);
    const d = new Float32Array(W * H);
    const r = new Float32Array(W * H * 3);
    d.fill(0.08); // arka plan — pozitif (kameranın önü)
    const fk = projectScene([pose], scene, W, H, 0)[0];
    for (let i = 0; i < N_POINTS; i++) {
      if (!fk.visible[i]) continue;
      // GRID pikseline oturt: köprü sampleStep=4 ile örnekler, dolu piksel
      // ancak grid hizasında yakalanır (nokta pikseli round'dan 4'ün katına).
      const gx = Math.round(fk.x[i] / step) * step;
      const gy = Math.round(fk.y[i] / step) * step;
      if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;
      const dx = scene[i * 3] - pose.t[0];
      const dy = scene[i * 3 + 1] - pose.t[1];
      const dz = scene[i * 3 + 2] - pose.t[2];
      const dTrue = -(m[2] * dx + m[5] * dy + m[8] * dz);
      const idx = gy * W + gx;
      if (d[idx] === 0.08) d[idx] = aModel * dTrue + bModel; // ilk nokta kazanır
      const oi = idx * 3;
      r[oi] = 0.4;
      r[oi + 1] = 0.6;
      r[oi + 2] = 0.8;
    }
    depth[k] = d;
    rgb[k] = r;
  }
  const res = fuseVideoFrames({
    poses,
    depth,
    rgb,
    matches: [],
    width: W,
    height: H,
    fovY: FOV,
    sampleStep: step,
  });
  assert.ok(res.data.count > 0, 'köprü boş buffer üretti');
  assert.equal(res.scale, null, 'matches yokken scale null olmalı (dürüstlük — sessiz ölçek yok)');
  let sampled = 0;
  for (let i = 0; i < res.data.count && sampled < 3; i++) {
    const o = i * 4;
    // Float32Array yuvarlaması: 0.4 literal'ı float32'de 0.4000000059… olur —
    // === değil, fiziksel doğrulukla (1e-3) karşılaştır.
    const r = res.data.c[o];
    const g = res.data.c[o + 1];
    const b = res.data.c[o + 2];
    if (Math.abs(r - 0.4) < 1e-3 && Math.abs(g - 0.6) < 1e-3 && Math.abs(b - 0.8) < 1e-3) sampled++;
  }
  assert.ok(sampled >= 3, "renkler köprüden buffer'a taşınmadı");
  console.log(`[3] video köprüsü: ${res.data.count} splat (step=${step}), ölçeksiz üretim + renk taşıma ✓`);
}

// ---------------------------------------------------------------------------
// 4. DETERMİNİZM — aynı girdi iki koşu, birebir aynı.
// ---------------------------------------------------------------------------
{
  const r1 = fuseKeyframes(fusionArgs);
  const r2 = fuseKeyframes(fusionArgs);
  assert.equal(JSON.stringify(r1.data), JSON.stringify(r2.data), 'iki koşu birebir aynı olmalı');
  assert.equal(JSON.stringify(r1.scale), JSON.stringify(r2.scale), 'ölçek de determinist olmalı');
  console.log('[4] determinizm: birebir');
}

// ---------------------------------------------------------------------------
// 5. TIMING — medianMs (metrics.ts), hedef assert YOK (raporlama amaçlı).
// ---------------------------------------------------------------------------
{
  fuseKeyframes(fusionArgs); // ısınma
  const times = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    fuseKeyframes(fusionArgs);
    times.push(performance.now() - t0);
  }
  console.log(`[5] fuseKeyframes medyan ${medianMs(times).toFixed(1)} ms (10 koşu, ${splatPixels.length} aday piksel)`);
}

console.log('OK füzyon + entegrasyon (Gün 7)');
