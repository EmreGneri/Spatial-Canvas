// VİDEO MASKESİ ZAMANSAL YUMUŞATMA — kare başına IS-Net maskesi titrer (kenar
// pikselleri 0.5 çevresinde gidip gelir). Son N maskenin ortalaması kenarı
// yumuşatır; N > ~5 görünür gecikme verir, o yüzden varsayılan 3.

export const MASK_TEMPORAL_FRAMES = 3;
/** Yeni maske öncekiyle bu IoU'nun altındaysa sahne kesildi sayılır: geçmiş atılır. */
export const MASK_CUT_IOU = 0.3;

export interface MaskSmoother {
  /** Yeni maskeyi ekler, son N maskenin ortalamasını döndürür. */
  push(mask: Float32Array, w: number, h: number): Float32Array;
  /** Kaynak değişince çağrılır. */
  reset(): void;
}

function iou(a: Float32Array, b: Float32Array): number {
  let kes = 0, bir = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] >= 0.5, y = b[i] >= 0.5;
    if (x && y) kes++;
    if (x || y) bir++;
  }
  return bir === 0 ? 1 : kes / bir;
}

export function createMaskSmoother(frames: number = MASK_TEMPORAL_FRAMES): MaskSmoother {
  let ring: Float32Array[] = [];
  let dim = '';
  return {
    push(mask, w, h) {
      const key = `${w}x${h}`;
      if (key !== dim || (ring.length && iou(ring[ring.length - 1], mask) < MASK_CUT_IOU)) ring = [];
      dim = key;
      ring.push(mask);
      if (ring.length > frames) ring.shift();
      if (ring.length === 1) return mask;
      const out = new Float32Array(mask.length);
      for (const m of ring) for (let i = 0; i < out.length; i++) out[i] += m[i];
      for (let i = 0; i < out.length; i++) out[i] /= ring.length;
      return out;
    },
    reset() { ring = []; dim = ''; },
  };
}
