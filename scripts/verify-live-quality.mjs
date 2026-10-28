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

  // Execute the actual presenter callback with its React/engine leaves replaced by local state.
  const start = app.indexOf('    preparedFramePresenterRef.current = (frame) => {');
  assert.ok(start >= 0, 'prepared presenter callback is available');
  const end = app.indexOf('\n    };', start);
  assert.ok(end > start, 'prepared presenter callback has a complete body');
  const createPresenter = new Function('video', 'initialDepth', `
    let lastDepth = initialDepth, preparedMask = null;
    const applied = [], iptal = false, isCurrent = () => true;
    const videoRef = { current: video }, preparedFramePresenterRef = { current: null };
    const preparedFrameTimeRef = { current: -Infinity }, engineRef = { current: null };
    const stopLuminanceLoop = () => {}, setLiveRates = () => {};
    const applyDepth = frame => applied.push(frame);
    ${app.slice(start, end + '\n    };'.length)}
    return { present: preparedFramePresenterRef.current, applied, depth: () => lastDepth };
  `);
  const { createBufferedDepthReader } = await import('../src/engine/vision/bufferedVideoPlayback.ts');
  const settle = () => new Promise(setImmediate);
  const cases = [
    { name: 'current paused detailed V2 survives a cache floor timestamp', paused: true, currentTime: 0.65, liveTime: 0.65, cachedTime: 0.6, depthModel: 'v2', interpolated: false, accepted: false },
    { name: 'playing prepared frames still replace live V2', paused: false, currentTime: 0.65, liveTime: 0.65, cachedTime: 0.6, depthModel: 'v2', interpolated: false, accepted: true },
    { name: 'a paused V2 result at the old cache stamp does not pin a new cursor', paused: true, currentTime: 0.65, liveTime: 0.6, cachedTime: 0.6, depthModel: 'v2', interpolated: false, accepted: true },
    { name: 'a seeked cursor accepts prepared depth before its detailed V2 arrives', paused: true, currentTime: 1, liveTime: 0.65, cachedTime: 0.96, depthModel: 'v2', interpolated: false, accepted: true },
    { name: 'interpolated V2 cannot block prepared depth while paused', paused: true, currentTime: 0.65, liveTime: 0.65, cachedTime: 0.6, depthModel: 'v2', interpolated: true, accepted: true },
    { name: 'VDA cannot block prepared depth while paused', paused: true, currentTime: 0.65, liveTime: 0.65, cachedTime: 0.6, depthModel: 'vda', interpolated: false, accepted: true },
  ];
  for (const fixture of cases) {
    const video = { paused: fixture.paused, currentTime: fixture.currentTime };
    const detailed = { data: new Float32Array([0.9]), width: 1, height: 1,
      mediaTime: fixture.liveTime, depthModel: fixture.depthModel, interpolated: fixture.interpolated };
    const presenter = createPresenter(video, detailed), published = [], errors = [];
    const reader = createBufferedDepthReader({
      cache: { hasFrame: () => true, frameAt: async () =>
        ({ data: new Float32Array([0.5]), width: 1, height: 1, mediaTime: fixture.cachedTime }) },
      currentTime: () => video.currentTime,
      onFrame: frame => { published.push(frame); presenter.present({ ...frame, depthModel: 'vda', inferenceMs: 0 }); },
      onError: error => errors.push(error),
    });
    try {
      reader.submit(video.currentTime); await settle();
      assert.deepEqual(errors, [], 'presenter callback executes without suppressed errors');
      assert.deepEqual(published.map(frame => frame.mediaTime), [fixture.cachedTime], 'the reader preserves actual cache stamps');
      assert.equal(presenter.applied.length, fixture.accepted ? 1 : 0, fixture.name);
      assert.equal(presenter.depth().mediaTime, fixture.accepted ? fixture.cachedTime : fixture.liveTime, fixture.name);
      if (!fixture.accepted) assert.equal(presenter.depth(), detailed, 'paused detailed depth ownership is retained');
    } finally { reader.dispose(); }
  }
  console.log('OK actual prepared presenter: paused detailed cursor, playing, seeks, interpolation and VDA');
}
