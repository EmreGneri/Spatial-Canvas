import type { LiveFlowField } from './liveDepthFlow.ts';

/** Ölçüm sayaçları (yalnız artırılır; DEV'de window.__videoStats ile okunur). */
export const videoStats = {
  fallbacks: 0, liveInfers: 0, interpolations: 0, interpolatedApplied: 0,
  preparedFrames: 0, captures: 0, captureMs: 0,
  advanceApplied: 0, advanceFallbacks: 0, advanceMs: 0, advanceCoverage: 0, advanceSteps: 0,
  advanceLast: null as { field: LiveFlowField; k: number; target: number; data: Float32Array } | null,
};
