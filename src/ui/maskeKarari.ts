/**
 * NESNE AYIRMA KARARI — maske üretildikten sonra ne yapılacağının saf
 * mantığı. DOM'suz tutulur ki Node'dan doğrulanabilsin
 * (`scripts/verify-maske-karari.mjs`).
 *
 * ── SORUN (ölçüldü, 2026-09-25) ───────────────────────────────────────────
 * Segmentasyon modeli RMBG-1.4'ten IS-Net'e geçince "sentetik görsel"de
 * maske kadrajın yalnız **%4,7**'sini seçmeye başladı: yalnız kırmızı küre
 * özne sayıldı, panel ve zemin arka plana düştü. Nesne ayırma fotoğraf
 * yolunda OTOMATİK açıldığı için ekranda dolu piksel oranı %5,3 → **%0,7**'ye
 * indi; kullanıcı pratikte SİYAH EKRAN görüyordu ve sebebi hiçbir yerde
 * yazmıyordu.
 *
 * Aynı modelin meşru kadrajlardaki oranları (aynı ölçüm):
 *
 *   proje küçük resmi (gerçek fotoğraf)   %17,9
 *   bina cephesi test görüntüsü           %45,6
 *   sentetik görsel (hatalı davranış)      %4,7
 *
 * ── KARAR ─────────────────────────────────────────────────────────────────
 * Üst uç zaten korunuyordu ("model pes etti", %92 üstü). Alt uç eksikti.
 * %8 altındaki maske ATILMAZ — depth aşamaları ondan faydalanır (Gün E) ve
 * kullanıcı düğmeyle açabilir — ama nesne ayırma KENDİLİĞİNDEN açılmaz ve
 * sebep söylenir. Böylece ölçülen meşru en küçük kadraj (%17,9) rahatça
 * geçer, "kadrajı yuttu" durumu sessizce ekranı boşaltmaz.
 */

/** Bu oranın altında maske meşru olabilir ama OTOMATİK ayırmaya yetmez. */
export const MASKE_ALT_ESIK = 0.08;
/** Bu oranın üstünde model "her piksel ön plan" demiştir: maske işe yaramaz. */
export const MASKE_UST_ESIK = 0.92;

export type MaskeKarari =
  /** Maske kullanılır, nesne ayırma otomatik açılır (eski davranış). */
  | { tip: 'kullan'; ayirmaAcik: true; sebep: null }
  /** Maske kullanılır ama ayırma KAPALI başlar; sebep kullanıcıya söylenir. */
  | { tip: 'kullan'; ayirmaAcik: false; sebep: string }
  /** Maske hiç kullanılmaz (boş ya da tüm kare). */
  | { tip: 'atla'; ayirmaAcik: false; sebep: string };

export function maskeKarari(fgOran: number): MaskeKarari {
  if (!(fgOran > 0)) {
    return { tip: 'atla', ayirmaAcik: false, sebep: 'nesne ayırma: boş maske üretildi — maske atlandı (tüm sahne)' };
  }
  const yuzde = (100 * fgOran).toFixed(0);
  if (fgOran > MASKE_UST_ESIK) {
    return {
      tip: 'atla',
      ayirmaAcik: false,
      sebep: `nesne ayırma: model kareyi tümüyle ön plan saydı (%${yuzde}) — maske atlandı`,
    };
  }
  if (fgOran < MASKE_ALT_ESIK) {
    return {
      tip: 'kullan',
      ayirmaAcik: false,
      sebep:
        `nesne ayırma: maske kadrajın yalnız %${yuzde}'ini özne saydı — ` +
        'ayırma KAPALI başlatıldı (açık olsaydı sahnenin geri kalanı silinirdi). ' +
        '"nesne ayırma" düğmesiyle açabilirsin.',
    };
  }
  return { tip: 'kullan', ayirmaAcik: true, sebep: null };
}
