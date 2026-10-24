export interface VideoGuideMask { data: Float32Array; width: number; height: number }

/** Video disparity uses 0 = far and 1 = near. Confidence is independent of segmentation. */
export function resampleVideoDepthEdges(
  input: Float32Array,
  width: number,
  height: number,
  grid: number,
  strength: number,
  foregroundMask?: Float32Array | null,
  guideMask?: VideoGuideMask | null,
): { depth: Float32Array; confidence: Float32Array } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || input.length !== width * height || !Number.isInteger(grid) || grid < 1) {
    throw new Error('Video depth dimensions must match a non-empty depth map');
  }
  const amount = Number.isFinite(strength) ? Math.min(4, Math.max(0, strength)) : 0;
  const radius = amount === 0 ? 0 : Math.ceil(amount / 2);
  const mask = foregroundMask?.length === input.length ? foregroundMask : null;
  const guide = guideMask && guideMask.width > 0 && guideMask.height > 0
    && guideMask.data.length === guideMask.width * guideMask.height ? guideMask : null;
  const source = Float32Array.from(input, d => Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0);
  const filtered = new Float32Array(source.length);
  const index = (x: number, y: number) =>
    Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x));
  // shortcut: bounded CPU kernels suit current depth maps; move to GPU if measured frame cost grows.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const foreground = !mask || mask[p] >= 0.5;
      let value = source[p];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const q = index(x + dx, y + dy);
          if (mask && (mask[q] >= 0.5) !== foreground) continue;
          // The mask supplies the contour: do not expand the foreground into its background.
          value = foreground ? Math.max(value, source[q]) : Math.min(value, source[q]);
        }
      }
      filtered[p] = value;
    }
  }
  const depth = new Float32Array(grid * grid);
  const confidence = new Float32Array(grid * grid).fill(1);
  const threshold = 0.45 - amount * 0.075;
  for (let y = 0; y < grid; y++) {
    const sy = Math.min(height - 1, Math.max(0, (y + 0.5) / grid * height - 0.5));
    const y0 = Math.floor(sy);
    const ty = sy - y0;
    for (let x = 0; x < grid; x++) {
      const sx = Math.min(width - 1, Math.max(0, (x + 0.5) / grid * width - 0.5));
      const x0 = Math.floor(sx);
      const tx = sx - x0;
      let nearest = index(Math.round(sx), Math.round(sy));
      const foreground = guide
        ? guide.data[Math.min(guide.height - 1, Math.floor((y + 0.5) / grid * guide.height)) * guide.width
          + Math.min(guide.width - 1, Math.floor((x + 0.5) / grid * guide.width))] >= 0.5
        : !!mask && mask[nearest] >= 0.5;
      if (amount > 0 && guide && mask && (mask[nearest] >= 0.5) !== foreground) {
        let best = Infinity;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const q = index(Math.round(sx) + dx, Math.round(sy) + dy);
            const distance = dx * dx + dy * dy;
            if ((mask[q] >= 0.5) === foreground && distance < best) {
              nearest = q;
              best = distance;
            }
          }
        }
      }
      let sum = 0;
      let weight = 0;
      let lo = 1;
      let hi = 0;
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const q = index(x0 + dx, y0 + dy);
          const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
          if (w === 0) continue;
          lo = Math.min(lo, filtered[q]);
          hi = Math.max(hi, filtered[q]);
          if (amount > 0 && mask && (mask[q] >= 0.5) !== foreground) continue;
          sum += filtered[q] * w;
          weight += w;
        }
      }
      const p = y * grid + x;
      const d = weight > 0 ? sum / weight : filtered[nearest];
      const nx = Math.round(sx);
      const ny = Math.round(sy);
      const nearNeighbor = Math.max(filtered[index(nx - 1, ny)], filtered[index(nx + 1, ny)],
        filtered[index(nx, ny - 1)], filtered[index(nx, ny + 1)]);
      const relativeGradient = (hi - lo) / Math.max(0.05, hi);
      if (amount > 0 && relativeGradient > threshold) {
        // A hard depth edge cannot be interpolated: intermediate z produces the rubber curtain.
        depth[p] = filtered[nearest];
        // Keep every foreground sample; only uncertain contour/background samples are culled.
        confidence[p] = foreground || filtered[nearest] >= hi - 0.02
          || Math.abs(d - filtered[nearest]) < 0.02 ? 1 : 0;
      } else {
        depth[p] = d;
      }
      if (amount > 0 && !foreground
        && (nearNeighbor - filtered[nearest]) / Math.max(0.05, nearNeighbor) > threshold) {
        confidence[p] = 0;
      }
    }
  }
  return { depth, confidence };
}
