import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { egitimOturumAyari } from '../src/engine/reconstruction/egitim3dgs.ts';
import * as page from '../src/bench/gezinmeSayfasi.ts';

const quick = { tier: 'quick', maxFrames: 24, maxIters: 3000, gpu: 'test', zayifGpu: true, entegreGpu: false };

assert.deepEqual(egitimOturumAyari(quick), {
  maxIters: 3000, holdout: 'auto', refineEvery: 375,
});
assert.deepEqual(egitimOturumAyari(quick, {
  refineEvery: 200, capMult: 2, maxSplats: 90000, seed: 17,
}), {
  maxIters: 3000, holdout: 'auto', refineEvery: 200,
  trainer: { capMult: 2, maxSplats: 90000, seed: 17 },
});

const parsed = page.parametreleriOku('?klip=/clip.webm&refine-every=200&cap-mult=2.5&max-splats=90000&trainer-seed=0');
assert.deepEqual(parsed.egitim, { refineEvery: 200, capMult: 2.5, maxSplats: 90000, seed: 0 });
assert.equal(page.parametreleriOku('?klip=/clip.webm').egitim, undefined);
assert.throws(() => page.parametreleriOku('?klip=/clip.webm&refine-every=0'), /refine-every/);
assert.throws(() => page.parametreleriOku('?klip=/clip.webm&cap-mult=NaN'), /cap-mult/);
assert.throws(() => page.parametreleriOku('?klip=/clip.webm&max-splats=-1'), /max-splats/);

assert.equal(typeof page.egitimOlcumRaporu, 'function');
assert.deepEqual(page.egitimOlcumRaporu(quick, parsed.egitim, [
  { kind: 'refine', iter: 1520, moved: 2, grown: 100, ms: 25 },
  { kind: 'refine', iter: 1904, moved: 0, grown: 200, ms: 40 },
  { kind: 'refine', iter: 2304, moved: 0, grown: 0, ms: 0 },
], 1200, 1500, 12345, [{ psnr: 28 }, { psnr: 30 }]), {
  settings: { refineEvery: 200, capMult: 2.5, maxSplats: 90000, seed: 0, actualCap: 1500 },
  initialN: 900,
  refinements: [
    { iter: 1520, moved: 2, grown: 100, n: 1000, ms: 25 },
    { iter: 1904, moved: 0, grown: 200, n: 1200, ms: 40 },
    { iter: 2304, moved: 0, grown: 0, n: 1200, ms: 0 },
  ],
  elapsedMs: 12345,
  heldoutPsnrMean: 29,
});

const tempDir = mkdtempSync(join(tmpdir(), 'gs-bench-flags-'));
const clip = join(tempDir, 'empty.webm');
try {
  writeFileSync(clip, '');
  const result = spawnSync(process.execPath, ['scripts/olc-gezinme.mjs', clip, '--refine-every', '0'], {
    encoding: 'utf8', cwd: process.cwd(), timeout: 5000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--refine-every must be a positive integer/);
} finally {
  unlinkSync(clip);
  rmdirSync(tempDir);
}

console.log('3DGS benchmark training options: OK');
