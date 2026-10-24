/** Experimental VDA Small: official hidden-state streaming, trained window32. */
export const VDA_INPUT_WIDTH = 266;
export const VDA_INPUT_HEIGHT = 154;
/** Opt-in only (`?videoDerinlik=vda`); see docs/benchmarks/video-depth-anything.md. */
export const VDA_DEFAULT_ENABLED = false;
// Dışa aktarım bizim üretimimiz: geliştirmede yerel klasörden, yayında Hugging Face'ten
// (Apache-2.0, sabit revizyon; https://huggingface.co/EmreGneri/video-depth-anything-small-stream).
const VDA_BASE = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
  ? '/models/DepthAnything/video-depth-anything-small-stream-154x266/'
  : 'https://huggingface.co/EmreGneri/video-depth-anything-small-stream/resolve/56ff0a88aaf2262d50d5d82d69b47e9d40e1c991/';
const VDA_PIXELS = VDA_INPUT_WIDTH * VDA_INPUT_HEIGHT;
const VDA_PATCHES = (VDA_INPUT_WIDTH / 14) * (VDA_INPUT_HEIGHT / 14);
/** Fixed-shape export: a larger squash than 16:10 → 16:9 distorts geometry; V2 keeps aspect. */
const VDA_ASPECT_TOLERANCE = 0.15;

export function vdaIstendi(search: string): boolean {
  return new URLSearchParams(search).get('videoDerinlik') === 'vda';
}

export function vdaOranUygun(width: number, height: number): boolean {
  return width > 0 && height > 0
    && Math.abs(width / height / (VDA_INPUT_WIDTH / VDA_INPUT_HEIGHT) - 1) <= VDA_ASPECT_TOLERANCE;
}

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** Upstream transform: RGB/255, ImageNet mean/std, planar CHW (resize is the caller's canvas). */
export function vdaOnIsle(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const n = width * height;
  if (rgba.length !== n * 4) throw Error('Invalid VDA input shape');
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[c * n + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

/** 4x4 block-mean luma, the scene-cut signature fed to `vdaResetReason`. */
export function vdaImza(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const sum = new Float32Array(16), count = new Float32Array(16);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4, cell = Math.floor(y * 4 / height) * 4 + Math.floor(x * 4 / width);
      sum[cell] += (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) / 255;
      count[cell]++;
    }
  }
  return sum.map((s, i) => (count[i] ? s / count[i] : 0));
}

export function vdaCiktiDogrula(depth: Float32Array | undefined): void {
  if (!depth || depth.length !== VDA_PIXELS) throw Error(`Invalid VDA output shape (${depth?.length ?? 'missing'})`);
  let min = Infinity, max = -Infinity;
  for (const v of depth) {
    if (!Number.isFinite(v)) throw Error('VDA output implausible: non-finite depth');
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max - min > 1e-6)) throw Error('VDA output implausible: constant depth');
}

export interface VdaTensor { data: Float32Array; dims: readonly number[] }
export type VdaRun = (feeds: Record<string, VdaTensor>) => Promise<Record<string, VdaTensor>>;
export interface VdaRunners { encoder: VdaRun; bootstrap: VdaRun; stream: VdaRun }
export interface VdaStream {
  infer(pixels: Float32Array): Promise<Float32Array>;
  reset(): void;
  /** Frames seen in the current temporal context. */
  frames(): number;
}

/** Encoder → bootstrap (first frame) or stream (31 cached frames) → depth + next cache. */
export function createVdaStream(run: VdaRunners): VdaStream {
  let history = createVdaHistory<VdaTensor[]>();
  let epoch = 0;
  return {
    frames: () => history.frameId + 1,
    reset() {
      history = createVdaHistory();
      epoch++;
    },
    async infer(pixels) {
      if (pixels.length !== 3 * VDA_PIXELS) throw Error('Invalid VDA input shape');
      const startedEpoch = epoch, context = history;
      const features = await run.encoder({ pixels: { data: pixels, dims: [1, 3, VDA_INPUT_HEIGHT, VDA_INPUT_WIDTH] } });
      const feeds: Record<string, VdaTensor> = {};
      for (let i = 1; i <= 4; i++) {
        const f = features[`feat${i}`];
        if (!f || f.dims.join() !== `1,${VDA_PATCHES},384`) throw Error(`Invalid VDA encoder shape feat${i}: ${f?.dims.join('x')}`);
        feeds[`feat${i}`] = f;
      }
      const first = context.frameId < 0;
      if (!first) {
        const previous = selectVdaHistory(context);
        for (let i = 0; i < 8; i++) {
          const [spatial, , channels] = previous[0][i].dims;
          feeds[`cache${i}`] = { data: packVdaCache(previous.map(frame => frame[i].data), spatial, channels), dims: [spatial, previous.length, channels] };
        }
      }
      const out = await (first ? run.bootstrap : run.stream)(feeds);
      vdaCiktiDogrula(out.depth?.data);
      const caches = Array.from({ length: 8 }, (_, i) => out[`${first ? 'cache' : 'nextCache'}${i}`]);
      if (caches.some(c => !c || c.dims.length !== 3 || c.dims[1] !== 1)) throw Error('Invalid VDA cache shape');
      // A reset while this frame ran (seek, cut, new clip) owns the history now.
      if (startedEpoch === epoch) advanceVdaHistory(context, caches);
      return out.depth.data;
    },
  };
}

// ---------------------------------------------------------------------------
// Browser runtime. Node verify imports this module; ORT is loaded lazily.
// ---------------------------------------------------------------------------

async function openVdaRunners(): Promise<VdaRunners> {
  const { gpuSirasinaGir, webgpuKullanilabilir } = await import('../../depth.ts');
  if (!await webgpuKullanilabilir()) throw Error('VDA needs WebGPU (no adapter)');
  const ort = await import('onnxruntime-web/webgpu');
  const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
  ort.env.wasm.wasmPaths = dev ? '/node_modules/onnxruntime-web/dist/' : '/ort/';
  ort.env.wasm.numThreads = 1;
  const open = (file: string) => gpuSirasinaGir(() => ort.InferenceSession.create(VDA_BASE + file, { executionProviders: ['webgpu'] }));
  // Sequential: concurrent session creation on one device is the known WebGPU failure (depth.ts).
  const encoder = await open('encoder_fp16.onnx');
  const bootstrap = await open('bootstrap_fp16.onnx');
  const stream = await open('stream_fp16.onnx');
  const runner = (session: typeof encoder): VdaRun => async (feeds) => {
    const input = Object.fromEntries(Object.entries(feeds).map(([k, t]) => [k, new ort.Tensor('float32', t.data, [...t.dims])]));
    const output = await gpuSirasinaGir(() => session.run(input));
    return Object.fromEntries(Object.entries(output).map(([k, t]) => [k, { data: t.data as Float32Array, dims: t.dims }]));
  };
  return { encoder: runner(encoder), bootstrap: runner(bootstrap), stream: runner(stream) };
}

let streamPromise: Promise<VdaStream> | null = null;
let activeStream: VdaStream | null = null;
let lastStamp: VdaFrameStamp | null = null;
let disabledReason: string | null = null;
let aspectLogged = false;

/** Load once; a failure is reported to the caller, who falls back with `vdaDus`. */
export function vdaHazirla(): Promise<VdaStream> {
  streamPromise ??= openVdaRunners().then((runners) => (activeStream = createVdaStream(runners)));
  return streamPromise;
}

export function vdaKullanilsinMi(width: number, height: number, search = typeof location === 'undefined' ? '' : location.search): boolean {
  if (disabledReason || !vdaIstendi(search)) return false;
  if (vdaOranUygun(width, height)) return true;
  if (!aspectLogged) console.info(`[videoDerinlik] VDA skipped for ${width}x${height}: fixed 266x154 export; using V2-small`);
  aspectLogged = true;
  return false;
}

/** Any VDA failure disables it for this page; the frame and later ones use V2-small. */
export function vdaDus(error: unknown): void {
  if (!disabledReason) console.warn('[videoDerinlik] VDA disabled, falling back to V2-small:', error);
  disabledReason = String(error);
  vdaSifirla();
}

export function vdaSifirla(): void {
  activeStream?.reset();
  lastStamp = null;
}

/** One live video frame already drawn at 266x154. Resets context on seek/gap/cut/new source. */
export async function vdaKare(frame: ImageData, sourceId: string, time: number, sourceWidth: number, sourceHeight: number): Promise<VdaTensor> {
  const stream = await vdaHazirla();
  const stamp = { sourceId, time, width: sourceWidth, height: sourceHeight, signature: vdaImza(frame.data, frame.width, frame.height) };
  if (vdaResetReason(lastStamp, stamp)) stream.reset();
  lastStamp = stamp;
  const depth = await stream.infer(vdaOnIsle(frame.data, frame.width, frame.height));
  return { data: depth, dims: [1, VDA_INPUT_HEIGHT, VDA_INPUT_WIDTH] };
}

/** Shader compilation happens on the first real run; warm with a gradient, then drop the context. */
export async function vdaIsit(): Promise<void> {
  const stream = await vdaHazirla();
  const rgba = new Uint8ClampedArray(VDA_PIXELS * 4);
  for (let i = 0; i < VDA_PIXELS; i++) rgba.fill((i % VDA_INPUT_WIDTH) % 256, i * 4, i * 4 + 4);
  try {
    await stream.infer(vdaOnIsle(rgba, VDA_INPUT_WIDTH, VDA_INPUT_HEIGHT));
  } finally {
    vdaSifirla();
  }
}

export interface VdaHistory<T> { frames: T[]; frameId: number }
export function createVdaHistory<T>(): VdaHistory<T> { return { frames: [], frameId: -1 }; }

/** Match upstream first2 + latest29, including its persistent first-frame anchor. */
export function selectVdaHistory<T>(history: VdaHistory<T>): T[] {
  return history.frames.slice(0, 2).concat(history.frames.slice(-29));
}

export function advanceVdaHistory<T>(history: VdaHistory<T>, frame: T): void {
  history.frameId++;
  if (history.frameId === 0) history.frames = new Array(32).fill(frame);
  else history.frames.push(frame);
  if (history.frameId + 32 > 42) history.frames.splice(1, 1);
}

/** Upstream torch.cat(dim=1): flattening time first silently corrupts attention. */
export function packVdaCache(frames: readonly Float32Array[], spatial: number, channels: number): Float32Array {
  if (frames.some(frame => frame.length !== spatial * channels)) throw Error('Invalid VDA cache shape');
  const packed = new Float32Array(spatial * frames.length * channels);
  for (let pixel = 0; pixel < spatial; pixel++) {
    for (let time = 0; time < frames.length; time++) {
      packed.set(frames[time].subarray(pixel * channels, (pixel + 1) * channels), (pixel * frames.length + time) * channels);
    }
  }
  return packed;
}

export interface VdaFrameStamp {
  sourceId: string;
  time: number;
  width: number;
  height: number;
  signature: Float32Array;
}

/** A seek/cut must never import geometry from the previous temporal context. */
export function vdaResetReason(previous: VdaFrameStamp | null, next: VdaFrameStamp): string | null {
  if (!previous) return 'initial';
  if (previous.sourceId !== next.sourceId) return 'source';
  if (previous.width !== next.width || previous.height !== next.height) return 'dimensions';
  if (next.time <= previous.time) return 'seek';
  if (next.time - previous.time > 1) return 'gap';
  let difference = 0;
  if (previous.signature.length !== next.signature.length) return 'scene-cut';
  for (let i = 0; i < next.signature.length; i++) difference += Math.abs(previous.signature[i] - next.signature[i]);
  return difference / next.signature.length > 0.28 ? 'scene-cut' : null;
}
