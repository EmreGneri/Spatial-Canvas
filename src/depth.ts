import { env, pipeline, RawImage } from '@huggingface/transformers';

// Model weights and the ORT runtime both live in /public — no CDN, no network.
env.allowRemoteModels = false;
env.allowLocalModels = true; // off by default in the browser build
env.localModelPath = '/models/';
env.backends.onnx.wasm!.wasmPaths = '/ort/';
env.backends.onnx.wasm!.numThreads = 1; // single-thread => no COOP/COEP headers needed

const MODEL = 'onnx-community/depth-anything-v2-small';

export type DepthResult = {
  /** Normalized 0..1, 0 = far, 1 = near. Row 0 is the TOP of the image. */
  data: Float32Array;
  width: number;
  height: number;
};

let estimator: Awaited<ReturnType<typeof pipeline<'depth-estimation'>>> | null = null;

export async function loadDepthModel(device: 'wasm' | 'webgpu' = 'wasm') {
  if (estimator) return estimator;
  estimator = await pipeline('depth-estimation', MODEL, {
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
  });
  return estimator;
}

/**
 * Runs depth estimation and normalizes to the contract in ARCHITECTURE.md:
 * 0 = far, 1 = near, top-left origin. The shader layer never renormalizes.
 */
export async function estimateDepth(source: HTMLCanvasElement | HTMLImageElement): Promise<DepthResult> {
  const model = await loadDepthModel();
  const image = await RawImage.fromCanvas(toCanvas(source));
  const { predicted_depth } = await model(image);

  const [height, width] = predicted_depth.dims.slice(-2) as [number, number];
  const raw = predicted_depth.data as Float32Array;

  let min = Infinity;
  let max = -Infinity;
  for (const v of raw) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;

  const data = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) data[i] = (raw[i] - min) / span;

  return { data, width, height };
}

function toCanvas(source: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement {
  if (source instanceof HTMLCanvasElement) return source;
  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  canvas.getContext('2d')!.drawImage(source, 0, 0);
  return canvas;
}
