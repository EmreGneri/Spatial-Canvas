import assert from 'node:assert/strict';
const { createBufferedDepthReader, MISS_TOLERANCE_MS } = await import('../src/engine/vision/bufferedVideoPlayback.ts');
const tick = () => new Promise(setImmediate);
const requests = [], published = [], misses = [];
const reader = createBufferedDepthReader({
  cache: { hasFrame: () => true, frameAt: (time) => new Promise(resolve => requests.push({ time, resolve })) },
  onFrame: frame => published.push(frame), onFallback: time => misses.push(time),
});
reader.submit(1); reader.submit(2); reader.submit(3);
assert.equal(requests.length, 1, 'one disk read in flight');
requests[0].resolve({ data: new Float32Array([0.5]), width: 1, height: 1, mediaTime: 1 });
await tick();
assert.equal(requests.length, 2);
assert.equal(requests[1].time, 3, 'only the latest pending decoded frame is retained');
reader.reset();
requests[1].resolve({ data: new Float32Array([0.5]), width: 1, height: 1, mediaTime: 3 });
await tick();
assert.equal(published.length, 1, 'seek invalidates the old read');
reader.submit(4);
requests[2].resolve(null);
await tick();
assert.deepEqual(misses, [], 'one failed read keeps the last prepared frame (no live fallback)');
reader.dispose(); reader.submit(5);
assert.equal(requests.length, 3, 'disposed reader never starts new work');

// F1: late reads drop only that frame; live fallback needs a sustained miss.
let clock = 0, current = 1.3, published2 = 0;
const fallbacks = [];
const late = createBufferedDepthReader({
  cache: { hasFrame: () => true, frameAt: async (t) => ({ data: new Float32Array([0.5]), width: 1, height: 1, mediaTime: t }) },
  currentTime: () => current, now: () => clock,
  onFrame: () => { published2++; }, onFallback: t => fallbacks.push(t),
});
late.submit(1); await tick();
assert.equal(published2, 0, 'stale cache frames cannot rewind the scene');
assert.equal(fallbacks.length, 0, 'a single late read is not a fallback');
clock = MISS_TOLERANCE_MS / 2; late.submit(1.04); await tick();
assert.equal(fallbacks.length, 0, 'short read delays keep prepared playback');
current = 1.08; clock += 10; late.submit(1.08); await tick();
assert.equal(published2, 1, 'a fresh read publishes and clears the miss streak');
current = 3; clock += 10; late.submit(2); await tick();
clock += MISS_TOLERANCE_MS - 1; late.submit(2.04); await tick();
assert.equal(fallbacks.length, 0);
clock += 2; late.submit(2.08); await tick();
assert.equal(fallbacks.length, 1, 'sustained misses switch to live depth exactly once');
late.dispose();

// A region that is not prepared is a real gap: immediate fallback.
const gaps = [];
const gap = createBufferedDepthReader({ cache: { hasFrame: () => false, frameAt: async () => null }, onFrame: () => {}, onFallback: t => gaps.push(t) });
gap.submit(7);
assert.deepEqual(gaps, [7]);

// A hung read is never overlapped, but it cannot pin prepared mode forever either.
let hungClock = 0; const hungFallbacks = []; let hungReads = 0;
const hung = createBufferedDepthReader({
  cache: { hasFrame: () => true, frameAt: () => { hungReads++; return new Promise(() => {}); } },
  now: () => hungClock, onFrame: () => {}, onFallback: t => hungFallbacks.push(t),
});
hung.submit(1); hungClock = 100; hung.submit(1.04); hungClock = 100 + MISS_TOLERANCE_MS; hung.submit(1.08);
assert.equal(hungReads, 1, 'no overlapping reads');
assert.deepEqual(hungFallbacks, [1.08]);
console.log('OK buffered video: single read, latest frame, seek, hysteresis, real gaps, hung reads, disposal');
