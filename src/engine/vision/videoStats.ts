import type { LiveFlowField } from './liveDepthFlow.ts';

/** Ölçüm sayaçları (yalnız artırılır; DEV'de window.__videoStats ile okunur). */
export const videoStats = {
  fallbacks: 0, liveInfers: 0, interpolations: 0, interpolatedApplied: 0,
  preparedFrames: 0, captures: 0, captureMs: 0,
  advanceApplied: 0, advanceFallbacks: 0, advanceMs: 0, advanceCoverage: 0, advanceSteps: 0,
  advanceLast: null as { field: LiveFlowField; k: number; target: number; data: Float32Array } | null,
  /** Live video mask jobs: request -> compute done -> first render with it (null = not rendered). */
  maskLog: [] as VideoMaskJob[],
  /** Why a depth frame with a mask did NOT start a refresh (period not elapsed / job in flight). */
  maskGate: { interval: 0, busy: 0 },
};

export type VideoMaskJob = {
  reason: string; startAt: number; mediaTime: number; doneAt: number | null; appliedAt: number | null;
  coverage: number | null; separation: boolean | null; dropped: boolean;
};

/** Ring buffer: a long session must not grow the log without bound. */
export function logMaskJob(job: VideoMaskJob): VideoMaskJob {
  videoStats.maskLog.push(job);
  if (videoStats.maskLog.length > 500) videoStats.maskLog.shift();
  return job;
}
