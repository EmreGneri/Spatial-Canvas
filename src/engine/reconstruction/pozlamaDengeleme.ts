/**
 * POZLAMA / BEYAZ DENGESİ ÖN GEÇİŞİ — telefonlar her karede pozlamayı ve beyaz
 * dengesini kendisi ayarlar; 3DGS bu farkı görüş yönüne bağlı renk (SH) ya da
 * yüzen splat'larla "açıklamaya" çalışır.
 *
 * ── YÖNTEM ─────────────────────────────────────────────────────────────────
 * Kare başına kanal kazancı, SfM'in ÇÖZDÜĞÜ 3B noktaların farklı karelerdeki
 * renklerinden kestirilir. Kare ortalamasını eşitlemek İŞE YARAMAZ: sentetik
 * orman klibinde (pozlama sabit, render) kare ortalama parlaklığı yalnız
 * içerik değişiminden 38–56/255 arasında oynuyor (ölçüldü). Aynı yüzey
 * noktasının renk oranı ise içerikten bağımsızdır.
 *
 *   log g_kc = medyan_p ( ref_pc − log I_kc(p) ),  ref_pc = medyan_k log I_kc(p)
 *
 * Üç tur (her tur düzeltilmiş gözlemlerle ref yeniden), medyan örtülme
 * aykırılarını taşır. Kazançların kanal başına geometrik ortalaması 1'e
 * çekilir (sahnenin ortalama pozlaması korunur). Yalnız KAZANÇ: kaydırma
 * (bias) medyanla kararsız ve telefon tonlamasında kazanç baskın terim.
 *
 * Saf çekirdek DOM'suz; `gozlemleriTopla` yalnız `sampleColor` çağırır.
 */
import type { Vec3 } from './bosAlan.ts';

export interface Gozlem { kare: number; rgb: readonly number[] }

export interface PozlamaKazanci {
  /** Kare başına çarpan [r, g, b]; ölçülemeyen karede [1, 1, 1]. */
  kazanc: [number, number, number][];
  olculen: boolean[];
}

/** Bir karenin ölçülmüş sayılması için en az gözlem. */
const EN_AZ_GOZLEM = 30;
/** Bu bandın dışındaki değerler kırpılmış/gürültülü: oran anlamsız. */
const KARANLIK = 0.03, KIRPIK = 0.97;
/** ln(1,5): bundan büyük düzeltme bir hatanın (yanlış eşleşme) işaretidir. */
const KELEPCE = Math.log(1.5);
const TUR = 3;

function medyan(a: number[]): number {
  a.sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function pozlamaKazanclari(gozlemler: readonly Gozlem[][], kareSayisi: number): PozlamaKazanci {
  // Geçerli gözlemler log uzayında: nokta → [kare, lr, lg, lb]
  const noktalar: { kare: number; l: number[] }[][] = [];
  for (const obs of gozlemler) {
    const ok = obs.filter((o) => o.kare >= 0 && o.kare < kareSayisi
      && o.rgb.every((v) => v > KARANLIK && v < KIRPIK))
      .map((o) => ({ kare: o.kare, l: [Math.log(o.rgb[0]), Math.log(o.rgb[1]), Math.log(o.rgb[2])] }));
    if (ok.length >= 2) noktalar.push(ok);
  }
  const logG = Array.from({ length: kareSayisi }, () => [0, 0, 0]);
  const sayi = new Array(kareSayisi).fill(0);
  for (const obs of noktalar) for (const o of obs) sayi[o.kare]++;
  const olculen = sayi.map((n) => n >= EN_AZ_GOZLEM);

  for (let tur = 0; tur < TUR; tur++) {
    const fark: number[][][] = Array.from({ length: kareSayisi }, () => [[], [], []]);
    for (const obs of noktalar) {
      const ilgili = obs.filter((o) => olculen[o.kare]);
      if (ilgili.length < 2) continue;
      for (let c = 0; c < 3; c++) {
        const ref = medyan(ilgili.map((o) => o.l[c] + logG[o.kare][c]));
        for (const o of ilgili) fark[o.kare][c].push(ref - o.l[c]);
      }
    }
    for (let k = 0; k < kareSayisi; k++) {
      if (!olculen[k]) continue;
      for (let c = 0; c < 3; c++) logG[k][c] = fark[k][c].length ? medyan(fark[k][c]) : 0;
    }
    // geometrik ortalama 1: ölçülen karelerin log ortalaması 0
    const n = olculen.filter(Boolean).length;
    if (n === 0) break;
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < kareSayisi; k++) if (olculen[k]) s += logG[k][c];
      for (let k = 0; k < kareSayisi; k++) if (olculen[k]) logG[k][c] -= s / n;
    }
  }
  return {
    kazanc: logG.map((g, k) => (olculen[k]
      ? g.map((v) => Math.exp(Math.max(-KELEPCE, Math.min(KELEPCE, v)))) as [number, number, number]
      : [1, 1, 1])),
    olculen,
  };
}

/** Eğitim hedefine yerinde uygular. Negatif değer (-1 nöbetçi: kayıp dışı
 *  piksel) korunur; sonuç 1'de kırpılır. */
export function kazancUygula(rgb: Float32Array, g: readonly number[]): void {
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    if (rgb[i] < 0) continue;
    rgb[i] = Math.min(1, rgb[i] * g[0]);
    rgb[i + 1] = Math.min(1, rgb[i + 1] * g[1]);
    rgb[i + 2] = Math.min(1, rgb[i + 2] * g[2]);
  }
}

interface KareLike { fw: number; fh: number; sampleColor(x: number, y: number): number[] }
interface KameraLike { imgIdx: number; R: ArrayLike<number>; t: ArrayLike<number>; f: number; fy?: number; cx?: number; cy?: number }

/**
 * SfM noktalarını her kayıtlı kameraya izdüşürüp (özellik ölçeğinde, iğne
 * deliği; bozulma ihmal) renk örnekler. Görünürlük bilinmez — örtülen
 * gözlemleri `pozlamaKazanclari`'nın medyanı taşır. `haric` karelerinden
 * (ölçüm için ayrılan kareler) gözlem alınmaz. Nokta başına ≥ 2 gözlem.
 */
export function gozlemleriTopla(
  kareler: readonly KareLike[], kameralar: readonly KameraLike[], noktalar: readonly Vec3[],
  haric?: ReadonlySet<number>,
): Gozlem[][] {
  const sonuc: Gozlem[][] = [];
  const kullan = kameralar.filter((c) => !haric?.has(c.imgIdx) && kareler[c.imgIdx]);
  for (const X of noktalar) {
    const obs: Gozlem[] = [];
    for (const c of kullan) {
      const { R, t } = c;
      const z = R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2];
      if (!(z > 1e-6)) continue;
      const im = kareler[c.imgIdx];
      const u = c.f * (R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0]) / z + (c.cx ?? im.fw / 2);
      const v = (c.fy ?? c.f) * (R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1]) / z + (c.cy ?? im.fh / 2);
      if (u < 1 || v < 1 || u > im.fw - 2 || v > im.fh - 2) continue;
      obs.push({ kare: c.imgIdx, rgb: im.sampleColor(u, v) });
    }
    if (obs.length >= 2) sonuc.push(obs);
  }
  return sonuc;
}

/** ÖLÇÜM: tahmini kanal başına en küçük kareler kazancıyla gerçeğe hizalayıp
 *  PSNR (RGBA8). Ayrılan karenin KENDİ pozlaması/beyaz dengesi modele hata
 *  sayılmasın diye (NeRF-W/Mip-NeRF 360 değerlendirmesindeki renk hizalaması). */
export function kazancHizaliPsnr(tahmin: Uint8ClampedArray, gercek: Uint8ClampedArray): number {
  const tt = [0, 0, 0], tg = [0, 0, 0];
  for (let i = 0; i < tahmin.length; i += 4) for (let c = 0; c < 3; c++) {
    tt[c] += tahmin[i + c] * tahmin[i + c]; tg[c] += tahmin[i + c] * gercek[i + c];
  }
  const k = tt.map((v, c) => (v > 0 ? tg[c] / v : 1));
  let sum = 0, n = 0;
  for (let i = 0; i < tahmin.length; i += 4) for (let c = 0; c < 3; c++) {
    const d = Math.min(255, tahmin[i + c] * k[c]) - gercek[i + c];
    sum += d * d; n++;
  }
  return n === 0 || sum === 0 ? Infinity : 10 * Math.log10((255 * 255) / (sum / n));
}
