import type { SegmentationResult } from './segmentation';

type TrainingFrame = { source: Blob; name: string; t: number };
type MaskedFrame<T extends TrainingFrame> = T & { mask: HTMLCanvasElement };

const INPUT_MAX_EDGE = 1024;
const MIN_FOREGROUND = 0.03;
const MAX_FOREGROUND = 0.95;
const MIN_MASKED_VIEWS = 8;
const MIN_VALID_FRACTION = 0.7;

/** Prepare reliable masks, keeping full RGB for camera solving. */
export async function prepareSubjectFrames<T extends TrainingFrame>(
  frames: T[],
  segment: (source: HTMLCanvasElement) => Promise<SegmentationResult>,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number, skipped: number) => void,
): Promise<{ frames: MaskedFrame<T>[]; skipped: number; release(): void }> {
  const output: MaskedFrame<T>[] = [];
  const masks: HTMLCanvasElement[] = [];
  const required = Math.max(MIN_MASKED_VIEWS, Math.ceil(frames.length * MIN_VALID_FRACTION));
  let skipped = 0;
  let lastSkipped = '';
  const release = () => {
    for (const mask of masks) { mask.width = 0; mask.height = 0; }
    masks.length = 0;
  };
  try {
    if (frames.length < required) {
      throw new Error(`Insufficient reliable subject masks: ${frames.length} selected frames, ` +
        `at least ${required} masked views required. Record a longer orbit or use full-scene training.`);
    }
    onProgress?.(0, frames.length, 0);
    for (let i = 0; i < frames.length; i++) {
      signal?.throwIfAborted();
      const frame = frames[i];
      const bitmap = await createImageBitmap(frame.source);
      let source: HTMLCanvasElement | null = null;
      try {
        signal?.throwIfAborted();
        const scale = Math.min(1, INPUT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        source = document.createElement('canvas');
        source.width = Math.max(1, Math.round(bitmap.width * scale));
        source.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = source.getContext('2d');
        if (!context) throw new Error('Cannot create a canvas for subject masking');
        context.drawImage(bitmap, 0, 0, source.width, source.height);

        const result = await segment(source);
        signal?.throwIfAborted();
        if (result.width < 1 || result.height < 1 ||
            result.mask.length !== result.width * result.height) {
          throw new Error(`Invalid subject mask for ${frame.name}`);
        }
        let foreground = 0;
        for (const alpha of result.mask) {
          if (!Number.isFinite(alpha)) throw new Error(`Invalid subject mask for ${frame.name}`);
          if (alpha >= 0.5) foreground++;
        }
        const coverage = foreground / result.mask.length;
        if (coverage < MIN_FOREGROUND || coverage > MAX_FOREGROUND) {
          // A transient IS-Net miss must not make a usable orbit fail. Keep
          // only frames with a real matte; training an unmasked outlier would
          // make its background vote against every other masked view.
          skipped++;
          lastSkipped = `${frame.name} (${Math.round(coverage * 100)}% foreground)`;
          onProgress?.(i + 1, frames.length, skipped);
          if (output.length + frames.length - i - 1 < required) {
            throw new Error(`Insufficient reliable subject masks: ${output.length}/${frames.length} ` +
              `kept, ${skipped} skipped; at least ${required} needed. Last skipped: ${lastSkipped}. ` +
              'Record a clearer orbit or use full-scene training.');
          }
          continue;
        }

        const mask = document.createElement('canvas');
        mask.width = result.width;
        mask.height = result.height;
        masks.push(mask);
        const maskContext = mask.getContext('2d');
        if (!maskContext) throw new Error('Cannot create a subject mask canvas');
        const image = maskContext.createImageData(result.width, result.height);
        for (let p = 0; p < result.mask.length; p++) {
          const alpha = Math.round(Math.min(1, Math.max(0, result.mask[p])) * 255);
          const pixel = p * 4;
          image.data[pixel] = alpha;
          image.data[pixel + 1] = alpha;
          image.data[pixel + 2] = alpha;
          image.data[pixel + 3] = 255;
        }
        maskContext.putImageData(image, 0, 0);
        output.push({ ...frame, mask });
        onProgress?.(i + 1, frames.length, skipped);
      } finally {
        if (source) { source.width = 0; source.height = 0; }
        bitmap.close();
      }
    }
    return { frames: output, skipped, release };
  } catch (error) {
    release();
    throw error;
  }
}
