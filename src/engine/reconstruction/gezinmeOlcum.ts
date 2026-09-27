// Navigability measurement core: probe poses, today's fly bound and image
// metrics, all pure and Node-testable (no GPU, no DOM).
import type { GsKamera } from './egitim3dgs.ts';
import { kameraMerkezi } from './egitim3dgs.ts';
import type { CekimTuru, FlyAxes, FlySiniri } from '../../ui/egitimControls.ts';
import { flySiniri, flyStep, yolKamerasi } from '../../ui/egitimControls.ts';

type Vec3 = [number, number, number];

export type Bolge = 'bas' | 'orta' | 'son';
export type Yon = 'sag' | 'sol' | 'ileri' | 'yukari';

export interface Sonda { id: string; bolge: Bolge; s: number; yon: Yon; d: number; kamera: GsKamera }

export const BOLGELER: Record<Bolge, number> = { bas: 0.1, orta: 0.5, son: 0.9 };

/** Offsets in units of `olcumBirimi`; 0 is the on-path reference. */
export const MESAFELER: Record<Yon, number[]> = {
  sag: [0, 0.02, 0.04, 0.06, 0.1, 0.15, 0.2, 0.3],
  sol: [0, 0.02, 0.04, 0.06, 0.1, 0.15, 0.2, 0.3],
  ileri: [0, 0.05, 0.1, 0.2, 0.3],
  yukari: [0, 0.02, 0.04, 0.06, 0.1],
};

const fark = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const ic = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const birimVektor = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * Measurement unit: for a walk, the walked path length (same sum `flySiniri(...,
 * 'yol')` uses for its margin); for an orbit or mixed shot, the median
 * camera-to-pivot distance (`flySiniri(...).olcek`). All probe offsets and
 * today's-bound distances are fractions of this, so SfM's arbitrary scale and
 * world frame never change them — two runs of the same capture yield the same
 * probes.
 */
export function olcumBirimi(kameralar: Vec3[], pivot: Vec3, tur: CekimTuru): number {
  if (tur === 'yol' && kameralar.length >= 2) {
    let L = 0;
    for (let i = 1; i < kameralar.length; i++) L += Math.hypot(...fark(kameralar[i], kameralar[i - 1]));
    return L || 1;
  }
  return flySiniri(kameralar, pivot, tur).olcek;
}

/** Reference camera for a region fraction `s`: the smoothed along-path pose
 *  for a walk, else the nearest training pose (unchanged, not re-levelled). */
export function tabanKamera(pozlar: readonly GsKamera[], yukari: Vec3, tur: CekimTuru, s: number): GsKamera {
  if (tur === 'yol') return yolKamerasi(pozlar, yukari, s);
  const n = pozlar.length;
  const i = Math.max(0, Math.min(n - 1, Math.round(s * (n - 1))));
  return pozlar[i];
}

/** Same camera, translated to a new centre (no rotation). */
function oteleKamera(k: GsKamera, C2: Vec3): GsKamera {
  const t = [0, 1, 2].map((r) => -(k.R[r * 3] * C2[0] + k.R[r * 3 + 1] * C2[1] + k.R[r * 3 + 2] * C2[2]));
  return { ...k, t };
}

/**
 * Probe poses: for each region x direction x offset, the region's base camera
 * translated (never rotated) `d * olcumBirimi` along that world direction —
 * `sag` = +R row 0, `sol` = -R row 0, `ileri` = +R row 2, `yukari` = the world
 * up vector. `d = 0` is the same on-path reference regardless of direction, so
 * it is emitted once per region (`${bolge}_merkez_0.00`, tagged `yon: 'sag'`).
 */
export function sondaPozlari(
  pozlar: readonly GsKamera[], yukari: Vec3, pivot: Vec3, tur: CekimTuru,
  secim?: { bolgeler?: Bolge[]; yonler?: Yon[] },
): Sonda[] {
  const bolgeler = secim?.bolgeler ?? (Object.keys(BOLGELER) as Bolge[]);
  const yonler = secim?.yonler ?? (Object.keys(MESAFELER) as Yon[]);
  const birim = olcumBirimi(pozlar.map(kameraMerkezi), pivot, tur);
  const up = birimVektor(yukari);
  const sondalar: Sonda[] = [];
  for (const bolge of bolgeler) {
    const s = BOLGELER[bolge];
    const taban = tabanKamera(pozlar, yukari, tur, s);
    const sag: Vec3 = [taban.R[0], taban.R[1], taban.R[2]];
    const ileri: Vec3 = [taban.R[6], taban.R[7], taban.R[8]];
    const yonVektorleri: Record<Yon, Vec3> = { sag, sol: [-sag[0], -sag[1], -sag[2]], ileri, yukari: up };
    const tabanMerkez = kameraMerkezi(taban);
    let merkezVar = false;
    for (const yon of yonler) {
      for (const d of MESAFELER[yon]) {
        if (d === 0) {
          if (merkezVar) continue;
          merkezVar = true;
          sondalar.push({ id: `${bolge}_merkez_0.00`, bolge, s, yon: 'sag', d: 0, kamera: taban });
          continue;
        }
        const dir = yonVektorleri[yon];
        const mesafe = d * birim;
        const C2: Vec3 = [tabanMerkez[0] + dir[0] * mesafe, tabanMerkez[1] + dir[1] * mesafe, tabanMerkez[2] + dir[2] * mesafe];
        sondalar.push({ id: `${bolge}_${yon}_${d.toFixed(2)}`, bolge, s, yon, d, kamera: oteleKamera(taban, C2) });
      }
    }
  }
  return sondalar;
}

function eksenler(yon: Yon): FlyAxes {
  switch (yon) {
    case 'sag': return { forward: 0, right: 1, vertical: 0 };
    case 'sol': return { forward: 0, right: -1, vertical: 0 };
    case 'ileri': return { forward: 1, right: 0, vertical: 0 };
    case 'yukari': return { forward: 0, right: 0, vertical: 1 };
  }
}

function istenenYon(taban: GsKamera, yon: Yon, yukari: Vec3): Vec3 {
  switch (yon) {
    case 'sag': return [taban.R[0], taban.R[1], taban.R[2]];
    case 'sol': return [-taban.R[0], -taban.R[1], -taban.R[2]];
    case 'ileri': return [taban.R[6], taban.R[7], taban.R[8]];
    case 'yukari': return birimVektor(yukari);
  }
}

/**
 * Today's fly-mode bound in `yon`, starting from `taban`: repeated `flyStep`s
 * of `birim * 0.005` (up to 400) until the step's progress along the
 * requested world direction drops below 10% of the step size — the bound has
 * been reached. Returns the distance walked, in units of `birim`.
 */
export function bugunkuSinir(taban: GsKamera, yon: Yon, sinir: FlySiniri, yukari: Vec3, birim: number): number {
  const dir = istenenYon(taban, yon, yukari);
  const axes = eksenler(yon);
  const adim = birim * 0.005;
  let kamera = taban;
  let toplam = 0;
  for (let i = 0; i < 400; i++) {
    const sonraki = flyStep(kamera, axes, adim, sinir, yukari);
    const ilerleme = ic(fark(kameraMerkezi(sonraki), kameraMerkezi(kamera)), dir);
    if (ilerleme < adim * 0.1) break;
    toplam += ilerleme;
    kamera = sonraki;
  }
  return toplam / birim;
}

// ── image metrics (RGBA Uint8ClampedArray, canvas ImageData layout) ────────

function luminans(img: Uint8ClampedArray, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    out[p] = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
  }
  return out;
}

/** PSNR over RGB (alpha excluded), values 0..255; `maske` (1 per pixel, same
 *  width*height as the images) restricts the comparison to masked pixels.
 *  Identical input -> Infinity. */
export function psnr(a: Uint8ClampedArray, b: Uint8ClampedArray, maske?: Uint8Array): number {
  let sum = 0, n = 0;
  const pixelCount = a.length / 4;
  for (let p = 0; p < pixelCount; p++) {
    if (maske && !maske[p]) continue;
    const i = p * 4;
    for (let c = 0; c < 3; c++) {
      const d = a[i + c] - b[i + c];
      sum += d * d;
      n++;
    }
  }
  if (n === 0 || sum === 0) return Infinity;
  const mse = sum / n;
  return 10 * Math.log10((255 * 255) / mse);
}

/** Structural similarity on luminance (0.299/0.587/0.114), 8x8 windows
 *  stepped by 4, averaged; C1 = (0.01*255)^2, C2 = (0.03*255)^2. */
export function ssim(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number): number {
  const la = luminans(a, w, h), lb = luminans(b, w, h);
  const WIN = 8, STEP = 4, N = WIN * WIN;
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let total = 0, count = 0;
  for (let y = 0; y + WIN <= h; y += STEP) {
    for (let x = 0; x + WIN <= w; x += STEP) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let j = 0; j < WIN; j++) {
        for (let i = 0; i < WIN; i++) {
          const va = la[(y + j) * w + (x + i)], vb = lb[(y + j) * w + (x + i)];
          sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const mua = sa / N, mub = sb / N;
      const vara = saa / N - mua * mua, varb = sbb / N - mub * mub, cov = sab / N - mua * mub;
      total += ((2 * mua * mub + C1) * (2 * cov + C2)) / ((mua * mua + mub * mub + C1) * (vara + varb + C2));
      count++;
    }
  }
  return count ? total / count : 1;
}

/** Variance of the 4-neighbour Laplacian on luminance (edge pixels excluded):
 *  0 on a flat image, higher with more high-frequency detail (focus measure). */
export function keskinlik(img: Uint8ClampedArray, w: number, h: number): number {
  const l = luminans(img, w, h);
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * l[i] - l[i - 1] - l[i + 1] - l[i - w] - l[i + w];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (n === 0) return 0;
  const ortalama = sum / n;
  return sumSq / n - ortalama * ortalama;
}

/** Coverage from the same pose rendered on black and white backgrounds: per-
 *  pixel transmittance `T = mean_rgb(beyaz - siyah) / 255` (0 = opaque pixel,
 *  1 = empty); returns `1 - mean(T)`, clamped to 0..1. */
export function kaplama(siyah: Uint8ClampedArray, beyaz: Uint8ClampedArray): number {
  const n = siyah.length / 4;
  if (n === 0) return 1;
  let sum = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const t = ((beyaz[i] - siyah[i]) + (beyaz[i + 1] - siyah[i + 1]) + (beyaz[i + 2] - siyah[i + 2])) / 3 / 255;
    sum += t;
  }
  return Math.max(0, Math.min(1, 1 - sum / n));
}

/** Largest `d`, starting from `d = 0`, up to and including which every entry
 *  (in ascending `d` order) is `iyi`; 0 if even `d = 0` is not `iyi`. */
export function kullanilabilirMesafe(seri: { d: number; iyi: boolean }[]): number {
  const sirali = [...seri].sort((a, b) => a.d - b.d);
  let en = 0;
  for (const { d, iyi } of sirali) {
    if (!iyi) break;
    en = d;
  }
  return en;
}
