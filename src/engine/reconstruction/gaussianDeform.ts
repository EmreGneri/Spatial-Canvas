export type Mat3 = number[];
type Vec3 = [number, number, number];

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const MIN_VARIANCE = 1e-20;

function transpose(a: Mat3): Mat3 {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[3 * row + col] = a[3 * row] * b[col]
        + a[3 * row + 1] * b[3 + col]
        + a[3 * row + 2] * b[6 + col];
    }
  }
  return out;
}

function determinant(a: Mat3): number {
  return a[0] * (a[4] * a[8] - a[5] * a[7])
    - a[1] * (a[3] * a[8] - a[5] * a[6])
    + a[2] * (a[3] * a[7] - a[4] * a[6]);
}

function symmetricEigen(a: Mat3): { values: Vec3; vectors: Mat3 } {
  const d = a.slice();
  const v = IDENTITY.slice();
  for (let sweep = 0; sweep < 12; sweep++) {
    let p = 0, q = 1;
    if (Math.abs(d[2]) > Math.abs(d[1])) { p = 0; q = 2; }
    if (Math.abs(d[5]) > Math.abs(d[3 * p + q])) { p = 1; q = 2; }
    const apq = d[3 * p + q];
    const scale = Math.max(Math.abs(d[0]), Math.abs(d[4]), Math.abs(d[8]));
    if (scale === 0 || Math.abs(apq) <= 1e-15 * scale) break;
    const tau = (d[3 * q + q] - d[3 * p + p]) / (2 * apq);
    const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    const app = d[3 * p + p], aqq = d[3 * q + q];
    d[3 * p + p] = app - t * apq;
    d[3 * q + q] = aqq + t * apq;
    d[3 * p + q] = d[3 * q + p] = 0;
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const kp = d[3 * k + p], kq = d[3 * k + q];
        d[3 * k + p] = d[3 * p + k] = c * kp - s * kq;
        d[3 * k + q] = d[3 * q + k] = s * kp + c * kq;
      }
      const vp = v[3 * k + p], vq = v[3 * k + q];
      v[3 * k + p] = c * vp - s * vq;
      v[3 * k + q] = s * vp + c * vq;
    }
  }
  return { values: [d[0], d[4], d[8]], vectors: v };
}

function diagonalized(v: Mat3, diagonal: Vec3): Mat3 {
  const scaled = v.map((value, index) => value * diagonal[index % 3]);
  return multiply(scaled, transpose(v));
}

/** Polar factorization A = R S, with symmetric positive-semidefinite S. */
export function polarDecompose3(matrix: readonly number[]): { rotation: Mat3; stretch: Mat3 } {
  if (matrix.length !== 9 || !matrix.every(Number.isFinite)) throw new RangeError('Expected a finite 3x3 matrix');
  const a = Array.from(matrix);
  const { values, vectors } = symmetricEigen(multiply(transpose(a), a));
  const singular = values.map(value => Math.sqrt(Math.max(0, value))) as Vec3;
  const stretch = diagonalized(vectors, singular);
  const inv = singular.map(value => value > 1e-12 ? 1 / value : 0) as Vec3;
  const rotation = multiply(a, diagonalized(vectors, inv));
  // Complete null-space columns if the input is singular. Full-rank matrices need no correction.
  if (singular.some(value => value <= 1e-12)) {
    const u = multiply(rotation, vectors);
    for (let col = 0; col < 3; col++) {
      if (singular[col] > 1e-12) continue;
      let best: Vec3 = [1, 0, 0], bestNorm = -1;
      for (let candidate = 0; candidate < 3; candidate++) {
        const trial: Vec3 = [0, 0, 0];
        trial[candidate] = 1;
        for (let previous = 0; previous < 3; previous++) {
          if (previous === col || singular[previous] <= 1e-12 && previous > col) continue;
          const dot = trial[0] * u[previous] + trial[1] * u[3 + previous] + trial[2] * u[6 + previous];
          for (let row = 0; row < 3; row++) trial[row] -= dot * u[3 * row + previous];
        }
        const norm = Math.hypot(...trial);
        if (norm > bestNorm) { best = trial; bestNorm = norm; }
      }
      for (let row = 0; row < 3; row++) u[3 * row + col] = best[row] / bestNorm;
    }
    return { rotation: multiply(u, transpose(vectors)), stretch };
  }
  return { rotation, stretch };
}

// Radial factor 1 + k·z reaches 0 on the bend axis and inverts behind it. Below
// the knee it is eased (C1, hyperbolic) toward the floor, so far splats behind
// the axis flatten toward a shell instead of folding. Calibration knobs.
const RADIAL_KNEE = 0.5;
const RADIAL_FLOOR = 0.2;

/** Eased u = k·z and its derivative; identity above the knee. */
function softRadial(u: number): [number, number] {
  const knee = RADIAL_KNEE - 1, span = RADIAL_KNEE - RADIAL_FLOOR;
  if (u >= knee) return [u, 1];
  const d = span + (knee - u);
  return [RADIAL_FLOOR - 1 + span * span / d, span * span / (d * d)];
}

/** Bend around the Y axis; curvature is radians per scene unit along X.
 * Only |x| <= halfLength bends (theta = k·clamp(x)); beyond it the geometry
 * continues rigidly along the end tangent (Bend-SOP capture region). */
export function bendPointAndJacobian(
  point: ArrayLike<number>, curvature: number, halfLength = Infinity,
): { point: Vec3; jacobian: Mat3 } {
  if (point.length !== 3 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
    || !Number.isFinite(point[2]) || !Number.isFinite(curvature) || !(halfLength > 0)) {
    throw new RangeError('Expected a finite point, curvature and positive half-length');
  }
  const x = point[0], y = point[1], z = point[2];
  if (curvature === 0) return { point: [x, y, z], jacobian: IDENTITY.slice() };
  const clamped = Math.max(-halfLength, Math.min(halfLength, x));
  const along = x - clamped;
  const theta = curvature * clamped;
  const sin = Math.sin(theta), cos = Math.cos(theta);
  const [u, slope] = softRadial(curvature * z);
  const depth = u / curvature;
  // Inside the region x stretches by the radial factor; outside it is rigid.
  const stretch = Math.abs(x) < halfLength ? 1 + u : 1;
  // The half-angle identity avoids cancellation in (cos(theta) - 1) / curvature.
  const baseZ = -2 * Math.sin(theta / 2) ** 2 / curvature;
  return {
    point: [sin / curvature + depth * sin + along * cos, y, baseZ + depth * cos - along * sin],
    jacobian: [stretch * cos, 0, slope * sin, 0, 1, 0, -stretch * sin, 0, slope * cos],
  };
}

function normalize3(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > 1e-12)) throw new RangeError('Expected a non-zero vector');
  return [v[0] / n, v[1] / n, v[2] / n];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function applyMat3(m: Mat3, v: ArrayLike<number>): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export type BendDirection = 'yana' | 'yukari';

/**
 * Orthonormal bend frame (columns = world directions of the canonical
 * spine/axis/depth used by `bendPointAndJacobian`) built from the scene up
 * vector and a view-direction hint, instead of the trainer's raw Y axis.
 * - 'yana' (sideways): the fixed axis is scene up — the bend curls around
 *   the vertical, like a road spiraling sideways.
 * - 'yukari' (up/down): the fixed axis is horizontal, perpendicular to
 *   `forward` — the bend curls the spine up/down (e.g. a road curling
 *   upward), matching the reference Houdini clip.
 * Sign of the caller's curvature/strength gives the opposite way; that is
 * unaffected by this frame choice.
 */
export function bendFrame(direction: BendDirection, up: ArrayLike<number>, forward: ArrayLike<number>): Mat3 {
  const yukari = normalize3([up[0], up[1], up[2]]);
  const forwardHint: Vec3 = [forward[0], forward[1], forward[2]];
  let axis: Vec3;
  if (direction === 'yana') {
    axis = yukari;
  } else {
    const right = cross3(forwardHint, yukari);
    if (!(Math.hypot(right[0], right[1], right[2]) > 1e-6)) {
      throw new RangeError('Forward direction cannot be parallel to up for a yukari bend');
    }
    axis = normalize3(right);
  }
  // Gram-Schmidt: spine is the forward hint with its axis component removed.
  const along = dot3(forwardHint, axis);
  let spine: Vec3 = [forwardHint[0] - along * axis[0], forwardHint[1] - along * axis[1], forwardHint[2] - along * axis[2]];
  if (!(Math.hypot(spine[0], spine[1], spine[2]) > 1e-6)) {
    // Degenerate hint (parallel to the axis): fall back to any perpendicular.
    const fallback: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const d = dot3(fallback, axis);
    spine = [fallback[0] - d * axis[0], fallback[1] - d * axis[1], fallback[2] - d * axis[2]];
  }
  spine = normalize3(spine);
  // spine x axis (not axis x spine) keeps the frame right-handed, matching
  // the canonical frame's own handedness (X=spine, Y=axis, Z=depth with
  // X x Y = Z), so `bendFrame` reduces to the identity when it already is.
  const depth = cross3(spine, axis);
  return [
    spine[0], axis[0], depth[0],
    spine[1], axis[1], depth[1],
    spine[2], axis[2], depth[2],
  ];
}

/** `bendPointAndJacobian` conjugated by an orthonormal `frame`: the point and
 * Jacobian are computed in the frame's local coordinates (X spine, Y axis, Z
 * depth) and rotated back, so the fixed bend axis is `frame`'s Y column
 * instead of world Y. */
export function bendPointAndJacobianInFrame(
  point: ArrayLike<number>, frame: Mat3, curvature: number, halfLength = Infinity,
): { point: Vec3; jacobian: Mat3 } {
  return inFrame(point, frame, (local) => bendPointAndJacobian(local, curvature, halfLength));
}

type PointMap = (point: ArrayLike<number>) => { point: Vec3; jacobian: Mat3 };

/** Conjugate a canonical map by an orthonormal frame (local = frameᵀ·p). */
function inFrame(point: ArrayLike<number>, frame: Mat3, map: PointMap): { point: Vec3; jacobian: Mat3 } {
  const frameT = transpose(frame);
  const { point: mapped, jacobian } = map(applyMat3(frameT, point));
  return { point: applyMat3(frame, mapped), jacobian: multiply(multiply(frame, jacobian), frameT) };
}

/**
 * Tiny-planet dome: the ground plane (local XZ, height = local Y, pivot at the
 * origin) wraps onto a sphere of radius 1/curvature whose centre sits below
 * the pivot. Horizontal distance rho becomes the polar angle k·rho, height
 * becomes radial distance, so verticals (trees) fan out along the sphere
 * normal and the pivot plus the up axis through it stay put. Negative
 * curvature is a bowl. Like the bend: only rho <= halfLength wraps, beyond
 * it the ground continues rigidly along the rim tangent, and height is eased
 * (`softRadial`) so points far below never cross the sphere centre.
 * Pole/antipode guard: rho = 0 uses series forms (no 0/0), and the rim angle
 * is capped at pi/2 so the continuation can never fold back through the axis.
 */
export function domePointAndJacobian(
  point: ArrayLike<number>, curvature: number, halfLength = Infinity,
): { point: Vec3; jacobian: Mat3 } {
  if (point.length !== 3 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
    || !Number.isFinite(point[2]) || !Number.isFinite(curvature) || !(halfLength > 0)) {
    throw new RangeError('Expected a finite point, curvature and positive half-length');
  }
  const x = point[0], h = point[1], z = point[2];
  if (curvature === 0) return { point: [x, h, z], jacobian: IDENTITY.slice() };
  const k = curvature;
  const edge = Math.min(halfLength, Math.PI / (2 * Math.abs(k)));
  const rho = Math.hypot(x, z);
  const [u, slope] = softRadial(k * h);
  // g = A/rho (horizontal scale), gRho = (dA/drho - g)/rho^2, gH = (dA/dh)/rho,
  // yRho = (dY/drho)/rho, yH = dY/dh; A = new horizontal radius, Y = new height.
  let g: number, gRho: number, gH: number, y: number, yRho: number, yH: number;
  if (rho < edge) {
    const t = k * rho;
    const sin = Math.sin(t), cos = Math.cos(t);
    const small = Math.abs(t) < 1e-3;
    const sinc = small ? 1 - t * t / 6 : sin / t;
    g = (1 + u) * sinc;
    gRho = (1 + u) * k * k * (small ? -1 / 3 + t * t / 30 : (cos - sinc) / (t * t));
    gH = slope * k * sinc;
    y = -2 * Math.sin(t / 2) ** 2 / k + u / k * cos;
    yRho = -(1 + u) * k * sinc;
    yH = slope * cos;
  } else {
    const theta = k * edge, along = rho - edge;
    const sin = Math.sin(theta), cos = Math.cos(theta);
    g = ((1 + u) * sin / k + along * cos) / rho;
    gRho = (cos - g) / (rho * rho);
    gH = slope * sin / rho;
    y = -2 * Math.sin(theta / 2) ** 2 / k + u / k * cos - along * sin;
    yRho = -sin / rho;
    yH = slope * cos;
  }
  return {
    point: [g * x, y, g * z],
    jacobian: [
      g + x * x * gRho, x * gH, x * z * gRho,
      x * yRho, yH, z * yRho,
      z * x * gRho, z * gH, g + z * z * gRho,
    ],
  };
}

/** `domePointAndJacobian` in a frame whose Y column is the scene up. */
export function domePointAndJacobianInFrame(
  point: ArrayLike<number>, frame: Mat3, curvature: number, halfLength = Infinity,
): { point: Vec3; jacobian: Mat3 } {
  return inFrame(point, frame, (local) => domePointAndJacobian(local, curvature, halfLength));
}

// Noise field: NOISE_OCTAVES x NOISE_WAVES_PER_OCTAVE seeded plane waves
// ("spectral" noise), octave o at 2^o x the base frequency with weight 2^-o,
// normalized so |displacement| <= |amplitude|. Time phases advance by integer
// turns, so the field loops with period 1 in `time`. Calibration knobs.
//
// det J > 0 bound (per seed). n(p) = Σ_i w_i d_i sin(k_i·p + φ_i) with unit
// d_i, k_i = 2π·f·2^o_i·u_i, so J = I + D, D = A·f·Σ_i c_i M_i with
// M_i = w_i·2π·2^o_i·d_i u_iᵀ and c_i = cos(k_i·p + φ_i) ∈ [-1, 1].
// 1. For any unit x: xᵀJx = 1 + xᵀ sym(D) x >= 1 + λ_min(sym D).
// 2. λ_max(sym ·) is convex, so over the zonotope {Σ c_i M_i : c ∈ [-1,1]^n}
//    it peaks at a vertex; the cube is symmetric, so
//    -λ_min(sym D) <= |A|·f·μ, μ = max over s ∈ {±1}^n of λ_max(sym Σ s_i M_i).
// 3. Clamping |A|·f·μ <= NOISE_MAX_STRAIN = 0.8 gives xᵀJx >= 0.2, hence
//    |Jx| >= 0.2 (σ_min(J) >= 0.2), |det J| >= 0.008, and det J > 0 because
//    xᵀ(I + tD)x >= 1 - 0.8t > 0 keeps I + tD invertible for t ∈ [0, 1].
// μ replaces the triangle-inequality sum Σ‖M_i‖ (10.77, the previous bound)
// and is ~2.3-2.8x smaller for these wave tables, so the same guarantee allows that much more
// amplitude. The bound holds for all p and t, so `time` never needs a re-check.
const NOISE_OCTAVES = 3;
const NOISE_WAVES_PER_OCTAVE = 4;
const NOISE_MAX_STRAIN = 0.8;
let noiseWeightSum = 0;
for (let octave = 0; octave < NOISE_OCTAVES; octave++) noiseWeightSum += NOISE_WAVES_PER_OCTAVE * 2 ** -octave;

const strainBounds = new Map<number, number>();

/** μ(seed) from the comment above: exact vertex enumeration (2^12 sign
 * vectors, ~6 ms once per seed, cached), padded by 1e-9 relative for eigenvalue round-off. */
function noiseStrainBound(seed: number): number {
  const cached = strainBounds.get(seed);
  if (cached !== undefined) return cached;
  const terms = noiseWaves(seed).map((w) => {
    const s = w.weight * 2 * Math.PI * 2 ** w.octave, d = w.displacement, u = w.direction;
    // Upper triangle of sym(d uᵀ)·s: xx, yy, zz, xy, xz, yz.
    return [d[0] * u[0], d[1] * u[1], d[2] * u[2], (d[0] * u[1] + d[1] * u[0]) / 2,
      (d[0] * u[2] + d[2] * u[0]) / 2, (d[1] * u[2] + d[2] * u[1]) / 2].map((v) => v * s);
  });
  let mu = 0;
  for (let mask = 0; mask < 1 << terms.length; mask++) {
    const m = [0, 0, 0, 0, 0, 0];
    terms.forEach((t, i) => { const sign = (mask >> i) & 1 ? -1 : 1; for (let j = 0; j < 6; j++) m[j] += sign * t[j]; });
    const { values } = symmetricEigen([m[0], m[3], m[4], m[3], m[1], m[5], m[4], m[5], m[2]]);
    mu = Math.max(mu, ...values);
  }
  mu *= 1 + 1e-9;
  strainBounds.set(seed, mu);
  return mu;
}

/** Largest |amplitude| (scene units) at `frequency` (base cycles per scene
 * unit) for `seed` that keeps σ_min(J) >= 0.2 and det J > 0 (proof above). */
export function noiseAmplitudeLimit(frequency: number, seed = 0): number {
  if (!(frequency > 0) || !Number.isFinite(frequency)) throw new RangeError('Noise frequency must be positive and finite');
  return NOISE_MAX_STRAIN / (frequency * noiseStrainBound(seed));
}

interface NoiseWave { direction: Vec3; displacement: Vec3; weight: number; octave: number; phase: number; turns: number }

/** Seeded wave table (mulberry32); the same seed always gives the same field. */
function noiseWaves(seed: number): NoiseWave[] {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const unit = (): Vec3 => {
    const z = 2 * random() - 1, angle = 2 * Math.PI * random(), r = Math.sqrt(1 - z * z);
    return [r * Math.cos(angle), r * Math.sin(angle), z];
  };
  const waves: NoiseWave[] = [];
  for (let octave = 0; octave < NOISE_OCTAVES; octave++) {
    for (let wave = 0; wave < NOISE_WAVES_PER_OCTAVE; wave++) {
      const turns = (random() < 0.5 ? -1 : 1) * (1 + Math.floor(2 * random()));
      waves.push({
        direction: unit(), displacement: unit(), weight: 2 ** -octave / noiseWeightSum,
        octave, phase: 2 * Math.PI * random(), turns,
      });
    }
  }
  return waves;
}

/**
 * Smooth, bounded 3D noise displacement p + A·n(p) with its exact (analytic)
 * Jacobian. `amplitude` is clamped to `noiseAmplitudeLimit(frequency, seed)`
 * (sign kept), so σ_min(J) >= 0.2 and det J > 0 for any finite scene-scale
 * input; `time` shifts every wave's phase by whole turns per unit (period 1).
 */
export function noisePointAndJacobian(
  point: ArrayLike<number>, amplitude: number, frequency: number, seed = 0, time = 0,
): { point: Vec3; jacobian: Mat3 } {
  return noiseMap({ kind: 'noise', amplitude, frequency, seed, time })(point);
}

function noiseMap(spec: Extract<DeformSpec, { kind: 'noise' }>): PointMap {
  const seed = spec.seed ?? 0;
  const limit = noiseAmplitudeLimit(spec.frequency, seed);
  const amplitude = Math.sign(spec.amplitude) * Math.min(Math.abs(spec.amplitude), limit);
  const time = spec.time ?? 0;
  // Flat table per wave: k (3), v = A·w·d (3), phase.
  const table = new Float64Array(noiseWaves(seed).flatMap((w) => [
    ...w.direction.map((d) => 2 * Math.PI * spec.frequency * 2 ** w.octave * d),
    ...w.displacement.map((d) => amplitude * w.weight * d),
    // Whole turns per unit time, reduced mod 1 so large `time` keeps precision.
    w.phase + 2 * Math.PI * ((w.turns * time) % 1),
  ]));
  return (p) => {
    if (p.length !== 3 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
      throw new RangeError('Expected a finite point');
    }
    const x = p[0], y = p[1], z = p[2];
    if (amplitude === 0) return { point: [x, y, z], jacobian: IDENTITY.slice() };
    let px = x, py = y, pz = z;
    let j0 = 1, j1 = 0, j2 = 0, j3 = 0, j4 = 1, j5 = 0, j6 = 0, j7 = 0, j8 = 1;
    // J = I + Σ v kᵀ cos(k·p + φ).
    for (let i = 0; i < table.length; i += 7) {
      const kx = table[i], ky = table[i + 1], kz = table[i + 2], vx = table[i + 3], vy = table[i + 4], vz = table[i + 5];
      const angle = kx * x + ky * y + kz * z + table[i + 6];
      const s = Math.sin(angle), c = Math.cos(angle);
      px += vx * s; py += vy * s; pz += vz * s;
      const cx = vx * c, cy = vy * c, cz = vz * c;
      j0 += cx * kx; j1 += cx * ky; j2 += cx * kz;
      j3 += cy * kx; j4 += cy * ky; j5 += cy * kz;
      j6 += cz * kx; j7 += cz * ky; j8 += cz * kz;
    }
    return { point: [px, py, pz], jacobian: [j0, j1, j2, j3, j4, j5, j6, j7, j8] };
  };
}

/** One deform, selected by `kind`; each maps a point to point + Jacobian.
 * noise: `amplitude` in scene units (clamped, see `noiseAmplitudeLimit`),
 * `frequency` in base cycles per scene unit, integer `seed`, `time` loops
 * with period 1. */
export type DeformSpec =
  | { kind: 'bend'; curvature: number; halfLength?: number; frame?: Mat3 }
  | { kind: 'dome'; curvature: number; halfLength?: number; frame?: Mat3 }
  | { kind: 'noise'; amplitude: number; frequency: number; seed?: number; time?: number };

/** True when `spec` is the exact identity (buffer restored bit-identically);
 * throws RangeError for non-finite / invalid parameters. */
export function isIdentityDeform(spec: DeformSpec): boolean {
  if (spec.kind === 'noise') {
    if (!Number.isFinite(spec.amplitude) || !Number.isFinite(spec.time ?? 0) || !Number.isInteger(spec.seed ?? 0)) {
      throw new RangeError('Noise amplitude and time must be finite, seed an integer');
    }
    noiseAmplitudeLimit(spec.frequency, spec.seed);
    return spec.amplitude === 0;
  }
  if (!Number.isFinite(spec.curvature)) throw new RangeError('Deform curvature must be finite');
  return spec.curvature === 0;
}

function deformMap(spec: DeformSpec): PointMap {
  if (spec.kind === 'noise') return noiseMap(spec);
  const halfLength = spec.halfLength ?? Infinity;
  const canonical: PointMap = spec.kind === 'dome'
    ? (p) => domePointAndJacobian(p, spec.curvature, halfLength)
    : (p) => bendPointAndJacobian(p, spec.curvature, halfLength);
  const frame = spec.frame;
  return frame ? (p) => inFrame(p, frame, canonical) : canonical;
}

function quaternionToMatrix(w: number, x: number, y: number, z: number): Mat3 {
  const norm = Math.hypot(w, x, y, z);
  if (norm < 1e-20 || !Number.isFinite(norm)) return IDENTITY.slice();
  w /= norm; x /= norm; y /= norm; z /= norm;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

function matrixToQuaternion(m: Mat3): [number, number, number, number] {
  const trace = m[0] + m[4] + m[8];
  let w: number, x: number, y: number, z: number;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
    w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4;
  }
  return w < 0 ? [-w, -x, -y, -z] : [w, x, y, z];
}

const PERMUTATIONS: readonly Vec3[] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

// Rational falloff 1 / (1 + t^2): 1 at the boundary (t=0) with zero slope
// there (continuous, matches the bend region's own C1 edge), strictly
// decreasing and always > 0 (never hard-clips a distant subject splat to
// zero, per the outlier constraint), asymptoting toward the background.
const FADE_MIN_OPACITY = 1e-6;

/**
 * Far-background opacity fade: points beyond `halfLength` from the origin
 * (3D radial distance in the same centered coordinates `deformGaussianBuffer`
 * uses, and the same region source as `bendRegion`) fade out smoothly and
 * monotonically; inside the region opacity is an exact copy (bit-identical),
 * so a zero/disabled fade (`halfLength = Infinity`) restores exactly. Only
 * the opacity logit (index 13) changes — position, scale, rotation, DC and
 * padding are untouched.
 */
export function fadeGaussianOpacity(source: Float32Array, count: number, halfLength: number): Float32Array {
  if (!Number.isInteger(count) || count < 0 || source.length < count * 16) {
    throw new RangeError('Expected a valid Gaussian count');
  }
  if (!(halfLength > 0)) throw new RangeError('Expected a positive half-length');
  const output = source.slice();
  if (!Number.isFinite(halfLength)) return output;
  for (let index = 0; index < count; index++) {
    const base = index * 16;
    const r = Math.hypot(source[base], source[base + 1], source[base + 2]);
    const excess = r - halfLength;
    if (excess <= 0) continue;
    const t = excess / halfLength;
    const multiplier = 1 / (1 + t * t);
    const opacity = 1 / (1 + Math.exp(-source[base + 13]));
    const faded = Math.min(1 - FADE_MIN_OPACITY, Math.max(FADE_MIN_OPACITY, opacity * multiplier));
    output[base + 13] = Math.log(faded / (1 - faded));
  }
  return output;
}

/** Return a view-only transformed snapshot of stride-16 trainer parameters.
 * A plain number is the cylindrical bend's curvature (with `halfLength`,
 * `frame`); a `DeformSpec` selects any deform. */
export function deformGaussianBuffer(
  source: Float32Array, count: number, deform: number | DeformSpec, halfLength = Infinity, frame?: Mat3,
): Float32Array {
  const spec: DeformSpec = typeof deform === 'number' ? { kind: 'bend', curvature: deform, halfLength, frame } : deform;
  if (!Number.isInteger(count) || count < 0 || source.length < count * 16) {
    throw new RangeError('Expected a valid Gaussian count');
  }
  const output = source.slice();
  if (isIdentityDeform(spec)) return output;
  const map = deformMap(spec);
  for (let index = 0; index < count; index++) {
    const base = index * 16;
    const { point, jacobian } = map(source.subarray(base, base + 3));
    output.set(point, base);
    const original = quaternionToMatrix(source[base + 6], source[base + 7], source[base + 8], source[base + 9]);
    const scales: Vec3 = [0, 1, 2].map(axis => Math.exp(2 * source[base + 3 + axis])) as Vec3;
    const covariance = diagonalized(original, scales);
    const transformed = multiply(multiply(jacobian, covariance), transpose(jacobian));
    const { values, vectors } = symmetricEigen(transformed);
    const targetAxes = multiply(jacobian, original);
    let best = PERMUTATIONS[0], bestScore = -Infinity;
    for (const permutation of PERMUTATIONS) {
      let score = 0;
      for (let axis = 0; axis < 3; axis++) {
        const col = permutation[axis];
        score += Math.abs(vectors[col] * targetAxes[axis] + vectors[3 + col] * targetAxes[3 + axis]
          + vectors[6 + col] * targetAxes[6 + axis]);
      }
      if (score > bestScore) { best = permutation; bestScore = score; }
    }
    const outputFrame = new Array<number>(9);
    const alignments: Vec3 = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      const col = best[axis];
      const dot = vectors[col] * targetAxes[axis] + vectors[3 + col] * targetAxes[3 + axis]
        + vectors[6 + col] * targetAxes[6 + axis];
      alignments[axis] = Math.abs(dot);
      const sign = dot < 0 ? -1 : 1;
      for (let row = 0; row < 3; row++) outputFrame[3 * row + axis] = sign * vectors[3 * row + col];
      output[base + 3 + axis] = Math.log(Math.sqrt(Math.max(values[col], MIN_VARIANCE)));
    }
    if (determinant(outputFrame) < 0) {
      const axis = alignments.indexOf(Math.min(...alignments));
      for (let row = 0; row < 3; row++) outputFrame[3 * row + axis] *= -1;
    }
    output.set(matrixToQuaternion(outputFrame), base + 6);
  }
  return output;
}
