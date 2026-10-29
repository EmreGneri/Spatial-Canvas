import { computeOpticalFlow } from './flow.ts';
import { densifyFlow } from './temporal.ts';
import { fitScaleAlignment } from './scale.ts';
import { resampleBilinear } from '../reconstruction/silhouette.ts';

export interface LiveDepthFrame { data: Uint8ClampedArray; width: number; height: number }
export interface LiveDepthFlowInput {
  depth: Float32Array; previousFrame: LiveDepthFrame; currentFrame: LiveDepthFrame;
  width: number; height: number; mediaTime: number; modelMediaTime?: number; fieldOnly?: boolean;
  mask?: { data: Float32Array; width: number; height: number; colorFrame?: LiveDepthFrame; mediaTime?: number };
}
export interface LiveDepthFlowResult {
  depth: Float32Array; confidence: Float32Array; coverage: number;
  mask?: Float32Array;
  sceneCut?: boolean;
  /** `fieldOnly` requests (depth advance): the trusted backward flow, no depth. */
  field?: LiveFlowField;
}
/** Backward flow (current -> previous frame) on a <=112 px grid; `trusted` is 0/1. */
export interface LiveFlowField { fw: number; fh: number; u: Float32Array; v: Float32Array; trusted: Float32Array }
const MAX_FLOW_EDGE = 112;
const SCENE_CUT_MEAN_DELTA = 0.24;
export const LIVE_DEPTH_MAX_AGE_SECONDS = 0.75;
/**
 * Ara kare (akış) en fazla ~12 Hz: her ara kare tam bir `setDepth` (~10 ms ana
 * iş parçacığı) + geri okuma demek. Her video karesinde yapılınca varsayılan
 * canlı yol 110abf4 öncesinden yavaştı (inceleme F5).
 */
export const LIVE_INTERPOLATION_MIN_INTERVAL_SECONDS = 1 / 12;
/**
 * Ara kare VARSAYILAN KAPALI (`?araKare=1` ile açılır). 4K klipte görünür
 * Chrome ölçümü (RTX 5070, 2026-10-25): kapalı ~53 FPS / 9 model Hz, açık (12 Hz
 * tavanla bile) ~42 FPS / 6 model Hz; 110abf4 öncesi ~58 FPS. Ara karenin
 * setDepth'i (~16 ms) model karelerinden pahalı ve model hızını da düşürüyor.
 */
export function liveInterpolationEnabled(search: string = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).get('araKare') === '1';
}
/**
 * Deney, VARSAYILAN KAPALI (`?derinlikIlerlet=1`): her model derinliği, sunulmadan
 * önce akışla o anki video karesine taşınır (ekstra çıkarım ya da setDepth yok).
 * Ölçüm: docs/benchmarks/video-depth-advance.md.
 */
export function depthAdvanceEnabled(search: string = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).get('derinlikIlerlet') === '1';
}
/** Below this the warp is no better than the model frame; present the model frame instead. */
export function isDepthAdvanceUsable(result: LiveDepthFlowResult): boolean {
  return !result.sceneCut && result.coverage >= 0.12;
}
export function isLiveInterpolationDue(mediaTime: number, lastShownTime: number): boolean {
  return mediaTime - lastShownTime >= LIVE_INTERPOLATION_MIN_INTERVAL_SECONDS - 0.005;
}
export function shouldPresentLiveDepth(mediaTime: number, displayedTime: number): boolean {
  return Number.isFinite(mediaTime) && mediaTime >= displayedTime;
}
/** Maximum per-channel difference protects local movement from averaging away. */
export function isLiveFrameUnchanged(a: LiveDepthFrame | undefined, b: LiveDepthFrame | undefined): boolean {
  if (!a || !b || a.width < 1 || a.height < 1 || a.width !== b.width || a.height !== b.height
    || a.data.length !== a.width * a.height * 4 || b.data.length !== a.data.length) return false;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > 2 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 2
      || Math.abs(a.data[i + 2] - b.data[i + 2]) > 2) return false;
  }
  return true;
}
export function isLiveDepthResultStale(mediaTime: number, currentTime: number): boolean {
  return Number.isFinite(mediaTime) && Number.isFinite(currentTime)
    && currentTime - mediaTime > LIVE_DEPTH_MAX_AGE_SECONDS;
}
function toLuminance(frame: LiveDepthFrame, width: number, height: number): Float32Array {
  const rgb = new Float32Array(frame.width * frame.height);
  for (let i = 0; i < rgb.length; i++) {
    const k = i * 4;
    rgb[i] = (0.2126 * frame.data[k] + 0.7152 * frame.data[k + 1] + 0.0722 * frame.data[k + 2]) / 255;
  }
  return frame.width === width && frame.height === height ? rgb
    : resampleBilinear(rgb, frame.width, frame.height, width, height);
}
function sample(data: Float32Array, w: number, h: number, x: number, y: number): number {
  x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  // Zero-weight corners do not require coverage; Infinity * 0 would erase a valid sample.
  const top = fx === 0 ? data[y0 * w + x0]
    : data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  if (!Number.isFinite(top)) return NaN;
  if (fy === 0) return top;
  const bottom = fx === 0 ? data[y1 * w + x0]
    : data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return Number.isFinite(bottom) ? top * (1 - fy) + bottom * fy : NaN;
}
export { sample as sampleLiveFlowBilinear };
/** Flow part of `propagateLiveDepth`, for a `width` x `height` target grid. */
export function liveFlowField(
  previousFrame: LiveDepthFrame, currentFrame: LiveDepthFrame, width: number, height: number,
): LiveFlowField | 'scene-cut' | null {
  const scale = Math.min(1, MAX_FLOW_EDGE / Math.max(width, height));
  const fw = Math.max(2, Math.round(width * scale)), fh = Math.max(2, Math.round(height * scale));
  const oldLuma = toLuminance(previousFrame, fw, fh), newLuma = toLuminance(currentFrame, fw, fh);
  let delta = 0;
  for (let i = 0; i < oldLuma.length; i++) delta += Math.abs(oldLuma[i] - newLuma[i]);
  if (delta / oldLuma.length > SCENE_CUT_MEAN_DELTA) return 'scene-cut';
  const options = { maxCorners: 80, pyramidLevels: 2, windowRadius: 4 };
  const forward = computeOpticalFlow(oldLuma, newLuma, fw, fh, options).filter(p => p.status === 1);
  const backward = computeOpticalFlow(newLuma, oldLuma, fw, fh, options).filter(p => p.status === 1);
  if (forward.length < 12 || backward.length < 12) return null;
  const fwd = densifyFlow(forward, fw, fh, 9), bwd = densifyFlow(backward, fw, fh, 9);
  const trusted = new Float32Array(fw * fh);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const i = y * fw + x, px = x + bwd.u[i], py = y + bwd.v[i];
    if (px < 0 || py < 0 || px > fw - 1 || py > fh - 1 || bwd.d2[i] > 81
      || !(sample(fwd.d2, fw, fh, px, py) <= 81)) continue;
    const error = Math.hypot(bwd.u[i] + sample(fwd.u, fw, fh, px, py), bwd.v[i] + sample(fwd.v, fw, fh, px, py));
    if (error <= 0.3 && Math.abs(newLuma[i] - sample(oldLuma, fw, fh, px, py)) < 0.12) trusted[i] = 1;
  }
  return { fw, fh, u: bwd.u, v: bwd.v, trusted };
}
/** Backward flow is evaluated at destination pixels; newly exposed pixels have zero confidence. */
export function propagateLiveDepth(
  previousDepth: Float32Array, previousFrame: LiveDepthFrame | undefined,
  currentFrame: LiveDepthFrame | undefined, width: number, height: number,
  previousMask?: Float32Array,
): LiveDepthFlowResult {
  const empty = (): LiveDepthFlowResult => ({ depth: previousDepth, confidence: new Float32Array(previousDepth.length), coverage: 0 });
  if (!previousFrame || !currentFrame || width < 2 || height < 2 || previousFrame.width < 2 || previousFrame.height < 2
    || previousFrame.width !== currentFrame.width || previousFrame.height !== currentFrame.height
    || previousDepth.length !== width * height
    || previousFrame.data.length !== previousFrame.width * previousFrame.height * 4
    || currentFrame.data.length !== currentFrame.width * currentFrame.height * 4) return empty();
  if (isLiveFrameUnchanged(previousFrame, currentFrame)) {
    return { depth: new Float32Array(previousDepth), confidence: new Float32Array(previousDepth.length).fill(1),
      coverage: 1, mask: previousMask?.length === previousDepth.length ? new Float32Array(previousMask) : undefined };
  }
  const field = liveFlowField(previousFrame, currentFrame, width, height);
  if (field === 'scene-cut') return { ...empty(), sceneCut: true };
  if (!field) return empty();
  const { fw, fh, u: bwdU, v: bwdV, trusted } = field;
  const depth = new Float32Array(previousDepth), confidence = new Float32Array(previousDepth.length);
  const mask = previousMask?.length === previousDepth.length ? new Float32Array(previousDepth.length) : undefined;
  let covered = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, fx = x * (fw - 1) / (width - 1), fy = y * (fh - 1) / (height - 1);
    if (sample(trusted, fw, fh, fx, fy) < 0.99) continue;
    const px = x + sample(bwdU, fw, fh, fx, fy) * (width - 1) / (fw - 1);
    const py = y + sample(bwdV, fw, fh, fx, fy) * (height - 1) / (fh - 1);
    depth[i] = sample(previousDepth, width, height, px, py); confidence[i] = 1;
    if (mask) mask[i] = sample(previousMask!, width, height, px, py);
    covered++;
  }
  return { depth, confidence, coverage: covered / depth.length, mask };
}
/** Extrapolation cap, in model-frame intervals: past this a constant-velocity guess is noise. */
export const DEPTH_ADVANCE_MAX_STEPS = 1.5;
/** Worker side of `?derinlikIlerlet=1`: flow between two model RGB frames, no depth. */
export function liveFlowFieldResult(previousFrame: LiveDepthFrame, currentFrame: LiveDepthFrame, width: number, height: number): LiveDepthFlowResult {
  const none = { depth: new Float32Array(0), confidence: new Float32Array(0) };
  if (previousFrame.width !== currentFrame.width || previousFrame.height !== currentFrame.height || width < 2 || height < 2) return { ...none, coverage: 0 };
  const field = liveFlowField(previousFrame, currentFrame, width, height);
  if (field === 'scene-cut') return { ...none, coverage: 0, sceneCut: true };
  if (!field) return { ...none, coverage: 0 };
  let trusted = 0;
  for (const t of field.trusted) trusted += t;
  return { ...none, coverage: trusted / field.trusted.length, field };
}
/**
 * Constant-velocity extrapolation: each pixel samples `src` `k` backward-flow steps
 * upstream (k = lead time / last model interval). Untrusted pixels keep `src`: no
 * holes and no invented depth, but a moving edge can lag there. channels: 1 or 4.
 */
export function advanceByField<T extends Float32Array | Uint8ClampedArray>(
  src: T, width: number, height: number, channels: number, field: LiveFlowField, k: number,
): T {
  const out = src.slice() as T;
  const { fw, fh, u, v, trusted } = field;
  const sx = (width - 1) / (fw - 1), sy = (height - 1) / (fh - 1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const fx = x / sx, fy = y / sy;
    if (sample(trusted, fw, fh, fx, fy) < 0.99) continue;
    const px = Math.max(0, Math.min(width - 1, x + k * sample(u, fw, fh, fx, fy) * sx));
    const py = Math.max(0, Math.min(height - 1, y + k * sample(v, fw, fh, fx, fy) * sy));
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const ax = px - x0, ay = py - y0, o = (y * width + x) * channels;
    const a = (y0 * width + x0) * channels, b = (y0 * width + x1) * channels;
    const c = (y1 * width + x0) * channels, d = (y1 * width + x1) * channels;
    for (let ch = 0; ch < channels; ch++) {
      out[o + ch] = (src[a + ch] * (1 - ax) + src[b + ch] * ax) * (1 - ay) + (src[c + ch] * (1 - ax) + src[d + ch] * ax) * ay;
    }
  }
  return out;
}
/** Model scale/shift alignment uses only trustworthy correspondences before a short EMA. */
export function stabilizeLiveDepthPair(
  previousDepth: Float32Array, currentDepth: Float32Array,
  previousFrame: LiveDepthFrame | undefined, currentFrame: LiveDepthFrame | undefined,
  depthWidth: number, depthHeight: number,
): { depth: Float32Array; coverage: number; sceneCut?: boolean } {
  if (previousDepth.length !== currentDepth.length) return { depth: currentDepth, coverage: 0 };
  const propagated = propagateLiveDepth(previousDepth, previousFrame, currentFrame, depthWidth, depthHeight);
  if (propagated.coverage < 0.12) return { depth: currentDepth, coverage: propagated.coverage, sceneCut: propagated.sceneCut };
  const pairs: Array<{ dPred: number; dMetric: number }> = [];
  const stride = Math.max(1, Math.floor(currentDepth.length / 1500));
  for (let i = 0; i < currentDepth.length; i += stride) if (propagated.confidence[i]) {
    pairs.push({ dPred: currentDepth[i], dMetric: propagated.depth[i] });
  }
  const fit = fitScaleAlignment(pairs);
  const usableFit = fit && fit.scaleA > 0.5 && fit.scaleA < 2 && Math.abs(fit.scaleB) < 0.3;
  const depth = new Float32Array(currentDepth);
  for (let i = 0; i < depth.length; i++) {
    const aligned = usableFit ? fit.scaleA * currentDepth[i] + fit.scaleB : currentDepth[i];
    depth[i] = Math.max(0, Math.min(1, propagated.confidence[i]
      ? 0.45 * propagated.depth[i] + 0.55 * aligned : aligned));
  }
  return { depth, coverage: propagated.coverage };
}
