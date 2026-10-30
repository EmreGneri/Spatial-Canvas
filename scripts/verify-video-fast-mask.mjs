// ?hizliMaske (docs/benchmarks/video-fast-mask.md): flag parsing, the use/fallback rule, the
// segmenter adapter, and the App wiring that keeps the default (flag off) path unchanged.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
const { fastMaskModel, segmentPerson } = await import('../src/engine/vision/personMask.ts');
const { hizliMaskeKullan } = await import('../src/ui/maskeKarari.ts');

// 1. Flag: default off; only the two known values switch it on.
for (const s of ['', '?', '?hizliMaske', '?hizliMaske=1', '?hizliMaske=on', '?hizliMaske=SELFIE', '?maske=selfie']) assert.equal(fastMaskModel(s), null, s);
assert.equal(fastMaskModel('?hizliMaske=selfie'), 'selfie');
assert.equal(fastMaskModel('?a=1&hizliMaske=multiclass'), 'multiclass');

// 2. Use rule: separation hysteresis (on at 8 %, off below 4 %), never a near-full-frame mask.
assert.equal(hizliMaskeKullan(0.07, false), false, 'small person mask does not take over');
assert.equal(hizliMaskeKullan(0.08, false), true);
assert.equal(hizliMaskeKullan(0.05, true), true, 'kept while above 4 %');
assert.equal(hizliMaskeKullan(0.03, true), false, 'person left: IS-Net path takes over');
assert.equal(hizliMaskeKullan(0, true), false, 'people-free frame');
assert.equal(hizliMaskeKullan(0.95, true), false, 'near-full-frame mask rejected like IS-Net (92 %)');

// 3. Adapter: selfie = person channel; multiclass = 1 - background; the result is always closed.
const fake = (values, fail = false) => { const r = { closed: false, confidenceMasks: fail ? [] : [{ width: 2, height: 1, getAsFloat32Array: () => new Float32Array(values) }], close() { r.closed = true; } };
  return { r, seg: { segment: () => r } }; };
let f = fake([0.9, 0.2]);
assert.deepEqual([...segmentPerson(f.seg, 'selfie', {}).data].map(v => +v.toFixed(2)), [0.9, 0.2]); assert.ok(f.r.closed);
f = fake([0.9, 0.2]);
const mc = segmentPerson(f.seg, 'multiclass', {});
assert.deepEqual([...mc.data].map(v => +v.toFixed(2)), [0.1, 0.8]); assert.equal(mc.width, 2); assert.ok(f.r.closed);
f = fake([], true);
assert.throws(() => segmentPerson(f.seg, 'selfie', {}), /no confidence mask/); assert.ok(f.r.closed, 'closed on error');

// 4. App wiring.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const body = app.slice(app.indexOf('function startVideoDepth'), app.indexOf('onStaleDrop'));
// Flag off is the old path: the segmenter is only ever set from a load that needs the flag, every
// new statement runs under `fastSegmenter`, so `fastActive` stays false and the gates reduce to the old ones.
assert.match(body, /const fastModel = fastMaskModel\(location\.search\);/);
assert.match(body, /if \(fastModel && !fastRequested\) \{/);
assert.equal((body.match(/fastSegmenter = /g) ?? []).length, 1, 'set in one place (the flag-gated load)');
assert.match(body, /void loadPersonSegmenter\(fastModel\)\.then\(\(s\) => \{ if \(!iptal\) fastSegmenter = s; \}\)/, 'a load finishing after a video switch is ignored');
assert.equal((body.match(/fastActive = /g) ?? []).length, 2, 'declared false, then only assigned inside the gated branch');
assert.match(body, /let fastActive = false;/);
assert.match(body, /if \(fastSegmenter && fastModel && d\.colorFrame && !segmentKapaliRef\.current\) \{/, 'user-off latch: no fast mask, never switches separation on');
assert.match(body, /if \(istek && !fastActive\) captureMask\(istek\);/, 'IS-Net requests unchanged when the fast mask is not in use');
assert.match(body, /if \(mask && !mask\.fast && d\.colorFrame\) \{/, 'tracker unchanged for IS-Net masks');
// Stale results: the fast mask is computed synchronously on the depth frame being presented (no
// await, no queue); taking over drops an IS-Net job in flight; seek / cut / switch reset as before.
const branch = body.slice(body.indexOf('if (fastSegmenter && fastModel'), body.indexOf('const mask = segmentRef.current ? videoMask : null;'));
assert.doesNotMatch(branch, /await|\.then\(|setTimeout|queue/i, 'synchronous: nothing can land later');
assert.match(branch, /const m = segmentPerson\(fastSegmenter, fastModel, d\.colorFrame\);/, 'mask of this depth frame');
assert.match(branch, /mediaTime: d\.mediaTime,\s*colorFrame: d\.colorFrame, job, fast: true \};/);
assert.match(branch, /maskRevision\+\+;/, 'in-flight IS-Net job dropped');
assert.match(branch, /else if \(videoMask\?\.fast\) \{\s*videoMask = null;/, 'no person: a fast mask is never kept stale');
assert.match(app, /if \(iptal \|\| videoRef\.current !== video \|\| revision !== maskRevision\) \{ job\.dropped = true; return; \}/);
assert.match(body, /if \(reason !== 'loop' && !cutTooSoon\) \{\s*maskRevision\+\+;\s*videoMask = null;/, 'seek / cut clears the mask (next depth frame recomputes)');
console.log('verify-video-fast-mask OK');
