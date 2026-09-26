/**
 * EĞİTİM İLERLEME GRAFİĞİ — DOM'suz, Node'dan test edilir.
 *
 * NEDEN: eğitim sırasında kullanıcı yalnız "eğitiliyor" ve bir yüzde görüyordu.
 * Yüzde GEÇEN ZAMANI söyler, KALİTEYİ söylemez — kullanıcı çıktının iyileşip
 * iyileşmediğini bilmediği için bekleme "boşa geçen zaman" gibi hissediliyor.
 * Trainer iterasyon başına PSNR + Gaussian sayısı üretiyor (`olay.metrik`);
 * eksik olan tek şey onu ÇİZMEKTİ.
 *
 * X ekseni 0..BÜTÇE (hedef iterasyon), ölçülen son iterasyona kadar değil:
 * çizgi kadrajın sağına doğru büyüdükçe bitişe ne kadar kaldığı görünür
 * (tasarim-kurallari.md · hedef-gradyanı etkisi). Y ekseni serinin kendi
 * aralığı — PSNR 0'dan başlamaz, sabit 0..50 ekseninde iyileşme düz bir çizgi
 * gibi görünürdü.
 */

export interface GrafikNoktasi {
  iter: number;
  /** Eğitim PSNR'ı (dB). */
  psnr: number;
  /** Gaussian sayısı — çizgide değil, sayı olarak gösterilir. */
  splats: number;
}

/**
 * Seride tutulacak en çok nokta. 10.000 iterasyonda trainer yüzlerce metrik
 * basar; 240 nokta 300 px genişlikte zaten pikselden fazla — fazlası bellek ve
 * çizim maliyeti.
 */
export const SERI_SINIRI = 240;

/**
 * Yeni ölçümü seriye ekler. YENİ DİZİ döndürür (React state'i yerinde
 * değiştirilmez). Sınır dolunca seri YARIYA SEYRELTİLİR (her ikinciyi tut):
 * en eskiyi atmak eğrinin BAŞINI keser, oysa iyileşmenin en dik yeri orasıdır.
 */
export function seriEkle(
  seri: readonly GrafikNoktasi[],
  m: { iter: number; splats: number; psnrTrain?: number; psnrHold?: number },
  sinir = SERI_SINIRI,
): GrafikNoktasi[] {
  const psnr = m.psnrTrain ?? m.psnrHold;
  // PSNR henüz yoksa (ilk iterasyonlar) nokta EKLENMEZ: 0 dB uydurmak eğriyi
  // yalan bir dipten başlatır.
  if (typeof psnr !== 'number' || !Number.isFinite(psnr)) return seri as GrafikNoktasi[];
  // Aynı iterasyon iki kez gelirse (trainer tekrar basabilir) üzerine yaz.
  const son = seri[seri.length - 1];
  if (son && son.iter === m.iter) {
    const kopya = seri.slice(0, -1);
    kopya.push({ iter: m.iter, psnr, splats: m.splats });
    return kopya;
  }
  const next = [...seri, { iter: m.iter, psnr, splats: m.splats }];
  if (next.length <= sinir) return next;
  const seyrek = next.filter((_, i) => i % 2 === 0);
  // Son nokta HER ZAMAN kalmalı: canlı uç seyreltmede düşerse grafik geride kalır.
  if (seyrek[seyrek.length - 1] !== next[next.length - 1]) seyrek.push(next[next.length - 1]);
  return seyrek;
}

export interface GrafikDuzeni {
  /** SVG polyline `points` niteliği — boş dizide ''. */
  yol: string;
  /** Y ekseni aralığı (dB) — eksen etiketi bunu yazar. */
  yMin: number;
  yMax: number;
  /** Son ölçüm — sayı olarak gösterilir. */
  son: GrafikNoktasi | null;
  /** Kadrajın x'i: son iterasyon / bütçe, 0..1. */
  ilerleme: number;
}

/** Düz seride eksen çökmesin diye açılan en küçük aralık (dB). */
const EN_KUCUK_ARALIK = 1;

/**
 * Seriyi bir SVG kadrajına oturtur. `hedefIter` = bütçe (X ekseninin sonu);
 * 0 ya da eksikse serinin son iterasyonu kullanılır.
 */
export function grafikDuzeni(
  seri: readonly GrafikNoktasi[],
  genislik: number,
  yukseklik: number,
  hedefIter: number,
  pay = 2,
): GrafikDuzeni {
  const son = seri.length ? seri[seri.length - 1] : null;
  if (seri.length === 0) return { yol: '', yMin: 0, yMax: 0, son: null, ilerleme: 0 };

  const sonIter = son!.iter;
  const xSon = Math.max(1, hedefIter > 0 ? hedefIter : sonIter);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const n of seri) {
    if (n.psnr < yMin) yMin = n.psnr;
    if (n.psnr > yMax) yMax = n.psnr;
  }
  if (yMax - yMin < EN_KUCUK_ARALIK) {
    const orta = (yMax + yMin) / 2;
    yMin = orta - EN_KUCUK_ARALIK / 2;
    yMax = orta + EN_KUCUK_ARALIK / 2;
  }
  const ic = { w: Math.max(1, genislik - pay * 2), h: Math.max(1, yukseklik - pay * 2) };
  const parcalar: string[] = [];
  for (const n of seri) {
    const x = pay + (Math.min(n.iter, xSon) / xSon) * ic.w;
    // SVG y AŞAĞI artar; yüksek PSNR YUKARI çizilmeli.
    const y = pay + (1 - (n.psnr - yMin) / (yMax - yMin)) * ic.h;
    parcalar.push(`${round(x)},${round(y)}`);
  }
  return {
    yol: parcalar.join(' '),
    yMin,
    yMax,
    son,
    ilerleme: Math.min(1, sonIter / xSon),
  };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Son N noktadaki eğim (dB / 1000 iterasyon). Kullanıcıya "daha iyileşiyor mu,
 * doymuş mu" sorusunun cevabı; "sürdür +4.000" düğmesine basmaya değip
 * değmeyeceğini söyler. Ölçemiyorsa `null` — uydurma eğim basılmaz.
 */
export function egim(seri: readonly GrafikNoktasi[], pencere = 20): number | null {
  if (seri.length < 3) return null;
  const dilim = seri.slice(-Math.max(3, pencere));
  const ilk = dilim[0];
  const son = dilim[dilim.length - 1];
  const dIter = son.iter - ilk.iter;
  if (dIter <= 0) return null;
  return ((son.psnr - ilk.psnr) / dIter) * 1000;
}
