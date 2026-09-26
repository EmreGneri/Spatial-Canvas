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
  const frameT = transpose(frame);
  const local = applyMat3(frameT, point);
  const { point: bentLocal, jacobian: jacobianLocal } = bendPointAndJacobian(local, curvature, halfLength);
  return {
    point: applyMat3(frame, bentLocal),
    jacobian: multiply(multiply(frame, jacobianLocal), frameT),
  };
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

/** Return a view-only transformed snapshot of stride-16 trainer parameters. */
export function deformGaussianBuffer(
  source: Float32Array, count: number, curvature: number, halfLength = Infinity, frame?: Mat3,
): Float32Array {
  if (!Number.isInteger(count) || count < 0 || source.length < count * 16 || !Number.isFinite(curvature)) {
    throw new RangeError('Expected a valid Gaussian count and finite curvature');
  }
  const output = source.slice();
  if (curvature === 0) return output;
  for (let index = 0; index < count; index++) {
    const base = index * 16;
    const { point, jacobian } = frame
      ? bendPointAndJacobianInFrame(source.subarray(base, base + 3), frame, curvature, halfLength)
      : bendPointAndJacobian(source.subarray(base, base + 3), curvature, halfLength);
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
