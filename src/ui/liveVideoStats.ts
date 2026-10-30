export interface LiveVideoStats {
  path: 'loading' | 'depth' | 'fallback';
  backend?: string;
  hz: number;
  inferenceMs: number;
  width: number;
  height: number;
  frames: number;
  /** Media timestamp captured by the most recently accepted 3D frame. */
  mediaTime: number | null;
  /** Wall-clock age measured exactly when that 3D frame is published. */
  geometryAgeMs: number | null;
}

/**
 * Converts media-timeline distance to perceived wall-clock lag.
 *
 * Dividing by playback rate keeps the metric meaningful at 0.25x/0.5x: an
 * inference that spans 100 ms of media at 0.25x is 400 ms old to the viewer.
 * Loop wrap is handled explicitly; a backwards seek is not interpreted as a
 * huge positive delay while the replacement frame is pending.
 */
export function liveGeometryAgeMs(
  currentMediaTime: number,
  geometryMediaTime: number | null,
  playbackRate: number,
  duration: number,
  loop: boolean,
): number | null {
  if (!Number.isFinite(currentMediaTime) || geometryMediaTime === null
    || !Number.isFinite(geometryMediaTime)) return null;

  let mediaLag = currentMediaTime - geometryMediaTime;
  if (mediaLag < 0 && loop && Number.isFinite(duration) && duration > 0) {
    mediaLag += duration;
  }
  if (mediaLag <= 0) return 0;

  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  return Math.round(mediaLag * 1000 / rate);
}
