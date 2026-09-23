import type { YuzReferansi } from '../vision/yuzReferansi.ts';

export interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AffineDepthFit {
  scale: number;
  offset: number;
  samples: number;
}

export interface HeadBlendResult {
  fit: AffineDepthFit | null;
  maxSeamJump: number;
  outsideChanged: number;
}

export interface LimiterImpact {
  changed: number;
  maxChange: number;
}

const MASK_THRESHOLD = 0.5;

function inside(rect: GridRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

function edgeDistance(rect: GridRect, x: number, y: number): number {
  return Math.min(x - rect.x, y - rect.y, rect.x + rect.width - 1 - x, rect.y + rect.height - 1 - y);
}

function smoothstep01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * Finds a face-scale ROI from the foreground mask alone. The upper quarter is
 * deliberately used instead of a face model, so the method remains available
 * wherever the existing RMBG mask is available.
 */
export function findHeadRoi(mask: Float32Array, width: number, height: number): GridRect | null {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] < MASK_THRESHOLD) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;

  const bodyHeight = maxY - minY + 1;
  const bandBottom = Math.min(maxY, minY + Math.max(3, Math.ceil(bodyHeight * 0.25)) - 1);
  let weightedX = 0;
  let weight = 0;
  let bandMinX = width;
  let bandMaxX = -1;
  for (let y = minY; y <= bandBottom; y++) {
    for (let x = minX; x <= maxX; x++) {
      const alpha = mask[y * width + x];
      if (alpha < MASK_THRESHOLD) continue;
      weightedX += x * alpha;
      weight += alpha;
      bandMinX = Math.min(bandMinX, x);
      bandMaxX = Math.max(bandMaxX, x);
    }
  }
  if (weight === 0 || bandMaxX < bandMinX) return null;

  const bandHeight = bandBottom - minY + 1;
  const spanWidth = bandMaxX - bandMinX + 1;
  const padX = Math.max(2, Math.round(spanWidth * 0.18));
  const padY = Math.max(2, Math.round(bandHeight * 0.1));
  const roiWidth = Math.min(width, Math.max(spanWidth + 2 * padX, Math.round(bandHeight * 0.8)));
  const roiHeight = Math.min(height, bandHeight + 2 * padY);
  const centerX = weightedX / weight;
  const x = Math.max(0, Math.min(width - roiWidth, Math.round(centerX - roiWidth / 2)));
  const y = Math.max(0, Math.min(height - roiHeight, minY - padY));
  return { x, y, width: roiWidth, height: roiHeight };
}

/** Yüz ovaline eklenen paylar (yüz yüksekliği/genişliği oranı). Saç payı
 *  tepeye (oval alın çizgisinde biter), yan pay kulak/saça, çene payı boyna. */
export const YUZ_ROI_SAC_PAYI = 0.35;
export const YUZ_ROI_YAN_PAYI = 0.2;
export const YUZ_ROI_CENE_PAYI = 0.1;

/**
 * Kafa ROI'si YÜZ referansından: oval bbox + saç/kulak/çene payları, kadraja
 * kırpılır. `findHeadRoi`'nin aksine kaldırılmış kol ROI'ye giremez — ROI'nin
 * genişliği maske bandından değil yüzün kendisinden gelir (asansör fotoğrafı:
 * kadrajın %80.7'si → yüz genişliği + %40). 8 px'ten küçük ROI null (model
 * kırpmasına değmez → çağıran maske bandına düşer).
 */
export function headRoiFromFace(face: YuzReferansi, width: number, height: number): GridRect | null {
  const fw = (face.oval.x1 - face.oval.x0) * width;
  const fh = (face.oval.y1 - face.oval.y0) * height;
  if (!(fw > 0) || !(fh > 0)) return null;
  const x0 = Math.max(0, Math.floor(face.oval.x0 * width - fw * YUZ_ROI_YAN_PAYI));
  const y0 = Math.max(0, Math.floor(face.oval.y0 * height - fh * YUZ_ROI_SAC_PAYI));
  const x1 = Math.min(width, Math.ceil(face.oval.x1 * width + fw * YUZ_ROI_YAN_PAYI));
  const y1 = Math.min(height, Math.ceil(face.oval.y1 * height + fh * YUZ_ROI_CENE_PAYI));
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export type HeadRoiKaynagi = 'yuz' | 'maske';

/** ROI seçimi TEK yerde: yüz varsa ve geçerli ROI veriyorsa yüz, yoksa maske bandı. */
export function headRoiSec(
  mask: Float32Array,
  width: number,
  height: number,
  face: YuzReferansi | null | undefined,
): { roi: GridRect | null; kaynak: HeadRoiKaynagi } {
  if (face) {
    const roi = headRoiFromFace(face, width, height);
    if (roi) return { roi, kaynak: 'yuz' };
  }
  return { roi: findHeadRoi(mask, width, height), kaynak: 'maske' };
}

/**
 * Fits only the ROI boundary ring. A whole-ROI fit would use the flattened
 * global face interior as the target and collapse the detail being recovered.
 */
export function fitAffineDepth(
  globalDepth: Float32Array,
  cropDepth: Float32Array,
  mask: Float32Array,
  width: number,
  roi: GridRect,
): AffineDepthFit | null {
  const ringWidth = Math.max(1, Math.min(3, Math.floor(Math.min(roi.width, roi.height) / 6)));
  let sumCrop = 0;
  let sumGlobal = 0;
  let samples = 0;
  for (let j = 0; j < roi.height; j++) {
    for (let i = 0; i < roi.width; i++) {
      const x = roi.x + i;
      const y = roi.y + j;
      const globalIndex = y * width + x;
      if (mask[globalIndex] < MASK_THRESHOLD || edgeDistance(roi, x, y) > ringWidth) continue;
      sumCrop += cropDepth[j * roi.width + i];
      sumGlobal += globalDepth[globalIndex];
      samples++;
    }
  }
  if (samples < 16) return null;
  const meanCrop = sumCrop / samples;
  const meanGlobal = sumGlobal / samples;
  let covariance = 0;
  let cropVariance = 0;
  for (let j = 0; j < roi.height; j++) {
    for (let i = 0; i < roi.width; i++) {
      const x = roi.x + i;
      const y = roi.y + j;
      const globalIndex = y * width + x;
      if (mask[globalIndex] < MASK_THRESHOLD || edgeDistance(roi, x, y) > ringWidth) continue;
      const cropDelta = cropDepth[j * roi.width + i] - meanCrop;
      covariance += cropDelta * (globalDepth[globalIndex] - meanGlobal);
      cropVariance += cropDelta * cropDelta;
    }
  }
  if (!(cropVariance > 1e-8)) return null;
  const scale = covariance / cropVariance;
  const offset = meanGlobal - scale * meanCrop;
  if (!Number.isFinite(scale) || !Number.isFinite(offset) || scale <= 0) return null;
  return { scale, offset, samples };
}

function measureSeamJump(depth: Float32Array, mask: Float32Array, width: number, height: number, roi: GridRect): number {
  let maximum = 0;
  for (let y = Math.max(0, roi.y - 1); y < Math.min(height, roi.y + roi.height + 1); y++) {
    for (let x = Math.max(0, roi.x - 1); x < Math.min(width, roi.x + roi.width + 1); x++) {
      if (!inside(roi, x, y)) continue;
      const current = y * width + x;
      if (mask[current] < MASK_THRESHOLD) continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || inside(roi, nx, ny)) continue;
        const neighbor = ny * width + nx;
        if (mask[neighbor] < MASK_THRESHOLD) continue;
        maximum = Math.max(maximum, Math.abs(depth[current] - depth[neighbor]));
      }
    }
  }
  return maximum;
}

/**
 * Applies an affine-aligned crop only inside the head rectangle. The feather
 * reaches zero at the rectangle boundary, preserving continuity with the
 * untouched global field outside the crop.
 */
export function blendHeadDetail(
  globalDepth: Float32Array,
  cropDepth: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  roi: GridRect,
): HeadBlendResult {
  if (cropDepth.length !== roi.width * roi.height) {
    throw new RangeError('Head crop depth dimensions do not match its ROI.');
  }
  const before = Float32Array.from(globalDepth);
  const fit = fitAffineDepth(globalDepth, cropDepth, mask, width, roi);
  if (!fit) return { fit: null, maxSeamJump: measureSeamJump(globalDepth, mask, width, height, roi), outsideChanged: 0 };

  const featherWidth = Math.max(1, Math.min(4, Math.floor(Math.min(roi.width, roi.height) / 5)));
  for (let j = 0; j < roi.height; j++) {
    for (let i = 0; i < roi.width; i++) {
      const x = roi.x + i;
      const y = roi.y + j;
      const globalIndex = y * width + x;
      const alpha = Math.min(1, Math.max(0, mask[globalIndex]));
      if (alpha <= 0) continue;
      const feather = smoothstep01(edgeDistance(roi, x, y) / featherWidth);
      const target = fit.scale * cropDepth[j * roi.width + i] + fit.offset;
      globalDepth[globalIndex] += (target - globalDepth[globalIndex]) * alpha * feather;
    }
  }

  let outsideChanged = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inside(roi, x, y)) continue;
      if (globalDepth[y * width + x] !== before[y * width + x]) outsideChanged++;
    }
  }
  return {
    fit,
    maxSeamJump: measureSeamJump(globalDepth, mask, width, height, roi),
    outsideChanged,
  };
}

/**
 * Mirrors the limiter's radius-two neighborhood so diagnostics describe the
 * exact comparison that decides whether a merged facial feature is a spike.
 */
export function measureTwoPixelSlope(
  depth: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  roi: GridRect,
): number {
  let maximum = 0;
  for (let y = roi.y; y < roi.y + roi.height; y++) {
    for (let x = roi.x; x < roi.x + roi.width; x++) {
      const current = y * width + x;
      if (mask[current] < MASK_THRESHOLD) continue;
      for (const [dx, dy] of [[-2, -2], [0, -2], [2, -2], [-2, 0], [2, 0], [-2, 2], [0, 2], [2, 2]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < roi.x || ny < roi.y || nx >= roi.x + roi.width || ny >= roi.y + roi.height) continue;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (mask[neighbor] < MASK_THRESHOLD) continue;
        maximum = Math.max(maximum, Math.abs(depth[current] - depth[neighbor]));
      }
    }
  }
  return maximum;
}

/** Reports whether the production slope limiter removed any merged head detail. */
export function measureLimiterImpact(
  before: Float32Array,
  after: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  roi: GridRect,
): LimiterImpact {
  let changed = 0;
  let maxChange = 0;
  for (let y = roi.y; y < roi.y + roi.height; y++) {
    for (let x = roi.x; x < roi.x + roi.width; x++) {
      const i = y * width + x;
      if (mask[i] < MASK_THRESHOLD) continue;
      const delta = Math.abs(after[i] - before[i]);
      if (delta === 0) continue;
      changed++;
      maxChange = Math.max(maxChange, delta);
    }
  }
  return { changed, maxChange };
}

/**
 * Measures relief only over trusted foreground samples. The inverted branch
 * makes the non-head result an exact guard that a head-only blend did not
 * change a hand, arm, or torso sample outside the ROI.
 */
export function measureMaskedDepthRange(
  depth: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  roi: GridRect,
  withinRoi: boolean,
): number {
  let low = Infinity;
  let high = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inside(roi, x, y) !== withinRoi) continue;
      const i = y * width + x;
      if (mask[i] < MASK_THRESHOLD) continue;
      low = Math.min(low, depth[i]);
      high = Math.max(high, depth[i]);
    }
  }
  return high >= low ? high - low : 0;
}

/**
 * Keeps post-limiter head detail only when both independent safety probes
 * agree: the crop still joins the global field continuously, and the real
 * limiter does not classify any ROI sample as an isolated spike.
 */
export function shouldKeepHeadDetail(result: HeadBlendResult, limiterImpact: LimiterImpact): boolean {
  return result.fit !== null && result.outsideChanged === 0 && result.maxSeamJump <= 0.02 && limiterImpact.changed === 0;
}
