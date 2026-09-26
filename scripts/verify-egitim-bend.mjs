import assert from 'node:assert/strict';
import * as egitim from '../src/engine/reconstruction/egitim3dgs.ts';
import { bendFrame, deformGaussianBuffer } from '../src/engine/reconstruction/gaussianDeform.ts';

const { createGaussianBendController, bendSceneFrame } = egitim;

function near(actual, expected, label, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, received ${actual}`);
}
function nearArray(actual, expected, label, tolerance = 1e-9) {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < expected.length; i++) near(actual[i], expected[i], `${label}[${i}]`, tolerance);
}

const original = new Float32Array([
  1, 0, 0, Math.log(2), 0, 0, 1, 0, 0, 0, 0.3, 0.4, 0.5, 0.6, 0, 0,
]);
let readCount = 0;
let redrawCount = 0;
let ready = false;
const writes = [];
const session = {
  trainer: {
    device: { queue: { writeBuffer(_buffer, offset, data) {
      assert.equal(offset, 0);
      writes.push(new Float32Array(data));
    } } },
    bufParams: {},
  },
  async exportRawState() {
    readCount++;
    return { data: original.slice(), n: 1 };
  },
};
const bend = createGaussianBendController(session, () => ready, () => { redrawCount++; });

await bend.apply(0);
assert.equal(readCount, 0, 'disabled bend must not read training parameters');
assert.equal(writes.length, 0, 'disabled bend must not write training parameters');
await assert.rejects(bend.apply(0.2), /finished/);
assert.equal(readCount, 0);

ready = true;
await bend.apply(0.2);
assert.equal(readCount, 1, 'first bend captures one reversible snapshot');
assert.equal(writes.length, 1);
assert.notDeepEqual(writes[0].slice(0, 3), original.slice(0, 3));
assert.deepEqual(writes[0].slice(10, 16), original.slice(10, 16), 'appearance parameters survive');
await bend.apply(-0.2);
assert.equal(readCount, 1, 'moving the slider must reuse the snapshot');
assert.equal(writes.length, 2);
await bend.apply(0);
assert.deepEqual(writes.at(-1), original, 'zero restores exact trainer parameters');
assert.equal(redrawCount, 3);

await bend.apply(0.15);
bend.restoreForTraining();
assert.deepEqual(writes.at(-1), original, 'continuation starts from trained parameters');
await bend.apply(0.1);
assert.equal(readCount, 2, 'post-continuation bends need a fresh snapshot');

// Regression for the failed real-scene acceptance: far floaters (40-60 units
// out, like the trained St George scene) must not cap the bend on the subject.
// Subject spans local x in [-1, 1] around an off-origin pivot; a 90 degree
// total bend over that region must put 45 degrees on each end.
const pivot = [100, 0, 100];
const gaussian = (x, y, z, s = [0.1, 0.02, 0.02]) =>
  [x, y, z, ...s.map(Math.log), 1, 0, 0, 0, 0.1, 0.2, 0.3, 0.4, 0, 0];
const withFloaters = new Float32Array([
  ...gaussian(101.5, 0, 100), ...gaussian(98.5, 0, 100), ...gaussian(100, 0, 100),
  ...gaussian(145, 3, 140, [5, 5, 5]), ...gaussian(40, 0, 57, [13, 13, 13]), ...gaussian(100.3, 0, 60, [2, 2, 2]),
]);
let bentResult;
const distantSession = {
  trainer: { device: { queue: { writeBuffer(_buffer, _offset, data) { bentResult = new Float32Array(data); } } }, bufParams: {} },
  async exportRawState() { return { data: withFloaters.slice(), n: 6 }; },
};
const distantBend = createGaussianBendController(distantSession, () => true, () => {}, pivot);
await distantBend.apply(Math.PI / 4, 1);
assert.ok(bentResult, 'bend must write the deformed view');
assert.ok([...bentResult].every(Number.isFinite), 'floaters never produce NaN');
const xAxis = (base) => {
  const [w, x, y, z] = bentResult.slice(base + 6, base + 10);
  return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
};
const [right, left] = [xAxis(0), xAxis(16)];
const endAngle = Math.acos(Math.abs(right[0] * left[0] + right[1] * left[1] + right[2] * left[2])) * 180 / Math.PI;
assert.ok(Math.abs(endAngle - 90) < 0.5, `subject must bend 90 degrees end to end despite floaters, got ${endAngle.toFixed(2)}`);
const k = Math.PI / 4;
assert.ok(Math.abs(bentResult[0] - (100 + Math.sin(k) / k + 0.5 * Math.cos(k))) < 1e-4,
  'the end beyond the region continues rigidly along the 45 degree tangent');
assert.ok(Math.abs(bentResult[32] - 100) < 1e-6 && Math.abs(bentResult[34] - 100) < 1e-6,
  'the pivot, not the world origin, is the bend center');
await distantBend.apply(0);
assert.deepEqual(bentResult, withFloaters, 'off-origin bend restores exact trainer data');

// UI strength maps to a total angle across the camera-derived subject region.
const cams = [[102, 0, 100], [100, 0, 98], [98.5, 0, 100], [100, 1.8, 100], [130, 0, 100]];
const region = egitim.bendRegion(cams, pivot, 1);
assert.equal(region.halfLength, 2, 'region half-length is the median camera distance to the pivot');
assert.ok(Math.abs(2 * region.curvature * region.halfLength - Math.PI / 2) < 1e-12, 'strength 1 -> 90 degrees total');
assert.equal(egitim.bendRegion(cams, pivot, -0.5).curvature, -region.curvature / 2, 'strength is linear and signed');
assert.equal(egitim.bendRegion([], pivot, 1).halfLength, 1, 'no cameras falls back to a unit region');

let releaseRead;
let raceReady = true;
let raceWrites = 0;
const delayedSession = {
  trainer: { device: { queue: { writeBuffer() { raceWrites++; } } }, bufParams: {} },
  exportRawState: () => new Promise((resolve) => { releaseRead = resolve; }),
};
const delayedBend = createGaussianBendController(delayedSession, () => raceReady, () => {});
const pendingBend = delayedBend.apply(0.1);
assert.throws(() => delayedBend.restoreForTraining(), /Wait for the bend update/,
  'continuation must not race a pending snapshot readback');
raceReady = false;
releaseRead({ data: original.slice(), n: 1 });
await assert.rejects(pendingBend, /no longer ready/);
assert.equal(raceWrites, 0, 'late readback must not write into a resumed or closed trainer');

// ── Free bend axis/direction ──────────────────────────────────────────────
// bendSceneFrame turns the scene's up vector and the (pivot, first camera)
// pair into the same reusable bendFrame from gaussianDeform.ts, so later
// deform types (fade, dome, noise) can share it instead of re-deriving axes.
const yukari = [0, 1, 0];
const scenePivot = [10, 5, 10];
const ilkKamera = [10, 5, 12]; // camera sits in front along +z, looking back at the pivot
const yanaFrame = bendSceneFrame('yana', yukari, scenePivot, ilkKamera);
nearArray(yanaFrame, bendFrame('yana', yukari, [0, 0, -2]), 'bendSceneFrame forwards pivot-minus-camera as the view hint');
const axisColumn = [yanaFrame[1], yanaFrame[4], yanaFrame[7]];
nearArray(axisColumn, yukari, 'yana scene frame axis is the scene up vector');

// The controller threads an optional frame straight into deformGaussianBuffer:
// a bend applied in a rotated frame must match calling the pure function directly.
const frameOriginal = new Float32Array([
  1, 0.5, -0.3, Math.log(2), Math.log(0.4), Math.log(0.6), 1, 0, 0, 0, 0.3, 0.4, 0.5, 0.6, 0, 0,
]);
const frameWrites = [];
const frameSession = {
  trainer: { device: { queue: { writeBuffer(_buffer, _offset, data) { frameWrites.push(new Float32Array(data)); } } }, bufParams: {} },
  async exportRawState() { return { data: frameOriginal.slice(), n: 1 }; },
};
const frameBend = createGaussianBendController(frameSession, () => true, () => {});
const someFrame = bendFrame('yukari', [0, 1, 0], [0, 0, 1]);
await frameBend.apply(0.3, 2, someFrame);
const expectedFramed = deformGaussianBuffer(frameOriginal, 1, 0.3, 2, someFrame);
nearArray(frameWrites.at(-1), expectedFramed, 'bend controller applies the supplied frame via deformGaussianBuffer', 1e-6);

console.log('3DGS post-training bend integration: OK');
