import { onceRetry } from '../../depth.ts';
import { ilerlemeliGetir } from '../../indirmeIlerleme.ts';

/**
 * Fast per-frame person mask for live video (MediaPipe Image Segmenter), used while object
 * separation is on. Default `selfie` (selfie_segmenter, 256x256 float16, 0.25 MB);
 * `?hizliMaske=multiclass` (selfie_multiclass_256x256, float32, 16 MB; person = 1 - background);
 * `?hizliMaske=isnet` keeps the IS-Net-only path. Segmentation runs in a module Worker
 * (personMaskWorker.ts), so model set-up and per-frame work stay off the page.
 * LICENCE: both model cards say "LICENSED UNDER Apache License, Version 2.0".
 * Out of scope per the cards: several people at different scales, people beyond ~4 m.
 */
export type FastMaskModel = 'selfie' | 'multiclass';

export function fastMaskModel(search: string): FastMaskModel | null {
  const v = new URLSearchParams(search).get('hizliMaske');
  if (v === 'isnet') return null;
  return v === 'multiclass' ? 'multiclass' : 'selfie';
}

const MODEL_PATH: Record<FastMaskModel, string> = {
  selfie: '/models/mediapipe/selfie_segmenter.tflite',
  multiclass: '/models/mediapipe/selfie_multiclass_256x256.tflite',
};

const VITE_DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
const WASM_BASE = VITE_DEV ? '/node_modules/@mediapipe/tasks-vision/wasm' : '/mediapipe-wasm';

export type PersonMask = { data: Float32Array; width: number; height: number };
export type PersonMaskRequest =
  | { type: 'init'; model: FastMaskModel; bytes: ArrayBuffer; wasmBase: string }
  | { type: 'segment'; id: number; width: number; height: number; data: ArrayBuffer };
export type PersonMaskResponse =
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; setupMs: number }
  | { type: 'mask'; id: number; width: number; height: number; data: ArrayBuffer }
  | { type: 'error'; id: number | null; message: string };

/** A segment job longer than this is a hung worker: the fast path stops, IS-Net takes over. */
export const PERSON_MASK_TIMEOUT_MS = 2000;
/** Worker set-up (WASM + delegate) on a slow connection; past this the IS-Net path is kept. */
export const PERSON_MASK_SETUP_TIMEOUT_MS = 60_000;

type Job = { resolve: (mask: PersonMask | null) => void; reject: (error: Error) => void };

/** One running job and one replaceable latest frame; a replaced frame resolves null. */
export class PersonMaskWorker {
  broken: Error | null = null;
  private sequence = 0;
  private running: (Job & { id: number; timer: ReturnType<typeof setTimeout> }) | null = null;
  private pending: (Job & { frame: ImageData }) | null = null;
  private readonly worker: Worker;

  constructor(worker: Worker) {
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<PersonMaskResponse>) => this.receive(event.data);
    worker.onerror = (event) => this.fail(new Error(event.message || 'person mask worker failed'));
  }

  segment(frame: ImageData): Promise<PersonMask | null> {
    if (this.broken) return Promise.reject(this.broken);
    return new Promise((resolve, reject) => {
      if (!this.running) { this.start(frame, { resolve, reject }); return; }
      this.pending?.resolve(null);
      this.pending = { frame, resolve, reject };
    });
  }

  private start(frame: ImageData, job: Job) {
    const id = ++this.sequence;
    // The page keeps drawing from this frame; the worker gets its own copy.
    const data = frame.data.slice().buffer;
    const timer = setTimeout(() => this.fail(new Error('person mask worker timed out')), PERSON_MASK_TIMEOUT_MS);
    this.running = { ...job, id, timer };
    const request: PersonMaskRequest = { type: 'segment', id, width: frame.width, height: frame.height, data };
    this.worker.postMessage(request, [data]);
  }

  private receive(message: PersonMaskResponse) {
    const job = this.running;
    if (message.type === 'ready' || !job || message.id !== job.id) return;
    clearTimeout(job.timer);
    this.running = null;
    if (message.type === 'error') this.fail(new Error(message.message), job);
    else job.resolve({ data: new Float32Array(message.data), width: message.width, height: message.height });
    const next = this.pending;
    this.pending = null;
    if (next && !this.broken) this.start(next.frame, next);
    else next?.resolve(null);
  }

  private fail(error: Error, job = this.running) {
    if (this.running) clearTimeout(this.running.timer);
    this.broken = error;
    this.worker.terminate();
    job?.reject(error);
    this.pending?.reject(error);
    this.running = this.pending = null;
  }
}

const loaders = new Map<FastMaskModel, () => Promise<PersonMaskWorker>>();
/** One worker per model for the page; a broken one is replaced on the next request. */
export function loadPersonMaskWorker(model: FastMaskModel, createWorker = () =>
  new Worker(new URL('./personMaskWorker.ts', import.meta.url), { type: 'module' })): Promise<PersonMaskWorker> {
  let load = loaders.get(model);
  if (!load) {
    load = onceRetry(async () => {
      // Cache Storage + ETag (same as the other same-origin models): a plain path is re-downloaded
      // on every visit (measured: 16.4 MB again on the warm pass).
      const bytes = await ilerlemeliGetir(MODEL_PATH[model], 'hızlı maske modeli');
      const worker = createWorker();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('person mask worker set-up timed out')), PERSON_MASK_SETUP_TIMEOUT_MS);
        worker.onmessage = (event: MessageEvent<PersonMaskResponse>) => {
          if (event.data.type === 'ready') { clearTimeout(timer); resolve(); }
          else if (event.data.type === 'error') { clearTimeout(timer); reject(new Error(event.data.message)); }
        };
        worker.onerror = (event) => { clearTimeout(timer); reject(new Error(event.message || 'person mask worker failed')); };
        const request: PersonMaskRequest = { type: 'init', model, bytes, wasmBase: WASM_BASE };
        worker.postMessage(request, [bytes]);
      }).catch((error) => { worker.terminate(); throw error; });
      return new PersonMaskWorker(worker);
    });
    loaders.set(model, load);
  }
  return load().then((client) => {
    if (!client.broken) return client;
    loaders.delete(model);
    return loadPersonMaskWorker(model, createWorker);
  });
}
