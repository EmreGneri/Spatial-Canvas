// VDA vs V2-small through the REAL live path (`estimateDepthLive` + the
// driver's flow stabilization). Model choice comes from the page URL
// (`?videoDerinlik=vda`), exactly as in the app. Frames are seeked, not
// played, so both models see identical frames at the live cadence `stride`.
// Driven by scripts/bench-vda-quality.mjs; metrics are computed in Node.
import { estimateDepthLive, isitLiveModel, LIVE_INPUT_SIZE, resetLiveDepthState } from '../engine/vision/liveDepth.ts';
import { stabilizeLiveDepthPair } from '../engine/vision/liveDepthFlow.ts';

export interface VdaKiyasAyar { clip: string; fps: number; startFrame: number; stride: number; count: number }

const b64 = (a: ArrayBufferView) => {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

function watchAdapters() {
  const seen: { at: string; info: Record<string, string> }[] = [];
  const gpu = (navigator as unknown as { gpu?: GPU }).gpu;
  if (!gpu) return seen;
  const describe = (a: GPUAdapter) => ({ vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description, device: a.info.device });
  const proto = Object.getPrototypeOf(gpu) as GPU;
  const requestAdapter = proto.requestAdapter;
  proto.requestAdapter = async function (this: GPU, ...args: Parameters<GPU['requestAdapter']>) {
    const adapter = await requestAdapter.apply(this, args);
    if (adapter && !(adapter as unknown as { __hooked?: boolean }).__hooked) {
      (adapter as unknown as { __hooked?: boolean }).__hooked = true;
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async (...d: Parameters<GPUAdapter['requestDevice']>) => {
        const device = await requestDevice(...d);
        seen.push({ at: 'requestDevice', info: describe(adapter) });
        void device.lost.then((l) => console.error(`GPU device lost: ${l.reason} ${l.message}`));
        return device;
      };
    }
    return adapter;
  };
  return seen;
}

async function seek(video: HTMLVideoElement, time: number): Promise<number | null> {
  const presented = new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 2000);
    video.requestVideoFrameCallback((_n, m) => { clearTimeout(timer); resolve(m.mediaTime); });
  });
  const seeked = new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
  video.currentTime = time;
  await seeked;
  return presented;
}

export async function runVdaKiyas(ayar: VdaKiyasAyar, status: (s: string) => void) {
  const adapters = watchAdapters();
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = ayar.clip;
  document.body.append(video);
  video.style.width = '320px';
  await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('video load failed')); });
  const warmStart = performance.now();
  await isitLiveModel();
  const warmupMs = performance.now() - warmStart;
  resetLiveDepthState();
  const rgbCanvas = document.createElement('canvas');
  const rgbCtx = rgbCanvas.getContext('2d', { willReadFrequently: true })!;
  const frames = [];
  let previous: { data: Float32Array; colorFrame?: ImageData; width: number; height: number; mediaTime: number } | null = null;
  for (let k = 0; k < ayar.count; k++) {
    const index = ayar.startFrame + k * ayar.stride;
    if ((index + 0.5) / ayar.fps >= video.duration) break;
    const presented = await seek(video, (index + 0.5) / ayar.fps);
    const r = await estimateDepthLive(video, { girdi: LIVE_INPUT_SIZE });
    let chain = r.data;
    if (previous && r.mediaTime > previous.mediaTime && previous.width === r.width && previous.height === r.height) {
      chain = stabilizeLiveDepthPair(previous.data, r.data, previous.colorFrame, r.colorFrame, r.width, r.height).depth;
    }
    previous = { data: chain, colorFrame: r.colorFrame, width: r.width, height: r.height, mediaTime: r.mediaTime };
    rgbCanvas.width = r.width;
    rgbCanvas.height = r.height;
    rgbCtx.drawImage(video, 0, 0, r.width, r.height);
    const rgba = rgbCtx.getImageData(0, 0, r.width, r.height).data;
    const rgb = new Uint8Array(r.width * r.height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]; }
    frames.push({
      index, presented, mediaTime: r.mediaTime, model: r.depthModel, inferenceMs: r.inferenceMs,
      width: r.width, height: r.height, raw: b64(r.modelOutput.data), chain: b64(chain), rgb: b64(rgb),
    });
    status(`${k + 1}/${ayar.count} ${r.depthModel} ${r.inferenceMs.toFixed(0)} ms`);
  }
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
  return { adapters, visibility: document.visibilityState, hasFocus: document.hasFocus(), warmupMs, memory, video: { w: video.videoWidth, h: video.videoHeight, duration: video.duration }, frames };
}
