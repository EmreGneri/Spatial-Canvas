import { propagateLiveDepth } from './liveDepthFlow.ts';
import { resampleBilinear } from '../reconstruction/silhouette.ts';
import type { FlowRequest, FlowResponse } from './liveDepthFlowClient.ts';
import type { LiveDepthFrame } from './liveDepthFlow.ts';

let maskGeneration = -1;
let maskSourceTime: number | undefined;
let previousMask: Float32Array | undefined;
let previousMaskFrame: LiveDepthFrame | undefined;
let previousMaskTime = -Infinity;

self.onmessage = (event: MessageEvent<FlowRequest>) => {
  const { id, generation, input } = event.data;
  let response: FlowResponse;
  try {
    if (generation !== maskGeneration || input.mediaTime <= previousMaskTime) {
      previousMask = undefined; previousMaskFrame = undefined; maskSourceTime = undefined;
      maskGeneration = generation;
    }
    const result = propagateLiveDepth(input.depth, input.previousFrame, input.currentFrame, input.width, input.height);
    const mask = input.mask;
    if (mask && mask.data.length === mask.width * mask.height && mask.colorFrame && result.coverage >= 0.12) {
      const historical = previousMask && previousMask.length === input.width * input.height && previousMaskFrame
        ? propagateLiveDepth(previousMask, previousMaskFrame, input.currentFrame, input.width, input.height, previousMask)
        : undefined;
      if (!historical?.mask || mask.mediaTime === undefined || mask.mediaTime !== maskSourceTime) {
        const resized = resampleBilinear(mask.data, mask.width, mask.height, input.width, input.height);
        const fresh = propagateLiveDepth(resized, mask.colorFrame, input.currentFrame, input.width, input.height, resized);
        if (fresh.coverage >= 0.12 && fresh.mask) {
          result.mask = fresh.mask;
          if (historical?.mask && historical.coverage >= 0.12) {
            for (let i = 0; i < result.mask.length; i++) if (historical.confidence[i] && fresh.confidence[i]) {
              result.mask[i] = 0.65 * fresh.mask[i] + 0.35 * historical.mask[i];
            }
          }
          maskSourceTime = mask.mediaTime;
        }
      } else if (historical.coverage >= 0.12) result.mask = historical.mask;
    }
    previousMask = result.mask;
    previousMaskFrame = result.mask ? input.currentFrame : undefined;
    previousMaskTime = input.mediaTime;
    response = { id, generation, result };
  } catch (error) {
    response = { id, generation, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
