import assert from 'node:assert/strict';
import { bendPointAndJacobian, deformGaussianBuffer, polarDecompose3 } from '../src/engine/reconstruction/gaussianDeform.ts';

const EPSILON = 1e-9;

function near(actual, expected, label, tolerance = EPSILON) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`);
}

function nearArray(actual, expected, label, tolerance = EPSILON) {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < expected.length; i++) near(actual[i], expected[i], `${label}[${i}]`, tolerance);
}

function multiply3(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

function transpose3(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

// A non-diagonal symmetric stretch catches implementations that keep only three axis scales.
const affine = [-0.4, -1, 0, 2, 0.4, 0, 0, 0, 3];
const { rotation, stretch } = polarDecompose3(affine);
nearArray(rotation, [0, -1, 0, 1, 0, 0, 0, 0, 1], 'polar rotation');
nearArray(stretch, [2, 0.4, 0, 0.4, 1, 0, 0, 0, 3], 'polar stretch');
nearArray(multiply3(rotation, stretch), affine, 'polar reconstruction');
nearArray(multiply3(transpose3(rotation), rotation), [1, 0, 0, 0, 1, 0, 0, 0, 1], 'rotation orthogonality');

// Tiny but full-rank matrices must retain their off-diagonal stretch and orthogonal polar factor.
const tinyAffine = [-4e-9, -1e-8, 0, 2e-8, 4e-9, 0, 0, 0, 3e-8];
const tinyPolar = polarDecompose3(tinyAffine);
nearArray(multiply3(transpose3(tinyPolar.rotation), tinyPolar.rotation),
  [1, 0, 0, 0, 1, 0, 0, 0, 1], 'tiny polar rotation orthogonality', 1e-8);
nearArray(multiply3(tinyPolar.rotation, tinyPolar.stretch), tinyAffine,
  'tiny polar reconstruction', 1e-16);

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const straight = bendPointAndJacobian([2, -3, 4], 0);
nearArray(straight.point, [2, -3, 4], 'zero-curvature point');
nearArray(straight.jacobian, identity, 'zero-curvature Jacobian');

// Curvature is radians per scene unit. At theta=pi/2 the centerline follows a quarter-circle.
const quarter = bendPointAndJacobian([1, 3, 0], Math.PI / 2);
nearArray(quarter.point, [2 / Math.PI, 3, -2 / Math.PI], 'quarter-circle point');
nearArray(quarter.jacobian, [0, 0, 1, 0, 1, 0, -1, 0, 0], 'quarter-circle Jacobian');

// Finite differences independently check all Jacobian columns, including z-dependent stretch.
for (const [point, curvature] of [
  [[0.2, -1, 0.3], 0.7],
  [[-1.1, 2, -0.4], -0.25],
  [[3, 0, 1.2], 1e-6],
]) {
  const { jacobian } = bendPointAndJacobian(point, curvature);
  const step = 1e-5;
  for (let axis = 0; axis < 3; axis++) {
    const plus = point.slice();
    const minus = point.slice();
    plus[axis] += step;
    minus[axis] -= step;
    const a = bendPointAndJacobian(plus, curvature).point;
    const b = bendPointAndJacobian(minus, curvature).point;
    for (let row = 0; row < 3; row++) {
      near(jacobian[row * 3 + axis], (a[row] - b[row]) / (2 * step),
        `finite difference at ${point}, k=${curvature}, row=${row}, axis=${axis}`, 1e-6);
    }
  }
}

function covarianceFromGaussian(data, offset) {
  const [w, x, y, z] = data.slice(offset + 6, offset + 10);
  const qLength = Math.hypot(w, x, y, z);
  const a = w / qLength, b = x / qLength, c = y / qLength, d = z / qLength;
  const rotation = [
    1 - 2 * (c * c + d * d), 2 * (b * c - a * d), 2 * (b * d + a * c),
    2 * (b * c + a * d), 1 - 2 * (b * b + d * d), 2 * (c * d - a * b),
    2 * (b * d - a * c), 2 * (c * d + a * b), 1 - 2 * (b * b + c * c),
  ];
  const squaredScales = [3, 4, 5].map((i) => Math.exp(2 * data[offset + i]));
  const scaledRotation = rotation.map((value, i) => value * squaredScales[i % 3]);
  return multiply3(scaledRotation, transpose3(rotation));
}

// The first Gaussian is an aligned anisotropic ellipsoid at a quarter-circle bend.
// The second has a 45-degree local frame; its sheared covariance has an exact hand-derived target.
const source = new Float32Array([
  1, 2, 0, Math.log(2), 0, Math.log(0.5), 1, 0, 0, 0, 0.2, -0.4, 0.7, -1.3, 17, -23,
  0, -1, 0.5, Math.log(2), 0, 0, Math.cos(Math.PI / 8), 0, 0, Math.sin(Math.PI / 8),
  -0.8, 0.6, 0.3, 2.1, -7, 11,
]);
const untouched = source.slice();
const quarterBuffer = deformGaussianBuffer(source, 2, Math.PI / 2);
assert.ok(quarterBuffer instanceof Float32Array, 'buffer result must retain the trainer parameter type');
assert.notStrictEqual(quarterBuffer, source, 'the trained source buffer must remain owned by the trainer');
nearArray(source, untouched, 'source remains immutable', 0);
nearArray(quarterBuffer.slice(0, 3), [2 / Math.PI, 2, -2 / Math.PI], 'bent first center', 1e-6);
for (const base of [0, 16]) {
  nearArray(quarterBuffer.slice(base + 10, base + 16), source.slice(base + 10, base + 16),
    `DC, opacity and padding at ${base}`, 0);
}
// Center-only deformation would leave the x principal axis pointing in +x.
nearArray(covarianceFromGaussian(quarterBuffer, 0), [0.25, 0, 0, 0, 1, 0, 0, 0, 4],
  'quarter-circle rotated anisotropic covariance', 2e-5);
const [qw, qx, qy, qz] = quarterBuffer.slice(6, 10);
const qNorm = Math.hypot(qw, qx, qy, qz);
near(2 * (qx * qz - qw * qy) / (qNorm * qNorm), -1,
  'quarter-circle quaternion rotates local +x toward world -z', 2e-5);
assert.ok(Math.abs(covarianceFromGaussian(source, 0)[0] - covarianceFromGaussian(quarterBuffer, 0)[0]) > 1,
  'moving only the center must not satisfy the covariance check');

const sheared = deformGaussianBuffer(source.subarray(16, 32), 1, 1);
nearArray(sheared.slice(0, 3), [0, -1, 0.5], 'radial-stretch center', 1e-6);
nearArray(covarianceFromGaussian(sheared, 0), [5.625, 2.25, 0, 2.25, 2.5, 0, 0, 0, 1],
  'exact Jacobian covariance with non-aligned local axes', 2e-5);

// Scaling the same ellipsoid down must not turn its sheared covariance into a diagonal one.
const tinySource = new Float32Array([
  0, -1, 0.5, Math.log(1e-8), Math.log(2e-8), Math.log(1e-8),
  Math.cos(Math.PI / 8), 0, 0, Math.sin(Math.PI / 8), 0, 0, 0, 0, 0, 0,
]);
const tinySheared = deformGaussianBuffer(tinySource, 1, 1);
nearArray(covarianceFromGaussian(tinySheared, 0).map(value => value * 1e16),
  [5.625, -2.25, 0, -2.25, 2.5, 0, 0, 0, 1],
  'tiny exact Jacobian covariance', 3e-5);

const zeroBuffer = deformGaussianBuffer(source, 2, 0);
nearArray(zeroBuffer, source, 'zero-curvature trainer parameters', 1e-6);
assert.notStrictEqual(zeroBuffer, source, 'zero curvature still returns an independent snapshot');

// ── Capture region (Bend-SOP style): theta = k * clamp(x, -h, h); rigid outside.
const determinant3 = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6])
  + m[2] * (m[3] * m[7] - m[4] * m[6]);
const k45 = Math.PI / 4; // h = 1 -> end angle 45 degrees, total 90
const edge = bendPointAndJacobian([1, 0, 0], k45, 1);
const outside = bendPointAndJacobian([3, 2, 0], k45, 1);
const t45 = [Math.cos(k45), 0, -Math.sin(k45)];
nearArray(outside.point, [edge.point[0] + 2 * t45[0], 2, edge.point[2] + 2 * t45[2]],
  'outside the region the geometry continues along the end tangent');
nearArray(outside.jacobian, [Math.cos(k45), 0, Math.sin(k45), 0, 1, 0, -Math.sin(k45), 0, Math.cos(k45)],
  'outside the region the Jacobian is the pure end rotation');
const mirrored = bendPointAndJacobian([-3, 0, 0], k45, 1);
near(mirrored.point[2], outside.point[2], 'symmetric region: both ends bend the same way');
for (const z of [0, 0.4, -0.3]) {
  const eps = 1e-7;
  const inner = bendPointAndJacobian([1 - eps, 0.5, z], k45, 1);
  const outer = bendPointAndJacobian([1 + eps, 0.5, z], k45, 1);
  nearArray(inner.point, outer.point, `position continuous at the region boundary, z=${z}`, 1e-6);
  nearArray(polarDecompose3(inner.jacobian).rotation, polarDecompose3(outer.jacobian).rotation,
    `Jacobian rotation continuous at the region boundary, z=${z}`, 1e-6);
  if (z === 0) nearArray(inner.jacobian, outer.jacobian, 'full Jacobian continuous on the bend centerline', 1e-6);
}

// Radial singularity: 1 + k z -> 0 behind the bend axis. Far splats must stay
// finite and orientation-preserving without limiting k for the whole scene.
for (const [point, curvature] of [
  [[0.5, 0, -40], k45], [[0.5, 0, 40], -k45], [[-0.2, 1, -1.3], k45], [[0.7, 0, -1e4], 2],
]) {
  const { point: moved, jacobian } = bendPointAndJacobian(point, curvature, 1);
  assert.ok(moved.every(Number.isFinite) && jacobian.every(Number.isFinite), `finite far point ${point}`);
  assert.ok(determinant3(jacobian) > 0, `far point ${point} (k=${curvature}) must not fold or invert`);
}
// The softened radial profile is still an exact derivative (C1), checked by finite differences.
for (const [point, curvature, h] of [
  [[0.3, 0, -1.1], k45, 1], [[0.3, 0, 1.1], -k45, 1], [[2.5, -1, -2], k45, 1], [[0.2, 0, 0.3], 0.7, Infinity],
]) {
  const { jacobian } = bendPointAndJacobian(point, curvature, h);
  const step = 1e-6;
  for (let axis = 0; axis < 3; axis++) {
    const plus = point.slice(), minus = point.slice();
    plus[axis] += step; minus[axis] -= step;
    const a = bendPointAndJacobian(plus, curvature, h).point;
    const b = bendPointAndJacobian(minus, curvature, h).point;
    for (let row = 0; row < 3; row++) {
      near(jacobian[row * 3 + axis], (a[row] - b[row]) / (2 * step),
        `softened finite difference at ${point}, row=${row}, axis=${axis}`, 1e-5);
    }
  }
}
// Buffer level: far outliers keep finite, positive scales and unit quaternions.
const outliers = new Float32Array([
  0.5, 0, -40, Math.log(3), Math.log(0.5), Math.log(2), 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  -60, 5, 45, Math.log(10), Math.log(10), Math.log(10), 0.9, 0.1, -0.3, 0.2, 0, 0, 0, 0, 0, 0,
  0.1, 0, -1e4, Math.log(0.01), Math.log(0.01), Math.log(0.01), 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);
for (const curvature of [k45, -k45]) {
  const bentOutliers = deformGaussianBuffer(outliers, 3, curvature, 1);
  assert.ok([...bentOutliers].every(Number.isFinite), `outliers stay finite at k=${curvature}`);
  for (const base of [0, 16, 32]) {
    // The 1e4-deep splat may flatten onto the floor shell; the plausible floaters must not.
    if (base < 32) for (const axis of [3, 4, 5]) assert.ok(bentOutliers[base + axis] > -20, 'outlier scale not collapsed');
    near(Math.hypot(...bentOutliers.slice(base + 6, base + 10)), 1, 'outlier quaternion stays unit', 1e-5);
  }
}

console.log('OK · polar decomposition and cylindrical bend Jacobian');
