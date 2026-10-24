import assert from 'node:assert/strict';
import { videoWindowIndices, alignVideoWindow, blendVideoSeam, quantizeVideoDepth } from '../src/engine/vision/videoPrecomputeWindow.ts';
import { prepareVideoDepth } from '../src/engine/vision/videoPrecompute.ts';

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
