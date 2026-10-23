import assert from 'node:assert/strict';
const { mogePhotoResult } = await import('../src/engine/vision/mogePhoto.ts');
const W = 16, H = 12, focal = 1.8, shift = .35, scale = 2;
const points = new Float32Array(W * H * 3), mask = new Float32Array(W * H).fill(1);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, z = 1 + .3 * x / W + .2 * y / H;
  points.set([(2*x+1-W)/Math.hypot(W,H)*z/focal,
    (2*y+1-H)/Math.hypot(W,H)*z/focal, z-shift], i*3);
}
const raw = { points, mask, metricScale: scale, width: W, height: H, backend: 'webgpu' };
const rect = { x: 2, y: 1, w: 12, h: 10 };
const result = mogePhotoResult(raw, rect);
assert.equal(result.width, 12);
assert.equal(result.height, 10);
assert.equal(result.metricGeometry.depth.length, 120);
assert.ok(Math.abs(result.metricGeometry.depth[0] - 2*(1+.3*2/16+.2/12)) < 1e-5);
const K = result.metricGeometry.intrinsics;
assert.ok(Math.abs(K[0] - focal*Math.hypot(W,H)/(2*rect.w)) < 1e-5);
assert.ok(Math.abs(K[2] - (W/2-rect.x)/rect.w) < 1e-5);
assert.ok(result.data.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
assert.ok(result.data[0] > result.data.at(-1), 'near depth polarity');
assert.equal(result.moge.backend, 'webgpu');
assert.throws(() => mogePhotoResult(raw, { ...rect, w: 0 }));

// Plausibility gates throw -> estimateDepth logs and uses the default chain.
const { MOGE_LIMITS } = await import('../src/engine/vision/mogePhoto.ts');
const synth = (f, noise = 0, validCount = W * H) => {
  const p = new Float32Array(W * H * 3), m = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, z = 1 + .3 * x / W + .2 * y / H, n = noise * Math.sin(i * 12.9898) ;
    p.set([((2*x+1-W)/Math.hypot(W,H) + n)*z/f, (2*y+1-H)/Math.hypot(W,H)*z/f, z-shift], i*3);
    m[i] = i < validCount ? 1 : 0;
  }
  return { ...raw, points: p, mask: m };
};
const full = { x: 0, y: 0, w: W, h: H };
assert.ok(mogePhotoResult(synth(1.8), full).metricGeometry, 'plausible synthetic camera accepted');
assert.throws(() => mogePhotoResult(synth(.1), full), /focal/, 'ultra-wide (>160 deg) focal rejected');
assert.throws(() => mogePhotoResult(synth(40), full), /focal/, 'extreme telephoto focal rejected');
assert.throws(() => mogePhotoResult(synth(1.8, .3), full), /residual/, 'non-pinhole points rejected');
assert.throws(() => mogePhotoResult(synth(1.8, 0, 1), full), undefined, 'near-empty validity mask rejected');
assert.ok(MOGE_LIMITS.maxProjectionRmse > 0.002, 'limit is above the measured synthetic residual ~0.0015');

// Flag: only ?derinlik=moge enables MoGe; absent flag keeps the exact default.
const { mogeIstendi, FOTO_KALITE } = await import('../src/depth.ts');
assert.equal(mogeIstendi('?derinlik=moge'), true);
for (const q of ['', '?derinlik=MoGe', '?derinlik=da3', '?moge=1', '?yuz=0']) assert.equal(mogeIstendi(q), false, q);
assert.deepEqual(FOTO_KALITE, { tileDetay: true, kenarHizalama: 0.5, model: 'da3-mono' }, 'default photo options unchanged');
console.log('OK MoGe photo: metric crop, camera K, near/far display and diagnostics');
