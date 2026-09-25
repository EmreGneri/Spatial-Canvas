import type { YetenekRaporu } from '../engine/vision/yetenek';

/**
 * YETENEK UYARISININ SAF KARARI — Z2. DOM'suz tutulur ki Node'dan
 * doğrulanabilsin (`scripts/verify-yetenek-uyarisi.mjs`); `YetenekUyarisi.tsx`
 * yalnız bu kararı çizer.
 *
 * Kritik kural burada yaşar: `sebep === null` ise HİÇBİR ŞEY gösterilmez.
 * Çalışan kurulumda "her şey yolunda" rozeti göstermek, sonraki gerçek
 * uyarının okunmamasına yol açar.
 */

export interface YetenekGorunumu {
  goster: boolean;
  /** Şeritte gösterilecek rozetler; `goster` false ise boştur. */
  rozetler: { ad: string; acik: boolean }[];
  /** Şeritteki açıklama; `goster` false ise null. */
  sebep: string | null;
}

const GIZLI: YetenekGorunumu = { goster: false, rozetler: [], sebep: null };

export function yetenekGorunumu(rapor: YetenekRaporu | null, kapatildi: boolean): YetenekGorunumu {
  if (!rapor || kapatildi) return GIZLI;
  // Sebep yoksa kapalı yetenek de yoktur: gürültü üretme.
  if (rapor.sebep === null) return GIZLI;
  return {
    goster: true,
    rozetler: [
      { ad: 'WebGPU', acik: rapor.webgpu },
      { ad: 'canlı derinlik', acik: rapor.canliDerinlik === 'acik' },
      { ad: 'nesne tespiti', acik: rapor.tespit === 'acik' },
    ],
    sebep: rapor.sebep,
  };
}
