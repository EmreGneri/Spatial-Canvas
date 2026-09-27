import { computeOpticalFlow } from './flow.ts';
import { stabilizeDepth } from './temporal.ts';
import type { FlowPoint } from './types.ts';
import { resampleBilinear } from '../reconstruction/silhouette.ts';

export interface LiveDepthFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const MAX_FLOW_EDGE = 112;
const SCENE_CUT_MEAN_DELTA = 0.24;
export const LIVE_DEPTH_MAX_AGE_SECONDS = 0.75;

export function isLiveDepthResultStale(mediaTime: number, currentTime: number): boolean {
  return Number.isFinite(mediaTime) && Number.isFinite(currentTime)
    && currentTime - mediaTime > LIVE_DEPTH_MAX_AGE_SECONDS;
}

function toLuminance(frame: LiveDepthFrame, width: number, height: number): Float32Array {
  const rgb = new Float32Array(frame.width * frame.height);
  for (let i = 0; i < rgb.length; i++) {
    const offset = i * 4;
    rgb[i] = (0.2126 * frame.data[offset] + 0.7152 * frame.data[offset + 1] + 0.0722 * frame.data[offset + 2]) / 255;
  }
  return frame.width === width && frame.height === height
    ? rgb
    : resampleBilinear(rgb, frame.width, frame.height, width, height);
}

/** Flow-aligns consecutive accepted model depth maps on an aspect-preserving small grid. */
export function stabilizeLiveDepthPair(
  previousDepth: Float32Array,
  currentDepth: Float32Array,
  previousFrame: LiveDepthFrame | undefined,
  currentFrame: LiveDepthFrame | undefined,
  depthWidth: number,
  depthHeight: number,
): { depth: Float32Array; coverage: number } {
  if (!previousFrame || !currentFrame || previousFrame.width < 2 || previousFrame.height < 2
    || previousFrame.width !== currentFrame.width || previousFrame.height !== currentFrame.height
    || previousDepth.length !== currentDepth.length || currentDepth.length !== depthWidth * depthHeight
    || previousFrame.data.length !== previousFrame.width * previousFrame.height * 4
    || currentFrame.data.length !== currentFrame.width * currentFrame.height * 4) {
    return { depth: currentDepth, coverage: 0 };
  }

  const scale = Math.min(1, MAX_FLOW_EDGE / Math.max(depthWidth, depthHeight));
  const flowWidth = Math.max(32, Math.round(depthWidth * scale));
  const flowHeight = Math.max(32, Math.round(depthHeight * scale));
  const previousLuma = toLuminance(previousFrame, flowWidth, flowHeight);
  const currentLuma = toLuminance(currentFrame, flowWidth, flowHeight);
  let delta = 0;
  for (let i = 0; i < previousLuma.length; i++) delta += Math.abs(previousLuma[i] - currentLuma[i]);
  if (delta / previousLuma.length > SCENE_CUT_MEAN_DELTA) return { depth: currentDepth, coverage: 0 };

  const flowOptions = { maxCorners: 80, pyramidLevels: 2, windowRadius: 4 };
  const forward: FlowPoint[] = computeOpticalFlow(previousLuma, currentLuma, flowWidth, flowHeight, flowOptions)
    .filter((point) => point.status === 1);
  if (forward.length < 12) return { depth: currentDepth, coverage: 0 };
  const backward: FlowPoint[] = computeOpticalFlow(currentLuma, previousLuma, flowWidth, flowHeight, flowOptions)
    .filter((point) => point.status === 1);
  if (backward.length < 12) return { depth: currentDepth, coverage: 0 };

  const oldSmall = resampleBilinear(previousDepth, depthWidth, depthHeight, flowWidth, flowHeight);
  const newSmall = resampleBilinear(currentDepth, depthWidth, depthHeight, flowWidth, flowHeight);
  const stabilized = stabilizeDepth(oldSmall, newSmall, forward, backward, flowWidth, flowHeight, {
    alpha: 0.55,
    coverRadius: 9,
  });
  let covered = 0;
  for (const valid of stabilized.occlusion) covered += valid;
  const coverage = covered / stabilized.occlusion.length;
  if (coverage < 0.12) return { depth: currentDepth, coverage };
  return {
    depth: resampleBilinear(stabilized.depth, flowWidth, flowHeight, depthWidth, depthHeight),
    coverage,
  };
}
