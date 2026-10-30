import assert from 'node:assert/strict';
import * as liveDepth from '../src/engine/vision/liveDepth.ts';
const { depthResultFromTensor, resetLiveDepthState } = liveDepth;

const width = 20;
const height = 20;
const base = Float32Array.from({ length: width * height }, (_, i) => i / (width * height - 1));
const shifted = Float32Array.from(base, (value) => value + 0.2);
const luminance = (value) => Float32Array.from(base, () => value);
const result = (data, time, mask = null, lum = null) =>
  depthResultFromTensor([height, width], Float32Array.from(data), mask, lum, null, time).data;

function sampleAfterFrames(frames, mask = null) {
  resetLiveDepthState();
  result(base, 0, mask);
  let depth;
  for (let frame = 1; frame <= frames; frame++) depth = result(shifted, frame / 10, mask);
  return depth[160];
}

// reference pipeline parity (2026-10-25): range endpoints move by a FIXED per-frame EMA
// (alpha 0.15), not by a media-time half-life. The earlier time-based alpha made
// v2 diverge from the reference pipeline's look at any inference rate other than ~10 Hz.
const one = sampleAfterFrames(1), five = sampleAfterFrames(5), thirty = sampleAfterFrames(30);
assert.ok(one > five && five > thirty, `range must keep converging frame by frame: ${one} ${five} ${thirty}`);
assert.ok(Math.abs(thirty - base[160]) < 0.03, `a persistent shift is absorbed after 30 frames: ${thirty}`);

// The foreground stretch range has its own per-frame EMA and still converges.
const mask = Float32Array.from(base, () => 1);
assert.ok(Number.isFinite(sampleAfterFrames(5, mask)));

// A cut changes both appearance and raw disparity; neither prior range nor
// per-pixel temporal history should contaminate the new scene.
resetLiveDepthState();
result(base, 0, null, luminance(0.2));
const afterCut = result(shifted, 0.25, null, luminance(0.8));
resetLiveDepthState();
const fresh = result(shifted, 0.25, null, luminance(0.8));
assert.ok(Math.abs(afterCut[160] - fresh[160]) < 1e-5,
  `scene cut inherits previous normalization: ${afterCut[160]} vs ${fresh[160]}`);

// reference pipeline parity: a live VIDEO frame is cropped to the subject box too
// (canliKirpmaKutusu; the embed grid edge-clamps outside the box).
const smallSubject = new Float32Array(width * height);
for (let y = 3; y < 17; y++) for (let x = 4; x < 16; x++) smallSubject[y * width + x] = 1;
assert.ok(liveDepth.canliKirpmaKutusu(smallSubject, width, height, null), 'subject box is produced for video');
assert.equal(liveDepth.chooseLiveCrop, undefined, 'no video-specific crop veto remains');

// Crop gate hysteresis: a box area hovering around a limit must not switch the crop on and off every refresh
// (a mask that alternates between one and two people does that). It starts only KIRPMA_HISTEREZIS inside the
// limits and, once on, keeps the old limits; the lower limit (measured regression zone) is never relaxed.
{
  const side = (n) => { const m = new Float32Array(100 * 100); for (let y = 10; y < 10 + n; y++) for (let x = 10; x < 10 + n; x++) m[y * 100 + x] = 1; return m; };
  const crop = (n, prev) => liveDepth.canliKirpmaKutusu(side(n), 100, 100, prev);
  const on = crop(57, null); // padded area 0.42: inside by more than the margin
  assert.ok(on, 'box above lower limit + margin starts the crop');
  assert.equal(crop(53, null), null, 'area 0.372: inside the margin, does not START the crop');
  assert.ok(crop(53, on), 'area 0.372 with the crop already on: stays on');
  assert.equal(crop(49, on), null, 'area 0.325: below the lower limit, off even when on (never relaxed)');
  assert.equal(crop(77, null), null, 'area 0.72: inside the upper margin, does not start');
  assert.ok(crop(77, on), 'area 0.72 with the crop on: stays on');
  assert.equal(crop(80, on), null, 'area 0.77: above the upper limit, off');
}

console.log('OK live temporal range (per-frame EMA), cut reset, and video crop policy');
