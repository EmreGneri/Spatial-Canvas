import * as ort from 'onnxruntime-web/webgpu';
import { gpuSirasinaGir, onceRetry, webgpuKullanilabilir } from '../../depth.ts';
import { ilerlemeliGetir } from '../../indirmeIlerleme.ts';
import { localInference, localInferenceAvailable, type RawTensor } from '../sidecarClient.ts';

export interface MogeRawResult {
  /** Raw affine XYZ, interleaved HWC. Recover focal and Z shift before scaling. */
  points: Float32Array;
  mask: Float32Array;
  /** Already exponentiated by the model. */
  metricScale: number;
  width: number;
  height: number;
  backend: 'webgpu' | 'sidecar';
}

interface OutputTensor { data: unknown; dims: readonly number[] }
const MODEL_PATH = '/models/Ruicheng/moge-2-vits-normal-onnx/model.onnx';
const SIZE = 518;
const VITE_DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
ort.env.wasm.wasmPaths = VITE_DEV ? '/node_modules/onnxruntime-web/dist/' : '/ort/';
ort.env.wasm.numThreads = 1;

function hasShape(tensor: OutputTensor | undefined, dims: number[]): tensor is OutputTensor & { data: Float32Array } {
  return !!tensor && tensor.data instanceof Float32Array && tensor.dims.length === dims.length
    && dims.every((d, i) => d === tensor.dims[i])
    && tensor.data.length === dims.reduce((a, b) => a * b, 1);
}

/** Validate named raw ONNX outputs and copy them before ORT tensors are disposed. */
export function unpackMogeOutputs(
  outputs: Record<string, OutputTensor>, width: number, height: number,
): MogeRawResult | null {
  const { points, mask } = outputs;
  // Published July 2025 graphs call this "scale"; newer export docs use "metric_scale".
  const scale = outputs.metric_scale ?? outputs.scale;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || !hasShape(points, [1, height, width, 3]) || !hasShape(mask, [1, height, width])
    || !(hasShape(scale, [1]) || hasShape(scale, []))) return null;
  const metricScale = scale.data[0];
  if (!(metricScale > 0) || !Number.isFinite(metricScale) || !points.data.every(Number.isFinite)) return null;
  let valid = 0;
  for (const probability of mask.data) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) return null;
    if (probability > 0.5) valid++;
  }
  if (valid < 2) return null;
  return { points: points.data.slice(), mask: mask.data.slice(), metricScale, width, height, backend: 'webgpu' };
}

/** Sidecar protocol: [1,5,H,W] planes X,Y,Z,mask,repeated metric_scale. */
export function unpackMogeSidecar(tensor: RawTensor, width: number, height: number): MogeRawResult | null {
  if (!hasShape(tensor, [1, 5, height, width])) return null;
  const count = width * height;
  const scale = tensor.data[4 * count];
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(tensor.data[4 * count + i]) || tensor.data[4 * count + i] !== scale) return null;
    points.set([tensor.data[i], tensor.data[count + i], tensor.data[2 * count + i]], i * 3);
  }
  const result = unpackMogeOutputs({ points: { data: points, dims: [1, height, width, 3] },
    mask: { data: tensor.data.subarray(3 * count, 4 * count), dims: [1, height, width] },
    metric_scale: { data: Float32Array.of(scale), dims: [1] } }, width, height);
  return result ? { ...result, backend: 'sidecar' } : null;
}

const loadSession = onceRetry(async () => {
  const bytes = await ilerlemeliGetir(MODEL_PATH, 'MoGe-2 geometry model');
  return gpuSirasinaGir(() => ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] }));
});
let browserDisabled = false;
let browserSession: ort.InferenceSession | null = null;

/** RGB [0,1], NCHW [1,3,518,518]; normalization is already inside the ONNX.
 * Sidecar ViT-L first, browser ViT-S second. Logs failures and returns null so
 * the caller can select its existing depth provider. No product flags live here.
 */
export async function inferMoge(input: RawTensor): Promise<MogeRawResult | null> {
  if (!hasShape(input, [1, 3, SIZE, SIZE]) || !input.data.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
    console.warn('MoGe input rejected: expected finite RGB [0,1] with shape [1,3,518,518].');
    return null;
  }
  try {
    if (localInference && await localInferenceAvailable()) {
      // SidecarClient invokes this callback after disabling a failed connection;
      // browser execution remains below, keeping GPU queue entry non-recursive.
      const raw = await localInference.infer('moge', input, async () => { throw new Error('MoGe sidecar unavailable'); });
      const result = unpackMogeSidecar(raw, SIZE, SIZE);
      if (!result) throw new Error('Invalid MoGe sidecar output shape, mask, or metric scale');
      return result;
    }
  } catch (error) { console.warn('MoGe sidecar failed; trying browser geometry.', error); }
  if (browserDisabled) return null;
  if (!await webgpuKullanilabilir()) {
    browserDisabled = true;
    console.warn('MoGe browser unavailable: WebGPU is required; using existing depth provider.');
    return null;
  }
  try {
    const session = browserSession = await loadSession();
    return await gpuSirasinaGir(async () => {
      const image = new ort.Tensor('float32', input.data, input.dims);
      const numTokens = new ort.Tensor('int64', BigInt64Array.of(1800n), []);
      let outputs: Record<string, ort.Tensor> = {};
      try {
        const scaleName = session.outputNames?.includes('metric_scale') ? 'metric_scale' : 'scale';
        outputs = await session.run({ image, num_tokens: numTokens }, ['points', 'mask', scaleName]);
        const result = unpackMogeOutputs(outputs, SIZE, SIZE);
        if (!result) console.warn('MoGe browser output rejected: invalid shape, mask, points, or metric scale.');
        return result;
      } finally {
        image.dispose();
        numTokens.dispose();
        for (const tensor of Object.values(outputs)) tensor.dispose?.();
      }
    });
  } catch (error) {
    browserDisabled = true;
    const failedSession = browserSession;
    browserSession = null;
    if (failedSession) {
      try { await gpuSirasinaGir(() => failedSession.release()); }
      catch (releaseError) { console.warn('MoGe failed session could not be released.', releaseError); }
    }
    console.warn('MoGe browser failed; using existing depth provider until reload.', error);
    return null;
  }
}
