import type { DepthEstimateOptions } from '../../depth.ts';
import type { SegmentationResult } from '../reconstruction/segmentation.ts';
import { maskeKaydir } from './liveDepth.ts';

type RgbaFrame = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };
/** Tracking grid (long side). The live colour frames are ~384 px; 96 is enough for a shift. */
const TRACK_GRID = 96;
/** Search radius as a fraction of the grid's long side (12 grid px). */
const TRACK_SEARCH = 0.125;
/**
 * Best match error relative to the template's own contrast (mean |luma - mean| inside the mask)
 * above which no shift explains the frame: the subject is no longer where the mask says.
 */
export const MASK_TRACK_LOST = 0.6;

function gridLuma(frame: RgbaFrame, gw: number, gh: number): Float32Array {
  const out = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const sy = Math.min(frame.height - 1, Math.floor((y + 0.5) * frame.height / gh));
    for (let x = 0; x < gw; x++) {
      const k = (sy * frame.width + Math.min(frame.width - 1, Math.floor((x + 0.5) * frame.width / gw))) * 4;
      out[y * gw + x] = (0.299 * frame.data[k] + 0.587 * frame.data[k + 1] + 0.114 * frame.data[k + 2]) / 255;
    }
  }
  // 3x3 box blur: the coarse (step 2) search needs a cost that varies smoothly with the shift.
  const blur = new Float32Array(out.length);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, y - 1); j <= Math.min(gh - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(gw - 1, x + 1); i++) { sum += out[j * gw + i]; n++; }
    blur[y * gw + x] = sum / n;
  }
  return blur;
}

/**
 * Where did the masked region of `from` (the frame the mask was computed on) move to in `to`?
 * Block matching of the masked pixels (zero-mean, so a lighting change is not motion) on a
 * small grid, coarse step 2 then refined. Returns the shift in mask-normalised units and the
 * match error; `lost` means no shift explains the frame (cut, occlusion, subject left).
 * ponytail: translation only — limbs that move against the body still lag until the next refresh.
 */
export function estimateMaskShift(
  mask: { data: Float32Array; width: number; height: number }, from: RgbaFrame, to: RgbaFrame,
): { dx: number; dy: number; /** best error / template contrast */ error: number; lost: boolean } | null {
  if (from.width !== to.width || from.height !== to.height) return null;
  const s = TRACK_GRID / Math.max(from.width, from.height);
  const gw = Math.max(8, Math.round(from.width * s)), gh = Math.max(8, Math.round(from.height * s));
  const a = gridLuma(from, gw, gh), b = gridLuma(to, gw, gh);
  const idx: number[] = [];
  let mean = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const m = mask.data[Math.min(mask.height - 1, Math.floor((y + 0.5) * mask.height / gh)) * mask.width
      + Math.min(mask.width - 1, Math.floor((x + 0.5) * mask.width / gw))];
    if (m >= 0.5) { idx.push(y * gw + x); mean += a[y * gw + x]; }
  }
  if (idx.length < 12) return null;
  mean /= idx.length;
  let contrast = 0;
  for (const i of idx) contrast += Math.abs(a[i] - mean);
  contrast = Math.max(1e-3, contrast / idx.length);
  const R = Math.round(TRACK_SEARCH * Math.max(gw, gh));
  const cost = (dx: number, dy: number) => {
    let sum = 0, n = 0, mb = 0;
    for (const i of idx) {
      const x = i % gw + dx, y = (i / gw | 0) + dy;
      if (x >= 0 && y >= 0 && x < gw && y < gh) { mb += b[y * gw + x]; n++; }
    }
    if (n < idx.length * 0.6) return Infinity;
    mb /= n;
    for (const i of idx) {
      const x = i % gw + dx, y = (i / gw | 0) + dy;
      if (x >= 0 && y >= 0 && x < gw && y < gh) sum += Math.abs(a[i] - mean - (b[y * gw + x] - mb));
    }
    return sum / n;
  };
  let best = { dx: 0, dy: 0, e: cost(0, 0) };
  for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
    const e = cost(dx, dy);
    if (e < best.e) best = { dx, dy, e };
  }
  const c = best;
  for (let dy = c.dy - 1; dy <= c.dy + 1; dy++) for (let dx = c.dx - 1; dx <= c.dx + 1; dx++) {
    const e = cost(dx, dy);
    if (e < best.e) best = { dx, dy, e };
  }
  const error = best.e / contrast;
  return { dx: best.dx / gw, dy: best.dy / gh, error, lost: !(error <= MASK_TRACK_LOST) };
}

/** The captured mask moved by `shift` (normalised); the captured data stays untouched. */
export function shiftLiveMask(
  mask: { data: Float32Array; width: number; height: number }, shift: { dx: number; dy: number },
): Float32Array {
  return maskeKaydir(mask.data, mask.width, mask.height, shift.dx * mask.width, shift.dy * mask.height);
}

export type LiveMaskResult = {
  data: Float32Array;
  width: number;
  height: number;
  model: SegmentationResult['model'] | 'david';
};

type MaskDependencies = {
  selection: DepthEstimateOptions['insanMaskesi'];
  /** 'foto' = BiRefNet chain (sidecar), 'video' = IS-Net (browser-only visitors). */
  quality?: 'foto' | 'video';
  segmentForeground: (
    source: HTMLCanvasElement, device: 'wasm' | 'webgpu', quality: 'foto' | 'video',
  ) => Promise<SegmentationResult>;
  applyDavidMask: (
    selection: DepthEstimateOptions['insanMaskesi'], source: HTMLCanvasElement,
    mask: Float32Array, width: number, height: number,
  ) => Promise<{ maske: Float32Array } | null>;
};

/** Browser-only visitors: fetch the IS-Net bytes ahead of the first mask request (no GPU work). */
export async function preloadLiveMaskModel(): Promise<void> {
  const [{ preloadSegmentationBytes }, { localModelAvailable }] = await Promise.all([
    import('../reconstruction/segmentation.ts'), import('../sidecarClient.ts'),
  ]);
  // Same decision as `captureLiveMask`: with a local helper the video mask never uses IS-Net.
  if (await localModelAvailable('david-mask') || await localModelAvailable('mask')) return;
  await preloadSegmentationBytes();
}

/** Keep the captured canvas unchanged until both models finish to align their edges. */
export async function captureLiveMask(
  source: HTMLCanvasElement,
  device: 'wasm' | 'webgpu' = 'webgpu',
  dependencies?: MaskDependencies,
): Promise<LiveMaskResult> {
  if (!dependencies) {
    const [{ segmentForeground }, { applyDavidMask, FOTO_KALITE }, { localModelAvailable }] = await Promise.all([
      import('../reconstruction/segmentation.ts'), import('../../depth.ts'), import('../sidecarClient.ts'),
    ]);
    // Video masks refresh repeatedly: the heavy BiRefNet + DAViD chain only runs on the
    // local sidecar. Browser-only visitors (Vercel) keep IS-Net and skip the 115 MB + 180 MB
    // downloads and multi-second browser inference per refresh.
    const yerel = await localModelAvailable('david-mask');
    dependencies = {
      segmentForeground, applyDavidMask,
      selection: yerel ? FOTO_KALITE.insanMaskesi : undefined,
      quality: yerel || await localModelAvailable('mask') ? 'foto' : 'video',
    };
  }
  const segmented = await dependencies.segmentForeground(source, device, dependencies.quality ?? 'foto');
  const david = await dependencies.applyDavidMask(
    dependencies.selection, source, segmented.mask, segmented.width, segmented.height,
  );
  return {
    data: david?.maske ?? segmented.mask,
    width: segmented.width,
    height: segmented.height,
    model: david ? 'david' : segmented.model,
  };
}
