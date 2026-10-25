export interface BufferedDepthFrame {
  data: Float32Array; width: number; height: number; mediaTime: number; mask?: Float32Array;
}
interface DepthCache {
  hasFrame(time: number): boolean;
  frameAt(time: number): Promise<BufferedDepthFrame | null>;
}

/**
 * Geç/başarısız okuma YALNIZ o kareyi düşürür (son hazır kare ekranda kalır).
 * Canlı derinliğe dönüş iki durumda: bölge hazır değil (`hasFrame` yanlış) ya da
 * `MISS_TOLERANCE_MS` boyunca hiç kare yayınlanamadı. Eskiden tek geç okuma
 * canlı V2'yi uyandırıyordu; ek yük sonraki okumayı da geciktiriyor, iki boru
 * hattı birlikte koşuyordu (inceleme F1).
 */
export const MISS_TOLERANCE_MS = 1000;
const STALE_SECONDS = 0.25;

/** Disk reads never queue decoded frames; seeking invalidates in-flight publications. */
export function createBufferedDepthReader(options: {
  cache: DepthCache;
  onFrame: (frame: BufferedDepthFrame) => void;
  onFallback?: (time: number) => void;
  onError?: (error: unknown) => void;
  currentTime?: () => number;
  now?: () => number;
}) {
  const now = options.now ?? (() => performance.now());
  let epoch = 0, busy = false, disposed = false, lastTime = -Infinity;
  let pending: number | null = null;
  let missSince: number | null = null;
  const softMiss = (time: number) => {
    missSince ??= now();
    if (now() - missSince >= MISS_TOLERANCE_MS) { missSince = null; options.onFallback?.(time); }
  };
  const submit = (time: number) => {
    if (disposed || !Number.isFinite(time)) return;
    // A hung read must not block forever; the busy read itself is never overlapped.
    if (busy) { pending = time; softMiss(time); return; }
    if (!options.cache.hasFrame(time)) { missSince = null; options.onFallback?.(time); return; }
    busy = true;
    const generation = epoch;
    void options.cache.frameAt(time).then(frame => {
      if (disposed || generation !== epoch || time < lastTime) return;
      if (!frame || (options.currentTime && Math.abs(options.currentTime() - time) > STALE_SECONDS)) {
        softMiss(time); return;
      }
      lastTime = time; missSince = null;
      options.onFrame({ ...frame, mediaTime: time });
    }).catch(error => {
      if (!disposed && generation === epoch) { options.onError?.(error); softMiss(time); }
    }).finally(() => {
      busy = false;
      const latest = pending;
      pending = null;
      if (latest !== null && !disposed) submit(latest);
    });
  };
  const reset = () => { epoch++; pending = null; lastTime = -Infinity; missSince = null; };
  return { submit, reset, dispose() { disposed = true; reset(); } };
}

/**
 * Hazır derinliği video karelerine bağlar. RENK OKUMASI YOK: hazır derinlik o
 * anki kareyle hizalı olduğundan parçacık rengi GPU'daki video dokusundan gelir.
 * Eskiden her karede 4K `drawImage` + `getImageData` (willReadFrequently) ~20 ms
 * ana iş parçacığı yiyordu (ölçüldü, inceleme F2).
 */
export function startBufferedVideoPlayback(video: HTMLVideoElement, cache: DepthCache, options: {
  onFrame: (frame: BufferedDepthFrame) => void;
  onFallback?: (time: number) => void;
  onError?: (error: unknown) => void;
  /** False (ör. nesne ayırma açık, maske izi yok) iken okuma yok, canlı derinliğe dönülür. */
  enabled?: () => boolean;
}): () => void {
  const reader = createBufferedDepthReader({ cache, ...options, currentTime: () => video.currentTime });
  let active = true, callback: number | null = null, animation: number | null = null, previousTime = -Infinity;
  const present = (time: number) => {
    if (!active || video.seeking || video.readyState < 2) return;
    if (options.enabled && !options.enabled()) { previousTime = -Infinity; options.onFallback?.(time); return; }
    if (time < previousTime) reader.reset();
    if (time === previousTime) return;
    previousTime = time;
    reader.submit(time);
  };
  const reset = () => { reader.reset(); previousTime = -Infinity; };
  video.addEventListener('seeking', reset);
  const seeked = () => present(video.currentTime);
  video.addEventListener('seeked', seeked);
  present(video.currentTime);
  if (typeof video.requestVideoFrameCallback === 'function') {
    const tick: VideoFrameRequestCallback = (_now, metadata) => {
      if (!active) return;
      present(metadata.mediaTime);
      callback = video.requestVideoFrameCallback(tick);
    };
    callback = video.requestVideoFrameCallback(tick);
  } else {
    const tick = () => {
      if (!active) return;
      present(video.currentTime);
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
  }
  return () => {
    active = false; reader.dispose(); video.removeEventListener('seeking', reset);
    video.removeEventListener('seeked', seeked);
    if (callback !== null) video.cancelVideoFrameCallback(callback);
    if (animation !== null) cancelAnimationFrame(animation);
  };
}
