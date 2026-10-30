export type OverlayMask = { data: Float32Array; width: number; height: number };

/**
 * What 'maskeyi göster' draws. Video: the mask the engine got with the last depth frame (after the
 * tracker shift), or a message when none is applied (separation off, no mask yet, after a seek).
 * Photo: the engine's own foreground mask, nothing when there is none (unchanged).
 */
export function maskeOverlayKaynagi(o: {
  video: boolean; videoMask: OverlayMask | null;
  photoMask: Float32Array | null | undefined; photoSize: { width: number; height: number } | null | undefined;
}): { mask: OverlayMask } | { mesaj: string } | null {
  if (o.video) return o.videoMask ? { mask: o.videoMask } : { mesaj: 'uygulanan video maskesi yok (nesne ayırma kapalı ya da maske henüz yok)' };
  if (!o.photoMask || !o.photoSize) return null;
  return { mask: { data: o.photoMask, width: o.photoSize.width, height: o.photoSize.height } };
}
