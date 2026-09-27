import assert from 'node:assert/strict';
import { gezinmeHazirlikDegerlendir } from '../src/engine/reconstruction/gezinmeDerinligi.ts';

const good = gezinmeHazirlikDegerlendir({ alignedFrames: 8, validPixelRatio: 0.42,
  unknownVoxelRatio: 0.84, medianRelativeFitRmse: 0.035, worstRelativeFitRmse: 0.05, baselineRatio: 0.18 });
assert.equal(good.serbestGezinmeUygun, true, 'enough aligned multi-view geometry may offer experimental free-fly');
assert.equal(good.nedenler.length, 0);
for (const [label, sample] of [
  ['too few aligned frames', { alignedFrames: 2 }],
  ['insufficient valid depth', { validPixelRatio: 0.01 }],
  ['mostly unknown volume', { unknownVoxelRatio: 0.985 }],
  ['one bad aligned frame', { medianRelativeFitRmse: 0.035, worstRelativeFitRmse: 0.4 }],
  ['insufficient camera viewpoint diversity', { baselineRatio: 0.005 }],
]) {
  const status = gezinmeHazirlikDegerlendir({ alignedFrames: 8, validPixelRatio: 0.42,
    unknownVoxelRatio: 0.84, medianRelativeFitRmse: 0.035, worstRelativeFitRmse: 0.05, baselineRatio: 0.18, ...sample });
  assert.equal(status.serbestGezinmeUygun, false, `${label} must hold the user in orbit mode`);
  assert.ok(status.nedenler.length > 0, `${label} exposes an explanation`);
}
console.log('navigation readiness gates: sparse/low-confidence geometry stays in orbit mode');
