export interface BufferedDepthFrame {
  data: Float32Array; width: number; height: number; mediaTime: number;
}
interface DepthCache {
  hasFrame(time: number): boolean;
  frameAt(time: number): Promise<BufferedDepthFrame | null>;
}
export interface BufferedPresentedFrame extends BufferedDepthFrame { colorFrame: ImageData }

/** Disk reads never queue decoded frames; seeking invalidates in-flight publications. */
export function createBufferedDepthReader(options: {
  cache: DepthCache;
  onFrame: (frame: BufferedPresentedFrame) => void;
  onFallback?: (time: number) => void;
  onError?: (error: unknown) => void;
  currentTime?: () => number;
}) {
  let epoch = 0, busy = false, disposed = false, lastTime = -Infinity;
  let pending: { time: number; color: ImageData } | null = null;
  const submit = (time: number, color: ImageData) => {
    if (disposed || !Number.isFinite(time)) return;
    if (busy) { pending = { time, color }; return; }
    if (!options.cache.hasFrame(time)) { options.onFallback?.(time); return; }
    busy = true;
    const generation = epoch;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([
      options.cache.frameAt(time),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Depth cache read timed out')), 1500); }),
    ]).then(frame => {
      if (disposed || generation !== epoch || time < lastTime) return;
      if (options.currentTime && Math.abs(options.currentTime() - time) > 0.25) {
        options.onFallback?.(time); return;
      }
      if (!frame) { options.onFallback?.(time); return; }
      lastTime = time;
      options.onFrame({ ...frame, mediaTime: time, colorFrame: color });
    }).catch(error => {
      if (!disposed && generation === epoch) { options.onError?.(error); options.onFallback?.(time); }
    }).finally(() => {
      clearTimeout(timeout);
      busy = false;
      const latest = pending;
      pending = null;
      if (latest) submit(latest.time, latest.color);
    });
  };
  const reset = () => { epoch++; pending = null; lastTime = -Infinity; };
  return { submit, reset, dispose() { disposed = true; reset(); } };
}

export function startBufferedVideoPlayback(video: HTMLVideoElement, cache: DepthCache, options: {
  onFrame: (frame: BufferedPresentedFrame) => void;
  onFallback?: (time: number) => void;
  onError?: (error: unknown) => void;
}): () => void {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Cannot capture buffered video color');
  const reader = createBufferedDepthReader({ cache, ...options, currentTime: () => video.currentTime });
  let active = true, callback: number | null = null, animation: number | null = null, previousTime = -Infinity;
  const present = (time: number) => {
    if (!active || video.seeking || video.readyState < 2) return;
    if (time < previousTime) reader.reset();
    if (time === previousTime) return;
    previousTime = time;
    if (!cache.hasFrame(time)) { options.onFallback?.(time); return; }
    const scale = Math.min(1, 384 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.drawImage(video, 0, 0, width, height);
    reader.submit(time, context.getImageData(0, 0, width, height));
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
    canvas.width = canvas.height = 0;
  };
}
