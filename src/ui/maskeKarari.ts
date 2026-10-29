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

/**
 * VIDEO nesne ayırma histerezisi (tek doğruluk kaynağı: canlı yol ve anahtar
 * kare yakalama aynı sabitleri kullanır). Kapalıyken >= AÇMA'da açılır, açıkken
 * yalnız < KAPATMA'da kapanır.
 *
 * Ölçüm (personal clip A konser klibi, IS-Net, 0,5 sn'de bir 70 kare,
 * docs/benchmarks/video-mask-refresh.md): oran p50 %13; %4,5–6,5 maskeler
 * sahnedeki 3–5 kişiden BİRİNİ seçiyor (kenar o kişiyi izliyor), %0–3,7
 * maskeler bacak/gövde parçası. %15 açma eşiği karelerin %67'sinde kişi
 * seçen maskeyi dışarıda bırakıyordu (%12–13'lük iki dansçı dahil) → açma %8
 * (karelerin %73'ü), kapatma parça sınırının hemen üstünde %4.
 * BİLİNEN SINIR: %4–8'lik geçerli ama küçük İLK maske ayırmayı açmaz;
 * maske yeniden istenmedikçe kapalı kalır. Açma
 * eşiği %8 altına indirilmedi: yukarıdaki sentetik "kadrajı yuttu" maskesi
 * %4,7 idi, tek klipte parça/kişi aralığı (%3,7 / %4,5) çok dar.
 */
export const AYIRMA_ACMA_ORANI = 0.08;
export const AYIRMA_KAPATMA_ORANI = 0.04;
/** Histerezisli sonraki ayırma durumu (kullanıcı-kapalı mandalı çağıranda). */
export function videoAyirmaDurumu(fgOran: number, acik: boolean): boolean {
  return acik ? fgOran >= AYIRMA_KAPATMA_ORANI : fgOran >= AYIRMA_ACMA_ORANI;
}

export type MaskeKarari =
  /** Maske kullanılır, nesne ayırma otomatik açılır (eski davranış). */
  | { tip: 'kullan'; ayirmaAcik: true; sebep: null }
  /** Maske kullanılır ama ayırma KAPALI başlar; sebep kullanıcıya söylenir. */
  | { tip: 'kullan'; ayirmaAcik: false; sebep: string }
  /** Maske hiç kullanılmaz (boş ya da tüm kare). */
  | { tip: 'atla'; ayirmaAcik: false; sebep: string };

/** Ana parça ön planın bundan azıysa maske "dağınık" sayılır (manzarada rastgele yamalar). */
export const MASKE_ANA_PARCA_MIN = 0.6;
/** Bu oranın altındaki parçalar dağınıklığa sayılmaz (el, tüy, benek). */
const PARCA_MIN_ORAN = 0.01;

/**
 * Ön planın ne kadarı EN BÜYÜK tek parçada (0..1). İnsan/nesne maskesi tek
 * gövdedir (~1); manzarada model gökyüzü, köprü, bina gibi kopuk yamaları
 * seçer (düşük). Parçalar yalnız 4-komşulukla ve küçültülmüş ızgarada sayılır.
 */
export function maskeTekParcaOrani(mask: Float32Array, w: number, h: number): number {
  const s = Math.max(1, Math.floor(Math.max(w, h) / 128));
  const gw = Math.ceil(w / s);
  const gh = Math.ceil(h / s);
  const fg = new Uint8Array(gw * gh);
  let toplam = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (mask[y * s * w + x * s] >= 0.5) { fg[y * gw + x] = 1; toplam++; }
    }
  }
  if (!toplam) return 1;
  const stack: number[] = [];
  const boyutlar: number[] = [];
  for (let i = 0; i < fg.length; i++) {
    if (fg[i] !== 1) continue;
    let boyut = 0;
    fg[i] = 2;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      boyut++;
      const x = p % gw;
      for (const q of [x > 0 ? p - 1 : -1, x < gw - 1 ? p + 1 : -1, p - gw, p + gw]) {
        if (q >= 0 && q < fg.length && fg[q] === 1) { fg[q] = 2; stack.push(q); }
      }
    }
    boyutlar.push(boyut);
  }
  const sayilan = boyutlar.filter((b) => b >= toplam * PARCA_MIN_ORAN);
  const say = sayilan.reduce((a, b) => a + b, 0);
  return say ? Math.max(...sayilan) / say : 1;
}

export function maskeKarari(fgOran: number, tekParca: number = 1): MaskeKarari {
  if (!(fgOran > 0)) {
    return { tip: 'atla', ayirmaAcik: false, sebep: 'nesne ayırma: boş maske üretildi; maske atlandı (tüm sahne)' };
  }
  const yuzde = (100 * fgOran).toFixed(0);
  if (fgOran > MASKE_UST_ESIK) {
    return {
      tip: 'atla',
      ayirmaAcik: false,
      sebep: `nesne ayırma: model kareyi tümüyle ön plan saydı (%${yuzde}); maske atlandı`,
    };
  }
  if (tekParca < MASKE_ANA_PARCA_MIN) {
    return {
      tip: 'atla',
      ayirmaAcik: false,
      sebep:
        `nesne ayırma: maske dağınık (ön planın yalnız %${(100 * tekParca).toFixed(0)}'i tek parça); ` +
        'öznesiz sahne sayıldı, maske atlandı',
    };
  }
  if (fgOran < MASKE_ALT_ESIK) {
    return {
      tip: 'kullan',
      ayirmaAcik: false,
      sebep:
        `nesne ayırma: maske kadrajın yalnız %${yuzde}'ini özne saydı; ` +
        'ayırma KAPALI başlatıldı (açık olsaydı sahnenin geri kalanı silinirdi). ' +
        '"nesne ayırma" düğmesiyle açabilirsin.',
    };
  }
  return { tip: 'kullan', ayirmaAcik: true, sebep: null };
}
