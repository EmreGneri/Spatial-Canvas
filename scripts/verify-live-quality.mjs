import assert from 'node:assert/strict';
import {
  advanceLiveQuality,
  createLiveQualityState,
  liveQualityInputSize,
} from '../src/engine/vision/liveDepth.ts';

// Default = reference pipeline "Detaylı · 378 (duraklatınca)": 252 while playing, 378 paused
// (was: 154 with a 252 probe; changed 2026-10-25, user decision to match reference pipeline).
let state = createLiveQualityState();
assert.equal(liveQualityInputSize(state, false), 252, 'playback uses the Detaylı playback cap');
assert.equal(liveQualityInputSize(state, true), 378, 'a paused frame uses the detailed 378 input');

// The first frame at a size may compile shaders; only SUSTAINED <1 Hz falls back.
state = advanceLiveQuality(state, 4000);
assert.equal(liveQualityInputSize(state, false), 252, 'first (compile) frame is ignored');
for (const ms of [700, 680, 690, 720]) state = advanceLiveQuality(state, ms);
assert.equal(liveQualityInputSize(state, false), 252, 'Intel-class 252 timings (~1.5 Hz) keep Detaylı');
for (const ms of [1200, 1100]) state = advanceLiveQuality(state, ms);
state = advanceLiveQuality(state, 500);
assert.equal(liveQualityInputSize(state, false), 252, 'non-consecutive slow frames do not fall back');
for (const ms of [1200, 1300, 1250]) state = advanceLiveQuality(state, ms);
assert.equal(liveQualityInputSize(state, false), 154, 'three frames below 1 Hz fall back to Hızlı 154');
assert.equal(liveQualityInputSize(state, true), 378, 'paused frame stays detailed after the fallback');
for (let i = 0; i < 6; i++) state = advanceLiveQuality(state, 60);
assert.equal(liveQualityInputSize(state, false), 154, 'fallback is one-way: no oscillation');
assert.equal(advanceLiveQuality(state, Number.NaN), state, 'invalid timings are ignored');

console.log('OK live quality: Detaylı default, <1 Hz fallback');

// Paused = detailed, also over prepared depth (App wiring; behaviour measured in docs/benchmarks/video-precompute.md).
{
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /shouldInfer: \(\) => \{\s*\/\/[^\n]*\n\s*if \(video\.paused\) return true;/, 'paused frame must infer even with prepared depth');
  assert.match(app, /forceV2: \(\) => videoPreparingRef\.current \|\| video\.paused/, 'paused frame uses V2 at 378, not VDA');
  assert.match(app, /if \(!fromCache && !video\.paused && preparedVideoUsableRef\.current/, 'paused live result may replace the prepared frame');
  console.log('OK paused detailed frame wiring');
}
