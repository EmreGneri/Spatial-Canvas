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

function sampleAfterOneSecond(hz, mask = null) {
  resetLiveDepthState();
  result(base, 0, mask);
  let depth;
  for (let frame = 1; frame <= hz; frame++) depth = result(shifted, frame / hz, mask);
  return depth[160];
}

// The same one-second video transition must not depend on GPU inference rate.
const threeHz = sampleAfterOneSecond(3);
const fiveHz = sampleAfterOneSecond(5);
assert.ok(Math.abs(threeHz - fiveHz) < 0.015,
  `3 Hz and 5 Hz normalization differ after the same media time: ${threeHz} vs ${fiveHz}`);
assert.ok(threeHz < 0.48,
  `the normalized range still trails one second after a persistent change: ${threeHz}`);

// A foreground stretch has its own range state and must obey the same clock.
const mask = Float32Array.from(base, () => 1);
const threeHzMasked = sampleAfterOneSecond(3, mask);
const fiveHzMasked = sampleAfterOneSecond(5, mask);
assert.ok(Math.abs(threeHzMasked - fiveHzMasked) < 0.025,
  `foreground stretch varies with inference rate: ${threeHzMasked} vs ${fiveHzMasked}`);

// A cut changes both appearance and raw disparity; neither prior range nor
// per-pixel temporal history should contaminate the new scene.
resetLiveDepthState();
result(base, 0, null, luminance(0.2));
const afterCut = result(shifted, 0.25, null, luminance(0.8));
resetLiveDepthState();
const fresh = result(shifted, 0.25, null, luminance(0.8));
assert.ok(Math.abs(afterCut[160] - fresh[160]) < 1e-5,
  `scene cut inherits previous normalization: ${afterCut[160]} vs ${fresh[160]}`);

// A mask must not make live video invent the rest of the frame by extending
// the cropped model prediction to every edge pixel.
const smallSubject = new Float32Array(width * height);
for (let y = 3; y < 17; y++) for (let x = 4; x < 16; x++) smallSubject[y * width + x] = 1;
assert.equal(liveDepth.chooseLiveCrop(smallSubject, width, height, null, true), null);
assert.ok(liveDepth.chooseLiveCrop(smallSubject, width, height, null, false));

console.log('OK live temporal range, cut reset, and video crop policy');
