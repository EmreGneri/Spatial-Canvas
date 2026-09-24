import assert from 'node:assert/strict';
import { Session } from '../src/vendor/splat.js/session.js';

globalThis.navigator ??= {};
const previousGpu = navigator.gpu;
let releaseAdapter;
let destroyed = 0;
const adapter = {
  features: { has: () => false },
  limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 },
  info: {},
  requestDevice: async () => ({ destroy() { destroyed++; } }),
};

try {
  navigator.gpu = { requestAdapter: () => new Promise((resolve) => { releaseAdapter = resolve; }) };
  const session = new Session({});
  session.frames = [{ fw: 16, fh: 16 }, { fw: 16, fh: 16 }];
  const solve = session.solve();
  session.dispose();
  releaseAdapter(adapter);
  const result = await Promise.race([
    solve.then(() => 'resolved', (error) => error.name),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 500)),
  ]);
  assert.equal(result, 'AbortError', 'disposed session must not continue to SfM');
  assert.equal(destroyed, 1, 'late owned GPU must be destroyed');
  assert.equal(session.gpu, null, 'disposed session must not retain a GPU');

  const restored = new Session({});
  const seed = restored.seedFrom({ data: new Float32Array(16), n: 1 }, { viewOnly: true });
  restored.dispose();
  releaseAdapter(adapter);
  const seedResult = await Promise.race([
    seed.then(() => 'resolved', (error) => error.name),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 500)),
  ]);
  assert.equal(seedResult, 'AbortError', 'late GPU must not initialize a restored model');
  assert.equal(destroyed, 2, 'restored model must release its late GPU');
  console.log('3DGS late GPU acquisition cleanup: OK');
} finally {
  if (previousGpu === undefined) delete navigator.gpu;
  else navigator.gpu = previousGpu;
}
