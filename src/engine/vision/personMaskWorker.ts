// Fast person mask off the main thread. On the page, MediaPipe's WebGL delegate set-up and the
// first segment() blocked rendering for seconds when cold, and every depth frame paid the
// segmentation itself (docs/benchmarks/video-fast-mask.md).
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { FastMaskModel, PersonMaskRequest, PersonMaskResponse } from './personMask.ts';

let segmenter: ImageSegmenter | null = null;
let invert = false;

// The options form type-checks against both DOM's Window and a worker's global scope.
const reply = (message: PersonMaskResponse, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

async function load(model: FastMaskModel, bytes: ArrayBuffer, wasmBase: string) {
  // Module worker: MediaPipe's module build sets ModuleFactory without importScripts.
  const wasm = await FilesetResolver.forVisionTasks(wasmBase, true);
  const create = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(wasm, {
    baseOptions: { modelAssetBuffer: new Uint8Array(bytes), delegate },
    runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
    // GPU delegate: the worker's own canvas, never the engine's WebGL context.
    ...(delegate === 'GPU' ? { canvas: new OffscreenCanvas(1, 1) } : {}),
  });
  // selfie on the CPU delegate: warm-up 92 ms against 2.67 s on GPU, 11-15 ms a frame in this Worker
  // (docs/benchmarks/video-fast-mask.md). Multiclass needs the GPU (190 ms a frame on CPU).
  let delegate: 'GPU' | 'CPU' = model === 'selfie' ? 'CPU' : 'GPU';
  const loaded = await create(delegate).catch((error) => {
    if (delegate === 'CPU') throw error;
    delegate = 'CPU';
    return create('CPU');
  });
  // The first segment() compiles the delegate's shaders; pay it here, not on a live frame.
  loaded.segment(new ImageData(16, 16)).close();
  invert = model === 'multiclass';
  segmenter = loaded;
  return delegate;
}

self.onmessage = async (event: MessageEvent<PersonMaskRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    const started = performance.now();
    try {
      const delegate = await load(message.model, message.bytes, message.wasmBase);
      reply({ type: 'ready', delegate, setupMs: performance.now() - started });
    } catch (error) {
      reply({ type: 'error', id: null, message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (!segmenter) { reply({ type: 'error', id: message.id, message: 'segmenter not loaded' }); return; }
  try {
    const result = segmenter.segment(new ImageData(new Uint8ClampedArray(message.data), message.width, message.height));
    try {
      const mask = result.confidenceMasks?.[0];
      if (!mask) throw new Error('segmenter returned no confidence mask');
      const data = new Float32Array(mask.getAsFloat32Array());
      // multiclass: channel 0 is background, so person = 1 - background.
      if (invert) for (let i = 0; i < data.length; i++) data[i] = 1 - data[i];
      reply({ type: 'mask', id: message.id, width: mask.width, height: mask.height, data: data.buffer }, [data.buffer]);
    } finally { result.close(); }
  } catch (error) {
    reply({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
};
