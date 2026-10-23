// Cache correctness and discontinuities are CPU-only; real graph timings live in the benchmark.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
assert.ok(existsSync(new URL('../src/engine/vision/videoDepthAnything.ts', import.meta.url)), 'VDA streaming cache implementation must exist');
const { createVdaHistory, advanceVdaHistory, selectVdaHistory, packVdaCache, vdaResetReason } = await import('../src/engine/vision/videoDepthAnything.ts');

const history = createVdaHistory();
advanceVdaHistory(history, 'frame0');
assert.equal(history.frames.length, 32, 'Bootstrap repeats the first hidden states 32 times, as upstream');
assert.deepEqual(selectVdaHistory(history), new Array(31).fill('frame0'));
for (let i = 1; i <= 50; i++) advanceVdaHistory(history, `frame${i}`);
assert.equal(history.frames.length, 42, 'Official gap41 schedule must bound retained caches');
const selected = selectVdaHistory(history);
assert.equal(selected.length, 31);
assert.equal(selected[0], 'frame0', 'First anchor survives beyond the cache horizon');
assert.equal(selected[1], 'frame10', 'Second anchor follows the official delete-index1 schedule');
assert.equal(selected[2], 'frame22', 'Remaining 29 slots are the latest frames');
assert.equal(selected.at(-1), 'frame50');

assert.deepEqual(Array.from(packVdaCache([
  Float32Array.of(1, 2, 3, 4), Float32Array.of(5, 6, 7, 8),
], 2, 2)), [1, 2, 5, 6, 3, 4, 7, 8], 'Cache concatenation is spatial, time, channel (not frame-major)');
assert.throws(() => packVdaCache([Float32Array.of(1)], 2, 2), /shape/);

const previous = { sourceId: 'a', time: 1, width: 640, height: 360, signature: Float32Array.of(0.2, 0.3) };
assert.equal(vdaResetReason(previous, { ...previous, time: 1.1 }), null);
assert.equal(vdaResetReason(previous, { ...previous, sourceId: 'b', time: 1.1 }), 'source');
assert.equal(vdaResetReason(previous, { ...previous, time: 0.9 }), 'seek');
assert.equal(vdaResetReason(previous, { ...previous, time: 3 }), 'gap');
assert.equal(vdaResetReason(previous, { ...previous, width: 320, time: 1.1 }), 'dimensions');
assert.equal(vdaResetReason(previous, { ...previous, time: 1.1, signature: Float32Array.of(0.9, 0.9) }), 'scene-cut');
assert.equal(vdaResetReason(null, previous), 'initial');
console.log('verify-video-depth-anything: official cache schedule, packing and discontinuities passed');
