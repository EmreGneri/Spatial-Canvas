// Fotoğraf derinlik kenarı: uzak yanak/çene kenarı aşınmaz, kenar pikselleri yandan perde olmaz.
// Gerçek vaka: AESPA-KARINA-5 (yüz sağa dönük). Maskenin yumuşak saçağı (≥0.5) arka plan
// derinliği taşıyordu; eğim sınırlayıcının çoğunluk kuralı bu saçağı "alçak komşu" sayıp
// çene/yanak kenarını 1-4 piksel arka plana çekiyordu, saçak pikselleri de öznenin
// arkasında nokta olarak kalıyordu. Yandan bakınca ikisi birlikte sağa/arkaya saçılma.
//   node scripts/verify-photo-depth-edges.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { limitDepthSlope, MAX_SLOPE_PER_PX } from '../src/depth.ts';
import { sampleVolumePositions, photoContourEdgePixels } from '../src/engine/reconstruction/sampler.ts';
import { buildSilhouette } from '../src/engine/reconstruction/silhouette.ts';

const W = 96, H = 80, BG = 0.1, FACE = 0.8;
// Yüz: sivri çeneli (60°) plato; maske yüzün 2 px dışına taşar (saçak, arka plan derinliği).
const inFace = (x, y) => y >= 10 && y <= 60 && Math.abs(x - 48) <= Math.min(24, (60 - y) * Math.tan(Math.PI / 6) + 0.5);
const depth = new Float32Array(W * H), mask = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  depth[i] = inFace(x, y) ? FACE - 0.001 * (x - 48) : BG;
  let near = false;
  for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (inFace(x + dx, y + dy)) { near = true; break; }
  mask[i] = inFace(x, y) ? 1 : near ? 0.7 : 0;
}
const faceLoss = (out) => {
  let worst = 0, eroded = 0;
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    // 1 px genişliğindeki çene ucu gerçekten sırt gibidir; ölçüm 3×3'ü yüzde kalan piksellerde.
    let core = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) core &&= inFace(x + dx, y + dy);
    if (!core) continue;
    const loss = depth[i] - out[i];
    worst = Math.max(worst, loss);
    if (loss > 0.2) eroded++;
  }
  return { worst, eroded };
};

// 1. Hata: çoğunluk kuralı çene ucunu arka plana çeker (video yolu bu kuralda kalır).
const majority = faceLoss(limitDepthSlope(depth, W, H, mask));
assert.ok(majority.eroded > 0, `çoğunluk kuralı çeneyi aşındırmalı (vaka kaydı): ${JSON.stringify(majority)}`);
// 2. Düzeltme: karşıt-çift kuralı yüzü korur.
const pairs = faceLoss(limitDepthSlope(depth, W, H, mask, MAX_SLOPE_PER_PX, 4, true));
assert.equal(pairs.eroded, 0, `karşıt çift kuralı yüzü aşındırmamalı: ${JSON.stringify(pairs)}`);
assert.ok(pairs.worst < 0.01, `yüz kaybı ${pairs.worst}`);

// 3. Sınırlayıcının asıl işi sürer: tek piksel tepe, 3×3 küme ve 1 px sırt düzlüğe iner.
const plane = new Float32Array(W * H).fill(0.5), full = new Float32Array(W * H).fill(1);
const spikes = Float32Array.from(plane);
spikes[20 * W + 20] = 0.95;
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) spikes[(40 + dy) * W + 50 + dx] = 0.9;
for (let x = 60; x < 90; x++) spikes[65 * W + x] = 0.9;
const capped = limitDepthSlope(spikes, W, H, full, MAX_SLOPE_PER_PX, 4, true);
for (const i of [20 * W + 20, 40 * W + 50, 40 * W + 51, 39 * W + 49, 65 * W + 75]) {
  assert.ok(capped[i] <= 0.5 + MAX_SLOPE_PER_PX + 1e-6, `tepe kırpılmalı: ${i} → ${capped[i]}`);
}
const flatOut = limitDepthSlope(plane, W, H, full, MAX_SLOPE_PER_PX, 4, true);
assert.deepEqual(flatOut, plane, 'düz yüzey değişmez');
// Varsayılan (video) davranış değişmedi: aynı tepeler çoğunlukta da kırpılır.
const cappedMajority = limitDepthSlope(spikes, W, H, full);
assert.ok(cappedMajority[20 * W + 20] <= 0.5 + MAX_SLOPE_PER_PX + 1e-6);

// 4. Siluet kenarında arka plan derinlikli saçak pikselleri gizlenir; yüz ve iç oklüzyon kenarı kalır.
const subject = Float32Array.from(depth);
// İç oklüzyon: yüzün içinde, konturdan uzak bir basamak (burun/kol gibi) — kesilmemeli.
for (let y = 25; y < 35; y++) for (let x = 40; x < 56; x++) subject[y * W + x] = 0.45;
const { alpha, dist } = buildSilhouette(subject, W, H, mask);
const edge = photoContourEdgePixels(subject, W, H, alpha, dist);
let fringeLeft = 0, faceCut = 0, innerCut = 0;
for (let i = 0; i < W * H; i++) {
  const x = i % W, y = (i / W) | 0;
  if (mask[i] >= 0.5 && !inFace(x, y) && !edge[i]) fringeLeft++;
  if (inFace(x, y) && edge[i] && subject[i] > 0.7) faceCut++;
  if (y >= 25 && y < 35 && x >= 40 && x < 56 && edge[i]) innerCut++;
}
assert.equal(fringeLeft, 0, 'saçak pikselleri gizlenmeli');
assert.equal(faceCut, 0, 'yüz kenarı kalmalı');
assert.equal(innerCut, 0, 'iç oklüzyon kenarı kesilmemeli');
// Örnekleyici: kapalıyken eski çıktı birebir; açıkken opak noktaların hiçbiri saçak derinliğinde değil.
const opts = { gridSize: 128, curvature: 0, importanceSampling: false, foregroundMask: mask };
const off = sampleVolumePositions(subject, W, H, opts), off2 = sampleVolumePositions(subject, W, H, { ...opts, photoEdgeCull: false });
assert.deepEqual(off2, off, 'bayrak kapalıyken çıktı aynı');
const on = sampleVolumePositions(subject, W, H, { ...opts, photoEdgeCull: true });
let lowOpaqueOff = 0, lowOpaqueOn = 0, opaqueOff = 0, opaqueOn = 0;
for (let k = 0; k < on.length; k += 4) {
  if (off[k + 3] === 1) { if (off[k + 2] >= -0.2) opaqueOff++; if (off[k + 2] < -0.2) lowOpaqueOff++; }
  if (on[k + 3] === 1) { if (on[k + 2] >= -0.2) opaqueOn++; if (on[k + 2] < -0.2) lowOpaqueOn++; }
}
assert.ok(lowOpaqueOff > 0, `vaka: saçak noktaları arkada opak (${lowOpaqueOff})`);
assert.equal(lowOpaqueOn, 0, 'düzeltme: arkada opak saçak noktası yok');
assert.ok(opaqueOn >= opaqueOff * 0.97, `yüz/iç yüzey kapsaması korunur ${opaqueOn}/${opaqueOff}`);

// 5. Kablolar: fotoğraf iç geçişi karşıt çift kuralını, motor fotoğrafta kenar ayıklamayı kullanır; video kullanmaz.
const src = readFileSync(new URL('../src/depth.ts', import.meta.url), 'utf8');
assert.match(src, /const inside = limitDepthSlope\(normalized, outWidth, outHeight, subject, MAX_SLOPE_PER_PX, 4, true\)/);
const engine = readFileSync(new URL('../src/engine/Engine.ts', import.meta.url), 'utf8');
assert.match(engine, /photoEdgeCull: !this\.videoTexture/);
for (const f of ['../src/engine/vision/liveDepth.ts', '../src/engine/vision/videoPrecompute.ts']) {
  assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /limitDepthSlope\([^)]*true\)/, `${f} çoğunlukta kalır`);
}
console.log('verify-photo-depth-edges OK', JSON.stringify({ majority, pairs, lowOpaqueOff, opaqueOff, opaqueOn }));
