export interface CategoryFrame { data: Uint8ClampedArray; width: number; height: number }
export interface CategoryInput {
  frame?: CategoryFrame;
  faceDetected?: boolean;
  maskCoverage?: number;
  maskMainComponent?: number;
  maskAccepted?: boolean;
}

/** Sabit en çok 128² ızgara: video sınıflandırması model/GPU işi eklemez. */
export function measureCategoryEdges(frame: CategoryFrame) {
  const { width, height, data } = frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) {
    throw new Error('Invalid category frame dimensions');
  }
  const scale = Math.min(1, 128 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = 4 * (Math.min(height - 1, Math.floor(y / scale)) * width + Math.min(width - 1, Math.floor(x / scale)));
    gray[y * w + x] = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) / 255;
  }
  let count = 0, horizontal = 0, vertical = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const gx = -gray[p-w-1]+gray[p-w+1]-2*gray[p-1]+2*gray[p+1]-gray[p+w-1]+gray[p+w+1];
    const gy = -gray[p-w-1]-2*gray[p-w]-gray[p-w+1]+gray[p+w-1]+2*gray[p+w]+gray[p+w+1];
    if (Math.hypot(gx, gy) < 0.25) continue;
    count++;
    if (Math.abs(gy) <= Math.abs(gx) * 0.268) vertical++;
    if (Math.abs(gx) <= Math.abs(gy) * 0.268) horizontal++;
  }
  return { density: count / Math.max(1, (w - 2) * (h - 2)), axisRatio: count ? (horizontal + vertical) / count : 0,
    horizontalRatio: count ? horizontal / count : 0, verticalRatio: count ? vertical / count : 0 };
}

/** guven kalibre olasılık değildir; etiket yalnız kayıt amaçlıdır. */
export function classifyCategory(input: CategoryInput) {
  const edges = input.frame ? measureCategoryEdges(input.frame) : null;
  let kategori: 'portre/selfie' | 'doğa/sahne' | 'mimari' | 'bilinmiyor' = 'bilinmiyor';
  let guven = 0;
  if (input.faceDetected === true) { kategori = 'portre/selfie'; guven = 0.85; }
  else if (edges && edges.density > 0.08 && edges.axisRatio > 0.72 && edges.horizontalRatio > 0.12 && edges.verticalRatio > 0.12) {
    kategori = 'mimari'; guven = 0.55;
  } else if (input.faceDetected === false && edges && edges.density > 0.02 && edges.axisRatio < 0.55
    && !(input.maskAccepted && (input.maskCoverage ?? 0) >= 0.08 && (input.maskMainComponent ?? 0) >= 0.6)) {
    kategori = 'doğa/sahne'; guven = 0.4;
  }
  return { kategori, guven, sinyaller: { ...input, frame: undefined, edges, guvenTuru: 'heuristic-not-calibrated' as const } };
}
