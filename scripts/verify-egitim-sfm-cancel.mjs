import assert from 'node:assert/strict';
import { runSfM } from '../src/vendor/splat.js/sfm/sfm.js';

const originalWorker = globalThis.Worker;
globalThis.navigator ??= { hardwareConcurrency: 4 };
const images = Array.from({ length: 2 }, () => ({ fw: 16, fh: 16, gray: new Float32Array(256) }));

async function outcome(work) {
  return Promise.race([
    work.then(() => 'resolved', (error) => error.name),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 500)),
  ]);
}

try {
  let created = 0, terminated = 0;
  globalThis.Worker = class {
    constructor() { created++; }
    postMessage() {}
    terminate() { terminated++; }
  };
  const controller = new AbortController();
  const work = runSfM(images, () => {}, () => [0, 0, 0], { signal: controller.signal });
  controller.abort();
  assert.equal(await outcome(work), 'AbortError', 'abort must settle the feature worker pool');
  assert.ok(created > 0);
  assert.equal(terminated, created, 'abort must terminate every feature worker');

  created = 0; terminated = 0;
  globalThis.Worker = class {
    constructor() { created++; }
    postMessage() { queueMicrotask(() => this.onerror?.({ message: 'worker failed' })); }
    terminate() { terminated++; }
  };
  const failure = runSfM(images, () => {}, () => [0, 0, 0]);
  assert.equal(await outcome(failure), 'Error', 'worker error must reject the solve');
  assert.equal(terminated, created, 'worker error must terminate every feature worker');

  created = 0; terminated = 0;
  globalThis.Worker = class {
    constructor() {
      created++;
      if (created === 2) throw new Error('worker quota');
    }
    postMessage() {}
    terminate() { terminated++; }
  };
  const quotaFailure = runSfM(images, () => {}, () => [0, 0, 0]);
  assert.equal(await outcome(quotaFailure), 'Error', 'worker creation failure must reject');
  assert.equal(terminated, 1, 'previously created workers must be released');
  console.log('3DGS SfM worker cancellation and cleanup: OK');
} finally {
  if (originalWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = originalWorker;
}
