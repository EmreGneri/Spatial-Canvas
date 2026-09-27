// HİZALAMA — iki dünya çerçevesi arasında benzerlik dönüşümü (Sim(3)) ve
// COLMAP kamerasının three.js matrisleri. Bağımlılıksız, saf; Node'da test edilir
// (scripts/verify-hizalama.mjs).
//
// Kullanım: SfM'nin keyfi çerçevesindeki kamera merkezleri ile bilinen (GT)
// merkezler arasında `umeyama`, sonra bir sonda kamerası `kamerayiDonustur`
// ile GT dünyasına taşınır ve `threeMatrisleri` ile birebir çizilir.

import type { GsKamera } from './egitim3dgs.ts';

type Vec3 = [number, number, number];

export interface Sim3 { s: number; R: number[] /* 3x3 row-major */; t: Vec3 }

// ── 3×3 helpers (row-major) ──────────────────────────────────────────────

const uygula = (A: number[], v: readonly number[]): Vec3 => [
  A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
  A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
  A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
];

/** A·Bᵀ */
function carpDevrik(A: number[], B: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += A[i * 3 + k] * B[j * 3 + k];
  return o;
}

/** Row-major rotation of a unit quaternion (w, x, y, z). */
function kuaterniyonDonme(q: readonly number[]): number[] {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  const w = q[0] / l, x = q[1] / l, y = q[2] / l, z = q[3] / l;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/**
 * Cyclic Jacobi eigen-decomposition of a symmetric n×n matrix (row-major).
 * Returns eigenvalues and eigenvectors as columns: `vektorler[i*n + j]` is
 * component i of eigenvector j. Accurate to machine precision; n is tiny here.
 */
function jacobiOzdeger(M: readonly number[], n: number): { degerler: number[]; vektorler: number[] } {
  const a = M.slice();
  const v = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  let norm2 = 0;
  for (const x of a) norm2 += x * x;
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q];
    if (off <= 1e-36 * norm2) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (apq === 0) continue;
        // Rotation (c, s) that zeroes a[p][q]; the smaller root keeps it stable.
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { // A ← A·J
          const akp = a[k * n + p], akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) { // A ← Jᵀ·A
          const apk = a[p * n + k], aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        a[p * n + q] = a[q * n + p] = 0;
        for (let k = 0; k < n; k++) { // V ← V·J
          const vkp = v[k * n + p], vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { degerler: Array.from({ length: n }, (_, i) => a[i * n + i]), vektorler: v };
}

// ── Sim(3) ───────────────────────────────────────────────────────────────

export function simUygula(T: Sim3, p: Vec3): Vec3 {
  const r = uygula(T.R, p);
  return [T.s * r[0] + T.t[0], T.s * r[1] + T.t[1], T.s * r[2] + T.t[2]];
}

/**
 * Least-squares similarity dst ≈ s·R·src + t (Umeyama 1991), reflection-safe.
 * The rotation comes from Horn's quaternion method (largest eigenvector of the
 * 4×4 cross-covariance matrix), so it is always proper (det +1) and planar or
 * collinear inputs need no special casing. Scale is Umeyama's asymmetric
 * estimate Σ bᵢ·R aᵢ / Σ |aᵢ|² on centred points. Coincident source points
 * (no spread) give a pure translation. `rms` is the RMS residual of the fit.
 */
export function umeyama(src: Vec3[], dst: Vec3[]): Sim3 & { rms: number } {
  const n = src.length;
  if (n === 0 || dst.length !== n) throw new RangeError(`umeyama: need equal non-empty point sets (${n} vs ${dst.length})`);
  const ms: Vec3 = [0, 0, 0], md: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ms[k] += src[i][k] / n; md[k] += dst[i][k] / n; }

  // Cross-covariance S[a][b] = Σ aᵢ[a]·bᵢ[b] of the centred sets; source spread.
  const S = new Array(9).fill(0);
  let yayilim = 0, buyukluk = 0;
  for (let i = 0; i < n; i++) {
    const a = [src[i][0] - ms[0], src[i][1] - ms[1], src[i][2] - ms[2]];
    const b = [dst[i][0] - md[0], dst[i][1] - md[1], dst[i][2] - md[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r * 3 + c] += a[r] * b[c];
    yayilim += a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
    buyukluk += src[i][0] ** 2 + src[i][1] ** 2 + src[i][2] ** 2;
  }

  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1], s = 1;
  if (yayilim > 1e-24 * buyukluk && yayilim > 0) {
    const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S;
    const N = [
      xx + yy + zz, yz - zy, zx - xz, xy - yx,
      yz - zy, xx - yy - zz, xy + yx, zx + xz,
      zx - xz, xy + yx, -xx + yy - zz, yz + zy,
      xy - yx, zx + xz, yz + zy, -xx - yy + zz,
    ];
    const { degerler, vektorler } = jacobiOzdeger(N, 4);
    let j = 0;
    for (let k = 1; k < 4; k++) if (degerler[k] > degerler[j]) j = k;
    R = kuaterniyonDonme([vektorler[j], vektorler[4 + j], vektorler[8 + j], vektorler[12 + j]]);
    // Σ bᵢ·R aᵢ = tr(R·S) with S = Σ aᵢ bᵢᵀ.
    let iz = 0;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) iz += R[r * 3 + c] * S[c * 3 + r];
    s = iz / yayilim;
  }
  const Rm = uygula(R, ms);
  const t: Vec3 = [md[0] - s * Rm[0], md[1] - s * Rm[1], md[2] - s * Rm[2]];
  const T: Sim3 = { s, R, t };
  let e2 = 0;
  for (let i = 0; i < n; i++) {
    const q = simUygula(T, src[i]);
    e2 += (q[0] - dst[i][0]) ** 2 + (q[1] - dst[i][1]) ** 2 + (q[2] - dst[i][2]) ** 2;
  }
  return { s, R, t, rms: Math.sqrt(e2 / n) };
}

/** Camera re-expressed in the target frame of `T` (world_target = T(world_src)):
 *  centre maps through T, R_target = R_src · T.Rᵀ, intrinsics unchanged.
 *  Camera coordinates scale by s, so pixel projections are preserved:
 *  t_target = s·t_src − R_target·T.t. */
export function kamerayiDonustur(k: GsKamera, T: Sim3): GsKamera {
  const R = carpDevrik(k.R, T.R);
  const Rt = uygula(R, T.t);
  return { ...k, R, t: [T.s * k.t[0] - Rt[0], T.s * k.t[1] - Rt[1], T.s * k.t[2] - Rt[2]] };
}

// ── three.js ─────────────────────────────────────────────────────────────

/** Column-major 4x4 matrices for a three.js camera reproducing `k` exactly:
 *  view (world→three camera, y up / looking down −z) and projection from
 *  f, fy ?? f, cx, cy, w, h with the given near/far. */
export function threeMatrisleri(k: GsKamera, near: number, far: number): { view: number[]; proj: number[] } {
  if (!(near > 0) || !(far > near)) throw new RangeError(`threeMatrisleri: need 0 < near < far (${near}, ${far})`);
  const { R, t } = k;
  // COLMAP (x right, y down, z forward) → three (x right, y up, z back): diag(1, −1, −1)·[R|t].
  const view = [
    R[0], -R[3], -R[6], 0,
    R[1], -R[4], -R[7], 0,
    R[2], -R[5], -R[8], 0,
    t[0], -t[1], -t[2], 1,
  ];
  // Pixel u = f·X/Z + cx ↔ NDC x = 2u/w − 1; v = fy·Y/Z + cy ↔ NDC y = 1 − 2v/h.
  // In three camera coordinates Z = −z, Y = −y; clip w = −z; OpenGL depth to [−1, 1].
  const fy = k.fy ?? k.f;
  const proj = [
    2 * k.f / k.w, 0, 0, 0,
    0, 2 * fy / k.h, 0, 0,
    1 - 2 * k.cx / k.w, 2 * k.cy / k.h - 1, -(far + near) / (far - near), -1,
    0, 0, -2 * far * near / (far - near), 0,
  ];
  return { view, proj };
}
