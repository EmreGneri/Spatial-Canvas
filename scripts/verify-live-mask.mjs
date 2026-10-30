import assert from 'node:assert/strict';
import { captureLiveMask, trackLiveMask } from '../src/engine/vision/liveMask.ts';

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

// Translation tracking must follow small visible motion without another model call.
{
  const width = 100, height = 80;
  const data = new Float32Array(width * height);
  for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) data[y * width + x] = 1;
  const mask = { data, width, height };
  const center = { x: 0.4, y: 0.5, oran: 0.2 };
  const moved = { ...center, x: 0.43 };
  const tracked = trackLiveMask(mask, center, moved, 0, 0.25);
  assert.equal(tracked.data[30 * width + 22], 0, 'a three-pixel shift leaves the old edge immediately');
  assert.equal(tracked.data[30 * width + 62], 1, 'small motion reaches the new edge');
  assert.equal(tracked.center, moved);
  assert.ok(Math.abs(tracked.distance - 0.03) < 1e-6);
  assert.equal(mask.data[30 * width + 22], 1, 'the captured mask stays immutable');
  const jitter = trackLiveMask(mask, center, { ...center, x: 0.405 }, 0, 0.25);
  assert.equal(jitter.data, data, 'subpixel jitter does not allocate or drift');
  assert.equal(jitter.center, center, 'small motion accumulates against the same anchor');
  assert.equal(trackLiveMask(mask, center, moved, 0.24, 0.25).data, data, 'cumulative drift remains bounded');
  assert.equal(trackLiveMask(mask, center, { ...moved, oran: 0.001 }, 0, 0.25).data, data, 'tiny depth regions are not motion evidence');
  assert.equal(trackLiveMask(mask, null, moved, 0, 0.25).center, moved, 'first frame installs an anchor');
}
console.log('live mask: low-latency translation, jitter rejection and drift budget passed');
