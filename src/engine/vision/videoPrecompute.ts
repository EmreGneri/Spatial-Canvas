import { alignVideoWindow, blendVideoSeam, quantizeVideoDepth, transformVideoDepth, videoWindowIndices } from './videoPrecomputeWindow.ts';
import { vdaImza } from './videoDepthAnything.ts';
import { decodeVideoDepthSource } from './videoPrecomputeDecode.ts';
import { maskKeyFrames, propagateMaskInterval } from './videoMaskTrack.ts';
import type { LiveDepthFrame } from './liveDepthFlow.ts';

/** `mask`: nesne ayırma maske izi (varsa), derinlikle aynı ızgarada 0..1. */
export interface VideoDepthFrame { data: Float32Array; width: number; height: number; mediaTime: number; mask?: Float32Array }
/** Anahtar kare RGB'sinden derinlik ızgarası boyutunda maske; null = güvenilmez. */
export type VideoMaskCapture = (frame: LiveDepthFrame) => Promise<Float32Array | null>;
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
  /** Maske izi bu kare için hazır mı (nesne ayırma açıkken hazır derinlik kullanılabilir). */
  hasMask(time: number): boolean;
  /**
   * Hazır derinlik bittikten sonra maske izini üretir: her `MASK_KEY_INTERVAL` karede
   * bir segmentasyon, aradakiler iki yönlü akışla. Yalnız nesne ayırma istenince
   * çağrılır (varsayılan yolda ek GPU işi yok). Tekrar çağrı aynı işi döndürür.
   */
  prepareMasks(capture: VideoMaskCapture, onProgress?: (fraction: number) => void): Promise<void>;
  cancel(): void;
  dispose(): Promise<void>;
}
interface PrepareOptions {
  signal?: AbortSignal; onProgress?: (progress: VideoDepthProgress) => void; provider?: VideoWindowProvider;
  /** True while playback stutters: preparation waits (at most `PAUSE_MAX_MS` per step). */
  shouldPause?: () => boolean;
}
const PAUSE_MAX_MS = 1000;
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
/** Bu süreden kısa videolar sormadan hazırlanır; uzunlar için önce tahminle sorulur. */
export const AUTO_PREPARE_MAX_SECONDS = 120;
/** Ölçülen hazırlık hızı (RTX 5070, 4K ve 1080p): video süresinin ~3-4 katı. Kaba tahmin. */
const PREPARE_SECONDS_PER_VIDEO_SECOND = 4;
export function videoPreparationPolicy(durationSeconds: number, enabled: boolean): 'auto' | 'ask' | 'off' {
  if (!enabled || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 'off';
  return durationSeconds < AUTO_PREPARE_MAX_SECONDS ? 'auto' : 'ask';
}
export function estimatePreparationSeconds(durationSeconds: number): number {
  return Math.ceil(durationSeconds * PREPARE_SECONDS_PER_VIDEO_SECOND);
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
  /**
   * Aşama başına TEK dosya, sıralı yazım. Kare başına `createWritable` her seferinde
   * takas dosyası açıp kopyalıyordu: 4K 5 sn klipte 122 RGB yazımı 5.5 sn (kare başına
   * ~45 ms, Windows), çözme süresinin yarısından fazlası (ölçüldü, F21).
   */
  const open = new Set<FileSystemWritableFileStream>();
  const stream = async (name: string) => {
    aborted(signal);
    const handle = await dir!.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    open.add(writable);
    return {
      async write(data: ArrayBufferView) { aborted(signal); await writable.write(data as unknown as BufferSource); },
      async close() { open.delete(writable); await writable.close(); return handle.getFile(); },
    };
  };
  const slice = async (source: File, index: number, bytes: number) => source.slice(index * bytes, (index + 1) * bytes).arrayBuffer();
  const remove = async () => {
    ownedStores.delete(id);
    await Promise.all([...open].map(writable => writable.abort().catch(() => {}))); open.clear();
    if (root) await root.removeEntry(id, { recursive: true }).catch(() => {});
  };
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  /** Oynatma takılıyorsa kısa bekle; hazırlık sekmeyi dondurmasın (madde 4). */
  const yieldToPlayback = async () => {
    const until = performance.now() + PAUSE_MAX_MS;
    while (options.shouldPause?.() && performance.now() < until && !signal.aborted) await sleep(100);
    aborted(signal);
  };
  const depthFiles: File[] = [];
  const maskFiles: File[] = [];
  let rgbFile: File | null = null, maskReadyFrames = 0, maskJob: Promise<void> | null = null;
  const sceneOf = (index: number) => {
    let scene = 0;
    while (scene + 1 < scenes.length && scenes[scene + 1] <= index) scene++;
    return scene;
  };
  const indexAt = (time: number) => {
    if ((!ready && time >= readySeconds) || disposed || signal.aborted || !Number.isFinite(time) || time < 0 || time > duration) return -1;
    let low = 0, high = stamps.length;
    while (low < high) { const mid = (low + high) >>> 1; if (stamps[mid] <= time) low = mid + 1; else high = mid; }
    return Math.max(0, low - 1);
  };
  const done = (async () => {
    try {
      progress('loading'); aborted(signal);
      if (!navigator.storage?.getDirectory) throw Error('Yerel video depolaması yok; canlı derinlik kullanılıyor.');
      root = await navigator.storage.getDirectory();
      staleCleanup ??= removeStaleStores(root);
      await staleCleanup;
      dir = await root.getDirectoryHandle(id, { create: true });
      ({ width, height } = provider ?? OFFLINE_SIZE);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw Error('Offline derinlik boyutu geçersiz');
      const rgbBytes = width * height * 4, floatBytes = width * height * 4;
      const rgbStream = await stream('rgb');
      await decodeVideoDepthSource(file, width, height, signal, async sourceDuration => {
        duration = sourceDuration;
        const estimate = await navigator.storage.estimate();
        // Reserve temporary RGBA/float depth and final Uint16 at a conservative 60 fps.
        if ((estimate.quota ?? 0) - (estimate.usage ?? 0) < duration * 60 * width * height * 10) throw Error('Yerel video depolaması yetersiz; canlı derinlik kullanılıyor.');
        // Codec, aspect, duration and quota are accepted: only now pay for ORT and two GPU sessions.
        provider ??= await (await import('./videoPrecomputeProvider.ts')).openVideoWindowProvider();
        aborted(signal);
        if (provider.width !== width || provider.height !== height) throw Error('Offline derinlik boyutu geçersiz');
        progress('decoding');
      }, async (time, pixels) => {
        const signature = vdaImza(pixels, width, height);
        if (lastSignature && signature.reduce((sum, v, i) => sum + Math.abs(v - lastSignature![i]), 0) / 16 > 0.28) scenes.push(stamps.length);
        lastSignature = signature;
        if (pixels.length !== rgbBytes) throw Error('Çözülen kare boyutu beklenmedik');
        stamps.push(time); await rgbStream.write(pixels);
        processedSeconds = time; progress('decoding');
        await yieldToPlayback();
      });
      rgbFile = await rgbStream.close();
      if (!stamps.length || !provider) throw Error('Çözülen video karesi yok');
      progress('processing');
      scenes.push(stamps.length);
      for (let scene = 0; scene < scenes.length - 1; scene++) {
        const sceneStart = scenes[scene], sceneEnd = scenes[scene + 1], sceneCount = sceneEnd - sceneStart;
        let previous: number[] | undefined, refs: Float32Array[] = [], tail: Float32Array[] = [], count = sceneStart;
        const samples: number[] = [];
        const floatStream = await stream(`float-${scene}`);
        // Frames are committed strictly in order (count++), so the scene file is sequential.
        const commit = async (data: Float32Array, _index: number) => {
          for (const value of data) if (!Number.isFinite(value)) throw Error('Offline derinlik geçersiz');
          const stride = Math.max(1, Math.floor(data.length / RANGE_SAMPLES_PER_FRAME));
          for (let i = 0; i < data.length; i += stride) samples.push(data[i]);
          await floatStream.write(data);
        };
        // After the first window each one commits 22 frames and keeps an 8-frame tail:
        // a window whose new frames all lie in that tail commits nothing (F15).
        for (let start = 0; start === 0 || start + 10 < sceneCount; start += 22) {
          await yieldToPlayback();
          const ids = videoWindowIndices(start, sceneCount, previous);
          const frames = await Promise.all(ids.map(async i => new Uint8ClampedArray(await slice(rgbFile!, sceneStart + i, rgbBytes))));
          const output = await provider.infer(frames, signal, ids.map(i => sceneStart + i)); aborted(signal);
          if (output.length !== 32 || output.some(x => x.length !== width * height)) throw Error('Offline pencere 32 derinlik haritası döndürmeli');
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
        const floatFile = await floatStream.close();
        const depthStream = await stream(`depth-${scene}`);
        for (let i = 0; i < sceneCount; i++) {
          await depthStream.write(quantizeVideoDepth(new Float32Array(await slice(floatFile, i, floatBytes)), min, max));
        }
        depthFiles[scene] = await depthStream.close();
        await dir.removeEntry(`float-${scene}`);
        readySeconds = sceneEnd < stamps.length ? stamps[sceneEnd] : duration; progress('processing');
      }
      // RGB stays until dispose: an optional mask track (object separation) reads it.
      aborted(signal); ready = true; progress('ready');
    } catch (error) {
      ready = false; readySeconds = 0; await remove(); progress(signal.aborted ? 'cancelled' : 'fallback', error instanceof Error ? error.message : String(error));
    } finally { await provider?.dispose().catch(() => {}); options.signal?.removeEventListener('abort', cancel); }
  })();
  return {
    done, cancel, hasFrame: time => indexAt(time) >= 0,
    async frameAt(time) {
      const index = indexAt(time); if (index < 0) return null;
      try {
        const scene = sceneOf(index);
        const source = depthFiles[scene];
        if (!source) return null;
        const packed = new Uint16Array(await slice(source, index - scenes[scene], width * height * 2));
        if (packed.length !== width * height) return null;
        if (indexAt(time) < 0) return null;
        const data = new Float32Array(packed.length);
        for (let i = 0; i < packed.length; i++) data[i] = packed[i] / 65535;
        let mask: Float32Array | undefined;
        if (index < maskReadyFrames && maskFiles[scene]) {
          const bytes = new Uint8Array(await slice(maskFiles[scene], index - scenes[scene], width * height));
          if (bytes.length === width * height) {
            mask = new Float32Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) mask[i] = bytes[i] / 255;
          }
        }
        return { data, width, height, mediaTime: stamps[index], mask };
      } catch { return null; }
    },
    hasMask: time => { const index = indexAt(time); return index >= 0 && index < maskReadyFrames; },
    prepareMasks(capture, onProgress) {
      maskJob ??= (async () => {
        await done;
        if (!ready || !rgbFile) throw Error('Video derinliği hazır değil');
        const rgbBytes = width * height * 4, n = width * height;
        const frame = async (i: number): Promise<LiveDepthFrame> =>
          ({ width, height, data: new Uint8ClampedArray(await slice(rgbFile!, i, rgbBytes)) });
        const toBytes = (mask: Float32Array) => {
          const out = new Uint8Array(n);
          for (let i = 0; i < n; i++) out[i] = Math.round(Math.max(0, Math.min(1, mask[i])) * 255);
          return out;
        };
        let lastValid: Float32Array = new Float32Array(n).fill(1);
        const keyMask = async (i: number) => {
          await yieldToPlayback();
          const mask = await capture(await frame(i)); aborted(signal);
          if (mask && mask.length === n) lastValid = mask;
          return lastValid;
        };
        for (let scene = 0; scene < scenes.length - 1; scene++) {
          const keys = maskKeyFrames(scenes[scene], scenes[scene + 1]);
          const out = await stream(`mask-${scene}`);
          let startMask = await keyMask(keys[0]);
          for (let k = 0; k < keys.length; k++) {
            const a = keys[k], b = keys[k + 1];
            if (b === undefined) { await out.write(toBytes(startMask)); break; }
            const endMask = await keyMask(b);
            const frames = await Promise.all(Array.from({ length: b - a + 1 }, (_, j) => frame(a + j)));
            const masks = await propagateMaskInterval(frames, startMask, endMask, width, height, () => sleep(0));
            aborted(signal);
            for (let j = 0; j < masks.length - 1; j++) await out.write(toBytes(masks[j]));
            startMask = endMask;
          }
          maskFiles[scene] = await out.close();
          maskReadyFrames = scenes[scene + 1];
          onProgress?.(maskReadyFrames / stamps.length);
        }
      })();
      return maskJob;
    },
    async dispose() { disposed = true; cancel(); await done; await remove(); },
  };
}

