/**
 * Main-thread share the brightness preview may use while the live depth model loads.
 * Measured on personal clip A: one preview tick costs 60-180 ms; on every decoded frame it
 * kept the main thread ~100 % busy, and model session creation + first inference took
 * 14-15 s instead of ~4 s (docs/benchmarks/video-startup-mask-latency.md).
 */
export const PREVIEW_DUTY = 0.25;

/** Earliest time of the next preview tick, given when the last one started and ended. */
export function previewNextAt(startMs: number, endMs: number): number {
  return endMs + (endMs - startMs) * (1 / PREVIEW_DUTY - 1);
}
