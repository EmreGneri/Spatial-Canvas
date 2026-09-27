// Sim(3) alignment (Umeyama), camera re-expression and three.js matrices — no GPU.
import assert from 'node:assert/strict';
import { umeyama, simUygula, kamerayiDonustur, threeMatrisleri } from '../src/engine/reconstruction/hizalama.ts';

const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);
const nearV = (a, b, msg, eps = 1e-9) => {
  assert.equal(a.length, b.length, `${msg}: length`);
  a.forEach((x, i) => near(x, b[i], `${msg}[${i}]`, eps));
};
const rng = (() => { let s = 12345; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const sym = (k = 1) => (rng() * 2 - 1) * k;
const randVec = (k = 1) => [sym(k), sym(k), sym(k)];

/** Uniform random rotation (row-major) from a random unit quaternion. */
function randRot() {
  let q;
  do { q = [sym(), sym(), sym(), sym()]; } while (Math.hypot(...q) < 0.1);
  const l = Math.hypot(...q);
  const [w, x, y, z] = q.map((v) => v / l);
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}
const mul = (A, v) => [0, 1, 2].map((i) => A[i * 3] * v[0] + A[i * 3 + 1] * v[1] + A[i * 3 + 2] * v[2]);
const mulT = (A, v) => [0, 1, 2].map((i) => A[i] * v[0] + A[3 + i] * v[1] + A[6 + i] * v[2]);
const det3 = (A) =>
  A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
function assertRotation(R, msg) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const d = R[i * 3] * R[j * 3] + R[i * 3 + 1] * R[j * 3 + 1] + R[i * 3 + 2] * R[j * 3 + 2];
    near(d, i === j ? 1 : 0, `${msg}: orthonormal (${i},${j})`, 1e-12);
  }
  near(det3(R), 1, `${msg}: det +1`, 1e-12);
}
/** COLMAP pinhole projection (x right, y down, z forward). */
function proj(k, X) {
  const c = mul(k.R, X).map((v, i) => v + k.t[i]);
  return [k.f * c[0] / c[2] + k.cx, (k.fy ?? k.f) * c[1] / c[2] + k.cy, c[2]];
}
const centre = (k) => mulT(k.R, k.t).map((v) => -v);
/** Random camera at C with a random orientation; intrinsics off-centre, fy ≠ f. */
function randCam(C) {
  const R = randRot();
  return { R, t: mul(R, C).map((v) => -v), f: 800, fy: 780, cx: 510.5, cy: 250.25, w: 960, h: 540 };
}
/** Random world point in front of k at depth in [zMin, zMax] inside the image. */
function pointInFront(k, zMin, zMax) {
  const z = zMin + rng() * (zMax - zMin);
  const u = rng() * k.w, v = rng() * k.h;
  const xc = [(u - k.cx) / k.f * z, (v - k.cy) / (k.fy ?? k.f) * z, z];
  return mulT(k.R, xc.map((x, i) => x - k.t[i]));
}

// ── umeyama: exact recovery ───────────────────────────────────────────────
const T = { s: 2.7, R: randRot(), t: [3.5, -1.25, 7] };
const src = Array.from({ length: 30 }, () => randVec(5));
const dst = src.map((p) => simUygula(T, p));
nearV(simUygula(T, [0, 0, 0]), T.t, 'simUygula origin → t');
nearV(simUygula({ s: 2, R: [0, -1, 0, 1, 0, 0, 0, 0, 1], t: [1, 2, 3] }, [1, 0, 0]), [1, 4, 3], 'simUygula known case');
{
  const fit = umeyama(src, dst);
  near(fit.s, T.s, 'scale recovered');
  nearV(fit.R, T.R, 'rotation recovered');
  nearV(fit.t, T.t, 'translation recovered');
  assert.ok(fit.rms < 1e-9, `exact data rms ≈ 0 (${fit.rms})`);
  assertRotation(fit.R, 'exact fit');
}
// Several random transforms, including rotations near 180°.
for (let n = 0; n < 20; n++) {
  const Tn = { s: 0.01 + rng() * 50, R: randRot(), t: randVec(100) };
  const a = Array.from({ length: 8 + n }, () => randVec(3));
  const fit = umeyama(a, a.map((p) => simUygula(Tn, p)));
  near(fit.s / Tn.s, 1, `random #${n} scale`);
  nearV(fit.R, Tn.R, `random #${n} rotation`, 1e-9);
  nearV(fit.t, Tn.t, `random #${n} translation`, 1e-8);
}
{
  const R180 = [1, 0, 0, 0, -1, 0, 0, 0, -1]; // half turn about x
  const fit = umeyama(src, src.map((p) => simUygula({ s: 1, R: R180, t: [0, 0, 0] }, p)));
  nearV(fit.R, R180, 'half turn recovered');
  near(fit.s, 1, 'half turn scale');
}

// ── umeyama: noise ────────────────────────────────────────────────────────
{
  const noisy = dst.map((p) => p.map((v) => v + sym(0.05)));
  const fit = umeyama(src, noisy);
  assert.ok(fit.rms > 1e-3 && fit.rms < 0.1, `noisy rms > 0 (${fit.rms})`);
  near(fit.s, T.s, 'noisy scale close', 0.02);
  assertRotation(fit.R, 'noisy fit');
  // rms is the RMS residual of the returned fit.
  const r = Math.sqrt(src.reduce((acc, p, i) => {
    const q = simUygula(fit, p);
    return acc + (q[0] - noisy[i][0]) ** 2 + (q[1] - noisy[i][1]) ** 2 + (q[2] - noisy[i][2]) ** 2;
  }, 0) / src.length);
  near(fit.rms, r, 'rms matches residuals', 1e-12);
}

// ── umeyama: never a reflection ───────────────────────────────────────────
for (const M of [[-1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, 1, 0, 0, 0, -1], [-1, 0, 0, 0, -1, 0, 0, 0, -1]]) {
  // A mirror image fits exactly with det −1; the result must still be a proper rotation.
  const mirrored = src.map((p) => mul(M, p));
  const fit = umeyama(src, mirrored);
  assertRotation(fit.R, `mirror ${M}`);
  assert.ok(fit.s > 0, 'positive scale');
  assert.ok(Number.isFinite(fit.rms) && fit.rms > 0, `mirror cannot fit exactly (${fit.rms})`);
}
{
  // Planar points mirrored in-plane (x → −x): the reflection diag(−1,1,1) fits
  // exactly, but so does the proper half turn about y — SVD-Umeyama needs its
  // rank-2 sign fix here; the result must be that rotation with rms ≈ 0.
  const plane = Array.from({ length: 20 }, () => [sym(4), sym(4), 0]);
  const fit = umeyama(plane, plane.map((p) => [-p[0], p[1], p[2]].map((v, i) => 2 * v + [1, 2, 3][i])));
  assertRotation(fit.R, 'planar mirror');
  nearV(fit.R, [-1, 0, 0, 0, 1, 0, 0, 0, -1], 'planar mirror → half turn about y');
  near(fit.s, 2, 'planar scale');
  assert.ok(fit.rms < 1e-9, `planar data fits exactly (${fit.rms})`);
}

// ── umeyama: degenerate inputs ────────────────────────────────────────────
{
  const plane = Array.from({ length: 15 }, () => [sym(3), sym(3), 0]);
  const fit = umeyama(plane, plane.map((p) => simUygula(T, p)));
  near(fit.s, T.s, 'planar scale');
  nearV(fit.R, T.R, 'planar rotation');
  nearV(fit.t, T.t, 'planar translation');
}
{
  const line = Array.from({ length: 10 }, (_, i) => [i * 0.5, i * 0.25, -i]);
  const fit = umeyama(line, line.map((p) => simUygula(T, p)));
  assertRotation(fit.R, 'collinear');
  near(fit.s, T.s, 'collinear scale');
  assert.ok(fit.rms < 1e-9, `collinear fits exactly (${fit.rms})`);
}
{
  const same = Array.from({ length: 4 }, () => [1, 2, 3]);
  const fit = umeyama(same, same.map(() => [4, 4, 4]));
  assertRotation(fit.R, 'coincident');
  assert.ok(Number.isFinite(fit.s) && fit.s > 0, 'coincident scale finite');
  nearV(simUygula(fit, [1, 2, 3]), [4, 4, 4], 'coincident maps the point');
  assert.ok(fit.rms < 1e-12, 'coincident rms');
}
assert.throws(() => umeyama([], []), 'empty input');
assert.throws(() => umeyama([[0, 0, 0]], [[0, 0, 0], [1, 1, 1]]), 'length mismatch');

// ── kamerayiDonustur ──────────────────────────────────────────────────────
{
  const k = { ...randCam([0.5, -0.3, -4]), imgIdx: 7 };
  const X = Array.from({ length: 25 }, () => pointInFront(k, 1, 30));
  const before = JSON.stringify(k);
  const k2 = kamerayiDonustur(k, T);
  assert.equal(JSON.stringify(k), before, 'input camera not mutated');
  for (const p of X) {
    const a = proj(k, p), b = proj(k2, simUygula(T, p));
    near(b[0], a[0], 'u preserved');
    near(b[1], a[1], 'v preserved');
    near(b[2] / a[2], T.s, 'depth scales by s', 1e-12);
  }
  nearV(centre(k2), simUygula(T, centre(k)), 'centre maps through T');
  assertRotation(k2.R, 'transformed camera');
  for (const key of ['f', 'fy', 'cx', 'cy', 'w', 'h', 'imgIdx']) assert.equal(k2[key], k[key], `keeps ${key}`);
  // Round trip with the fitted inverse brings the camera back.
  const inv = umeyama(X.map((p) => simUygula(T, p)), X);
  const k3 = kamerayiDonustur(k2, inv);
  nearV(k3.R, k.R, 'round trip R');
  nearV(k3.t, k.t, 'round trip t', 1e-8);
}

// ── threeMatrisleri ───────────────────────────────────────────────────────
/** Column-major 4x4 (three.js Matrix4.elements) times a 4-vector. */
const m4 = (m, v) => [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
function ndc(k, near_, far_, X) {
  const { view, proj: P } = threeMatrisleri(k, near_, far_);
  assert.equal(view.length, 16);
  assert.equal(P.length, 16);
  const c = m4(P, m4(view, [...X, 1]));
  return [c[0] / c[3], c[1] / c[3], c[2] / c[3], c[3]];
}
{
  const k = randCam([2, -1, 3]);
  const nearP = 0.1, farP = 100;
  for (let i = 0; i < 20; i++) {
    const X = pointInFront(k, 0.5, 90);
    const [nx, ny, nz, w] = ndc(k, nearP, farP, X);
    const want = proj(k, X);
    near((nx + 1) / 2 * k.w, want[0], `pixel x #${i}`, 1e-6);
    near((1 - ny) / 2 * k.h, want[1], `pixel y #${i}`, 1e-6);
    assert.ok(nz >= -1 && nz <= 1, `ndc depth in range #${i} (${nz})`);
    near(w, want[2], `clip w = depth #${i}`, 1e-9);
  }
  // Depth mapping: near plane → −1, far plane → +1, monotonic in between.
  const onAxis = (z) => mulT(k.R, [0, 0, z].map((x, i) => x - k.t[i]));
  near(ndc(k, nearP, farP, onAxis(nearP))[2], -1, 'near plane → −1');
  near(ndc(k, nearP, farP, onAxis(farP))[2], 1, 'far plane → +1', 1e-9);
  assert.ok(ndc(k, nearP, farP, onAxis(1))[2] < ndc(k, nearP, farP, onAxis(2))[2], 'depth monotonic');
  assert.ok(Math.abs(ndc(k, nearP, farP, onAxis(200))[2]) > 1, 'beyond far is clipped');
  // Principal point lands on (cx, cy).
  const pp = ndc(k, nearP, farP, onAxis(5));
  near((pp[0] + 1) / 2 * k.w, k.cx, 'principal point x');
  near((1 - pp[1]) / 2 * k.h, k.cy, 'principal point y');

  // View is rigid with det +1 (three.js inverts / decomposes it) and looks down −z.
  const { view, proj: P } = threeMatrisleri(k, nearP, farP);
  const V3 = [view[0], view[4], view[8], view[1], view[5], view[9], view[2], view[6], view[10]];
  assertRotation(V3, 'view rotation');
  assert.deepEqual([view[3], view[7], view[11], view[15]], [0, 0, 0, 1], 'view bottom row');
  const cam = m4(view, [...onAxis(5), 1]);
  near(cam[2], -5, 'point ahead is at −z in three camera');
  assert.deepEqual([P[3], P[7], P[11], P[15]], [0, 0, -1, 0], 'perspective bottom row');
}
{
  // fy omitted → fy = f; centred principal point gives a symmetric frustum.
  const k = { ...randCam([0, 0, 0]), fy: undefined, cx: 320, cy: 240, w: 640, h: 480, f: 500 };
  const { proj: P } = threeMatrisleri(k, 0.01, 10);
  near(P[0], 2 * 500 / 640, 'P00');
  near(P[5], 2 * 500 / 480, 'P11 uses f when fy is missing');
  near(P[8], 0, 'no x skew for centred cx');
  near(P[9], 0, 'no y skew for centred cy');
  for (let i = 0; i < 20; i++) {
    const X = pointInFront(k, 0.02, 9);
    const [nx, ny] = ndc(k, 0.01, 10, X);
    const want = proj(k, X);
    near((nx + 1) / 2 * k.w, want[0], `centred pixel x #${i}`, 1e-6);
    near((1 - ny) / 2 * k.h, want[1], `centred pixel y #${i}`, 1e-6);
  }
}
assert.throws(() => threeMatrisleri(randCam([0, 0, 0]), 0, 10), 'near must be > 0');
assert.throws(() => threeMatrisleri(randCam([0, 0, 0]), 5, 5), 'far must be > near');

console.log('✓ verify-hizalama: Umeyama Sim(3) recovery / noise / no reflection / degenerate, camera transform, three.js matrices');
