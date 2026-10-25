import { alignVideoWindow, blendVideoSeam, quantizeVideoDepth, transformVideoDepth, videoWindowIndices } from './videoPrecomputeWindow.ts';
import { vdaImza } from './videoDepthAnything.ts';
import { decodeVideoDepthSource } from './videoPrecomputeDecode.ts';

export interface VideoDepthFrame { data: Float32Array; width: number; height: number; mediaTime: number }
export interface VideoDepthProgress { stage: 'loading' | 'decoding' | 'processing' | 'ready' | 'fallback' | 'cancelled'; readySeconds: number; totalSeconds: number; processedSeconds?: number; error?: string }
export interface VideoWindowProvider {
  width: number; height: number;
  infer(frames: readonly Uint8ClampedArray[], signal?: AbortSignal, frameIds?: readonly number[]): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}
export interface VideoDepthHandle {
  done: Promise<void>;
  hasFrame(time: number): boolean;
  frameAt(time: number): Promise<VideoDepthFrame | null>;
  cancel(): void;
  dispose(): Promise<void>;
}
interface PrepareOptions { signal?: AbortSignal; onProgress?: (progress: VideoDepthProgress) => void; provider?: VideoWindowProvider }
function aborted(signal: AbortSignal): void { signal.throwIfAborted(); }
/** Gerçek offline başlığın girdi boyutu; sağlayıcı ancak kaynak kabul edilince açılır (F10). */
const OFFLINE_SIZE = { width: 266, height: 154 };
/** İlerleme en fazla ~4 Hz: her çözülen karede App'in tamamı yeniden çiziliyordu (F3). */
const PROGRESS_INTERVAL_MS = 250;
/** Sahne aralığı yüzdelikleri: tek aykırı piksel tüm sahneyi düzleştirmesin (F8). */
const RANGE_SAMPLES_PER_FRAME = 512;
const ownedStores = new Set<string>();
let staleCleanup: Promise<void> | null = null;
/**
 * Yeniden yükleme/çökme/sekme kapanışında `video-depth-*` klasörleri kalıyordu;
 * kota dolunca her hazırlık düşüyordu (F9). Sayfa başına bir kez, bu sekmenin
 * sahip olmadığı tüm klasörler silinir (uygulama tek sekmelik).
 */
async function removeStaleStores(root: FileSystemDirectoryHandle): Promise<void> {
  const names: string[] = [];
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (name.startsWith('video-depth-') && !ownedStores.has(name)) names.push(name);
  }
  await Promise.all(names.map(name => root.removeEntry(name, { recursive: true }).catch(() => {})));
}
export function videoDepthRange(samples: ArrayLike<number>): [number, number] {
  if (!samples.length) return [0, 0];
  const sorted = Float32Array.from(samples).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  return [at(0.01), at(0.99)];
}
/** Short-lived OPFS cache: cancelled/new clips never retain RGB or depth files. */
export async function prepareVideoDepth(file: Blob, options: PrepareOptions = {}): Promise<VideoDepthHandle> {
  const controller = new AbortController(), { signal } = controller;
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let root: FileSystemDirectoryHandle | undefined, dir: FileSystemDirectoryHandle | undefined;
  const id = `video-depth-${crypto.randomUUID()}`;
  ownedStores.add(id);
  let provider = options.provider, ready = false, disposed = false, duration = 0;
  const stamps: number[] = [];
  const scenes = [0];
  let lastSignature: Float32Array | null = null;
  let width = 0, height = 0, readySeconds = 0, processedSeconds = 0;
  let lastStage: VideoDepthProgress['stage'] | null = null, lastEmit = -Infinity;
  const progress = (stage: VideoDepthProgress['stage'], error?: string) => {
    const now = performance.now();
    if (stage === lastStage && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastStage = stage; lastEmit = now;
    options.onProgress?.({ stage, totalSeconds: duration, readySeconds: ready ? duration : readySeconds, processedSeconds, error });
  };
  const put = async (name: string, data: ArrayBuffer) => {
    aborted(signal);
    const writable = await (await dir!.getFileHandle(name, { create: true })).createWritable();
    try { await writable.write(data); await writable.close(); } catch (error) { await writable.abort().catch(() => {}); throw error; }
    aborted(signal);
  };
  const get = async (name: string) => (await (await dir!.getFileHandle(name)).getFile()).arrayBuffer();
  const remove = async () => { ownedStores.delete(id); if (root) await root.removeEntry(id, { recursive: true }).catch(() => {}); };
  const indexAt = (time: number) => {
    if ((!ready && time >= readySeconds) || disposed || signal.aborted || !Number.isFinite(time) || time < 0 || time > duration) return -1;
    let low = 0, high = stamps.length;
    while (low < high) { const mid = (low + high) >>> 1; if (stamps[mid] <= time) low = mid + 1; else high = mid; }
    return Math.max(0, low - 1);
  };
  const done = (async () => {
    try {
      progress('loading'); aborted(signal);
      if (!navigator.storage?.getDirectory) throw Error('Local video storage unavailable; using V2.');
      root = await navigator.storage.getDirectory();
      staleCleanup ??= removeStaleStores(root);
      await staleCleanup;
      dir = await root.getDirectoryHandle(id, { create: true });
      ({ width, height } = provider ?? OFFLINE_SIZE);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw Error('Invalid offline depth dimensions');
      await decodeVideoDepthSource(file, width, height, signal, async sourceDuration => {
        duration = sourceDuration;
        const estimate = await navigator.storage.estimate();
        // Reserve temporary RGBA/float depth and final Uint16 at a conservative 60 fps.
        if ((estimate.quota ?? 0) - (estimate.usage ?? 0) < duration * 60 * width * height * 10) throw Error('Insufficient local video storage; using V2.');
        // Codec, aspect, duration and quota are accepted: only now pay for ORT and two GPU sessions.
        provider ??= await (await import('./videoPrecomputeProvider.ts')).openVideoWindowProvider();
        aborted(signal);
        if (provider.width !== width || provider.height !== height) throw Error('Invalid offline depth dimensions');
        progress('decoding');
      }, async (time, pixels) => {
        const signature = vdaImza(pixels, width, height);
        if (lastSignature && signature.reduce((sum, v, i) => sum + Math.abs(v - lastSignature![i]), 0) / 16 > 0.28) scenes.push(stamps.length);
        lastSignature = signature;
        stamps.push(time); await put(`rgb-${stamps.length - 1}`, pixels.buffer as ArrayBuffer);
        processedSeconds = time; progress('decoding');
      });
      if (!stamps.length || !provider) throw Error('No decoded video frames');
      progress('processing');
      scenes.push(stamps.length);
      for (let scene = 0; scene < scenes.length - 1; scene++) {
        const sceneStart = scenes[scene], sceneEnd = scenes[scene + 1], sceneCount = sceneEnd - sceneStart;
        let previous: number[] | undefined, refs: Float32Array[] = [], tail: Float32Array[] = [], count = sceneStart;
        const samples: number[] = [];
        const commit = async (data: Float32Array, index: number) => {
          for (const value of data) if (!Number.isFinite(value)) throw Error('Invalid offline depth');
          const stride = Math.max(1, Math.floor(data.length / RANGE_SAMPLES_PER_FRAME));
          for (let i = 0; i < data.length; i += stride) samples.push(data[i]);
          await put(`float-${index}`, data.buffer as ArrayBuffer);
        };
        // After the first window each one commits 22 frames and keeps an 8-frame tail:
        // a window whose new frames all lie in that tail commits nothing (F15).
        for (let start = 0; start === 0 || start + 10 < sceneCount; start += 22) {
          aborted(signal);
          const ids = videoWindowIndices(start, sceneCount, previous);
          const frames = await Promise.all(ids.map(async i => new Uint8ClampedArray(await get(`rgb-${sceneStart + i}`))));
          const output = await provider.infer(frames, signal, ids.map(i => sceneStart + i)); aborted(signal);
          if (output.length !== 32 || output.some(x => x.length !== width * height)) throw Error('Offline window must return 32 depth maps');
          if (!previous) {
            refs = [output[0], output[12]];
            for (let i = 0; i < 24; i++) { if (count < sceneEnd) await commit(output[i], count++); }
            tail = output.slice(24);
          } else {
            const [scale, shift] = alignVideoWindow(output.slice(0, 2), refs);
            const aligned = output.map(x => transformVideoDepth(x, scale, shift));
            for (let i = 0; i < 8; i++) { if (count < sceneEnd) await commit(blendVideoSeam(tail[i], aligned[i + 2], i), count++); }
            for (let i = 10; i < 24; i++) { if (count < sceneEnd) await commit(aligned[i], count++); }
            tail = aligned.slice(24); refs = [refs[0], aligned[12]];
          }
          previous = ids;
          processedSeconds = stamps[Math.min(count, sceneEnd - 1)]; progress('processing');
        }
        for (const data of tail) { if (count < sceneEnd) await commit(data, count++); }
        // A shared scene range preserves relative depth over time. Never normalize each frame independently.
        const [min, max] = videoDepthRange(samples);
        for (let i = sceneStart; i < sceneEnd; i++) {
          const packed = quantizeVideoDepth(new Float32Array(await get(`float-${i}`)), min, max);
          await put(`depth-${i}`, packed.buffer as ArrayBuffer);
          await dir.removeEntry(`float-${i}`); await dir.removeEntry(`rgb-${i}`);
        }
        readySeconds = sceneEnd < stamps.length ? stamps[sceneEnd] : duration; progress('processing');
      }
      aborted(signal); ready = true; progress('ready');
    } catch (error) {
      ready = false; readySeconds = 0; await remove(); progress(signal.aborted ? 'cancelled' : 'fallback', String(error));
    } finally { await provider?.dispose().catch(() => {}); options.signal?.removeEventListener('abort', cancel); }
  })();
  return {
    done, cancel, hasFrame: time => indexAt(time) >= 0,
    async frameAt(time) {
      const index = indexAt(time); if (index < 0) return null;
      try {
        const packed = new Uint16Array(await get(`depth-${index}`));
        if (packed.length !== width * height) return null;
        if (indexAt(time) < 0) return null;
        const data = new Float32Array(packed.length);
        for (let i = 0; i < packed.length; i++) data[i] = packed[i] / 65535;
        return { data, width, height, mediaTime: stamps[index] };
      } catch { return null; }
    },
    async dispose() { disposed = true; cancel(); await done; await remove(); },
  };
}

