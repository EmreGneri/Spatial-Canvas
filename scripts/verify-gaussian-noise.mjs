import assert from 'node:assert/strict';
import * as egitim from '../src/engine/reconstruction/egitim3dgs.ts';
import {
  deformGaussianBuffer, fadeGaussianOpacity, isIdentityDeform, noiseAmplitudeLimit, noisePointAndJacobian,
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
function finiteDifference(map, point, h) {
  const jacobian = new Array(9);
  for (let col = 0; col < 3; col++) {
    const plus = point.slice(), minus = point.slice();
    plus[col] += h; minus[col] -= h;
    const a = map(plus).point, b = map(minus).point;
    for (let row = 0; row < 3; row++) jacobian[row * 3 + col] = (a[row] - b[row]) / (2 * h);
  }
  return jacobian;
}
let state = 12345;
const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
const randomPoint = (scale) => [0, 1, 2].map(() => (random() * 2 - 1) * scale);
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// Zero amplitude is the exact identity: point, Jacobian, buffer, and isIdentityDeform.
const still = noisePointAndJacobian([0.3, -2, 5], 0, 1.5, 7, 0.3);
nearArray(still.point, [0.3, -2, 5], 'zero-amplitude point', 0);
nearArray(still.jacobian, identity, 'zero-amplitude Jacobian', 0);
const params = new Float32Array([
  0.4, -0.1, 0.7, Math.log(0.05), Math.log(0.01), Math.log(0.02), 0.9, 0.1, -0.3, 0.2, 0.3, 0.4, 0.5, 0.6, 0, 0,
]);
const zeroNoise = { kind: 'noise', amplitude: 0, frequency: 1.5, seed: 7, time: 0.3 };
assert.equal(isIdentityDeform(zeroNoise), true, 'zero noise is identity');
assert.equal(isIdentityDeform({ ...zeroNoise, amplitude: 0.01 }), false, 'non-zero noise is not identity');
assert.equal(isIdentityDeform({ kind: 'bend', curvature: 0 }), true, 'zero bend is identity');
assert.equal(isIdentityDeform({ kind: 'dome', curvature: 0.2 }), false, 'non-zero dome is not identity');
assert.throws(() => isIdentityDeform({ ...zeroNoise, frequency: 0 }), RangeError, 'frequency must be positive');
assert.throws(() => isIdentityDeform({ ...zeroNoise, amplitude: NaN }), RangeError, 'amplitude must be finite');
assert.throws(() => isIdentityDeform({ ...zeroNoise, seed: 1.5 }), RangeError, 'seed must be an integer');
assert.throws(() => isIdentityDeform({ kind: 'bend', curvature: Infinity }), RangeError, 'curvature must be finite');
assert.deepEqual(deformGaussianBuffer(params, 1, zeroNoise), params, 'zero noise restores the buffer bit-identically');

// Clamp: the amplitude limit scales as 1/frequency, anything above it (either
// sign) behaves exactly like the limit.
for (const frequency of [0.05, 1, 3.7, 40]) {
  const limit = noiseAmplitudeLimit(frequency);
  assert.ok(limit > 0 && Number.isFinite(limit), `limit positive at f=${frequency}`);
  near(limit * frequency, noiseAmplitudeLimit(1), `limit ~ 1/f at f=${frequency}`, 1e-12);
  const p = randomPoint(2);
  assert.deepEqual(noisePointAndJacobian(p, 50 * limit, frequency, 3, 0.1),
    noisePointAndJacobian(p, limit, frequency, 3, 0.1), `over-limit clamps at f=${frequency}`);
  assert.deepEqual(noisePointAndJacobian(p, -50 * limit, frequency, 3, 0.1),
    noisePointAndJacobian(p, -limit, frequency, 3, 0.1), `negative over-limit clamps at f=${frequency}`);
  assert.notDeepEqual(noisePointAndJacobian(p, 0.5 * limit, frequency, 3, 0.1),
    noisePointAndJacobian(p, limit, frequency, 3, 0.1), `below-limit is not clamped at f=${frequency}`);
}
assert.throws(() => noiseAmplitudeLimit(0), RangeError);

// Displacement never exceeds |amplitude| (bounded, so outliers stay finite).
for (let i = 0; i < 200; i++) {
  const p = randomPoint(5), frequency = 0.8, amplitude = noiseAmplitudeLimit(frequency);
  const out = noisePointAndJacobian(p, amplitude, frequency, 11, 0.4).point;
  assert.ok(Math.hypot(out[0] - p[0], out[1] - p[1], out[2] - p[2]) <= amplitude * (1 + 1e-12), `displacement bounded ${p}`);
}

// The (finite-difference) Jacobian agrees with an independent finite difference of the point map.
for (const [frequency, seed, time] of [[1, 0, 0], [2.5, 9, 0.37], [0.3, 123456, 0.9], [12, 4, 0.05]]) {
  for (let i = 0; i < 8; i++) {
    const amplitude = noiseAmplitudeLimit(frequency) * (random() * 2 - 1);
    const point = randomPoint(3 / frequency);
    const map = (p) => noisePointAndJacobian(p, amplitude, frequency, seed, time);
    nearArray(map(point).jacobian, finiteDifference(map, point, 3e-5 / frequency),
      `noise FD f=${frequency} seed=${seed} ${point}`, 2e-5);
  }
}

// det J > 0 over the whole allowed range: frequencies across four decades,
// amplitudes up to the limit (and beyond it, clamped), seeds, times, outliers.
let minDet = Infinity;
for (const frequency of [0.01, 0.1, 1, 10, 100]) {
  for (const scale of [1, -1, 1000, -1000]) {
    for (let i = 0; i < 300; i++) {
      const amplitude = scale * noiseAmplitudeLimit(frequency) * (Math.abs(scale) > 1 ? 1 : random());
      const point = i < 290 ? randomPoint(10 / frequency) : randomPoint(1e4);
      const { point: out, jacobian } = noisePointAndJacobian(point, amplitude, frequency, i % 5, random() * 4 - 2);
      assert.ok([...out, ...jacobian].every(Number.isFinite), `finite f=${frequency} ${point}`);
      const det = det3(jacobian);
      minDet = Math.min(minDet, det);
      assert.ok(det > 0, `det > 0 f=${frequency} A=${amplitude} ${point}: ${det}`);
    }
  }
}
assert.ok(minDet > 0.005, `det J stays well away from zero (min ${minDet})`);

// Seed determinism: same seed -> identical; different seed -> different field.
{
  const spec = { kind: 'noise', amplitude: 0.05, frequency: 2, seed: 42, time: 0.25 };
  assert.deepEqual(deformGaussianBuffer(params, 1, spec), deformGaussianBuffer(params, 1, { ...spec }), 'same seed, same buffer');
  assert.notDeepEqual(deformGaussianBuffer(params, 1, spec), deformGaussianBuffer(params, 1, { ...spec, seed: 43 }),
    'different seed, different buffer');
  assert.deepEqual(noisePointAndJacobian([0.1, 0.2, 0.3], 0.05, 2, 42, 0.25), noisePointAndJacobian([0.1, 0.2, 0.3], 0.05, 2, 42, 0.25));
}

// Time: continuous (Lipschitz) in t, changes the field, and loops with period 1.
{
  const p = [0.2, -0.4, 0.6], frequency = 1.3, amplitude = noiseAmplitudeLimit(frequency);
  const at = (t) => noisePointAndJacobian(p, amplitude, frequency, 5, t).point;
  for (const t of [0, 0.13, 0.5, 0.99]) {
    for (const dt of [1e-3, 1e-6]) {
      const a = at(t), b = at(t + dt);
      const step = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(step <= 40 * amplitude * dt, `time continuity t=${t} dt=${dt}: ${step}`);
    }
  }
  const a = at(0), b = at(0.5);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-3 * amplitude, 'time changes the field');
  nearArray(at(1), at(0), 'time loops with period 1', 1e-12);
  nearArray(at(2.3), at(0.3), 'time loops with period 1 (2.3 vs 0.3)', 1e-12);
}

// Buffer path uses the exact J C J^T covariance; appearance untouched.
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
{
  const spec = { kind: 'noise', amplitude: noiseAmplitudeLimit(1.7), frequency: 1.7, seed: 2, time: 0.6 };
  const noisy = deformGaussianBuffer(params, 1, spec);
  const expected = noisePointAndJacobian(Array.from(params.slice(0, 3)), spec.amplitude, 1.7, 2, 0.6);
  nearArray(Array.from(noisy.slice(0, 3)), expected.point, 'buffer position', 1e-6);
  nearArray(covariance(noisy, 0), mul3(mul3(expected.jacobian, covariance(new Float64Array(params), 0)), tr3(expected.jacobian)),
    'buffer covariance is J C J^T', 1e-8);
  assert.deepEqual(noisy.slice(10, 16), params.slice(10, 16), 'appearance untouched');
}

// Scene settings -> spec: frequency from the camera region, strength scales the clamp limit.
{
  const cams = [[2, 0, 0], [0, 0, 2], [-2, 0, 0]];
  const spec = egitim.deformSpec({ kind: 'noise', strength: 1, seed: 3, time: 0.2 }, cams, [0, 0, 0], [0, 1, 0]);
  assert.equal(spec.kind, 'noise');
  assert.equal(spec.seed, 3);
  assert.equal(spec.time, 0.2);
  const farCams = cams.map((c) => c.map((v) => 2 * v));
  const far = egitim.deformSpec({ kind: 'noise', strength: 1, seed: 3, time: 0.2 }, farCams, [0, 0, 0], [0, 1, 0]);
  near(far.frequency, spec.frequency / 2, 'frequency follows the camera region');
  near(spec.amplitude, noiseAmplitudeLimit(spec.frequency), 'strength 1 = amplitude limit');
  const half = egitim.deformSpec({ kind: 'noise', strength: -0.5 }, cams, [0, 0, 0], [0, 1, 0]);
  near(half.amplitude, -0.5 * noiseAmplitudeLimit(half.frequency), 'strength scales amplitude');
  assert.equal(half.seed, 0, 'default seed');
  assert.equal(half.time, 0, 'default time');
  assert.throws(() => egitim.deformSpec({ kind: 'noise', strength: 1.2 }, cams, [0, 0, 0], [0, 1, 0]), RangeError);
}

// Controller: noise composes with the fade in exactly one write; zero noise
// with the fade off restores the snapshot exactly.
{
  const original = new Float32Array([1, 0.2, 0, -3, -3, -3, 1, 0, 0, 0, 0.3, 0.4, 0.5, 2, 0, 0,
    9, 0, 0, -3, -3, -3, 1, 0, 0, 0, 0.3, 0.4, 0.5, 2, 0, 0]);
  const writes = [];
  const session = {
    trainer: { device: { queue: { writeBuffer(_b, _o, data) { writes.push(new Float32Array(data)); } } }, bufParams: {} },
    async exportRawState() { return { data: original.slice(), n: 2 }; },
  };
  const controller = egitim.createGaussianBendController(session, () => true, () => {});
  const noiseSpec = { kind: 'noise', amplitude: noiseAmplitudeLimit(0.8), frequency: 0.8, seed: 1, time: 0.1 };
  await controller.apply(noiseSpec, Infinity, undefined, 2);
  assert.equal(writes.length, 1, 'noise + fade = one write');
  const plain = deformGaussianBuffer(original, 2, noiseSpec);
  nearArray(Array.from(writes[0].slice(0, 13)), Array.from(plain.slice(0, 13)), 'controller noise equals buffer noise', 1e-6);
  const faded = fadeGaussianOpacity(original, 2, 2);
  assert.equal(writes[0][16 + 13], faded[16 + 13], 'fade read from the pre-noise snapshot');
  assert.ok(writes[0][16 + 13] < original[16 + 13], 'far splat faded on top of the noise');
  await controller.apply({ ...noiseSpec, amplitude: 0 }, Infinity, undefined, Infinity);
  assert.equal(writes.length, 2, 'zero noise after an active one writes the restore');
  assert.deepEqual(writes.at(-1), original, 'zero noise, fade off = exact restore');
  await controller.apply({ ...noiseSpec, amplitude: 0 }, Infinity, undefined, Infinity);
  assert.equal(writes.length, 2, 'zero noise while inactive does not write');
}

console.log('gaussian noise deform: ok');
