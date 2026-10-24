import assert from 'node:assert/strict';
const { createBufferedDepthReader } = await import('../src/engine/vision/bufferedVideoPlayback.ts');
const requests = [], published = [], misses = [];
const reader = createBufferedDepthReader({
  cache: { hasFrame: () => true, frameAt: (time) => new Promise(resolve => requests.push({ time, resolve })) },
  onFrame: frame => published.push(frame), onFallback: time => misses.push(time),
});
const color = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
reader.submit(1, color); reader.submit(2, color); reader.submit(3, color);
assert.equal(requests.length, 1, 'one disk read in flight');
requests[0].resolve({ data: new Float32Array([0.5]), width: 1, height: 1, mediaTime: 1 });
await new Promise(setImmediate);
assert.equal(requests.length, 2);
assert.equal(requests[1].time, 3, 'only the latest pending decoded frame is retained');
reader.reset();
requests[1].resolve({ data: new Float32Array([0.5]), width: 1, height: 1, mediaTime: 3 });
await new Promise(setImmediate);
assert.equal(published.length, 1, 'seek invalidates the old read');
reader.submit(4, color);
requests[2].resolve(null);
await new Promise(setImmediate);
assert.deepEqual(misses, [4], 'cache miss requests live fallback');
reader.dispose(); reader.submit(5, color);
assert.equal(requests.length, 3, 'disposed reader never starts new work');
assert.equal(published[0].colorFrame, color, 'RGB belongs to the exact decoded frame');
let lateFallback = false, latePublication = false;
const late = createBufferedDepthReader({
  cache: { hasFrame: () => true, frameAt: async () => ({ data: new Float32Array([0.5]), width: 1, height: 1, mediaTime: 1 }) },
  currentTime: () => 1.3,
  onFrame: () => { latePublication = true; },
  onFallback: () => { lateFallback = true; },
});
late.submit(1, color);
await new Promise(setImmediate);
assert.equal(lateFallback, true, 'successful but stale reads must resume live inference');
assert.equal(latePublication, false, 'stale cache frames cannot rewind the scene');
late.dispose();
console.log('OK buffered video: single read, latest frame, seek, cache miss, disposal, RGB alignment');
