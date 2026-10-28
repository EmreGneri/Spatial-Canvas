import assert from 'node:assert/strict';
import test from 'node:test';
const { createBufferedDepthReader, startBufferedVideoPlayback, MISS_TOLERANCE_MS } = await import('../src/engine/vision/bufferedVideoPlayback.ts');
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

const frame = mediaTime => ({ data: new Float32Array([0.5]), width: 1, height: 1, mediaTime });
function playbackFixture() {
  const video = new EventTarget();
  let callback, enabled = true;
  Object.assign(video, {
    currentTime: 1, seeking: false, readyState: 2,
    requestVideoFrameCallback: fn => { callback = fn; return 1; },
    cancelVideoFrameCallback: () => { callback = undefined; },
  });
  const requests = [], published = [], fallbacks = [];
  const stop = startBufferedVideoPlayback(video, {
    hasFrame: () => true,
    frameAt: time => new Promise((resolve, reject) => requests.push({ time, resolve, reject })),
  }, { enabled: () => enabled, onFrame: value => published.push(value), onFallback: time => fallbacks.push(time) });
  return {
    video, requests, published, fallbacks, stop,
    enable(value) { enabled = value; },
    present(time = video.currentTime) { video.currentTime = time; callback?.(0, { mediaTime: time }); },
  };
}

for (const newTick of [false, true]) test(`disable invalidates a deferred read ${newTick ? 'with' : 'without'} a new video tick`, async () => {
  const p = playbackFixture();
  try {
    p.present(1.04); // Keep a target queued behind the initial read.
    p.enable(false);
    if (newTick) p.present();
    p.requests[0].resolve(frame(1));
    await tick();
    assert.equal(p.published.length, 0, 'disabled prepared playback cannot publish an old read');
    assert.equal(p.requests.length, 1, 'disable discards the old pending target');
    assert.ok(p.fallbacks.length > 0, 'disabled prepared playback returns to live depth');
    p.enable(true);
    p.present();
    assert.equal(p.requests.length, 2, 'the same timestamp can be requested after re-enabling');
    p.requests[1].resolve(frame(1.04));
    await tick();
    assert.deepEqual(p.published.map(x => x.mediaTime), [1.04]);
  } finally { p.stop(); }
});

test('a re-enabled target waits for the invalidated read to finish', async () => {
  const p = playbackFixture();
  try {
    p.enable(false); p.present();
    p.enable(true); p.present();
    assert.equal(p.requests.length, 1, 'invalidation never overlaps disk work');
    p.requests[0].resolve(frame(1));
    await tick();
    assert.equal(p.published.length, 0, 're-enabling cannot revive an invalidated read');
    assert.equal(p.requests.length, 2, 'the new epoch retains its latest target');
    p.requests[1].resolve(frame(1)); await tick();
    assert.equal(p.published.length, 1);
  } finally { p.stop(); }
});

test('seek and stop invalidate deferred publication and queued work', async () => {
  const p = playbackFixture();
  try {
    p.present(1.04);
    p.video.seeking = true; p.video.dispatchEvent(new Event('seeking'));
    p.requests[0].resolve(frame(1)); await tick();
    assert.equal(p.published.length, 0);
    assert.equal(p.requests.length, 1, 'seek drops the pending target');
    p.video.currentTime = 0.5; p.video.seeking = false; p.video.dispatchEvent(new Event('seeked'));
    assert.equal(p.requests[1].time, 0.5);
    p.present(0.54); p.stop();
    p.requests[1].resolve(frame(0.5)); await tick();
    assert.equal(p.published.length, 0);
    assert.equal(p.requests.length, 2, 'stop drops the pending target');
  } finally { p.stop(); }
});

test('source stamps survive publication and determine monotonic ordering', async () => {
  const published = [];
  const sources = [frame(0.96), frame(0.94), frame(1.02)];
  const reader = createBufferedDepthReader({
    cache: { hasFrame: () => true, frameAt: async () => sources.shift() },
    onFrame: value => published.push(value),
  });
  try {
    reader.submit(1); await tick();
    assert.equal(published[0].mediaTime, 0.96, 'cache timestamps must not be relabelled as request timestamps');
    reader.submit(1.04); await tick();
    assert.deepEqual(published.map(x => x.mediaTime), [0.96], 'an increasing request cannot publish a regressing source stamp');
    reader.submit(1.08); await tick();
    assert.deepEqual(published.map(x => x.mediaTime), [0.96, 1.02]);
    reader.reset(); sources.push(frame(0.4));
    reader.submit(0.4); await tick();
    assert.deepEqual(published.map(x => x.mediaTime), [0.96, 1.02, 0.4], 'seeking starts a new source timestamp epoch');
  } finally { reader.dispose(); }
});

test('publication copies the frame object while preserving shared buffer ownership', async () => {
  const source = { ...frame(0.96), mask: new Float32Array([1]) };
  let published;
  const reader = createBufferedDepthReader({
    cache: { hasFrame: () => true, frameAt: async () => source },
    onFrame: value => { published = value; value.mediaTime = 9; },
  });
  try {
    reader.submit(1); await tick();
    assert.equal(source.mediaTime, 0.96, 'presenter metadata mutation cannot alter a cache-owned frame');
    assert.notEqual(published, source);
    assert.equal(published.data, source.data, 'depth buffer sharing is unchanged');
    assert.equal(published.mask, source.mask, 'mask buffer sharing is unchanged');
  } finally { reader.dispose(); }
});

for (const sourceTime of [NaN, Infinity, -Infinity, -0.01, 0.7, 1.3]) test(`reject invalid or stale actual source stamp ${sourceTime}`, async () => {
  const published = [], fallbacks = [];
  const reader = createBufferedDepthReader({
    cache: { hasFrame: () => true, frameAt: async () => frame(sourceTime) },
    onFrame: value => published.push(value), onFallback: time => fallbacks.push(time),
  });
  try {
    reader.submit(1); await tick();
    assert.equal(published.length, 0, 'fresh requests cannot disguise invalid/stale source timestamps');
    assert.equal(fallbacks.length, 0, 'a single rejected source frame preserves fallback hysteresis');
  } finally { reader.dispose(); }
});

test('first-frame cache clamping accepts a bounded future source stamp unchanged', async () => {
  const published = [];
  const reader = createBufferedDepthReader({
    cache: { hasFrame: () => true, frameAt: async () => frame(0.04) },
    onFrame: value => published.push(value),
  });
  try {
    reader.submit(0); await tick();
    assert.deepEqual(published.map(x => x.mediaTime), [0.04]);
  } finally { reader.dispose(); }
});

test('freshness uses the actual source stamp and current playback time when a read settles', async () => {
  let currentTime = 1;
  const reads = [], published = [];
  const reader = createBufferedDepthReader({
    cache: { hasFrame: () => true, frameAt: time => new Promise(resolve => reads.push({ time, resolve })) },
    currentTime: () => currentTime, onFrame: value => published.push(value),
  });
  try {
    reader.submit(1);
    currentTime = 1.2; reads[0].resolve(frame(0.9)); await tick();
    assert.equal(published.length, 0, 'a fresh request cannot disguise a source that became stale during IO');
    reader.submit(1.2);
    currentTime = 1.5; reads[1].resolve(frame(1.2)); await tick();
    assert.equal(published.length, 0, 'playback advancement is checked after IO');
    reader.submit(1.5);
    reads[2].resolve(frame(1.48)); await tick();
    assert.deepEqual(published.map(x => x.mediaTime), [1.48], 'fresh actual source stamps still recover');
  } finally { reader.dispose(); }
});

test('eligibility changes inside onFrame do not swallow its callback error', async () => {
  let enabled = true;
  const errors = [], failure = new Error('presenter failure');
  const reader = createBufferedDepthReader({
    cache: { hasFrame: () => true, frameAt: async () => frame(1) },
    enabled: () => enabled,
    onFrame: () => { enabled = false; throw failure; },
    onError: error => errors.push(error),
  });
  try {
    reader.submit(1); await tick();
    assert.deepEqual(errors, [failure], 'the existing onError path still reports presenter exceptions');
  } finally { reader.dispose(); }
});

test('a rejected read after disable clears pending work and permits a same-time retry', async () => {
  const p = playbackFixture();
  try {
    p.enable(false);
    p.requests[0].reject(new Error('disk failure')); await tick();
    assert.equal(p.published.length, 0);
    assert.equal(p.requests.length, 1);
    p.enable(true); p.present();
    assert.equal(p.requests.length, 2);
    p.requests[1].resolve(frame(1)); await tick();
    assert.equal(p.published.length, 1);
  } finally { p.stop(); }
});
