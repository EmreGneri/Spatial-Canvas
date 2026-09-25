/**
 * ÇIKTI İMZASININ SAF MANTIĞI — Z1. DOM'suz tutulur ki Node'dan
 * doğrulanabilsin (`scripts/verify-cikti-imza.mjs`); `ExportBar.tsx` yalnız
 * bu hesabı canvas'a çizer.
 *
 * NEDEN AYRI DOSYA: yerleşim hatası (kutunun kareden taşması, 2x PNG'de
 * yazının küçülmesi) ekranda gözle yakalanması zor ama sayıyla kolay
 * yakalanır. Projenin UI kuralı: karar mantığı DOM'dan ayrı dursun.
 */

/** İmzanın canvas üzerindeki kutusu — piksel uzayı, sol-üst orijin. */
export interface ImzaYerlesimi {
  /** Yazının taban çizgisinin başlangıç noktası. */
  metinX: number;
  metinY: number;
  /** Arkadaki koyu kutu. */
  kutuX: number;
  kutuY: number;
  kutuW: number;
  kutuH: number;
  /** Yazı boyu (px). */
  boy: number;
}

/** Yazı boyu kare yüksekliğinin bu oranıdır — 2x PNG'de de aynı GÖRÜNÜR boy. */
export const IMZA_ORAN = 0.028;
/** Küçük kayıtlarda okunmaz hale gelmesin. */
export const IMZA_MIN_BOY = 10;

export function imzaMetni(surum: string): string {
  return `spatial-canvas v${surum}`;
}

/**
 * Sağ alt köşeye yerleşim. `metinGenisligi` çağıranın ölçtüğü değerdir
 * (`ctx.measureText`), çünkü yazı tipi metriği yalnız tarayıcıda bilinir.
 */
export function imzaYerlesimi(w: number, h: number, metinGenisligi: number): ImzaYerlesimi {
  const boy = Math.max(IMZA_MIN_BOY, Math.round(h * IMZA_ORAN));
  const pad = Math.round(boy * 0.5);
  const metinX = w - metinGenisligi - pad * 2;
  const metinY = h - pad;
  return {
    metinX,
    metinY,
    kutuX: metinX - pad,
    kutuY: metinY - boy - pad * 0.6,
    kutuW: metinGenisligi + pad * 2,
    kutuH: boy + pad * 1.2,
    boy,
  };
}
