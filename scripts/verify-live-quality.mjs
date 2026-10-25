import assert from 'node:assert/strict';
import {
  advanceLiveQuality,
  createLiveQualityState,
  liveQualityInputSize,
} from '../src/engine/vision/liveDepth.ts';

let state = createLiveQualityState();
assert.equal(liveQualityInputSize(state, false), 154);
assert.equal(liveQualityInputSize(state, true), 378, 'a paused frame uses the detailed 378 input');

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

// Paused = detailed, also over prepared depth (App wiring; behaviour measured in docs/benchmarks/video-precompute.md).
{
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /shouldInfer: \(\) => \{\s*\/\/[^\n]*\n\s*if \(video\.paused\) return true;/, 'paused frame must infer even with prepared depth');
  assert.match(app, /forceV2: \(\) => videoPreparingRef\.current \|\| video\.paused/, 'paused frame uses V2 at 378, not VDA');
  assert.match(app, /if \(!fromCache && !video\.paused && preparedVideoUsableRef\.current/, 'paused live result may replace the prepared frame');
  console.log('OK paused detailed frame wiring');
}
