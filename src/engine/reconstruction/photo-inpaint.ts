type PyramidLevel = {
  width: number;
  height: number;
  rgb: Float32Array;
  known: Uint8Array;
};

/** Fill foreground-covered pixels with a coarse continuation of surrounding background. */
export function inpaintMaskedPhoto(
  rgb: Float32Array,
  width: number,
  height: number,
  foregroundMask: Float32Array,
): Float32Array {
  if (rgb.length !== width * height * 3 || foregroundMask.length !== width * height) {
    throw new RangeError('Photo and foreground mask dimensions must match');
  }
  const result = rgb.slice();
  const base: PyramidLevel = {
    width,
    height,
    rgb: result,
    known: new Uint8Array(width * height),
  };
  let hasKnown = false;
  let hasMasked = false;
  for (let i = 0; i < base.known.length; i++) {
    base.known[i] = foregroundMask[i] >= 0.5 ? 0 : 1;
    hasKnown ||= base.known[i] === 1;
    hasMasked ||= base.known[i] === 0;
  }
  if (!hasKnown || !hasMasked) return result;

  const levels = [base];
  while (Math.max(levels.at(-1)!.width, levels.at(-1)!.height) > 16) {
    const source = levels.at(-1)!;
    const nextWidth = Math.max(1, Math.ceil(source.width / 2));
    const nextHeight = Math.max(1, Math.ceil(source.height / 2));
    const next: PyramidLevel = {
      width: nextWidth,
      height: nextHeight,
      rgb: new Float32Array(nextWidth * nextHeight * 3),
      known: new Uint8Array(nextWidth * nextHeight),
    };
    for (let y = 0; y < nextHeight; y++) {
      for (let x = 0; x < nextWidth; x++) {
        let samples = 0;
        const to = y * nextWidth + x;
        for (let oy = 0; oy < 2; oy++) {
          for (let ox = 0; ox < 2; ox++) {
            const sx = x * 2 + ox;
            const sy = y * 2 + oy;
            if (sx >= source.width || sy >= source.height) continue;
            const from = sy * source.width + sx;
            if (!source.known[from]) continue;
            samples++;
            for (let c = 0; c < 3; c++) next.rgb[to * 3 + c] += source.rgb[from * 3 + c];
          }
        }
        if (samples) {
          next.known[to] = 1;
          for (let c = 0; c < 3; c++) next.rgb[to * 3 + c] /= samples;
        }
      }
    }
    levels.push(next);
  }

  // At the coarsest scale, propagate the nearest available background color
  // across fully covered cells. Finer levels then interpolate this broad fill.
  const coarse = levels.at(-1)!;
  for (let pass = 0; pass < coarse.width + coarse.height; pass++) {
    let changed = false;
    for (let y = 0; y < coarse.height; y++) {
      for (let x = 0; x < coarse.width; x++) {
        const i = y * coarse.width + x;
        if (coarse.known[i]) continue;
        let count = 0;
        const sum = [0, 0, 0];
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || nx >= coarse.width || ny < 0 || ny >= coarse.height) continue;
          const ni = ny * coarse.width + nx;
          if (!coarse.known[ni]) continue;
          count++;
          for (let c = 0; c < 3; c++) sum[c] += coarse.rgb[ni * 3 + c];
        }
        if (!count) continue;
        coarse.known[i] = 1;
        for (let c = 0; c < 3; c++) coarse.rgb[i * 3 + c] = sum[c] / count;
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (let levelIndex = levels.length - 2; levelIndex >= 0; levelIndex--) {
    const target = levels[levelIndex];
    const parent = levels[levelIndex + 1];
    for (let y = 0; y < target.height; y++) {
      for (let x = 0; x < target.width; x++) {
        const i = y * target.width + x;
        if (target.known[i]) continue;
        const px = ((x + 0.5) * parent.width) / target.width - 0.5;
        const py = ((y + 0.5) * parent.height) / target.height - 0.5;
        const x0 = Math.max(0, Math.floor(px));
        const y0 = Math.max(0, Math.floor(py));
        const x1 = Math.min(parent.width - 1, x0 + 1);
        const y1 = Math.min(parent.height - 1, y0 + 1);
        const tx = Math.max(0, px - x0);
        const ty = Math.max(0, py - y0);
        for (let c = 0; c < 3; c++) {
          const a = parent.rgb[(y0 * parent.width + x0) * 3 + c] * (1 - tx)
            + parent.rgb[(y0 * parent.width + x1) * 3 + c] * tx;
          const b = parent.rgb[(y1 * parent.width + x0) * 3 + c] * (1 - tx)
            + parent.rgb[(y1 * parent.width + x1) * 3 + c] * tx;
          target.rgb[i * 3 + c] = a * (1 - ty) + b * ty;
        }
      }
    }
  }
  return result;
}
