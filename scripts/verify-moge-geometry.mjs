import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

assert.ok(existsSync(new URL('../src/engine/vision/mogeGeometry.ts', import.meta.url)), 'MoGe geometry implementation must exist');
const { recoverMogeFocalShift, mogePointsToMetricDepth } = await import('../src/engine/vision/mogeGeometry.ts');

function fixture(width, height, focal, shift, scale) {
  const points = new Float32Array(width * height * 3);
  const expected = new Float32Array(width * height);
  const diagonal = Math.hypot(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const z = 1.5 + 2 * x / width + 0.7 * Math.sin(y / height * 5) + (x > width / 2 ? 1 : 0);
    points.set([(2 * x + 1 - width) / diagonal * z / focal, (2 * y + 1 - height) / diagonal * z / focal, z - shift], i * 3);
    expected[i] = z * scale;
  }
  return { points, expected };
}

for (const [width, height, focal, shift, scale] of [[128, 96, 1.7, 0.8, 2.3], [160, 72, 0.8, -2, 0.4], [72, 160, 2.5, 3, 5]]) {
  const { points, expected } = fixture(width, height, focal, shift, scale);
  const mask = Float32Array.from({ length: width * height }, (_, i) => i % 11 === 0 ? 0 : 1);
  points[0] = NaN; // A masked invalid prediction must never enter calibration.
  const result = mogePointsToMetricDepth(points, width, height, scale, mask);
  let maxRelativeDepthError = 0;
  for (let i = 0; i < expected.length; i++) {
    if (mask[i]) maxRelativeDepthError = Math.max(maxRelativeDepthError, Math.abs(result.depth[i] / expected[i] - 1));
    else assert.equal(result.depth[i], Infinity);
  }
  assert.ok(Math.abs(result.focal - focal) < 1e-5, 'known focal recovered');
  assert.ok(Math.abs(result.shift - shift) < 1e-5, 'known affine z shift recovered');
  assert.ok(maxRelativeDepthError < 1e-5, 'metric scale applied after shift');
  assert.ok(Math.abs(result.intrinsics[0] * width - result.intrinsics[4] * height) < 1e-10);
  assert.equal(result.intrinsics[2], 0.5);
  assert.equal(result.intrinsics[5], 0.5);
  console.log(JSON.stringify({ width, height, focalError: Math.abs(result.focal - focal), shiftError: Math.abs(result.shift - shift), maxRelativeDepthError, projectionRmse: result.projectionRmse }));
}

// Noisy predictions require the nonlinear reprojection objective, beyond affine LS initialization.
{
  const { points } = fixture(128, 96, 1.4, 0.6, 1);
  for (let i = 0; i < points.length; i += 3) points[i] += 0.035 * Math.sin(i * 0.13);
  const fit = recoverMogeFocalShift(points, 128, 96);
  assert.ok(fit.projectionRmse < fit.initialProjectionRmse - 1e-7, 'nonlinear refinement improves reprojection error');
  console.log(JSON.stringify({ noisyInitialRmse: fit.initialProjectionRmse, noisyRefinedRmse: fit.projectionRmse }));
}

{
  const { points } = fixture(128, 96, 1.4, 0.6, 1);
  // Last pixel is outside the 64x64 nearest calibration samples.
  points[points.length - 1] = -100;
  const result = mogePointsToMetricDepth(points, 128, 96, 1);
  assert.equal(result.depth[result.depth.length - 1], Infinity, 'negative recovered depth masked');
  assert.equal(result.validMask[result.validMask.length - 1], 0);
  assert.throws(() => recoverMogeFocalShift(points, 128, 96, new Float32Array(128 * 96)), /valid|sample/i);
  assert.throws(() => mogePointsToMetricDepth(points, 128, 96, 0), /scale/i);
  assert.throws(() => recoverMogeFocalShift(new Float32Array(8), 2, 2), /shape|length/i);
  assert.throws(() => recoverMogeFocalShift(new Float32Array(12), 2, 2), /degenerate/i);
  const plane = fixture(32, 32, 1.4, 0, 1).points;
  for (let i = 2; i < plane.length; i += 3) plane[i] = 2;
  assert.throws(() => recoverMogeFocalShift(plane, 32, 32), /degenerate/i);
}
console.log('verify-moge-geometry OK');
