import assert from 'node:assert/strict';
import {
  advanceLiveQuality,
  createLiveQualityState,
  liveQualityInputSize,
} from '../src/engine/vision/liveDepth.ts';

let state = createLiveQualityState();
assert.equal(liveQualityInputSize(state, false), 154);
assert.equal(liveQualityInputSize(state, true), 252, 'a paused frame can use higher detail');

// A faster GPU earns one bounded quality trial after sustained fast frames.
for (const ms of [60, 62, 59]) state = advanceLiveQuality(state, ms);
assert.equal(liveQualityInputSize(state, false), 154);
state = advanceLiveQuality(state, 61);
assert.equal(liveQualityInputSize(state, false), 252);

// The first high-resolution frame can include shader compilation. Only
// sustained slow inference should undo the trial.
state = advanceLiveQuality(state, 1800);
assert.equal(liveQualityInputSize(state, false), 252);
state = advanceLiveQuality(state, 330);
assert.equal(liveQualityInputSize(state, false), 154);
for (let i = 0; i < 6; i++) state = advanceLiveQuality(state, 60);
assert.equal(liveQualityInputSize(state, false), 154, 'failed trial must not oscillate');

state = createLiveQualityState();
for (const ms of [60, 200, 60, 200, 60, 200]) state = advanceLiveQuality(state, ms);
assert.equal(liveQualityInputSize(state, false), 154, 'mixed speeds should stay responsive');
for (let i = 0; i < 5; i++) state = advanceLiveQuality(state, 100);
assert.equal(liveQualityInputSize(state, false), 154, 'Intel-class timings must never request 252px');
assert.equal(advanceLiveQuality(state, Number.NaN), state, 'invalid timings are ignored');

console.log('OK live quality adaptation');
