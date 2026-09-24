import assert from 'node:assert/strict';
import { egitimDevamEt } from '../src/engine/reconstruction/egitim3dgs.ts';
import { Session } from '../src/vendor/splat.js/session.js';

const ayar = { tier: 'quick', maxFrames: 24, maxIters: 3000, gpu: 'intel / gen-12lp', zayifGpu: true };
const session = new Session({ maxIters: ayar.maxIters });
session.trainer = { iter: 3000, lastRefine: 2529, opts: { maxIters: 3000 }, horizon: 3000 };
const trainer = session.trainer;
session._ensureScheduler = () => {};
session._scheduleFrame = () => {};

assert.throws(() => egitimDevamEt(session, ayar, 0), /positive integer/);
assert.throws(() => egitimDevamEt(session, ayar, 1.5), /positive integer/);
assert.equal(ayar.maxIters, 3000, 'invalid extensions must leave the original budget intact');

const target = egitimDevamEt(session, ayar);
assert.equal(target, 7000, 'the quick-run continuation extends by 4000 iterations');
assert.equal(ayar.maxIters, target, 'UI progress must use the new total');
assert.equal(session.trainer.horizon, target, 'the learning-rate and growth schedules must use the extended horizon');
assert.equal(session.trainer, trainer, 'continuation must keep the existing Gaussian trainer');
assert.equal(session.training, true, 'the existing session must resume without repeating SfM or seeding');
assert.throws(() => egitimDevamEt(session, ayar), /already running/);
assert.equal(ayar.maxIters, target, 'a second click while running must not add work');

const nextRefine = session.trainer.lastRefine + (session.opts.refineEvery ?? 2500);
assert.ok(nextRefine < 0.75 * target, 'the next refinement must land inside the growth window');
console.log('3DGS quick-run continuation: OK');
