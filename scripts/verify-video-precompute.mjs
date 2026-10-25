import assert from 'node:assert/strict';
import { videoWindowIndices, alignVideoWindow, blendVideoSeam, quantizeVideoDepth } from '../src/engine/vision/videoPrecomputeWindow.ts';
import { detailPreparedDepth, prepareVideoDepth, videoDepthRange, videoPreparationPolicy, estimatePreparationSeconds, AUTO_PREPARE_MAX_SECONDS } from '../src/engine/vision/videoPrecompute.ts';

const first = videoWindowIndices(0, 70);
const second = videoWindowIndices(22, 70, first);
assert.deepEqual(second.slice(0, 10), [0, 12, 24, 25, 26, 27, 28, 29, 30, 31]);
assert.deepEqual(second.slice(10), Array.from({ length: 22 }, (_, i) => i + 32));
const third = videoWindowIndices(44, 70, second);
assert.deepEqual(third.slice(0, 2), [0, 34]);
assert.equal(videoWindowIndices(66, 70, third).at(-1), 69);
assert.deepEqual(videoWindowIndices(0, 1), new Array(32).fill(0));
assert.throws(() => videoWindowIndices(0, 0));
const [scale, shift] = alignVideoWindow([new Float32Array([1, 2]), new Float32Array([3, 4])], [new Float32Array([5, 7]), new Float32Array([9, 11])]);
assert.equal(scale, 2); assert.equal(shift, 3);
assert.deepEqual(Array.from(blendVideoSeam(new Float32Array([2]), new Float32Array([9]), 0)), [2]);
assert.deepEqual(Array.from(blendVideoSeam(new Float32Array([2]), new Float32Array([9]), 7)), [9]);
const packed = quantizeVideoDepth(new Float32Array([10, 15, 20]), 10, 20);
assert.deepEqual(Array.from(packed), [0, 32768, 65535]);
// Same scene range, distinct frames retain their relative position (no per-frame renormalization).
assert.equal(quantizeVideoDepth(new Float32Array([15]), 10, 20)[0], packed[1]);
assert.deepEqual(Array.from(quantizeVideoDepth(new Float32Array([7]), 7, 7)), [0]);
// F8: one hot pixel cannot stretch the scene range (percentiles, not min/max).
const sceneSamples = Array.from({ length: 1000 }, (_, i) => i / 999);
sceneSamples[500] = 1e6;
const [lo, hi] = videoDepthRange(sceneSamples);
assert.ok(lo < 0.02 && hi > 0.97 && hi < 1, `robust range ${lo}..${hi}`);
assert.deepEqual(videoDepthRange([]), [0, 0]);
// Item 6 policy: short videos prepare automatically, long ones ask, the setting can turn it off.
assert.equal(videoPreparationPolicy(16, true), 'auto');
assert.equal(videoPreparationPolicy(AUTO_PREPARE_MAX_SECONDS - 1, true), 'auto');
assert.equal(videoPreparationPolicy(AUTO_PREPARE_MAX_SECONDS, true), 'ask');
assert.equal(videoPreparationPolicy(16, false), 'off');
assert.equal(videoPreparationPolicy(Number.NaN, true), 'off');
assert.ok(estimatePreparationSeconds(300) >= 300, 'estimate is never faster than real time');

// Prepared frames get the live post-process (detail from stored RGB; mask: stretch + sobel).
{
  const w = 40, h = 30, n = w * h;
  const flatDepth = new Uint16Array(n).fill(Math.round(0.6 * 65535));
  const rgba = (f) => { const out = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { const v = f(i % w, Math.floor(i / w)); out.set([v, v, v, 255], i * 4); } return out; };
  const spread = (a, sel = () => true) => { let lo = 1, hi = 0; a.forEach((v, i) => { if (sel(i)) { lo = Math.min(lo, v / 65535); hi = Math.max(hi, v / 65535); } }); return hi - lo; };
  const plain = detailPreparedDepth(flatDepth, rgba(() => 128), w, h);
  assert.ok(spread(plain) < 1e-3, 'uniform RGB adds no relief to flat depth');
  const textured = detailPreparedDepth(flatDepth, rgba((x, y) => ((x >> 1) + (y >> 1)) % 2 ? 230 : 30), w, h);
  assert.ok(spread(textured) > 0.02, `RGB detail adds relief: ${spread(textured)}`);
  // A subject squeezed into a narrow band is stretched open when the mask track exists.
  const subject = (i) => (i % w) >= 10 && (i % w) < 30 && Math.floor(i / w) >= 5 && Math.floor(i / w) < 25;
  const squeezed = Uint16Array.from({ length: n }, (_, i) => Math.round((subject(i) ? 0.70 + 0.04 * ((i % w) - 10) / 20 : 0.2) * 65535));
  const mask = Float32Array.from({ length: n }, (_, i) => subject(i) ? 1 : 0);
  const masked = detailPreparedDepth(squeezed, rgba(() => 128), w, h, mask);
  const inner = (i) => (i % w) >= 12 && (i % w) < 28 && Math.floor(i / w) >= 7 && Math.floor(i / w) < 23;
  assert.ok(spread(masked, inner) > 2 * spread(squeezed, inner), `mask stretch widens subject: ${spread(squeezed, inner)} -> ${spread(masked, inner)}`);
  assert.ok(masked.every(v => v >= 0 && v <= 65535));
}
let dispose = 0;
const stages = [];
const handle = await prepareVideoDepth(new Blob(), {
  provider: { width: 2, height: 1, infer: async () => [], dispose: async () => { dispose++; } },
  onProgress: progress => stages.push(progress.stage),
});
await handle.done;
assert.equal(handle.hasFrame(0), false);
assert.equal(await handle.frameAt(0), null);
assert.deepEqual(stages, ['loading', 'fallback']);
assert.equal(dispose, 1);
await handle.dispose();
const abort = new AbortController(); abort.abort();
const cancelled = [];
const cancelledHandle = await prepareVideoDepth(new Blob(), { signal: abort.signal, onProgress: p => cancelled.push(p.stage) });
await cancelledHandle.done;
assert.deepEqual(cancelled, ['loading', 'cancelled']);
assert.equal(cancelledHandle.hasFrame(0), false);
await cancelledHandle.dispose();
console.log('video precompute: official anchors, padding, affine alignment, seam endpoints, shared Uint16 range, fallback, cancellation passed');
