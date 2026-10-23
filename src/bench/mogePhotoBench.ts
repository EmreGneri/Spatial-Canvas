import { inferMoge } from '../engine/vision/mogeDepth.ts';
import { mogePointsToMetricDepth } from '../engine/vision/mogeGeometry.ts';
import { estimateDepth } from '../depth.ts';

export const MOGE_BENCH_SIZE = 518;
export type SceneName = 'slanted-plane' | 'sphere-backdrop' | 'room';

/** Deterministic pinhole ray tracer. Ray parameter t is camera Z, not range. */
export function renderMogeScene(name: SceneName, size = MOGE_BENCH_SIZE) {
  const rgba = new Uint8ClampedArray(size * size * 4), depth = new Float32Array(size * size);
  const focalPixels = size * 0.83;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rx = (x + 0.5 - size / 2) / focalPixels, ry = (y + 0.5 - size / 2) / focalPixels;
    let z = name === 'slanted-plane' ? 4 / (1 - 0.65 * rx - 0.2 * ry) : 7;
    let material = 0, nx = 0, ny = 0, nz = -1;
    if (name === 'slanted-plane') { nx = 0.65; ny = 0.2; }
    if (name !== 'slanted-plane') {
      const floor = ry > 0 ? 1.5 / ry : Infinity;
      if (floor < z) { z = floor; material = 1; nx = 0; ny = -1; nz = 0; }
      if (name === 'room') {
        const wall = Math.abs(rx) > 0 ? 2.4 / Math.abs(rx) : Infinity;
        if (wall < z) { z = wall; material = 2; nx = -Math.sign(rx); ny = 0; nz = 0; }
        const ceiling = ry < 0 ? -1.8 / ry : Infinity;
        if (ceiling < z) { z = ceiling; material = 3; nx = 0; ny = 1; nz = 0; }
      } else {
        const centerZ = 3.7, radius = 1.05;
        const a = rx * rx + ry * ry + 1;
        const discriminant = centerZ * centerZ - a * (centerZ * centerZ - radius * radius);
        const sphere = discriminant >= 0 ? (centerZ - Math.sqrt(discriminant)) / a : Infinity;
        if (sphere < z) {
          z = sphere; material = 4;
          nx = rx * z / radius; ny = ry * z / radius; nz = (z - centerZ) / radius;
        }
      }
    }
    const px = rx * z, py = ry * z;
    const u = material === 2 ? z : px;
    const v = material === 1 || material === 3 ? z : py;
    const checker = ((Math.floor(u * 2) + Math.floor(v * 2)) % 2 + 2) % 2;
    const normalLength = Math.hypot(nx, ny, nz);
    const light = 0.35 + 0.65 * Math.max(0, (-0.35 * nx - 0.55 * ny - 0.76 * nz) / normalLength);
    const colors = material === 4 ? [185, 75, 38] : material === 2 ? [100, 150, 185] : [175, 165, 140];
    const texture = material === 4 ? 0.92 + 0.08 * Math.sin(px * 17) * Math.sin(py * 17) : 0.6 + checker * 0.4;
    const i = y * size + x;
    for (let c = 0; c < 3; c++) rgba[4 * i + c] = colors[c] * light * texture;
    rgba[4 * i + 3] = 255;
    depth[i] = z;
  }
  return { rgba, depth, width: size, height: size, focalPixels,
    focalDiagonal: 2 * focalPixels / Math.hypot(size, size) };
}

/** Fit inverse-depth scale+shift on even checker pixels, score odd pixels only.
 * A nonpositive calibrated inverse-depth makes the all-pixel score null rather
 * than silently removing those predictions from the shared heldout coverage.
 */
export function fitAndScoreInverseDepth(prediction: ArrayLike<number>, targetZ: ArrayLike<number>, shared: Uint8Array, width: number) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < shared.length; i++) if (shared[i] && ((i % width + Math.floor(i / width)) % 2 === 0)) {
    const x = prediction[i], y = 1 / targetZ[i];
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const det = n * sxx - sx * sx;
  if (n < 2 || det <= 1e-12 * Math.max(1, n * sxx)) throw new Error('Degenerate inverse-depth calibration split');
  const scale = (n * sxy - sx * sy) / det, shift = (sy - scale * sx) / n;
  let heldout = 0, invalid = 0, error = 0;
  for (let i = 0; i < shared.length; i++) if (shared[i] && ((i % width + Math.floor(i / width)) % 2 === 1)) {
    heldout++;
    const inverse = scale * prediction[i] + shift;
    if (!(inverse > 0)) invalid++;
    else error += Math.abs(1 / inverse - targetZ[i]) / targetZ[i];
  }
  return { fitPixels: n, heldoutPixels: heldout, scale, shift, nonPositiveCalibratedPixels: invalid,
    heldoutAbsRel: invalid || !heldout ? null : error / heldout };
}

function rawMetricError(predicted: Float32Array, target: Float32Array, mask: Uint8Array, width: number) {
  let error = 0, n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && ((i % width + Math.floor(i / width)) % 2 === 1)) {
    error += Math.abs(predicted[i] - target[i]) / target[i]; n++;
  }
  return error / n;
}

export async function runMogePhotoBench(progress: (message: string) => void = console.log) {
  const gpu = navigator.gpu;
  if (!gpu) throw new Error('WebGPU is required for this benchmark');
  const adapters: unknown[] = [];
  const originalRequestAdapter = gpu.requestAdapter.bind(gpu);
  // Capture the adapter actually used to create each model's device, including
  // the default device ORT/transformers request; no dummy device attribution.
  gpu.requestAdapter = async (...args) => {
    const adapter = await originalRequestAdapter(...args);
    if (adapter) {
      const originalRequestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async descriptor => {
        const device = await originalRequestDevice(descriptor);
        const info = adapter.info;
        adapters.push({ vendor: info.vendor, architecture: info.architecture, device: info.device,
          description: info.description,
          maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize });
        return device;
      };
    }
    return adapter;
  };
  const scenes = [];
  try {
    for (const name of ['slanted-plane', 'sphere-backdrop', 'room'] as SceneName[]) {
      progress(`Rendering ${name}`);
      const scene = renderMogeScene(name), count = scene.depth.length;
      const canvas = document.createElement('canvas'); canvas.width = scene.width; canvas.height = scene.height;
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(scene.rgba), scene.width, scene.height), 0, 0);
      const input = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) input[c * count + i] = scene.rgba[4 * i + c] / 255;
      const timings = { moge: [] as number[], v2: [] as number[] };
      let metric: ReturnType<typeof mogePointsToMetricDepth> | undefined;
      let v2: Awaited<ReturnType<typeof estimateDepth>> | undefined;
      for (let repeat = 0; repeat < 2; repeat++) {
        progress(`${name}: MoGe ${repeat ? 'warm' : 'first'}`);
        let start = performance.now();
        const raw = await inferMoge({ data: input, dims: [1, 3, scene.height, scene.width] });
        if (!raw || raw.backend !== 'webgpu') throw new Error('Expected real browser MoGe inference');
        metric = mogePointsToMetricDepth(raw.points, raw.width, raw.height, raw.metricScale, raw.mask);
        timings.moge.push(performance.now() - start);
        progress(`${name}: V2-small ${repeat ? 'warm' : 'first'}`);
        start = performance.now();
        v2 = await estimateDepth(canvas, { model: 'v2-small', detailStrength: 0, foregroundStretch: false,
          sobelRelief: 0, depthSmoothing: false, tileDetay: false });
        timings.v2.push(performance.now() - start);
      }
      if (!metric || !v2 || v2.width !== scene.width || v2.height !== scene.height) throw new Error('Unexpected benchmark output dimensions');
      const shared = new Uint8Array(count), inverseMoge = new Float32Array(count);
      let sharedCount = 0;
      for (let i = 0; i < count; i++) {
        inverseMoge[i] = 1 / metric.depth[i];
        if (metric.validMask[i] && Number.isFinite(v2.data[i]) && scene.depth[i] > 0) { shared[i] = 1; sharedCount++; }
      }
      scenes.push({ name, width: scene.width, height: scene.height, trueFocalPixels: scene.focalPixels,
        sharedPixels: sharedCount, sharedCoverage: sharedCount / count, timingsMs: timings,
        moge: { ...fitAndScoreInverseDepth(inverseMoge, scene.depth, shared, scene.width),
          rawMetricAbsRel: rawMetricError(metric.depth, scene.depth, shared, scene.width),
          estimatedFocalPixels: metric.intrinsics[0] * scene.width,
          focalRelativeError: Math.abs(metric.focal / scene.focalDiagonal - 1),
          rawPointShift: metric.shift, calibrationProjectionRmse: metric.projectionRmse },
        v2: fitAndScoreInverseDepth(v2.data, scene.depth, shared, scene.width), imagePng: canvas.toDataURL('image/png') });
    }
  } finally { gpu.requestAdapter = originalRequestAdapter; }
  const mean = (values: Array<number | null>) => values.some(x => x === null) ? null : values.reduce<number>((sum, x) => sum + x!, 0) / values.length;
  return { createdAt: new Date().toISOString(), adapters, protocol: {
    models: 'Browser MoGe-2 ViT-S vs browser Depth Anything V2-small',
    scenes: 'Three deterministic raytraced synthetic images; not a representative real-photo benchmark',
    split: 'Even x+y calibration, odd x+y heldout; identical valid intersection for both models',
    relativeShape: 'Separate inverse-depth affine fits, heldout metric-Z AbsRel; null if calibrated depths are invalid',
    timing: 'First call includes loading only on the first scene; second call is warm. Includes CPU postprocessing.',
    v2Postprocessing: 'detail/stretch/Sobel/smoothing/tiles disabled; existing normalization and slope limiter remain',
  }, scenes, mean: { mogeHeldoutAbsRel: mean(scenes.map(s => s.moge.heldoutAbsRel)),
    v2HeldoutAbsRel: mean(scenes.map(s => s.v2.heldoutAbsRel)),
    mogeRawMetricAbsRel: mean(scenes.map(s => s.moge.rawMetricAbsRel)),
    mogeFocalRelativeError: mean(scenes.map(s => s.moge.focalRelativeError)) } };
}
