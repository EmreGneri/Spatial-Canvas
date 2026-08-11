// volume.ts sözleşme testi (GPU gerekmez, saf CPU).
//   node scripts/verify-volume.mjs
import assert from 'node:assert/strict';
import { calculateVolumeMaps } from '../src/engine/reconstruction/volume.ts';

const W = 4;
const H = 4;
const N = W * H;
const depth = new Float32Array(N).fill(0.5);
const mask = new Float32Array(N).fill(1);
const edge = new Float32Array(N).fill(0);

// --- 1. depth = 0.5 → zFront = 0 (varsayılan aralık 2.0) ---
let v = calculateVolumeMaps(depth, mask, edge, W, H);
assert.equal(v.zFrontMap[0], 0);

// --- 2. mask = 1, edge = 0 → thickness = tMax (0.5) ---
assert.equal(v.thicknessMap[0], 0.5);

// --- 3. edge = 1 → thickness = 0 ---
v = calculateVolumeMaps(depth, mask, new Float32Array(N).fill(1), W, H);
assert.equal(v.thicknessMap[0], 0);

// --- 4. mask = 0 → thickness KESİN 0 ---
v = calculateVolumeMaps(depth, new Float32Array(N).fill(0), edge, W, H);
assert.equal(v.thicknessMap[0], 0);
assert.equal(v.zBackMap[0], v.zFrontMap[0]);

// --- 5. her pikselde zBack <= zFront (rastgele girdilerle) ---
const rnd = (n) => Float32Array.from({ length: n }, () => Math.random());
v = calculateVolumeMaps(rnd(N), rnd(N), rnd(N), W, H);
for (let i = 0; i < N; i++) {
  assert.ok(v.zBackMap[i] <= v.zFrontMap[i] + 1e-6, `zBack > zFront @ ${i}`);
}

// --- 6. front/back hiçbir zaman [-1, +1] dışına çıkmaz ---
const dEdge = new Float32Array(N);
dEdge.fill(0);
dEdge[1] = 1;
v = calculateVolumeMaps(dEdge, mask, edge, W, H);
assert.equal(v.zFrontMap[0], -1);
assert.equal(v.zFrontMap[1], 1);
// devasa tMax bile back'i sınırdan çıkaramaz
v = calculateVolumeMaps(dEdge, mask, edge, W, H, { tMax: 10 });
assert.equal(v.zBackMap[0], -1);
assert.equal(v.zBackMap[1], -1);
for (let i = 0; i < N; i++) {
  assert.ok(v.zFrontMap[i] >= -1 && v.zFrontMap[i] <= 1);
  assert.ok(v.zBackMap[i] >= -1 && v.zBackMap[i] <= 1);
}

// --- 7. tMax override ---
v = calculateVolumeMaps(depth, mask, edge, W, H, { tMax: 0.2 });
assert.ok(Math.abs(v.thicknessMap[0] - 0.2) < 1e-6);

// --- 8. pointsDepthRange override ---
v = calculateVolumeMaps(new Float32Array(N).fill(0.8), mask, edge, W, H, {
  pointsDepthRange: 1,
});
assert.ok(Math.abs(v.zFrontMap[0] - 0.3) < 1e-6); // (0.8 − 0.5) · 1 = 0.3, clamp'a takılmadı

// --- 9. boyut uyumsuzluğu → RangeError, sessiz devam yok ---
assert.throws(
  () => calculateVolumeMaps(new Float32Array(N - 1), mask, edge, W, H),
  RangeError,
);
assert.throws(
  () => calculateVolumeMaps(depth, new Float32Array(N - 1), edge, W, H),
  RangeError,
);
assert.throws(
  () => calculateVolumeMaps(depth, mask, new Float32Array(N + 1), W, H),
  RangeError,
);

// --- ek: NaN/Infinity geometriye sızmaz ---
const dNaN = new Float32Array(N);
dNaN.fill(NaN);
dNaN[1] = Infinity;
v = calculateVolumeMaps(dNaN, mask, edge, W, H);
for (let i = 0; i < N; i++) {
  assert.ok(Number.isFinite(v.zFrontMap[i]));
  assert.ok(Number.isFinite(v.zBackMap[i]));
  assert.ok(Number.isFinite(v.thicknessMap[i]));
}

console.log('OK · volume maps (zFront/zBack/thickness, sınırlar, overrides, boyut güvenliği)');
