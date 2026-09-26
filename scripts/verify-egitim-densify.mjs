import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { egitimOturumAyari } from '../src/engine/reconstruction/egitim3dgs.ts';

// The vendored schedule this check mirrors (do not edit the vendored files):
// session.js refines when iter > 1500 and iter - lastRefine >= refineEvery
// (default 2500); the default trainer's legacy refine only grows while
// iter < growUntil (default 0.75 x horizon).
const session = readFileSync(new URL('../src/vendor/splat.js/session.js', import.meta.url), 'utf8');
const trainer = readFileSync(new URL('../src/vendor/splat.js/gs/trainer.js', import.meta.url), 'utf8');
assert.match(session, /trainer\.iter > 1500 &&\s+trainer\.iter - \(trainer\.lastRefine \|\| 0\) >= \(this\.opts\.refineEvery \?\? 2500\)/);
assert.match(trainer, /if \(this\.opts\.refineV2 !== true\) return this\._refineLegacy\(rng\);/);
assert.match(trainer, /_refineLegacy[\s\S]*?const canGrow = this\.iter < \(this\.opts\.growUntil \?\? 0\.75 \* this\.horizon\)/);

// The session checks the gate after each batch; 16 iterations is a typical batch.
function growthRefines(opts, batch = 16) {
  const growUntil = opts.trainer?.growUntil ?? 0.75 * opts.maxIters;
  const every = opts.refineEvery ?? 2500;
  const out = [];
  for (let iter = batch, last = 0; iter <= opts.maxIters; iter += batch) {
    if (iter > 1500 && iter - last >= every) {
      last = iter;
      if (iter < growUntil) out.push(iter);
    }
  }
  return out;
}

for (const [tier, maxIters, minGrowths] of [['quick', 3000, 2], ['standard', 10000, 4]]) {
  const opts = egitimOturumAyari({ tier, maxFrames: 24, maxIters, gpu: 'test', zayifGpu: false, entegreGpu: false });
  assert.equal(opts.maxIters, maxIters);
  assert.equal(opts.holdout, 'auto', 'held-out PSNR must stay measured');
  const grows = growthRefines(opts);
  assert.ok(grows.length >= minGrowths,
    `${tier}: ${grows.length} growth refinements (${grows.join(', ') || 'none'}), expected >= ${minGrowths}`);
}
console.log('3DGS densification schedule: OK');
