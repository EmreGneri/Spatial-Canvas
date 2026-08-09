import { env, pipeline, RawImage } from '@huggingface/transformers';

// Model weights and the ORT runtime both live locally — no CDN, no network.
env.allowRemoteModels = false;
env.allowLocalModels = true; // off by default in the browser build
env.localModelPath = '/models/';
// Dev: Vite refuses module imports from /public (500 on `?import`), so point at
// the onnxruntime-web dist inside node_modules (served through the transform
// pipeline). Prod: static /ort/ files from public/ are copied into dist.
env.backends.onnx.wasm!.wasmPaths = import.meta.env.DEV
  ? '/node_modules/onnxruntime-web/dist/'
  : '/ort/';
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

/**
 * Kamera/video yolu (Gün 1 kararı): depth modeli YOK — parlaklık = yükseklik.
 * Aynı DepthResult sözleşmesi: 0..1, 0 = uzak (karanlık), 1 = yakın (parlak),
 * satır 0 = üst. Görsel modelden geçmediği için çıkarım süresi yok.
 */
// Canlı kamerada saniyede ~10 kez çağrılır: her karede yeni canvas + yeni 2D
// context açmak yerine tek bir çizim yüzeyi yeniden kullanılır.
let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

export function luminanceHeightMap(
  source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
  size = 256,
): DepthResult {
  let srcW: number;
  let srcH: number;
  if (source instanceof HTMLVideoElement) {
    srcW = source.videoWidth;
    srcH = source.videoHeight;
  } else if (source instanceof HTMLImageElement) {
    srcW = source.naturalWidth;
    srcH = source.naturalHeight;
  } else {
    srcW = source.width;
    srcH = source.height;
  }
  const height = Math.max(1, Math.round(size * (srcH / Math.max(1, srcW))));

  if (!scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
    scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  }
  const canvas = scratchCanvas;
  const ctx = scratchCtx!;
  if (canvas.width !== size || canvas.height !== height) {
    canvas.width = size;
    canvas.height = height;
  }
  ctx.drawImage(source, 0, 0, size, height);

  const px = ctx.getImageData(0, 0, size, height).data;
  const data = new Float32Array(size * height);
  for (let i = 0; i < px.length; i += 4) {
    data[i / 4] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
  }
  return { data, width: size, height };
}
