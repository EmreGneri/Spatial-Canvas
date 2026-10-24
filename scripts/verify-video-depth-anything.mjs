// Cache correctness and discontinuities are CPU-only; real graph timings live in the benchmark.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
assert.ok(existsSync(new URL('../src/engine/vision/videoDepthAnything.ts', import.meta.url)), 'VDA streaming cache implementation must exist');
const { createVdaHistory, advanceVdaHistory, selectVdaHistory, packVdaCache, vdaResetReason } = await import('../src/engine/vision/videoDepthAnything.ts');

const history = createVdaHistory();
advanceVdaHistory(history, 'frame0');
assert.equal(history.frames.length, 32, 'Bootstrap repeats the first hidden states 32 times, as upstream');
assert.deepEqual(selectVdaHistory(history), new Array(31).fill('frame0'));
for (let i = 1; i <= 50; i++) advanceVdaHistory(history, `frame${i}`);
assert.equal(history.frames.length, 42, 'Official gap41 schedule must bound retained caches');
const selected = selectVdaHistory(history);
assert.equal(selected.length, 31);
assert.equal(selected[0], 'frame0', 'First anchor survives beyond the cache horizon');
assert.equal(selected[1], 'frame10', 'Second anchor follows the official delete-index1 schedule');
assert.equal(selected[2], 'frame22', 'Remaining 29 slots are the latest frames');
assert.equal(selected.at(-1), 'frame50');

assert.deepEqual(Array.from(packVdaCache([
  Float32Array.of(1, 2, 3, 4), Float32Array.of(5, 6, 7, 8),
], 2, 2)), [1, 2, 5, 6, 3, 4, 7, 8], 'Cache concatenation is spatial, time, channel (not frame-major)');
assert.throws(() => packVdaCache([Float32Array.of(1)], 2, 2), /shape/);

const previous = { sourceId: 'a', time: 1, width: 640, height: 360, signature: Float32Array.of(0.2, 0.3) };
assert.equal(vdaResetReason(previous, { ...previous, time: 1.1 }), null);
assert.equal(vdaResetReason(previous, { ...previous, sourceId: 'b', time: 1.1 }), 'source');
assert.equal(vdaResetReason(previous, { ...previous, time: 0.9 }), 'seek');
assert.equal(vdaResetReason(previous, { ...previous, time: 3 }), 'gap');
assert.equal(vdaResetReason(previous, { ...previous, width: 320, time: 1.1 }), 'dimensions');
assert.equal(vdaResetReason(previous, { ...previous, time: 1.1, signature: Float32Array.of(0.9, 0.9) }), 'scene-cut');
assert.equal(vdaResetReason(null, previous), 'initial');
console.log('verify-video-depth-anything: official cache schedule, packing and discontinuities passed');

// --- Browser runtime contract (pure parts; ORT sessions are injected fakes) ---
const vda = await import('../src/engine/vision/videoDepthAnything.ts');
assert.equal(vda.vdaIstendi('?videoDerinlik=vda'), true, 'Opt-in flag enables VDA');
assert.equal(vda.vdaIstendi('?x=1&videoDerinlik=vda'), true);
assert.equal(vda.vdaIstendi(''), false, 'Default stays V2-small');
assert.equal(vda.vdaIstendi('?videoDerinlik=v2'), false);

assert.equal(vda.vdaOranUygun(1920, 1080), true, '16:9 fits the fixed 266x154 export');
assert.equal(vda.vdaOranUygun(1920, 1200), true, '16:10 squashes under 15%');
assert.equal(vda.vdaOranUygun(640, 480), false, '4:3 would be stretched 30%: use V2');
assert.equal(vda.vdaOranUygun(1080, 1920), false, 'Portrait video: use V2');

const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
const chw = vda.vdaOnIsle(rgba, 2, 1);
assert.equal(chw.length, 6, 'Planar CHW, alpha dropped');
assert.ok(Math.abs(chw[0] - (1 - 0.485) / 0.229) < 1e-5, 'ImageNet mean/std on R, pixel 0');
assert.ok(Math.abs(chw[1] - (0 - 0.485) / 0.229) < 1e-5, 'R plane, pixel 1');
assert.ok(Math.abs(chw[3] - (1 - 0.456) / 0.224) < 1e-5, 'G plane, pixel 1');
assert.throws(() => vda.vdaOnIsle(rgba, 3, 1), /shape/);

const signature = vda.vdaImza(new Uint8ClampedArray(16 * 16 * 4).fill(255), 16, 16);
assert.equal(signature.length, 16, '4x4 luma signature');
assert.ok(signature.every(v => Math.abs(v - 1) < 1e-6));

const n = vda.VDA_INPUT_WIDTH * vda.VDA_INPUT_HEIGHT;
const ramp = Float32Array.from({ length: n }, (_, i) => i / n);
assert.doesNotThrow(() => vda.vdaCiktiDogrula(ramp));
assert.throws(() => vda.vdaCiktiDogrula(ramp.subarray(1)), /shape/, 'Wrong output size is a shape error');
assert.throws(() => vda.vdaCiktiDogrula(new Float32Array(n).fill(0.5)), /implausible/, 'Constant depth is implausible');
const bad = ramp.slice(); bad[7] = NaN;
assert.throws(() => vda.vdaCiktiDogrula(bad), /implausible/, 'Non-finite depth is implausible');

// Fake sessions with the real cache shapes from export-manifest.json.
const CACHE = [[209, 192], [209, 192], [60, 384], [60, 384], [209, 64], [209, 64], [836, 64], [836, 64]];
const calls = [];
const tensor = (dims) => ({ dims, data: new Float32Array(dims.reduce((a, b) => a * b, 1)) });
const head = (name, cacheOut) => async (feeds) => {
  calls.push({ name, feeds: Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, v.dims])) });
  const out = { depth: { dims: [1, 1, vda.VDA_INPUT_HEIGHT, vda.VDA_INPUT_WIDTH], data: ramp.slice() } };
  CACHE.forEach(([s, c], i) => { out[`${cacheOut}${i}`] = tensor([s, 1, c]); });
  return out;
};
let encoderDims = [1, 209, 384];
const stream = vda.createVdaStream({
  encoder: async (feeds) => {
    calls.push({ name: 'encoder', feeds: { pixels: feeds.pixels.dims } });
    return Object.fromEntries([1, 2, 3, 4].map(i => [`feat${i}`, tensor(encoderDims)]));
  },
  bootstrap: head('bootstrap', 'cache'),
  stream: head('stream', 'nextCache'),
});
const pixels = new Float32Array(3 * n);
assert.equal((await stream.infer(pixels)).length, n);
assert.equal(calls.at(-1).name, 'bootstrap', 'First frame of a context bootstraps');
assert.deepEqual(calls.at(-2).feeds.pixels, [1, 3, vda.VDA_INPUT_HEIGHT, vda.VDA_INPUT_WIDTH]);
await stream.infer(pixels);
assert.equal(calls.at(-1).name, 'stream', 'Next frame streams with the cache');
assert.deepEqual(calls.at(-1).feeds.cache0, [209, 31, 192], 'Cache input is (spatial, 31, channels)');
assert.deepEqual(calls.at(-1).feeds.cache6, [836, 31, 64]);
assert.equal(stream.frames(), 2);
stream.reset();
assert.equal(stream.frames(), 0, 'Reset drops the temporal context');
await stream.infer(pixels);
assert.equal(calls.at(-1).name, 'bootstrap', 'After reset the context restarts');

// A reset while a frame is in flight must not let that frame seed the new context.
const pending = stream.infer(pixels);
stream.reset();
await pending;
assert.equal(stream.frames(), 0, 'In-flight frame from the old context is not appended');

encoderDims = [1, 200, 384];
await assert.rejects(stream.infer(pixels), /shape/, 'Unexpected encoder shape is a shape error');
// Fallback is sticky: one failure (device lost, shape, implausible output) returns the page to V2.
assert.equal(vda.vdaKullanilsinMi(1920, 1080, ''), false, 'Not requested: V2');
assert.equal(vda.vdaKullanilsinMi(640, 480, '?videoDerinlik=vda'), false, 'Requested but 4:3: V2');
assert.equal(vda.vdaKullanilsinMi(1920, 1080, '?videoDerinlik=vda'), true);
const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
vda.vdaDus(new Error('device lost'));
vda.vdaDus(new Error('second failure'));
console.warn = warn;
assert.equal(warned, 1, 'Fallback is logged once');
assert.equal(vda.vdaKullanilsinMi(1920, 1080, '?videoDerinlik=vda'), false, 'After a failure the page stays on V2');
// Warmup must compile bootstrap and two stream runs (capture and replay), then reset.
encoderDims = [1, 209, 384];
const warmCalls = calls.length;
await vda.vdaIsitAkis(stream, pixels);
assert.deepEqual(calls.slice(warmCalls).filter(c => c.name !== 'encoder').map(c => c.name), ['bootstrap', 'stream', 'stream']);
assert.equal(stream.frames(), 0, 'Warmup never seeds the user temporal context');
encoderDims = [1, 200, 384];
await assert.rejects(vda.vdaIsitAkis(stream, pixels), /shape/);
assert.equal(stream.frames(), 0, 'A failed warmup still resets the temporal context');
console.log('verify-video-depth-anything: runtime flag, preprocessing, validation, stream, reset, fallback and warmup passed');
