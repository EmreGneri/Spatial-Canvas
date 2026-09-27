// TASK 2 (Görev 2, docs/plans/2026-09-27-gezinme-3-geometri.md) — TEST HELPER
// ONLY (not part of the production depth path): turns an analytic GT depth
// map (`gtDerinlik`, camera-space z, `Infinity` = no hit) into a synthetic
// "monocular depth model output" with the typical distortions such models
// exhibit, so `derinlikHizalama.ts` can be exercised without a real network.
//
// Output contract matches the real model (depthProvider.ts): normalised
// disparity in [0, 1], 0 = far, 1 = near.
//
// Distortion pipeline (in this order, per the plan):
//   1. `d = s/z + o` — a per-frame random AFFINE map of inverse depth into
//      disparity space (s, o reseeded from `tohum` every call — this is
//      exactly the inverse of the app's `1/z = a*d + b` convention, so
//      `fitScaleAlignment` has a real affine relationship to recover).
//   2. A low-frequency multiplicative screen-space warp, ±8%.
//   3. 2px "bleeding" at depth discontinuities (silhouette edges): the
//      higher (nearer) disparity value spills onto the discontinuous
//      neighbourhood, mimicking a monocular model's blurred object
//      boundaries.
//   4. ±1% multiplicative per-pixel noise.
//   5. Min-max normalisation to [0, 1].
// `Infinity`/no-hit pixels (sky) get disparity 0 BEFORE normalisation (step
// 1), same as the model's convention for unbounded distance.
//
// Deterministic: identical (gtZ, w, h, tohum) always produces the identical
// output (uses `mulberry32`, the same seeded PRNG `sentetikSahne.ts` uses).
//
// Identifiers stay Turkish (per the plan); comments are in English.

import { mulberry32 } from './sentetikSahne.ts';

/** Multiplicative low-frequency field over [0,w)x[0,h), values in roughly
 *  `[1 - genlik, 1 + genlik]` (a sum of a few unit-amplitude sinusoids,
 *  divided by their count, so the triangle inequality keeps it in range). */
function alcakFrekansAlan(w: number, h: number, rng: () => number, genlik: number): Float32Array {
  const terimSayisi = 3;
  const terimler = Array.from({ length: terimSayisi }, () => ({
    fx: 1 + Math.floor(rng() * 3), // 1..3 cycles across the width
    fy: 1 + Math.floor(rng() * 3), // 1..3 cycles across the height
    faz: rng() * 2 * Math.PI,
  }));
  const out = new Float32Array(w * h);
  let idx = 0;
  for (let y = 0; y < h; y++) {
    const ny = y / h;
    for (let x = 0; x < w; x++, idx++) {
      const nx = x / w;
      let toplam = 0;
      for (const t of terimler) toplam += Math.sin(2 * Math.PI * t.fx * nx + 2 * Math.PI * t.fy * ny + t.faz);
      out[idx] = 1 + genlik * (toplam / terimSayisi);
    }
  }
  return out;
}

/** True where `gtZ[i]` and `gtZ[j]` disagree enough to be a depth
 *  discontinuity: an `Infinity`/finite transition, or a > `oran` ratio
 *  between the two finite depths. */
function sureksizlikMi(gtZ: Float32Array, i: number, j: number, oran: number): boolean {
  const zi = gtZ[i];
  const zj = gtZ[j];
  const iSonlu = Number.isFinite(zi);
  const jSonlu = Number.isFinite(zj);
  if (iSonlu !== jSonlu) return true;
  if (!iSonlu && !jSonlu) return false;
  const buyuk = Math.max(zi, zj);
  const kucuk = Math.min(zi, zj);
  return kucuk <= 0 || buyuk / kucuk > oran;
}

const KENAR_ORAN_ESIGI = 1.3;
const KOMSULUK = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Dilates disparity onto pixels adjacent to a depth discontinuity: each
 *  edge pixel's value becomes the MAX raw disparity found within `yaricap`
 *  pixels (nearer objects bleed outward over farther background, the
 *  direction a real monocular model's boundary blur actually goes since
 *  disparity is high = near). */
function kenarTasmasi(raw: Float32Array, gtZ: Float32Array, w: number, h: number, yaricap: number): Float32Array {
  const out = raw.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      let kenar = false;
      for (const [dx, dy] of KOMSULUK) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (sureksizlikMi(gtZ, idx, ny * w + nx, KENAR_ORAN_ESIGI)) { kenar = true; break; }
      }
      if (!kenar) continue;
      let enBuyuk = raw[idx];
      for (let oy = -yaricap; oy <= yaricap; oy++) {
        const sy = y + oy;
        if (sy < 0 || sy >= h) continue;
        for (let ox = -yaricap; ox <= yaricap; ox++) {
          const sx = x + ox;
          if (sx < 0 || sx >= w) continue;
          const v = raw[sy * w + sx];
          if (v > enBuyuk) enBuyuk = v;
        }
      }
      out[idx] = enBuyuk;
    }
  }
  return out;
}

/** Min-max normalisation to [0, 1]. A degenerate (near-constant) map
 *  normalises to all-zero rather than dividing by ~0. */
function birimeNormalize(arr: Float32Array): Float32Array {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of arr) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const out = new Float32Array(arr.length);
  const aralik = mx - mn;
  if (!(aralik > 1e-9)) return out;
  for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - mn) / aralik;
  return out;
}

const AFIN_S_MIN = 0.5;
const AFIN_S_ARALIK = 1.5;
const AFIN_O_GENLIK = 0.2;
const DUSUK_FREKANS_GENLIK = 0.08;
const KENAR_TASMA_YARICAP = 2;
const GURULTU_GENLIK = 0.01;

/**
 * Synthesises a monocular-depth-model-like disparity map from analytic GT
 * depth (`gtZ`, camera-space z, `Infinity` = no hit — see `gtDerinlik` in
 * `sentetikSahne.ts`). `tohum` makes the per-frame affine, warp, and noise
 * fully deterministic and reproducible.
 */
export function tekGozBenzetimi(gtZ: Float32Array, w: number, h: number, tohum: number): Float32Array {
  if (gtZ.length !== w * h) {
    throw new RangeError(`tekGozBenzetimi: gtZ length ${gtZ.length} != w*h (${w * h})`);
  }
  const rng = mulberry32(tohum);

  // 1. Per-frame random affine over inverse depth (the direct inverse of
  //    the app's `1/z = a*d + b` alignment convention). Disparity cannot be
  //    negative in the real model's output space, so it is floored at 0.
  const s = AFIN_S_MIN + rng() * AFIN_S_ARALIK;
  const o = (rng() - 0.5) * 2 * AFIN_O_GENLIK;
  const raw = new Float32Array(gtZ.length);
  for (let i = 0; i < gtZ.length; i++) {
    const z = gtZ[i];
    raw[i] = Number.isFinite(z) && z > 0 ? Math.max(0, s / z + o) : 0; // no hit -> 0 before normalisation
  }

  // 2. Low-frequency multiplicative screen-space warp, ±8%.
  const warp = alcakFrekansAlan(w, h, rng, DUSUK_FREKANS_GENLIK);
  for (let i = 0; i < raw.length; i++) raw[i] *= warp[i];

  // 3. 2px bleeding at depth discontinuities.
  const bulanik = kenarTasmasi(raw, gtZ, w, h, KENAR_TASMA_YARICAP);

  // 4. ±1% multiplicative per-pixel noise.
  for (let i = 0; i < bulanik.length; i++) {
    bulanik[i] = Math.max(0, bulanik[i] * (1 + (rng() * 2 - 1) * GURULTU_GENLIK));
  }

  // 5. Normalise to [0, 1], like the real model's output.
  return birimeNormalize(bulanik);
}
