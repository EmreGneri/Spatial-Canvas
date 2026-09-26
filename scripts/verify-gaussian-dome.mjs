import assert from 'node:assert/strict';
import * as egitim from '../src/engine/reconstruction/egitim3dgs.ts';
import {
  bendFrame, deformGaussianBuffer, domePointAndJacobian, domePointAndJacobianInFrame,
} from '../src/engine/reconstruction/gaussianDeform.ts';

function near(actual, expected, label, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, received ${actual}`);
}
function nearArray(actual, expected, label, tolerance = 1e-9) {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < expected.length; i++) near(actual[i], expected[i], `${label}[${i}]`, tolerance);
}
function det3(a) {
  return a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
}
function mul3(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return out;
}
const tr3 = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
function finiteDifference(map, point, h = 1e-6) {
  const jacobian = new Array(9);
  for (let col = 0; col < 3; col++) {
    const plus = point.slice(), minus = point.slice();
    plus[col] += h; minus[col] -= h;
    const a = map(plus).point, b = map(minus).point;
    for (let row = 0; row < 3; row++) jacobian[row * 3 + col] = (a[row] - b[row]) / (2 * h);
  }
  return jacobian;
}

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// Strength 0 is the exact identity, point and Jacobian, and a bit-identical buffer.
const flat = domePointAndJacobian([0.3, -2, 5], 0, 1);
nearArray(flat.point, [0.3, -2, 5], 'zero-curvature point', 0);
nearArray(flat.jacobian, identity, 'zero-curvature Jacobian', 0);
const params = new Float32Array([
  0.4, -0.1, 0.7, Math.log(0.05), Math.log(0.01), Math.log(0.02), 0.9, 0.1, -0.3, 0.2, 0.3, 0.4, 0.5, 0.6, 0, 0,
]);
assert.deepEqual(deformGaussianBuffer(params, 1, { kind: 'dome', curvature: 0, halfLength: 1 }), params,
  'zero dome restores the buffer bit-identically');

// The pivot and the up axis through it stay put; the ground there is untouched.
const pivotMap = domePointAndJacobian([0, 0, 0], 1.2, 1);
nearArray(pivotMap.point, [0, 0, 0], 'pivot fixed');
nearArray(pivotMap.jacobian, identity, 'pivot Jacobian is identity');
nearArray(domePointAndJacobian([0, 0.3, 0], 1.2, 1).point, [0, 0.3, 0], 'up axis fixed');

// Tiny planet: a ground point at rim angle pi/2 lands on a quarter circle of
// radius 1/k, and its vertical (a tree) fans outward along the sphere normal.
const k = Math.PI / 2;
const rim = domePointAndJacobian([1, 0, 0], k, 1);
nearArray(rim.point, [1 / k, -1 / k, 0], 'rim on the sphere');
const mid = domePointAndJacobian([0, 0, 0.5], k, 1);
const theta = k * 0.5;
nearArray([mid.jacobian[1], mid.jacobian[4], mid.jacobian[7]], [0, Math.cos(theta), Math.sin(theta)],
  'vertical column follows the outward sphere normal');
const oblique = domePointAndJacobian([0.3, 0, 0.4], k, 1).point;
nearArray([oblique[0], oblique[2]], [0.6, 0.8].map((d) => d * Math.sin(theta) / k), 'radial direction preserved');

// Analytic vs finite-difference Jacobian: inside, outside (rigid continuation),
// negative curvature (bowl), soft region deep below the sphere centre, near pole.
for (const [point, curvature, halfLength] of [
  [[0.2, 0.1, 0.3], 1.1, 1],
  [[-0.4, -0.3, 0.25], 1.1, 1],
  [[1.7, 0.2, -0.9], 1.3, 1],
  [[-2.5, -0.4, 3.1], 1.5, 1],
  [[0.3, 0.2, -0.6], -1.2, 1],
  [[2.2, 0.5, 0.1], -1.4, 1],
  [[0.3, -2.4, 0.2], 1.2, 1],
  [[3, -6, -2], 1.5, 1],
  [[1e-4, 0.2, -2e-4], 1.4, 1],
  [[0.5, 0.1, 0.5], 0.9, Infinity],
]) {
  const map = (p) => domePointAndJacobian(p, curvature, halfLength);
  nearArray(map(point).jacobian, finiteDifference(map, point), `dome FD ${point} k=${curvature}`, 2e-6);
}

// Same in a tilted frame whose Y column is the scene up.
const up = [0.2, 0.9, -0.3];
const frame = bendFrame('yana', up, [0.1, -0.2, -1]);
near(det3(frame), 1, 'dome frame is proper');
for (const point of [[0.2, 0.4, -0.1], [1.3, -0.2, 0.9]]) {
  const map = (p) => domePointAndJacobianInFrame(p, frame, 1.2, 1);
  nearArray(map(point).jacobian, finiteDifference(map, point), `framed dome FD ${point}`, 2e-6);
}
const upUnit = up.map((v) => v / Math.hypot(...up));
nearArray(domePointAndJacobianInFrame(upUnit.map((v) => 0.25 * v), frame, 1.2, 1).point, upUnit.map((v) => 0.25 * v),
  'framed up axis through the pivot stays put');

// Continuity at the region edge (positions for any height, full Jacobian on the ground).
for (const [x, h, z] of [[0.6, 0, 0.8], [0.6, 0.3, 0.8], [-1, -0.2, 0]]) {
  const r = Math.hypot(x, z);
  const inside = domePointAndJacobian([x / r * (1 - 1e-9), h, z / r * (1 - 1e-9)], 1.3, 1);
  const outside = domePointAndJacobian([x / r * (1 + 1e-9), h, z / r * (1 + 1e-9)], 1.3, 1);
  nearArray(inside.point, outside.point, `edge position continuity ${[x, h, z]}`, 1e-8);
  if (h === 0) nearArray(inside.jacobian, outside.jacobian, `edge Jacobian continuity ${[x, h, z]}`, 1e-6);
}

// Pole: rho = 0 exactly and rho -> 0 agree, both finite.
const pole = domePointAndJacobian([0, 0.2, 0], 1.3, 1);
const nearPole = domePointAndJacobian([1e-12, 0.2, -1e-12], 1.3, 1);
assert.ok([...pole.point, ...pole.jacobian].every(Number.isFinite), 'pole finite');
nearArray(pole.jacobian, nearPole.jacobian, 'pole Jacobian limit', 1e-9);

// Far outliers (and an unbounded region, whose angle must be capped before
// wrapping past the antipode) never produce NaN or an orientation flip.
for (const halfLength of [1, Infinity]) {
  for (const curvature of [Math.PI / 2, -Math.PI / 2, 3]) {
    for (const point of [[1e4, 0, 0], [-3e3, 2e3, 5e3], [0, -1e4, 0], [0, 1e4, 0], [7e3, -9e3, -2e3], [40, -0.3, 40]]) {
      const { point: out, jacobian } = domePointAndJacobian(point, curvature, halfLength);
      assert.ok([...out, ...jacobian].every(Number.isFinite), `outlier finite ${point} k=${curvature} L=${halfLength}`);
      assert.ok(det3(jacobian) > 0, `outlier keeps orientation ${point} k=${curvature} L=${halfLength}`);
    }
  }
}
const outliers = new Float32Array(16 * 4);
[[1e4, 0, 0], [0, -1e4, 0], [-5e3, 3e3, 8e3], [0.2, 0.1, 0.2]].forEach((p, i) => {
  outliers.set([...p, -3, -4, -2, 1, 0, 0, 0, 0.5, 0.5, 0.5, 1, 0, 0], i * 16);
});
const deformedOutliers = deformGaussianBuffer(outliers, 4, { kind: 'dome', curvature: Math.PI / 2, halfLength: 1, frame });
assert.ok(deformedOutliers.every(Number.isFinite), 'outlier buffer finite');
for (let i = 0; i < 4; i++) {
  for (let a = 0; a < 3; a++) assert.ok(deformedOutliers[i * 16 + 3 + a] > -30, `outlier ${i} scale not collapsed`);
}

// Buffer path uses the exact J C J^T covariance.
function covariance(p, base) {
  const [w, x, y, z] = [p[base + 6], p[base + 7], p[base + 8], p[base + 9]];
  const n = Math.hypot(w, x, y, z);
  const [qw, qx, qy, qz] = [w / n, x / n, y / n, z / n];
  const r = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy),
    2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx),
    2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy),
  ];
  const s = [0, 1, 2].map((a) => Math.exp(2 * p[base + 3 + a]));
  return mul3(r.map((v, i) => v * s[i % 3]), tr3(r));
}
const source = new Float64Array(params);
const domed = deformGaussianBuffer(params, 1, { kind: 'dome', curvature: 1.3, halfLength: 1, frame });
const expected = domePointAndJacobianInFrame(Array.from(params.slice(0, 3)), frame, 1.3, 1);
nearArray(Array.from(domed.slice(0, 3)), expected.point, 'buffer position', 1e-6);
nearArray(covariance(domed, 0), mul3(mul3(expected.jacobian, covariance(source, 0)), tr3(expected.jacobian)),
  'buffer covariance is J C J^T', 1e-8);
assert.deepEqual(domed.slice(10, 16), params.slice(10, 16), 'appearance untouched');
// Number form still means the cylindrical bend (back-compat).
assert.deepEqual(deformGaussianBuffer(params, 1, 0.4, 1), deformGaussianBuffer(params, 1, { kind: 'bend', curvature: 0.4, halfLength: 1 }));

// Scene-level settings -> spec: region from cameras + pivot (never the splats),
// strength 1 = pi/2 rim angle, frame Y column is the scene up.
const cams = [[2, 0, 0], [0, 0, 2], [-2, 0, 0]];
const spec = egitim.deformSpec({ kind: 'dome', strength: 1 }, cams, [0, 0, 0], [0, 2, 0]);
assert.equal(spec.kind, 'dome');
near(spec.halfLength, 2, 'dome half-length from cameras');
near(spec.curvature * spec.halfLength, Math.PI / 2, 'strength 1 = quarter sphere at the rim');
nearArray([spec.frame[1], spec.frame[4], spec.frame[7]], [0, 1, 0], 'dome frame up column');
near(det3(spec.frame), 1, 'scene dome frame proper');
const bendSpec = egitim.deformSpec({ kind: 'bend', strength: 0.5, direction: 'yukari' }, cams, [0, 0, 0], [0, 1, 0]);
assert.equal(bendSpec.kind, 'bend');
near(bendSpec.curvature, egitim.bendRegion(cams, [0, 0, 0], 0.5).curvature, 'bend spec matches bendRegion');
assert.throws(() => egitim.deformSpec({ kind: 'dome', strength: 1.5 }, cams, [0, 0, 0], [0, 1, 0]), RangeError);

// Controller: a dome composes with the fade in exactly one write, zero restores.
{
  const original = new Float32Array([1, 0.2, 0, -3, -3, -3, 1, 0, 0, 0, 0.3, 0.4, 0.5, 2, 0, 0,
    9, 0, 0, -3, -3, -3, 1, 0, 0, 0, 0.3, 0.4, 0.5, 2, 0, 0]);
  const writes = [];
  const session = {
    trainer: { device: { queue: { writeBuffer(_b, _o, data) { writes.push(new Float32Array(data)); } } }, bufParams: {} },
    async exportRawState() { return { data: original.slice(), n: 2 }; },
  };
  const controller = egitim.createGaussianBendController(session, () => true, () => {});
  const domeSpec = { kind: 'dome', curvature: 1.2, halfLength: 2, frame: identity };
  await controller.apply(domeSpec, Infinity, undefined, 2);
  assert.equal(writes.length, 1, 'dome + fade = one write');
  const plain = deformGaussianBuffer(original, 2, domeSpec);
  nearArray(Array.from(writes[0].slice(0, 13)), Array.from(plain.slice(0, 13)), 'controller dome equals buffer dome', 1e-6);
  assert.ok(writes[0][16 + 13] < original[16 + 13], 'far splat faded on top of the dome');
  await controller.apply({ kind: 'dome', curvature: 0, halfLength: 2 }, Infinity, undefined, Infinity);
  assert.deepEqual(writes.at(-1), original, 'zero dome, fade off = exact restore');
}

console.log('gaussian dome deform: ok');
