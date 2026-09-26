// Subject-fit sampling grid (object separation density).
//
// When object separation is on, the 384x384 sampling grid used to span the
// FULL photo frame even though only the subject (mask bbox) gets drawn — a
// bust occupying ~19% of frame area got ~19% of the particle budget, the
// rest wasted on discarded background. This checks the crop helpers used to
// scope the grid to the mask's bbox (+ margin) before sampling, and that
// doing so measurably increases subject particle density without
// reintroducing the stretching bug (bust world width must still match its
// own — now cropped — silhouette; see verify-photo-geometry.mjs).
//   node scripts/verify-subject-crop.mjs
import assert from 'node:assert/strict';

const { computeMaskCropRect, cropChannels, scaleRect, applySeparationCrop } =
  await import('../src/engine/reconstruction/crop.ts');
const { sampleVolumePositions } = await import('../src/engine/reconstruction/sampler.ts');

// --- computeMaskCropRect -----------------------------------------------
{
  const w = 20, h = 10;
  const mask = new Float32Array(w * h);
  // Small subject block: x in [8,11], y in [3,6].
  for (let y = 3; y <= 6; y++) for (let x = 8; x <= 11; x++) mask[y * w + x] = 1;
  const rect = computeMaskCropRect(mask, w, h, 0.25);
  assert.ok(rect, 'bbox found');
  // bw=4 -> margin round(4*0.25)=1, bh=4 -> margin=1.
  assert.deepEqual(rect, { x0: 7, y0: 2, x1: 13, y1: 8 });

  assert.equal(computeMaskCropRect(new Float32Array(w * h), w, h), null, 'empty mask -> no crop');

  const full = new Float32Array(w * h).fill(1);
  assert.equal(computeMaskCropRect(full, w, h), null, 'mask covering the whole frame -> no crop');
}

// --- cropChannels --------------------------------------------------------
{
  const w = 4, h = 3;
  // 1-channel: row-major 0..11.
  const src1 = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const rect = { x0: 1, y0: 1, x1: 3, y1: 3 };
  const { data, width, height } = cropChannels(src1, w, h, 1, rect);
  assert.equal(width, 2);
  assert.equal(height, 2);
  assert.deepEqual([...data], [5, 6, 9, 10]);

  // 3-channel (rgb-style interleaved).
  const src3 = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { src3[i * 3] = i; src3[i * 3 + 1] = i + 100; src3[i * 3 + 2] = i + 200; }
  const rgbCrop = cropChannels(src3, w, h, 3, rect);
  assert.deepEqual([...rgbCrop.data], [5, 105, 205, 6, 106, 206, 9, 109, 209, 10, 110, 210]);
}

// --- scaleRect -------------------------------------------------------------
{
  const rect = { x0: 10, y0: 20, x1: 30, y1: 40 };
  // Depth space 100x100 -> rgb space 200x400 (2x, 4y).
  const scaled = scaleRect(rect, 100, 100, 200, 400);
  assert.deepEqual(scaled, { x0: 20, y0: 80, x1: 60, y1: 160 });
}

// --- density: cropping the sampler inputs concentrates particles on the
// subject (same fixture as verify-photo-geometry: 518x291 centered bust,
// head + torso, ~19% of frame area).
{
  const W = 518, H = 291;
  const depth = new Float32Array(W * H);
  const mask = new Float32Array(W * H);
  const cx = W / 2;
  const headR = 0.11 * H;
  const headCy = 0.53 * H;
  const tHalf = (0.34 * W) / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const inHead = (x - cx) ** 2 + (y - headCy) ** 2 < headR ** 2;
      const inTorso = y > headCy + headR * 0.8 && Math.abs(x - cx) < tHalf;
      depth[i] = 0.2 + 0.05 * (((x >> 3) + (y >> 3)) & 1);
      if (inHead || inTorso) {
        mask[i] = 1;
        const dx = (x - cx) / (inTorso ? tHalf : headR);
        depth[i] = 0.55 + 0.35 * Math.sqrt(Math.max(0, 1 - dx * dx));
      }
    }
  }

  function fgCount(xyz) {
    let n = 0;
    for (let k = 0; k < xyz.length / 4; k++) if (xyz[k * 4 + 3] >= 1) n++;
    return n;
  }
  function bboxSpanX(xyz) {
    let x0 = Infinity, x1 = -Infinity;
    for (let k = 0; k < xyz.length / 4; k++) {
      if (xyz[k * 4 + 3] < 1) continue;
      x0 = Math.min(x0, xyz[k * 4]);
      x1 = Math.max(x1, xyz[k * 4]);
    }
    return x1 - x0;
  }

  const grid = 64; // small grid for a fast test; mechanism is grid-size-agnostic.
  const full = sampleVolumePositions(depth, W, H, { gridSize: grid, foregroundMask: mask, importanceSampling: false });
  const fullFg = fgCount(full);
  const fullFraction = fullFg / (grid * grid);

  const rect = computeMaskCropRect(mask, W, H, 0.12);
  assert.ok(rect, 'bust bbox found');
  const cw = rect.x1 - rect.x0, ch = rect.y1 - rect.y0;
  const cDepth = cropChannels(depth, W, H, 1, rect).data;
  const cMask = cropChannels(mask, W, H, 1, rect).data;
  const cropped = sampleVolumePositions(cDepth, cw, ch, { gridSize: grid, foregroundMask: cMask, importanceSampling: false });
  const croppedFg = fgCount(cropped);
  const croppedFraction = croppedFg / (grid * grid);

  assert.ok(croppedFraction > fullFraction * 3,
    `cropping concentrates the budget on the subject (full ${fullFraction.toFixed(3)}, cropped ${croppedFraction.toFixed(3)})`);

  // Geometry sanity carried into the cropped grid: world width still equals
  // the (now cropped) silhouette's own bbox width, not stretched/shrunk.
  let mx0 = cw, mx1 = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (cMask[y * cw + x] >= 0.5) { mx0 = Math.min(mx0, x); mx1 = Math.max(mx1, x); }
  const trueX = ((mx1 + 1 - mx0) / cw) * 2 * (cw / ch);
  const spanX = bboxSpanX(cropped);
  assert.ok(Math.abs(spanX - trueX) / trueX < 0.05,
    `cropped bust world width matches its own silhouette (${spanX.toFixed(3)} vs ${trueX.toFixed(3)})`);

  console.log(`  full-frame subject density ${fullFraction.toFixed(3)}, cropped ${croppedFraction.toFixed(3)}`);
}

// --- applySeparationCrop: the single decision point Engine.ts calls -------
{
  const w = 20, h = 10;
  const mask = new Float32Array(w * h);
  for (let y = 3; y <= 6; y++) for (let x = 8; x <= 11; x++) mask[y * w + x] = 1;
  const depth = new Float32Array(w * h);
  for (let i = 0; i < depth.length; i++) depth[i] = i;
  const rgb = new Float32Array(w * 2 * h * 2 * 3); // 2x resolution rgb (letterbox mismatch case)
  for (let i = 0; i < w * 2 * h * 2; i++) { rgb[i * 3] = i; rgb[i * 3 + 1] = i; rgb[i * 3 + 2] = i; }

  // Separation off -> passthrough, same references.
  const off = applySeparationCrop({ depth, depthWidth: w, depthHeight: h, mask, rgb, rgbWidth: w * 2, rgbHeight: h * 2 }, false);
  assert.equal(off.depth, depth, 'inactive: depth untouched');
  assert.equal(off.depthWidth, w);

  // Separation on -> cropped, smaller, rgb scaled to its own resolution.
  const on = applySeparationCrop({ depth, depthWidth: w, depthHeight: h, mask, rgb, rgbWidth: w * 2, rgbHeight: h * 2 }, true);
  assert.ok(on.depthWidth < w && on.depthHeight < h, 'active: depth cropped smaller');
  assert.ok(on.rgbWidth === on.depthWidth * 2 && on.rgbHeight === on.depthHeight * 2, 'rgb crop keeps the resolution ratio');

  // No mask -> passthrough even if active.
  const noMask = applySeparationCrop({ depth, depthWidth: w, depthHeight: h }, true);
  assert.equal(noMask.depthWidth, w, 'active but no mask: untouched');
}

console.log('OK · subject crop (bbox+margin, crop helpers, density concentrates on subject, geometry stays honest)');
