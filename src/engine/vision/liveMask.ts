import type { DepthEstimateOptions } from '../../depth.ts';
import type { SegmentationResult } from '../reconstruction/segmentation.ts';

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
