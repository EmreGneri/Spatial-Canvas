import assert from 'node:assert/strict';
import { Session } from '../src/vendor/splat.js/session.js';

const originalRaf = globalThis.requestAnimationFrame;
const originalWorker = globalThis.Worker;

function makeSession(stepOnce) {
  const session = new Session({ maxIters: 1, itersPerFrame: 1, perf: false });
  session.trainer = {
    iter: 0,
    n: 1,
    camMeta: [{}],
    stepOnce() { stepOnce(this); },
    device: { queue: { onSubmittedWorkDone: () => Promise.resolve() } },
  };
  session.view._tick = () => {};
  session._emitMetrics = async () => {};
  return session;
}

async function until(predicate, ms = 1200) {
  const deadline = performance.now() + ms;
  while (!predicate() && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(predicate(), 'training must advance without foreground animation frames');
}

try {
  // Simulate a browser that suspends rAF and cannot create a Worker (for
  // example because the page's content security policy rejects blob workers).
  globalThis.requestAnimationFrame = () => 1;
  globalThis.Worker = undefined;

  const session = makeSession((trainer) => { trainer.iter++; });
  try {
    let completed = false;
    session.on('event', (event) => { if (event.kind === 'train-complete') completed = true; });
    session.start();
    await until(() => completed);
    assert.equal(session.trainer.iter, 1);
  } finally {
    session.dispose();
  }

  // A Worker can be constructed successfully yet never send ticks (host
  // throttling or a blocked blob script). It must not strand the GPU job.
  globalThis.Worker = class { terminate() {} };
  const silentWorker = makeSession((trainer) => { trainer.iter++; });
  try {
    let completed = false;
    silentWorker.on('event', (event) => { if (event.kind === 'train-complete') completed = true; });
    silentWorker.start();
    await until(() => completed);
  } finally {
    silentWorker.dispose();
    globalThis.Worker = undefined;
  }

  const broken = makeSession(() => { throw new Error('GPU submit failed'); });
  try {
    let reported = null;
    broken.on('event', (event) => { if (event.kind === 'train-error') reported = event.error; });
    broken.start();
    await until(() => reported !== null);
    assert.match(reported.message, /GPU submit failed/);
    assert.equal(broken.training, false);
  } finally {
    broken.dispose();
  }

  const lifetime = makeSession(() => {});
  let unconfigured = 0;
  lifetime.view.canvas = {};
  lifetime.view.ctx = { unconfigure() { unconfigured++; } };
  lifetime.dispose();
  lifetime.dispose();
  assert.equal(unconfigured, 1, 'closing training releases the canvas WebGPU context once');
  assert.equal(lifetime.view.ctx, null);

  console.log('3DGS background scheduler and failure reporting: OK');
} finally {
  if (originalRaf === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = originalRaf;
  if (originalWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = originalWorker;
}
