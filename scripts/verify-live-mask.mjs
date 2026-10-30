import assert from 'node:assert/strict';
import { captureLiveMask } from '../src/engine/vision/liveMask.ts';

const source = { width: 8, height: 4 };
const mask = new Float32Array([1, 0.7]);
const refined = new Float32Array([0.9, 0.3]);
const calls = [];
const dependencies = {
  selection: 'otomatik',
  segmentForeground: async (...args) => {
    calls.push(args);
    return { mask, width: 2, height: 1, model: 'birefnet' };
  },
  applyDavidMask: async (...args) => {
    calls.push(args);
    return { maske: refined };
  },
};
assert.deepEqual(await captureLiveMask(source, 'webgpu', dependencies), {
  data: refined, width: 2, height: 1, model: 'david',
});
assert.deepEqual(calls, [[source, 'webgpu', 'foto'], ['otomatik', source, mask, 2, 1]]);

// A missing optional DAViD result preserves the segmentation and its provenance.
assert.deepEqual(await captureLiveMask(source, 'wasm', {
  ...dependencies, applyDavidMask: async () => null,
}), { data: mask, width: 2, height: 1, model: 'birefnet' });

// Segmentation failure must reach the caller so it can retain its last valid mask.
await assert.rejects(captureLiveMask(source, 'webgpu', {
  ...dependencies, segmentForeground: async () => { throw new Error('segmentation unavailable'); },
}), /segmentation unavailable/);
console.log('live mask: source alignment, quality path and fallback passed');

// Image tracker (replaces the depth-centroid shift): follows the masked pixels, not the nearest depth.
{
  const { estimateMaskShift, shiftLiveMask, MASK_TRACK_LOST } = await import('../src/engine/vision/liveMask.ts');
  const W = 192, H = 108;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bg = Float32Array.from({ length: W * H }, rnd), tex = Float32Array.from({ length: 30 * 30 }, rnd);
  const frame = (sx, sy, gain = 0, background = bg) => { const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const inside = x >= sx && x < sx + 30 && y >= sy && y < sy + 30;
      const v = 255 * Math.min(1, (inside ? 0.3 + 0.6 * tex[((y - sy) >> 2) * 30 + ((x - sx) >> 2)] : 0.1 + 0.2 * background[(y >> 2) * W + (x >> 2)]) + gain);
      d.set([v, v, v, 255], (y * W + x) * 4); } return { data: d, width: W, height: H }; };
  // Mask at 2x the frame resolution, as the app's mask grid differs from the colour frame grid.
  const mask = { width: W * 2, height: H * 2, data: new Float32Array(W * H * 4) };
  for (let y = 80; y < 140; y++) for (let x = 120; x < 180; x++) mask.data[y * mask.width + x] = 1;
  const from = frame(60, 40);
  const still = estimateMaskShift(mask, from, from);
  assert.deepEqual([still.dx, still.dy, still.lost], [0, 0, false], 'unchanged frame: no shift');
  const moved = estimateMaskShift(mask, from, frame(72, 34));
  assert.ok(Math.abs(moved.dx - 12 / W) < 0.011 && Math.abs(moved.dy + 6 / H) < 0.02 && !moved.lost, `subject motion followed (${moved.dx}, ${moved.dy})`);
  const lit = estimateMaskShift(mask, from, frame(72, 34, 0.08));
  assert.ok(Math.abs(lit.dx - moved.dx) < 1e-9 && Math.abs(lit.dy - moved.dy) < 1e-9, 'a brightness change is not motion');
  const other = Float32Array.from({ length: W * H }, rnd);
  const cut = estimateMaskShift(mask, from, frame(-100, -100, 0.3, other)); // another shot, no subject
  assert.ok(cut.lost && cut.error > MASK_TRACK_LOST, `a different image is reported lost (${cut.error})`);
  const out = shiftLiveMask(mask, moved);
  assert.equal(out[100 * mask.width + 125], 0, 'old left edge cleared');
  assert.equal(out[(100 + Math.round(moved.dy * mask.height)) * mask.width + 181], 1, 'new right edge set');
  assert.equal(mask.data[100 * mask.width + 125], 1, 'captured mask untouched');
  assert.equal(estimateMaskShift({ ...mask, data: new Float32Array(mask.data.length) }, from, from), null, 'empty mask: nothing to track');
  assert.equal(estimateMaskShift(mask, from, { data: new Uint8ClampedArray(16), width: 2, height: 2 }), null, 'size change: no estimate');
}
console.log('live mask: image tracker follows motion, ignores lighting, reports a cut as lost');
