/** MoGe-2 raw ONNX postprocessing. RGB normalization belongs inside its graph.
 * Reference: microsoft/MoGe moge/model/v2.py and utils/geometry_numpy.py.
 */
export interface MogeCalibration {
  /** Focal length relative to half the image diagonal. */
  focal: number;
  /** Add to raw affine Z BEFORE multiplying by metric_scale. */
  shift: number;
  sampleCount: number;
  projectionRmse: number;
  initialProjectionRmse: number;
}

export interface MogeMetricDepth extends MogeCalibration {
  /** Camera Z in meters; invalid pixels are +Infinity, matching upstream infer(). */
  depth: Float32Array;
  validMask: Uint8Array;
  /** Row-major normalized K; multiply rows 0/1 by width/height for pixel K. */
  intrinsics: Float64Array;
}

function validate(points: ArrayLike<number>, width: number, height: number, mask?: ArrayLike<number>): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || points.length !== width * height * 3 || (mask && mask.length !== width * height)) {
    throw new Error('Invalid MoGe point-map shape or mask length. Expected interleaved HWC XYZ.');
  }
}

/** Recover camera focal and affine Z shift from interleaved raw HWC points.
 * Mask is a probability map (valid >0.5). Uses upstream's nearest 64x64 sampling
 * and nonlinear projection objective; the scalar LM implementation replaces SciPy.
 * Throws on unidentifiable geometry instead of fabricating intrinsics.
 */
export function recoverMogeFocalShift(
  points: ArrayLike<number>, width: number, height: number, mask?: ArrayLike<number>,
): MogeCalibration {
  validate(points, width, height, mask);
  const samples: number[][] = [];
  const diagonal = Math.hypot(width, height);
  let xx = 0, xu = 0, uu = 0, xuz = 0, uuz = 0;
  let minZ = Infinity, maxZ = -Infinity;
  // Sampling coordinates match torch interpolate(mode='nearest'), including pixel centers.
  for (let row = 0; row < 64; row++) for (let col = 0; col < 64; col++) {
    const x = Math.floor(col * width / 64), y = Math.floor(row * height / 64);
    const i = y * width + x;
    if (mask && !(mask[i] > 0.5)) continue;
    const px = points[3 * i], py = points[3 * i + 1], pz = points[3 * i + 2];
    if (![px, py, pz].every(Number.isFinite)) continue;
    const u = (2 * x + 1 - width) / diagonal, v = (2 * y + 1 - height) / diagonal;
    samples.push([px, py, pz, u, v]);
    const dot = px * u + py * v;
    xx += px * px + py * py;
    xu += dot;
    uu += u * u + v * v;
    xuz += dot * pz;
    uuz += (u * u + v * v) * pz;
    minZ = Math.min(minZ, pz);
    maxZ = Math.max(maxZ, pz);
  }
  if (samples.length < 2) throw new Error('MoGe calibration needs at least two valid samples.');
  const determinant = xx * uu - xu * xu;
  if (!(xx > 0) || determinant <= 1e-12 * xx * uu || maxZ - minZ < 1e-7 * Math.max(1, Math.abs(maxZ))) {
    throw new Error('Degenerate MoGe geometry: focal and shift cannot be recovered.');
  }
  // Affine LS is only an initializer. The final objective is projection error,
  // where focal has a closed-form optimum conditioned on each candidate shift.
  const initialShift = (xu * xuz - xx * uuz) / determinant;
  function evaluate(shift: number) {
    let numerator = 0, denominator = 0, numeratorPrime = 0, denominatorPrime = 0;
    for (const [x, y, z, u, v] of samples) {
      const d = z + shift;
      if (!(d > 1e-10)) return { error: Infinity, focal: NaN, gradient: 0, curvature: 0 };
      const dot = x * u + y * v, square = x * x + y * y;
      numerator += dot / d;
      denominator += square / (d * d);
      numeratorPrime -= dot / (d * d);
      denominatorPrime -= 2 * square / (d * d * d);
    }
    const focal = numerator / denominator;
    if (!(focal > 0) || !Number.isFinite(focal)) return { error: Infinity, focal, gradient: 0, curvature: 0 };
    const focalPrime = (numeratorPrime * denominator - numerator * denominatorPrime) / (denominator * denominator);
    let error = 0, gradient = 0, curvature = 0;
    for (const [x, y, z, u, v] of samples) {
      const d = z + shift;
      const dx = focalPrime * x / d - focal * x / (d * d);
      const dy = focalPrime * y / d - focal * y / (d * d);
      const rx = focal * x / d - u, ry = focal * y / d - v;
      error += rx * rx + ry * ry;
      gradient += rx * dx + ry * dy;
      curvature += dx * dx + dy * dy;
    }
    return { error, focal, gradient, curvature };
  }
  const floor = -minZ + Math.max(1e-6, (maxZ - minZ) * 1e-6);
  let shift = Math.max(initialShift, floor);
  let current = evaluate(shift);
  const initialProjectionRmse = Math.sqrt(current.error / (2 * samples.length));
  let damping = 1e-4;
  for (let iteration = 0; iteration < 100; iteration++) {
    const step = -current.gradient / Math.max(1e-30, current.curvature * (1 + damping));
    const candidateShift = Math.max(floor, shift + step);
    const candidate = evaluate(candidateShift);
    if (candidate.error < current.error) {
      const improvement = current.error - candidate.error;
      shift = candidateShift;
      current = candidate;
      damping = Math.max(1e-9, damping / 3);
      if (Math.abs(step) < 1e-10 * Math.max(1, Math.abs(shift)) || improvement < 1e-18) break;
    } else {
      damping *= 10;
      if (damping > 1e12) break;
    }
  }
  if (!Number.isFinite(current.error) || current.curvature < 1e-20) {
    throw new Error('Degenerate MoGe geometry: nonlinear calibration did not converge.');
  }
  return { focal: current.focal, shift, sampleCount: samples.length,
    projectionRmse: Math.sqrt(current.error / (2 * samples.length)), initialProjectionRmse };
}

/** Convert one raw ONNX point-map to metric camera Z and normalized intrinsics.
 * metricScale is the graph's already-exponentiated metric_scale scalar.
 */
export function mogePointsToMetricDepth(
  points: ArrayLike<number>, width: number, height: number, metricScale: number, mask?: ArrayLike<number>,
): MogeMetricDepth {
  if (!(metricScale > 0) || !Number.isFinite(metricScale)) throw new Error('MoGe metric scale must be finite and positive.');
  const calibration = recoverMogeFocalShift(points, width, height, mask);
  const depth = new Float32Array(width * height);
  const validMask = new Uint8Array(width * height);
  for (let i = 0; i < depth.length; i++) {
    const z = (points[3 * i + 2] + calibration.shift) * metricScale;
    if ((!mask || mask[i] > 0.5) && Number.isFinite(points[3 * i]) && Number.isFinite(points[3 * i + 1]) && Number.isFinite(z) && z > 0 && z <= 3.4028234663852886e38) {
      depth[i] = z;
      validMask[i] = 1;
    } else depth[i] = Infinity;
  }
  const a = width / height;
  const fy = calibration.focal * Math.hypot(1, a) / 2;
  return { ...calibration, depth, validMask,
    intrinsics: new Float64Array([fy / a, 0, 0.5, 0, fy, 0.5, 0, 0, 1]) };
}
