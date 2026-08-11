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

// Depth Anything V2 training resolution. The image processor resizes every
// input to this square, so we letterbox to the same size: the model then sees
// its native square without any aspect distortion.
const MODEL_INPUT_SIZE = 518;

export type DepthResult = {
  /** Normalized 0..1, 0 = far, 1 = near. Row 0 is the TOP of the image. */
  data: Float32Array;
  width: number;
  height: number;
};

export type DepthEstimateOptions = {
  /**
   * 'letterbox' (default): keep the aspect ratio, pad to a square. The model
   * never sees a squeezed image — vertical portraits keep their face geometry.
   * 'distort': old behavior, plain resize to the square.
   */
  aspect?: 'distort' | 'letterbox';
  /**
   * Trim the darkest/brightest `percentile`% of values before min-max
   * normalization. One blown-out pixel no longer crushes the whole range.
   * 0 disables the trim.
   */
  percentile?: number;
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
export async function estimateDepth(
  source: HTMLCanvasElement | HTMLImageElement,
  opts: DepthEstimateOptions = {},
): Promise<DepthResult> {
  const model = await loadDepthModel();
  const useLetterbox = (opts.aspect ?? 'letterbox') === 'letterbox';

  let input: RawImage;
  let rect: { x: number; y: number; w: number; h: number } | null = null;
  if (useLetterbox) {
    const lb = letterboxCanvas(source, MODEL_INPUT_SIZE);
    input = await RawImage.fromCanvas(lb.canvas);
    rect = lb;
  } else {
    input = await RawImage.fromCanvas(toCanvas(source));
  }

  const { predicted_depth } = await model(input);

  const [height, width] = predicted_depth.dims.slice(-2) as [number, number];
  let data = predicted_depth.data as Float32Array;
  let outWidth = width;
  let outHeight = height;
  if (rect) {
    // The pipeline interpolates the output back to the input (square) size;
    // crop the letterbox frame so padded areas never enter the depth map.
    data = cropDepth(data, width, rect);
    outWidth = rect.w;
    outHeight = rect.h;
  }

  const normalized = normalizeDepth(data, opts.percentile ?? 1);
  return { data: normalized, width: outWidth, height: outHeight };
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
 * Draws the source onto a `size`x`size` canvas, aspect preserved and centered.
 * Padding uses the image's average color (from a 16x16 thumbnail) instead of
 * black: the model treats uniform fills as "unknown area", so we want it to be
 * as close to the photo's own tone as possible. The padded frame is cropped
 * away after inference, so it never reaches the depth map.
 */
function letterboxCanvas(
  source: HTMLCanvasElement | HTMLImageElement,
  size: number,
): { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } {
  const src = toCanvas(source);
  const scale = Math.min(size / src.width, size / src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const x = Math.floor((size - w) / 2);
  const y = Math.floor((size - h) / 2);

  const thumb = document.createElement('canvas');
  thumb.width = 16;
  thumb.height = 16;
  const tctx = thumb.getContext('2d')!;
  tctx.drawImage(src, 0, 0, 16, 16);
  const tdata = tctx.getImageData(0, 0, 16, 16).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < tdata.length; i += 4) {
    r += tdata[i];
    g += tdata[i + 1];
    b += tdata[i + 2];
  }
  const n = tdata.length / 4;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(src, x, y, w, h);
  return { canvas, x, y, w, h };
}

/** Copies the letterbox frame out of the square output. Rows stay top-first. */
function cropDepth(
  data: Float32Array,
  square: number,
  rect: { x: number; y: number; w: number; h: number },
): Float32Array {
  const out = new Float32Array(rect.w * rect.h);
  for (let j = 0; j < rect.h; j++) {
    const rowStart = (j + rect.y) * square + rect.x;
    out.set(data.subarray(rowStart, rowStart + rect.w), j * rect.w);
  }
  return out;
}

/**
 * Min-max normalization with an optional percentile trim (histogram based,
 * no sort). Depth models emit a few outlier logits (usually far-field noise);
 * without trimming they compress the whole 0..1 range and flatten foreground
 * detail.
 */
function normalizeDepth(data: Float32Array, pct: number): Float32Array {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of data) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const span = mx - mn || 1;
  let lo = mn;
  let hi = mx;
  if (pct > 0) {
    const bins = new Float64Array(256);
    for (const v of data) {
      const b = Math.min(255, Math.max(0, Math.floor(((v - mn) / span) * 256)));
      bins[b]++;
    }
    const limit = (data.length * pct) / 100;
    let acc = 0;
    for (let i = 0; i < 256 && acc < limit; i++) {
      acc += bins[i];
      lo = mn + (i / 256) * span;
    }
    acc = 0;
    for (let i = 255; i >= 0 && acc < limit; i--) {
      acc += bins[i];
      hi = mn + ((i + 1) / 256) * span;
    }
  }
  const s = hi - lo || 1;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.min(1, Math.max(0, (data[i] - lo) / s));
  return out;
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
// Luminance buffer'ı da aynı nedenle yeniden kullanılır: video yolunda her
// frame'de yeni Float32Array ayırmak çöp biriktirir, scratch değişmez.
let scratchData: Float32Array | null = null;

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
  if (!scratchData || scratchData.length !== size * height) {
    scratchData = new Float32Array(size * height);
  }
  const data = scratchData;
  for (let i = 0; i < px.length; i += 4) {
    data[i / 4] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
  }
  return { data, width: size, height };
}
