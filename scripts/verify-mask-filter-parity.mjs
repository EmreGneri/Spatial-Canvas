// The faster mask filters (silhouette.ts minMaxPass / boxBlur) must give the SAME output as the
// previous implementation, bit for bit: photo masks and video masks are unchanged, only cheaper.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
const { minMaxPass, boxBlur, dilateAndFeatherMask } = await import('../src/engine/reconstruction/silhouette.ts');

// Previous implementation (e9cd25f), verbatim logic.
function oldMinMax(src, dst, w, h, r, horizontal, takeMax) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = takeMax ? -Infinity : Infinity;
    for (let d = -r; d <= r; d++) {
      const v = horizontal ? src[y * w + Math.min(w - 1, Math.max(0, x + d))] : src[Math.min(h - 1, Math.max(0, y + d)) * w + x];
      acc = takeMax ? (v > acc ? v : acc) : (v < acc ? v : acc);
    }
    dst[y * w + x] = acc;
  }
}
function oldBlur(src, w, h, radius) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), k = radius * 2 + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let dx = -radius; dx <= radius; dx++) s += src[y * w + Math.min(w - 1, Math.max(0, x + dx))]; tmp[y * w + x] = s / k; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let dy = -radius; dy <= radius; dy++) s += tmp[Math.min(h - 1, Math.max(0, y + dy)) * w + x]; out[y * w + x] = s / k; }
  return out;
}
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const [w, h] of [[1, 1], [3, 2], [7, 13], [64, 48], [57, 101]]) {
  // Soft mask with hard blobs: the shape a segmentation output has.
  const m = Float32Array.from({ length: w * h }, () => rnd() < 0.3 ? 1 : rnd() < 0.5 ? 0 : rnd());
  for (const r of [0, 1, 2, 4, 9])
    for (const horizontal of [true, false]) for (const takeMax of [true, false]) {
      const a = new Float32Array(w * h), b = new Float32Array(w * h);
      oldMinMax(m, a, w, h, r, horizontal, takeMax); minMaxPass(m, b, w, h, r, horizontal, takeMax);
      assert.deepEqual(b, a, `minMaxPass ${w}x${h} r${r} ${horizontal ? 'h' : 'v'} ${takeMax ? 'max' : 'min'}`);
    }
  for (const r of [0, 1, 2, 3, 7]) assert.deepEqual(boxBlur(m, w, h, r), oldBlur(m, w, h, r), `boxBlur ${w}x${h} r${r}`);
  const t = new Float32Array(w * h), d = new Float32Array(w * h);
  oldMinMax(m, t, w, h, 4, true, true); oldMinMax(t, d, w, h, 4, false, true);
  assert.deepEqual(dilateAndFeatherMask(m, w, h), oldBlur(d, w, h, 2), `dilateAndFeatherMask ${w}x${h}`);
}
// Speed on the video mask grid (576x1024, r = 4 / 2): reported, not asserted (machine dependent).
{
  const w = 576, h = 1024, m = Float32Array.from({ length: w * h }, () => (rnd() < 0.2 ? 1 : 0));
  const time = (f) => { f(); const t0 = performance.now(); for (let i = 0; i < 5; i++) f(); return (performance.now() - t0) / 5; };
  const tmp = new Float32Array(w * h);
  const before = time(() => { oldMinMax(m, tmp, w, h, 4, true, true); oldMinMax(tmp, m.slice(), w, h, 4, false, true); oldBlur(tmp, w, h, 2); });
  const after = time(() => dilateAndFeatherMask(m, w, h));
  console.log(`dilate+feather 576x1024: ${before.toFixed(1)} ms -> ${after.toFixed(1)} ms (Node)`);
}
console.log('verify-mask-filter-parity: OK · minMaxPass / boxBlur / dilateAndFeatherMask bit-identical to the previous filters');
