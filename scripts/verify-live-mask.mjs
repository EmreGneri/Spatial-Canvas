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
