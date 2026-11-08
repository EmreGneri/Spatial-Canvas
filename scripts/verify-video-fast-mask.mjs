// Live video fast person mask (docs/benchmarks/video-fast-mask.md): default selection, the
// use/fallback rule, the Worker client (latest frame wins, failure stops the fast path) and the
// App wiring (loaded only once separation is on, a result only for its own depth frame).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
const { fastMaskModel, PersonMaskWorker, loadPersonMaskWorker, PERSON_MASK_TIMEOUT_MS } = await import('../src/engine/vision/personMask.ts');
const { hizliMaskeKullan, isNetErtelensinMi, HIZLI_MASKE_BUTCE_MS } = await import('../src/ui/maskeKarari.ts');

// 1. Selection: selfie by default, multiclass on request, ?hizliMaske=isnet keeps the IS-Net-only path.
for (const s of ['', '?', '?hizliMaske', '?hizliMaske=1', '?hizliMaske=selfie', '?maske=isnet']) assert.equal(fastMaskModel(s), 'selfie', s);
assert.equal(fastMaskModel('?a=1&hizliMaske=multiclass'), 'multiclass');
assert.equal(fastMaskModel('?hizliMaske=isnet'), null);

// 2. Use rule: separation hysteresis (on at 8 %, off below 4 %), never a near-full-frame mask.
assert.equal(hizliMaskeKullan(0.07, false), false, 'small person mask does not take over');
assert.equal(hizliMaskeKullan(0.08, false), true);
assert.equal(hizliMaskeKullan(0.05, true), true, 'kept while above 4 %');
assert.equal(hizliMaskeKullan(0.03, true), false, 'person left: IS-Net path takes over');
assert.equal(hizliMaskeKullan(0, true), false, 'people-free frame');
assert.equal(hizliMaskeKullan(0.95, true), false, 'near-full-frame mask rejected like IS-Net (92 %)');

// 2b. IS-Net deferral: waits for the fast verdict, never while paused, never past the budget.
{
  const d = (o) => isNetErtelensinMi({ hizliYol: true, kararVerildi: false, duraklatildi: false, gecenMs: 0, ...o });
  assert.equal(HIZLI_MASKE_BUTCE_MS, 5000);
  assert.equal(d({}), true, 'no verdict yet: IS-Net waits');
  assert.equal(d({ gecenMs: 4999 }), true);
  assert.equal(d({ gecenMs: 5000 }), false, 'budget spent: IS-Net starts');
  assert.equal(d({ duraklatildi: true }), false, 'paused: no new frame can decide, IS-Net starts');
  assert.equal(d({ kararVerildi: true }), false, 'verdict reached or fast path failed');
  assert.equal(d({ hizliYol: false }), false, '?hizliMaske=isnet never waits');
  // Hidden tab: few depth frames to decide on, so the budget waits for the tab to be visible.
  assert.equal(d({ gizli: true, gecenMs: 60000 }), true, 'hidden tab: IS-Net waits past the budget');
  assert.equal(d({ gizli: true, duraklatildi: true }), false, 'hidden and paused: IS-Net starts');
  assert.equal(d({ gizli: true, kararVerildi: true }), false);
}

// 3. Worker client against a fake Worker.
class FakeWorker {
  sent = []; terminated = false; onmessage = null; onerror = null;
  postMessage(message, transfer) { this.sent.push({ message, transfer }); }
  terminate() { this.terminated = true; }
  answer(id, values = [0.9, 0.1]) {
    const data = new Float32Array(values).buffer;
    this.onmessage({ data: { type: 'mask', id, width: values.length, height: 1, data } });
  }
}
const frame = (v) => ({ width: 2, height: 1, data: new Uint8ClampedArray(8).fill(v) });
{
  const w = new FakeWorker(), client = new PersonMaskWorker(w), a = frame(1);
  const first = client.segment(a);
  assert.equal(w.sent.length, 1);
  const sent = w.sent[0].message;
  assert.notEqual(sent.data, a.data.buffer, 'the Worker gets a copy; the page keeps drawing from the frame');
  assert.deepEqual(w.sent[0].transfer, [sent.data]);
  const second = client.segment(frame(2)), third = client.segment(frame(3));
  assert.equal(w.sent.length, 1, 'one running job at a time');
  assert.equal(await second, null, 'a replaced frame resolves null');
  w.answer(sent.id);
  assert.deepEqual([...(await first).data].map(v => +v.toFixed(2)), [0.9, 0.1]);
  assert.equal(w.sent.length, 2, 'the latest waiting frame starts next');
  assert.equal(w.sent[1].message.data.byteLength, 8);
  w.onmessage({ data: { type: 'mask', id: 999, width: 1, height: 1, data: new Float32Array(1).buffer } });
  w.answer(w.sent[1].message.id, [0.5]);
  assert.equal((await third).data.length, 1, 'a stale id is ignored, the matching one resolves');
}
{
  const w = new FakeWorker(), client = new PersonMaskWorker(w);
  const job = client.segment(frame(1)), waiting = client.segment(frame(2));
  w.onmessage({ data: { type: 'error', id: w.sent[0].message.id, message: 'delegate lost' } });
  await assert.rejects(job, /delegate lost/);
  await assert.rejects(waiting, /delegate lost/);
  assert.ok(w.terminated && client.broken, 'an error stops the Worker');
  await assert.rejects(client.segment(frame(3)), /delegate lost/, 'a broken client never starts new work');
}
{
  const realSetTimeout = globalThis.setTimeout, timers = [];
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  try {
    const w = new FakeWorker(), client = new PersonMaskWorker(w);
    const job = client.segment(frame(1));
    assert.equal(timers.at(-1).ms, PERSON_MASK_TIMEOUT_MS);
    timers.at(-1).fn();
    await assert.rejects(job, /timed out/);
    assert.ok(w.terminated, 'a hung Worker is terminated');
  } finally { globalThis.setTimeout = realSetTimeout; }
}
// Loader: model bytes go to the Worker, `ready` resolves, `error` rejects and terminates, a broken
// client is replaced on the next request.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
  try {
    const workers = [];
    const create = (reply) => () => {
      const w = new FakeWorker();
      w.postMessage = (message, transfer) => { w.sent.push({ message, transfer }); queueMicrotask(() => w.onmessage({ data: reply })); };
      workers.push(w); return w;
    };
    await assert.rejects(loadPersonMaskWorker('multiclass', create({ type: 'error', id: null, message: 'no WebGL' })), /no WebGL/);
    assert.ok(workers[0].terminated, 'a failed set-up does not leave a Worker running');
    const client = await loadPersonMaskWorker('selfie', create({ type: 'ready', delegate: 'GPU', setupMs: 1 }));
    const init = workers[1].sent[0].message;
    assert.equal(init.type, 'init'); assert.equal(init.model, 'selfie'); assert.equal(init.bytes.byteLength, 3);
    assert.equal(await loadPersonMaskWorker('selfie', create({ type: 'ready' })), client, 'one Worker per model');
    client.broken = new Error('gone');
    const replaced = await loadPersonMaskWorker('selfie', create({ type: 'ready', delegate: 'CPU', setupMs: 1 }));
    assert.notEqual(replaced, client, 'a broken Worker is replaced');
  } finally { globalThis.fetch = realFetch; }
}

// 4. Worker module: module MediaPipe runtime, delegate warm-up before `ready`, multiclass inverted.
const worker = readFileSync(new URL('../src/engine/vision/personMaskWorker.ts', import.meta.url), 'utf8');
assert.match(worker, /FilesetResolver\.forVisionTasks\(wasmBase, true\)/, 'module runtime: no importScripts in a module Worker');
assert.match(worker, /loaded\.segment\(new ImageData\(16, 16\)\)\.close\(\);[\s\S]*segmenter = loaded;/, 'shader compile happens during set-up');
assert.match(worker, /let delegate: 'GPU' \| 'CPU' = model === 'selfie' \? 'CPU' : 'GPU';/, 'selfie on CPU, multiclass keeps the GPU delegate');
assert.match(worker, /canvas: new OffscreenCanvas\(1, 1\)/, 'GPU delegate keeps its own canvas');
assert.match(worker, /if \(invert\) for \(let i = 0; i < data\.length; i\+\+\) data\[i\] = 1 - data\[i\];/);
assert.match(worker, /finally \{ result\.close\(\); \}/);

// 5. App wiring.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const body = app.slice(app.indexOf('function startVideoDepth'), app.indexOf('onStaleDrop'));
assert.match(body, /const fastModel = fastMaskModel\(location\.search\);/);
assert.match(body, /if \(fastModel && !fastRequested && !segmentKapaliRef\.current\) \{/, 'nothing is downloaded until the user-off latch is released');
assert.match(body, /void loadPersonMaskWorker\(fastModel\)\.then\(\(w\) => \{ if \(!iptal\) fastWorker = w; \}\)/, 'a load finishing after a video switch is ignored');
assert.match(body, /fastReady\?\.frame === d\.colorFrame \? fastReady : null;/, 'a Worker result only for its own depth frame');
assert.match(body, /if \(istek && !fastActive && !isNetWaits\(\)\) captureMask\(istek\);/, 'IS-Net requests unchanged once the fast path has decided');
// Everything that ends the wait starts IS-Net at once, also without a new depth frame.
assert.match(body, /let fastSettled = !fastModel;/, '?hizliMaske=isnet never waits');
assert.match(body, /const stopFastMask = [\s\S]*?releaseIsNet\(\);\s*\};/, 'Worker error or a 2 s job starts IS-Net');
assert.match(body, /hızlı maske yüklenemedi[^\n]*\n\s*releaseIsNet\(\);/, 'load failure starts IS-Net');
assert.match(body, /budgetTimer = setTimeout\(budgetSpent, HIZLI_MASKE_BUTCE_MS\);\s*video\.addEventListener\('pause', releaseIsNet, \{ once: true, signal: budgetStop\.signal \}\);/, 'budget and pause start IS-Net');
assert.match(body, /const budgetSpent = \(\) => \{\s*if \(document\.visibilityState !== 'hidden'\) \{ releaseIsNet\(\); return; \}\s*document\.addEventListener\('visibilitychange', \(\) => \{\s*fastBudgetFrom = performance\.now\(\);\s*budgetTimer = setTimeout\(budgetSpent, HIZLI_MASKE_BUTCE_MS\);\s*\}, \{ once: true, signal: budgetStop\.signal \}\);/, 'hidden tab: the budget restarts once visible');
// A source change drops the budget's timer and listeners, on both stop functions.
assert.equal((app.match(/clearTimeout\(budgetTimer\);\s*budgetStop\.abort\(\);/g) ?? []).length, 2, 'budget cleaned up on stop');
// Engine: a Worker mask of the wrong size is refused, not thrown.
const engine = readFileSync(new URL('../src/engine/Engine.ts', import.meta.url), 'utf8');
assert.match(engine, /const on = !!mask && mask\.data\.length === mask\.width \* mask\.height/, 'mask size checked');
assert.match(body, /gizli: document\.visibilityState === 'hidden',/, 'the frame path waits in a hidden tab too');
assert.match(body, /if \(!varMi\) \{\s*releaseIsNet\(\);/, 'no WebGPU: no driver will ever decide');
assert.match(body, /if \(fast\) \{\s*fastReady = null;\s*fastSettled = true;/, 'the first fast result is the verdict, person or not');
assert.match(body, /const releaseIsNet = \(\) => \{\s*if \(fastSettled\) return;\s*fastSettled = true;\s*captureMask\('ilk'\);/);
assert.match(body, /if \(!fastActive \|\| video\.paused\) captureMask\(\);/, 'separation back on with the fast path running: no IS-Net download');
// Miss counter: only a frame the Worker really received can miss its depth frame.
assert.match(body, /if \(fastWorker && d\.colorFrame === fastSentFrame && !segmentKapaliRef\.current && !fast\) videoStats\.fastMaskMisses\+\+;/);
assert.match(body, /if \(mask && !mask\.fast && d\.colorFrame\) \{/, 'tracker unchanged for IS-Net masks');
const branch = body.slice(body.indexOf('if (fast) {'), body.indexOf('const mask = segmentRef.current ? videoMask : null;'));
assert.match(branch, /maskRevision\+\+;/, 'in-flight IS-Net job dropped');
assert.match(branch, /colorFrame: fast\.frame, job, fast: true \};/);
assert.match(branch, /else if \(videoMask\?\.fast\) \{\s*videoMask = null;/, 'no person: a fast mask is never kept stale');
assert.match(app, /onColorFrame: fastModel \? \(frame, mediaTime\) => \{\s*const worker = fastWorker;\s*if \(!worker \|\| segmentKapaliRef\.current\) return;/, 'latch on: no Worker job');
assert.match(app, /if \(iptal \|\| !mask \|\| fastWorker !== worker\) return;/, 'a result from a replaced Worker or an old video is dropped');
assert.match(app, /fastSentFrame = frame;\s*worker\.segment\(frame\)/);
// Live mask: only while in use, separation on, and not from before a seek; off on every way out.
assert.match(app, /if \(job && fastActive && segmentRef\.current && epoch === fastEpoch && engineRef\.current\?\.setVideoLiveMask\(mask\)\)/);
assert.match(body, /if \(!fastActive\) engineRef\.current\?\.setVideoLiveMask\(null\);/, 'person left');
assert.match(body, /const stopFastMask = [\s\S]*?setVideoLiveMask\(null\);/, 'Worker stopped');
const onDiscontinuity = app.slice(app.indexOf('onDiscontinuity: (reason)'), app.indexOf('onStaleDrop'));
assert.match(onDiscontinuity, /fastEpoch\+\+;\s*engineRef\.current\?\.setVideoLiveMask\(null\);/, 'seek or cut');
assert.match(app, /\(err\) => \{ if \(!iptal && fastWorker === worker\) stopFastMask\(err\); \}/, 'Worker failure: IS-Net path takes over');
assert.match(body, /const stopFastMask = [\s\S]*?fastActive = false;[\s\S]*?if \(videoMask\?\.fast\) videoMask = null;/);
assert.match(body, /if \(reason !== 'loop' && !cutTooSoon\) \{\s*maskRevision\+\+;\s*videoMask = null;/, 'seek / cut clears the mask (next depth frame recomputes)');
console.log('verify-video-fast-mask OK');
