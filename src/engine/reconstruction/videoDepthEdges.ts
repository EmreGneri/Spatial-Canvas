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
  const n = input.length;
  const source = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = input[i];
    source[i] = d > 0 && d !== Infinity ? (d < 1 ? d : 1) : 0; // non-finite -> 0
  }
  const index = (x: number, y: number) =>
    Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x));
  // Ucuz CPU yolu (madde 8): kenar köşe kelepçeleri satır/sütun tablolarına alındı,
  // maskesiz genişletme ayrılabilir max filtre. Çıktı eski çekirdekle birebir aynı
  // (scripts/verify-video-depth-edges.mjs karşılaştırır); ~4x daha hızlı.
  let filtered: Float32Array;
  if (radius === 0) {
    filtered = source;
  } else if (!mask) {
    const rows = new Float32Array(n);
    filtered = new Float32Array(n);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let value = source[row + x];
        for (let dx = -radius; dx <= radius; dx++) {
          const q = source[row + Math.min(width - 1, Math.max(0, x + dx))];
          if (q > value) value = q;
        }
        rows[row + x] = value;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = rows[y * width + x];
        for (let dy = -radius; dy <= radius; dy++) {
          const q = rows[Math.min(height - 1, Math.max(0, y + dy)) * width + x];
          if (q > value) value = q;
        }
        filtered[y * width + x] = value;
      }
    }
  } else {
    filtered = new Float32Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const foreground = mask[p] >= 0.5;
        let value = source[p];
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const q = index(x + dx, y + dy);
            if ((mask[q] >= 0.5) !== foreground) continue;
            // The mask supplies the contour: do not expand the foreground into its background.
            value = foreground ? Math.max(value, source[q]) : Math.min(value, source[q]);
          }
        }
        filtered[p] = value;
      }
    }
  }
  const depth = new Float32Array(grid * grid);
  const confidence = new Float32Array(grid * grid).fill(1);
  const threshold = 0.45 - amount * 0.075;
  // Column/row tables: source coordinate, bilinear corners, nearest and its 4-neighbours.
  const table = (count: number, size: number) => {
    const s0 = new Float64Array(count), t = new Float64Array(count);
    const c0 = new Int32Array(count), c1 = new Int32Array(count), near = new Int32Array(count);
    const lo = new Int32Array(count), hi = new Int32Array(count);
    for (let k = 0; k < count; k++) {
      const sc = Math.min(size - 1, Math.max(0, (k + 0.5) / count * size - 0.5));
      const f = Math.floor(sc);
      s0[k] = sc; t[k] = sc - f; c0[k] = f; c1[k] = Math.min(size - 1, f + 1);
      const r = Math.round(sc);
      near[k] = r; lo[k] = Math.max(0, r - 1); hi[k] = Math.min(size - 1, r + 1);
    }
    return { s0, t, c0, c1, near, lo, hi };
  };
  const cols = table(grid, width), rowsT = table(grid, height);
  for (let y = 0; y < grid; y++) {
    const ty = rowsT.t[y], r0 = rowsT.c0[y] * width, r1 = rowsT.c1[y] * width;
    const ny = rowsT.near[y], rn = ny * width, rUp = rowsT.lo[y] * width, rDown = rowsT.hi[y] * width;
    const guideRow = guide ? Math.min(guide.height - 1, Math.floor((y + 0.5) / grid * guide.height)) * guide.width : 0;
    for (let x = 0; x < grid; x++) {
      const tx = cols.t[x], x0 = cols.c0[x], x1 = cols.c1[x], nx = cols.near[x];
      let nearest = rn + nx;
      const foreground = guide
        ? guide.data[guideRow + Math.min(guide.width - 1, Math.floor((x + 0.5) / grid * guide.width))] >= 0.5
        : !!mask && mask[nearest] >= 0.5;
      if (amount > 0 && guide && mask && (mask[nearest] >= 0.5) !== foreground) {
        let best = Infinity;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const q = index(nx + dx, ny + dy);
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
      for (let corner = 0; corner < 4; corner++) {
        const dx = corner & 1, dy = corner >> 1;
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
        if (w === 0) continue;
        const q = (dy ? r1 : r0) + (dx ? x1 : x0);
        const f = filtered[q];
        if (f < lo) lo = f;
        if (f > hi) hi = f;
        if (amount > 0 && mask && (mask[q] >= 0.5) !== foreground) continue;
        sum += f * w;
        weight += w;
      }
      const p = y * grid + x;
      const fn = filtered[nearest];
      const d = weight > 0 ? sum / weight : fn;
      if (amount === 0) { depth[p] = d; continue; }
      const nearNeighbor = Math.max(filtered[rn + cols.lo[x]], filtered[rn + cols.hi[x]],
        filtered[rUp + nx], filtered[rDown + nx]);
      const relativeGradient = (hi - lo) / Math.max(0.05, hi);
      if (relativeGradient > threshold) {
        // A hard depth edge cannot be interpolated: intermediate z produces the rubber curtain.
        depth[p] = fn;
        // Keep every foreground sample; only uncertain contour/background samples are culled.
        confidence[p] = foreground || fn >= hi - 0.02 || Math.abs(d - fn) < 0.02 ? 1 : 0;
      } else {
        depth[p] = d;
      }
      if (!foreground && (nearNeighbor - fn) / Math.max(0.05, nearNeighbor) > threshold) {
        confidence[p] = 0;
      }
    }
  }
  return { depth, confidence };
}
