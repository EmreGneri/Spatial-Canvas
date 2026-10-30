import { onceRetry } from '../../depth.ts';
import { ilerlemeliGetir } from '../../indirmeIlerleme.ts';

/**
 * Fast per-frame person mask for live video (MediaPipe Image Segmenter), off by default.
 * `?hizliMaske=selfie` (selfie_segmenter, 256x256 float16, 0.25 MB) or `?hizliMaske=multiclass`
 * (selfie_multiclass_256x256, float32, 16 MB; person = 1 - background).
 * LICENCE: both model cards say "LICENSED UNDER Apache License, Version 2.0".
 * Out of scope per the cards: several people at different scales, people beyond ~4 m.
 */
export type FastMaskModel = 'selfie' | 'multiclass';

export function fastMaskModel(search: string): FastMaskModel | null {
  const v = new URLSearchParams(search).get('hizliMaske');
  return v === 'selfie' || v === 'multiclass' ? v : null;
}

const MODEL_PATH: Record<FastMaskModel, string> = {
  selfie: '/models/mediapipe/selfie_segmenter.tflite',
  multiclass: '/models/mediapipe/selfie_multiclass_256x256.tflite',
};

type Segmenter = import('@mediapipe/tasks-vision').ImageSegmenter;
const VITE_DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
const WASM_BASE = VITE_DEV ? '/node_modules/@mediapipe/tasks-vision/wasm' : '/mediapipe-wasm';

const loaders = new Map<string, () => Promise<Segmenter>>();
/** GPU delegate first (WebGL, not WebGPU); CPU (WASM) if the driver refuses it. `delegate` forces one (bench). */
export function loadPersonSegmenter(model: FastMaskModel, delegate?: 'GPU' | 'CPU'): Promise<Segmenter> {
  const key = `${model}:${delegate ?? 'auto'}`;
  let load = loaders.get(key);
  if (!load) {
    load = onceRetry(async () => {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const wasm = await FilesetResolver.forVisionTasks(WASM_BASE);
      // Cache Storage + ETag (same as the other same-origin models): a plain path is re-downloaded
      // on every visit (measured: 16.4 MB again on the warm pass).
      const bytes = new Uint8Array(await ilerlemeliGetir(MODEL_PATH[model], 'hızlı maske modeli'));
      const create = (d: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(wasm, {
        baseOptions: { modelAssetBuffer: bytes, delegate: d },
        runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
        // GPU delegate: its own canvas, so it never shares the engine's WebGL context.
        ...(d === 'GPU' && typeof OffscreenCanvas !== 'undefined' ? { canvas: new OffscreenCanvas(1, 1) } : {}),
      });
      return delegate ? create(delegate) : create('GPU').catch(() => create('CPU'));
    });
    loaders.set(key, load);
  }
  return load();
}

export type PersonMask = { data: Float32Array; width: number; height: number };

/** Person probability (0..1) at the input's size. Synchronous once the segmenter is loaded. */
export function segmentPerson(segmenter: Segmenter, model: FastMaskModel, image: ImageData | HTMLCanvasElement): PersonMask {
  const result = segmenter.segment(image);
  try {
    const masks = result.confidenceMasks;
    if (!masks?.length) throw new Error('segmenter returned no confidence mask');
    const m = masks[0];
    const data = new Float32Array(m.getAsFloat32Array());
    if (model === 'multiclass') for (let i = 0; i < data.length; i++) data[i] = 1 - data[i];
    return { data, width: m.width, height: m.height };
  } finally {
    result.close();
  }
}
