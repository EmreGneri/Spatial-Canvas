// ?derinlikIlerlet=1 experiment: flag-off identity + warp unit behaviour.
// node scripts/verify-depth-advance.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeFlowTexture, panTexture } from '../src/engine/vision/lab.ts';
import * as flow from '../src/engine/vision/liveDepthFlow.ts';

// Flag: opt-in only, independent of araKare.
assert.equal(flow.depthAdvanceEnabled(''), false, 'default is off');
assert.equal(flow.depthAdvanceEnabled('?derinlikIlerlet=0'), false);
assert.equal(flow.depthAdvanceEnabled('?araKare=1'), false, 'araKare does not enable advance');
assert.equal(flow.depthAdvanceEnabled('?derinlikIlerlet=1'), true);
assert.equal(flow.liveInterpolationEnabled('?derinlikIlerlet=1'), false, 'advance does not enable araKare');

// Flag-off path: no client, no onColorFrame hook, and onDepth receives the same object
// through the former upload + quality step.
const src = readFileSync(new URL('../src/engine/vision/liveDepth.ts', import.meta.url), 'utf8').replace(/\r/g, '');
assert.match(src, /const advanceClient = !flowClient && depthAdvanceEnabled\(\) \? new LiveDepthFlowClient\(/);
assert.match(src, /present\(advanceClient \? advance\(depth\) : depth\);/, 'flag off: the model result is presented as is');
assert.match(src, /\.\.\.\(advanceClient \|\| opts\.onColorFrame \? \{ onColorFrame: /, 'flags off: estimateDepthLive gets no extra option');
assert.match(src, /opts\.onColorFrame\?\.\(colorFrame, mediaTime\);/);
assert.match(src, /const present = \(depth: LiveDepthResult\) => \{\n {4}const uploadStart = performance\.now\(\);\n {4}onDepth\(depth\);\n {4}if \(autoQuality && !video\.paused\) \{\n {6}qualityState = advanceLiveQuality\(qualityState, depth\.inferenceMs \+ performance\.now\(\) - uploadStart\);/);
assert.equal((src.match(/onDepth\(depth\)/g) ?? []).length, 1, 'model frames reach onDepth only through present()');

// propagateLiveDepth was split into liveFlowField + warp: same output as a hand-inlined copy
// is covered by verify-live-interpolation; here, the field and the extrapolating warp.
const width = 112, height = 80, n = width * height;
const luminance = makeFlowTexture(width, height);
const toFrame = (luma) => ({ width, height, data: Uint8ClampedArray.from({ length: n * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : Math.round(luma[Math.floor(i / 4)] * 255)) });
const depth0 = Float32Array.from({ length: n }, (_, i) => 0.35 + 0.2 * Math.sin((i % width) * 0.08) + 0.1 * Math.cos(Math.floor(i / width) * 0.1));
// Constant motion (2, 1) px per model interval: t0 -> t1 seen, t2 predicted.
const f0 = toFrame(luminance), f1 = toFrame(panTexture(luminance, width, height, 2, 1));
const depth1 = panTexture(depth0, width, height, 2, 1), depth2 = panTexture(depth0, width, height, 4, 2);
const r = flow.liveFlowFieldResult(f0, f1, width, height);
assert.ok(flow.isDepthAdvanceUsable(r) && r.field, 'textured pan gives a usable field');
assert.equal(r.depth.length, 0, 'field-only results carry no depth');
const advanced = flow.advanceByField(depth1, width, height, 1, r.field, 1);
let before = 0, after = 0, count = 0;
for (let y = 8; y < height - 8; y++) for (let x = 8; x < width - 8; x++) {
  const i = y * width + x; count++;
  before += (depth1[i] - depth2[i]) ** 2; after += (advanced[i] - depth2[i]) ** 2;
}
assert.ok(after < before * 0.2, `one-step extrapolation lands on t2 geometry (${(after / count).toExponential(2)} vs ${(before / count).toExponential(2)})`);
assert.deepEqual(flow.advanceByField(depth1, width, height, 1, r.field, 0), depth1, 'k = 0 is identity');
assert.notEqual(advanced, depth1, 'source is not mutated in place');
const rgba = flow.advanceByField(f1.data, width, height, 4, r.field, 1);
assert.ok(rgba instanceof Uint8ClampedArray && rgba.length === f1.data.length, 'RGBA warps with the same field');
// Untrusted pixels keep the source value.
const half = { ...r.field, trusted: r.field.trusted.map((t, i) => (i % r.field.fw) < r.field.fw / 2 ? 0 : t) };
const partial = flow.advanceByField(depth1, width, height, 1, half, 1);
for (let y = 0; y < height; y++) for (let x = 0; x < width * 0.4; x++) assert.equal(partial[y * width + x], depth1[y * width + x]);

assert.equal(flow.liveFlowFieldResult(f0, toFrame(new Float32Array(n)), width, height).sceneCut, true, 'scene cut: no field');
assert.equal(flow.isDepthAdvanceUsable(flow.liveFlowFieldResult(f0, toFrame(new Float32Array(n)), width, height)), false);
const flat = flow.liveFlowFieldResult(toFrame(new Float32Array(n).fill(0.5)), toFrame(new Float32Array(n).fill(0.52)), width, height);
assert.equal(flow.isDepthAdvanceUsable(flat), false, 'no trackable texture: present the model frame');
assert.equal(flow.liveFlowFieldResult(f0, { width: 4, height: 4, data: new Uint8ClampedArray(64) }, width, height).coverage, 0, 'size mismatch: no field');
console.log('OK depth advance: flag off by default, flag-off path unchanged, extrapolation follows motion, fallbacks');
