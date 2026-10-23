/** Experimental VDA Small: official hidden-state streaming, trained window32. */
export const VDA_INPUT_WIDTH = 266;
export const VDA_INPUT_HEIGHT = 154;
export const VDA_DEFAULT_ENABLED = false;

export interface VdaHistory<T> { frames: T[]; frameId: number }
export function createVdaHistory<T>(): VdaHistory<T> { return { frames: [], frameId: -1 }; }

/** Match upstream first2 + latest29, including its persistent first-frame anchor. */
export function selectVdaHistory<T>(history: VdaHistory<T>): T[] {
  return history.frames.slice(0, 2).concat(history.frames.slice(-29));
}

export function advanceVdaHistory<T>(history: VdaHistory<T>, frame: T): void {
  history.frameId++;
  if (history.frameId === 0) history.frames = new Array(32).fill(frame);
  else history.frames.push(frame);
  if (history.frameId + 32 > 42) history.frames.splice(1, 1);
}

/** Upstream torch.cat(dim=1): flattening time first silently corrupts attention. */
export function packVdaCache(frames: readonly Float32Array[], spatial: number, channels: number): Float32Array {
  if (frames.some(frame => frame.length !== spatial * channels)) throw Error('Invalid VDA cache shape');
  const packed = new Float32Array(spatial * frames.length * channels);
  for (let pixel = 0; pixel < spatial; pixel++) {
    for (let time = 0; time < frames.length; time++) {
      packed.set(frames[time].subarray(pixel * channels, (pixel + 1) * channels), (pixel * frames.length + time) * channels);
    }
  }
  return packed;
}

export interface VdaFrameStamp {
  sourceId: string;
  time: number;
  width: number;
  height: number;
  signature: Float32Array;
}

/** A seek/cut must never import geometry from the previous temporal context. */
export function vdaResetReason(previous: VdaFrameStamp | null, next: VdaFrameStamp): string | null {
  if (!previous) return 'initial';
  if (previous.sourceId !== next.sourceId) return 'source';
  if (previous.width !== next.width || previous.height !== next.height) return 'dimensions';
  if (next.time <= previous.time) return 'seek';
  if (next.time - previous.time > 1) return 'gap';
  let difference = 0;
  if (previous.signature.length !== next.signature.length) return 'scene-cut';
  for (let i = 0; i < next.signature.length; i++) difference += Math.abs(previous.signature[i] - next.signature[i]);
  return difference / next.signature.length > 0.28 ? 'scene-cut' : null;
}
