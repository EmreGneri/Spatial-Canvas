// TASK 2 (Görev 2, docs/plans/2026-09-27-gezinme-3-geometri.md) — monocular
// disparity -> metric depth alignment, plus a cross-frame consistency filter.
//
// CONTRACT (matches src/engine/vision/depthProvider.ts and scale.ts):
//   - `disparite` is the app's Depth Anything-style output: normalised
//     disparity in [0, 1], 0 = far, 1 = near (NOT inverse depth itself, but
//     affinely related to it: `1/z = a * disparite + b`).
//   - `kareyiHizala` recovers (a, b) from a set of known 3D points (SfM /
//     GT points) by sampling the disparity map at each point's projection
//     and fitting `dMetric = 1/z` against `dPred = disparite(pixel)` with
//     the MAD-robust `fitScaleAlignment` (src/engine/vision/scale.ts) — the
//     same deterministic, outlier-resistant fit the rest of the app uses.
//   - `GsKamera` (src/engine/reconstruction/egitim3dgs.ts): row-major
//     world->camera `R`/`t` (COLMAP convention: x right, y down, z forward),
//     projection `u = f * x/z + cx`, `v = (fy ?? f) * y/z + cy`. A camera
//     point is `Xcam = R * Xworld + t`; its camera-space depth is `Xcam.z`.
//
// Identifiers stay Turkish (per the plan); comments are in English.

import type { GsKamera } from './egitim3dgs.ts';
import { fitScaleAlignment, type ScaleFit } from '../vision/scale.ts';

type Vec3 = [number, number, number];

/** Result of aligning one frame's disparity map to metric depth. */
export interface HizaliKare {
  /** Metric camera-space z per pixel (row-major, `w*h` long). `NaN` = invalid
   *  (outside the fit's valid range, or the whole-frame fit failed). */
  derinlik: Float32Array;
  /** The scale fit used to produce `derinlik`, or `null` if it could not be
   *  solved (fewer than 2 usable points, or no variance in `dPred`). */
  uydurma: ScaleFit | null;
  /** Number of points actually used by the fit (`uydurma?.inliers ?? 0`). */
  kullanilan: number;
}

/** Below this inlier count the fit is considered too weak to trust; the
 *  whole frame is returned as NaN rather than a shaky metric depth map. */
const MIN_INLIERS = 20;
/** `a * d + b` at or below this is treated as "at/behind infinity" (z would
 *  be non-positive or blow up) -> NaN, per the plan's `a·d+b ≤ 1e-6` rule. */
const INV_DEPTH_EPS = 1e-6;

/**
 * Aligns a single frame's monocular disparity map to metric depth using a
 * sparse set of known 3D points (SfM points, or in tests: GT points sampled
 * from other views, optionally with gross outliers mixed in).
 *
 * For each point: project into `kamera` (scaled from `kamera.w`x`kamera.h`
 * to the `disparite` map's own `w`x`h`, exactly like `gtDerinlik` in
 * `sentetikSahne.ts` scales its intrinsics — this lets `disparite` be a
 * different resolution than the camera's own canvas-scale intrinsics).
 * Points behind the camera (`z <= 0`) or projecting outside the image are
 * skipped. The remaining `(dPred, dMetric = 1/z)` pairs go through
 * `fitScaleAlignment`, which is itself MAD-robust to outliers (see its own
 * doc comment) — so a fraction of grossly wrong 3D points does not need any
 * extra handling here.
 *
 * If the fit fails, or uses fewer than `MIN_INLIERS` points, the entire
 * frame's `derinlik` is NaN (a shaky per-point fit is worse than no depth).
 * Otherwise every pixel gets `z = 1/(a*d + b)`, NaN where that denominator
 * is non-positive (at/behind the far plane).
 */
export function kareyiHizala(
  disparite: Float32Array,
  w: number,
  h: number,
  kamera: GsKamera,
  noktalar: readonly Vec3[],
): HizaliKare {
  if (disparite.length !== w * h) {
    throw new RangeError(`kareyiHizala: disparite length ${disparite.length} != w*h (${w * h})`);
  }

  // Scale intrinsics from the camera's own canvas resolution to the
  // disparity map's resolution (same convention as gtDerinlik).
  const olcekX = w / kamera.w;
  const olcekY = h / kamera.h;
  const f = kamera.f * olcekX;
  const fy = (kamera.fy ?? kamera.f) * olcekY;
  const cx = kamera.cx * olcekX;
  const cy = kamera.cy * olcekY;
  const { R, t } = kamera;

  const pairs: Array<{ dPred: number; dMetric: number }> = [];
  for (const p of noktalar) {
    const xc = R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0];
    const yc = R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1];
    const zc = R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2];
    if (!(zc > 0)) continue; // behind the camera
    const u = f * (xc / zc) + cx;
    const v = fy * (yc / zc) + cy;
    const px = Math.floor(u);
    const py = Math.floor(v);
    if (px < 0 || px >= w || py < 0 || py >= h) continue; // outside the image
    const dPred = disparite[py * w + px];
    if (!Number.isFinite(dPred)) continue;
    pairs.push({ dPred, dMetric: 1 / zc });
  }

  const uydurma = fitScaleAlignment(pairs);
  const derinlik = new Float32Array(w * h).fill(NaN);
  const kullanilan = uydurma?.inliers ?? 0;
  if (!uydurma || uydurma.inliers < MIN_INLIERS) {
    return { derinlik, uydurma, kullanilan };
  }

  const a = uydurma.scaleA;
  const b = uydurma.scaleB;
  for (let i = 0; i < derinlik.length; i++) {
    const invZ = a * disparite[i] + b;
    derinlik[i] = invZ > INV_DEPTH_EPS ? 1 / invZ : NaN;
  }
  return { derinlik, uydurma, kullanilan };
}

// ── cross-frame consistency filter ───────────────────────────────────────

export interface TutarlilikSecenek {
  /** How many nearest frames (by CAPTURE-ORDER index distance, not 3D
   *  distance) each pixel is checked against. Default 2. */
  komsu?: number;
  /** Relative depth error threshold for a neighbour to count as agreeing.
   *  Default 0.05 (5%). */
  esik?: number;
  /** Minimum number of agreeing neighbours required to keep a pixel.
   *  Default 1. */
  enAz?: number;
}

const TUTARLILIK_VARSAYILAN: Required<TutarlilikSecenek> = { komsu: 2, esik: 0.05, enAz: 1 };

/** A frame's aligned depth plus the camera it was aligned with. Each frame's
 *  `derinlik` must be `kamera.w * kamera.h` long — every frame fully
 *  describes its own map's resolution through its own camera, so the two
 *  never disagree silently. */
export interface TutarliKare {
  derinlik: Float32Array;
  kamera: GsKamera;
}

/** `Xcam = R*X + t`; returns the camera-space depth (`z`) together with the
 *  projected pixel coordinates (continuous, NOT yet floored to an index). */
function izdusur(k: GsKamera, X: Vec3): { u: number; v: number; z: number } {
  const { R, t } = k;
  const xc = R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0];
  const yc = R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1];
  const zc = R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2];
  const fy = k.fy ?? k.f;
  return { u: k.f * (xc / zc) + k.cx, v: fy * (yc / zc) + k.cy, z: zc };
}

/** Inverse of `izdusur`'s pixel convention: pixel index `(px, py)` samples
 *  the ray through its CENTRE (`px + 0.5`, `py + 0.5`), matching
 *  `gtDerinlik`'s convention in `sentetikSahne.ts` — `floor(izdusur(...).u)`
 *  recovers the same `px` that produced a point at its centre. Returns the
 *  world-space point at camera-space depth `z` along that ray. */
function genisUzayNoktasi(k: GsKamera, px: number, py: number, z: number): Vec3 {
  const { R, t } = k;
  const fy = k.fy ?? k.f;
  const xc = ((px + 0.5 - k.cx) / k.f) * z;
  const yc = ((py + 0.5 - k.cy) / fy) * z;
  // World = R^T * (Xcam - t) = R^T * Xcam + C, C = -R^T*t (kameraMerkezi).
  const dx = xc - t[0];
  const dy = yc - t[1];
  const dz = z - t[2];
  return [
    R[0] * dx + R[3] * dy + R[6] * dz,
    R[1] * dx + R[4] * dy + R[7] * dz,
    R[2] * dx + R[5] * dy + R[8] * dz,
  ];
}

/** Frame indices closest to `i` by capture-order distance (`|j - i|`),
 *  nearest first, excluding `i` itself; at most `komsu` of them. At the
 *  ends of the sequence this reaches past the immediate neighbour so a
 *  boundary frame still gets up to `komsu` checks (e.g. frame 0 with
 *  `komsu=2` checks against frames 1 and 2, not just frame 1). */
function komsuIndeksleri(n: number, i: number, komsu: number): number[] {
  const adaylar: number[] = [];
  for (let j = 0; j < n; j++) if (j !== i) adaylar.push(j);
  adaylar.sort((a, b) => Math.abs(a - i) - Math.abs(b - i));
  return adaylar.slice(0, komsu);
}

/**
 * Cross-frame geometric consistency filter: for every valid pixel of every
 * frame, its 3D point (back-projected using that frame's OWN aligned depth)
 * is forward-projected into its nearest `komsu` neighbour frames (by capture
 * order). A neighbour "agrees" when:
 *   1. the point lands in front of that neighbour's camera and inside its
 *      image, AND
 *   2. the neighbour has a valid (non-NaN, positive) depth reading at that
 *      pixel, AND
 *   3. that reading (`zKomsu`, the neighbour's OWN measurement — the
 *      trusted reference for this comparison) is close to the depth the
 *      point WOULD have in the neighbour's camera frame if the reference
 *      pixel's depth were correct (`zTahmin`, obtained purely by
 *      reprojection): `|zKomsu - zTahmin| / zKomsu < esik`.
 * A pixel survives if at least `enAz` neighbours agree; otherwise it is set
 * to NaN in the returned copy (inputs are never mutated). Pixels that are
 * already NaN stay NaN without being checked.
 *
 * Every frame must supply its own `kamera` (same object shape `kareyiHizala`
 * takes), and `derinlik.length` must equal `kamera.w * kamera.h`.
 */
export function tutarlilikSuz(
  kareler: readonly TutarliKare[],
  secenek: TutarlilikSecenek = {},
): Float32Array[] {
  const o = { ...TUTARLILIK_VARSAYILAN, ...secenek };
  const n = kareler.length;
  for (const kare of kareler) {
    if (kare.derinlik.length !== kare.kamera.w * kare.kamera.h) {
      throw new RangeError('tutarlilikSuz: derinlik.length must equal kamera.w * kamera.h');
    }
  }

  return kareler.map((kare, i) => {
    const { derinlik, kamera } = kare;
    const w = kamera.w;
    const h = kamera.h;
    const out = new Float32Array(derinlik.length);
    const komsular = komsuIndeksleri(n, i, o.komsu);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const zRef = derinlik[idx];
        if (!Number.isFinite(zRef) || !(zRef > 0)) { out[idx] = NaN; continue; }

        const X = genisUzayNoktasi(kamera, px, py, zRef);
        let sayac = 0;
        for (const j of komsular) {
          const komsuKare = kareler[j];
          const proj = izdusur(komsuKare.kamera, X);
          if (!(proj.z > 0)) continue; // behind that camera
          const ku = Math.floor(proj.u);
          const kv = Math.floor(proj.v);
          if (ku < 0 || ku >= komsuKare.kamera.w || kv < 0 || kv >= komsuKare.kamera.h) continue;
          const zKomsu = komsuKare.derinlik[kv * komsuKare.kamera.w + ku];
          if (!Number.isFinite(zKomsu) || !(zKomsu > 0)) continue; // not visible there
          if (Math.abs(zKomsu - proj.z) / zKomsu < o.esik) sayac++;
        }
        out[idx] = sayac >= o.enAz ? zRef : NaN;
      }
    }
    return out;
  });
}
