import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Gerçek çağrı sınırı, küçük sahte estimator ile; model/ağ/GPU kurulmaz.
const source = await readFile(new URL('../src/depth.ts', import.meta.url), 'utf8');
const start = source.indexOf('let photoModelQueue:');
const end = source.indexOf('\n/**', start);
assert.ok(start > 0 && end > start);
const shifts = new WeakMap();
const sidecars = new WeakSet();
const queued = [];
const code = stripTypeScriptTypes(source.slice(start, end));
const run = new Function('photoDisparityShifts', 'sidecarEstimators', 'gpuSirasinaGir',
  `${code}; return runPhotoModel;`)(shifts, sidecars, fn => {
    queued.push(fn);
    return new Promise((resolve, reject) => { fn.resolve = resolve; fn.reject = reject; });
  });
const input = { fixture: true };
const tensor = { data: new Float32Array([.1, .7]), dims: [1, 1, 1, 2] };
let calls = 0;
const model = async value => { assert.equal(value, input); calls++; return { predicted_depth: tensor }; };
const stages = [];
const trace = { measure(name, fn) { stages.push(name); return fn(); } };
const measured = run(model, input, trace, 'depth.tile');
assert.equal(calls, 0);
assert.deepEqual(stages, [], 'queue wait is outside estimator measurement');
const flush = async () => { const fn = queued.shift(); try { fn.resolve(await fn()); } catch (e) { fn.reject(e); } };
await flush();
const a = await measured;
assert.equal(a.predicted_depth, tensor);
assert.equal(calls, 1);
assert.deepEqual(stages, ['depth.tile']);
const disabled = run(model, input);
await flush();
assert.deepEqual(await disabled, a, 'disabled measurement preserves result and metadata');
assert.equal(calls, 2);
assert.deepEqual(stages, ['depth.tile']);

sidecars.add(model);
shifts.set(model, .35);
const b = await run(model, input, trace, 'depth.subject');
assert.equal(b.predicted_depth, tensor);
assert.equal(b.photoShift, .35);
assert.equal(b.photoModel, 'da3-mono', 'original estimator WeakMap identity survives measurement');
assert.equal(calls, 3);
assert.equal(queued.length, 0, 'sidecar retains its own serialized path');
const error = new Error('fixture failure');
const failing = async () => { throw error; };
sidecars.add(failing);
await assert.rejects(run(failing, input, trace), value => value === error);
console.log('PASS photo inference measurement: queue excluded, unchanged tensors/calls/identity/errors');
