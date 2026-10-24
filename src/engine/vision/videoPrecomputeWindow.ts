/** Official VDA offline window schedule. Streaming cache models are incompatible. */
export const VIDEO_WINDOW = 32;
export const VIDEO_STRIDE = 22;
export const VIDEO_ANCHORS = [0, 12, 24, 25, 26, 27, 28, 29, 30, 31] as const;
export function videoWindowIndices(start: number, count: number, previous?: readonly number[]): number[] {
  if (count < 1) throw Error('Empty video');
  const ids = Array.from({ length: 32 }, (_, i) => Math.min(start + i, count - 1));
  if (previous) VIDEO_ANCHORS.forEach((id, i) => { ids[i] = previous[id]; });
  return ids;
}
/** Least squares shared scale/shift, using only the two official alignment anchors. */
export function alignVideoWindow(current: readonly Float32Array[], reference: readonly Float32Array[]): [number, number] {
  let n = 0, sx = 0, sy = 0, xx = 0, xy = 0;
  current.forEach((frame, j) => frame.forEach((x, i) => {
    const y = reference[j][i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw Error('Non-finite video depth');
    n++; sx += x; sy += y; xx += x * x; xy += x * y;
  }));
  const det = n * xx - sx * sx;
  if (Math.abs(det) < 1e-12) return [1, 0];
  return [(n * xy - sx * sy) / det, (xx * sy - sx * xy) / det];
}
export function transformVideoDepth(data: Float32Array, scale: number, shift: number): Float32Array {
  return data.map(v => Math.max(0, v * scale + shift));
}
export function blendVideoSeam(before: Float32Array, after: Float32Array, index: number): Float32Array {
  // Upstream get_interpolate_frames uses linspace(0, 1, 8), including both endpoints.
  const weight = index / 7;
  return before.map((v, i) => v * (1 - weight) + after[i] * weight);
}
export function quantizeVideoDepth(data: Float32Array, min: number, max: number): Uint16Array {
  const span = max - min;
  return Uint16Array.from(data, v => span > 1e-12 ? Math.round(Math.max(0, Math.min(1, (v - min) / span)) * 65535) : 0);
}
