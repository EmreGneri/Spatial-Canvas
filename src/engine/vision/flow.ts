// GÜN 3 — D.6: optik akış (Shi-Tomasi köşe tespiti + piramidal Lucas-Kanade).
// Saf CPU klasik CV (üretici model YASAK). Math.random YOK — her hesaplama
// deterministik dizi/tensör işlemidir: aynı girdi, aynı çıktı (repo kuralı;
// verify-flow.mjs iki koşuyu birebir karşılaştırır).
import type { FlowPoint } from './types.ts';

/** D.6 — çalışma çözünürlüğü. */
export const FLOW_WIDTH = 320;
export const FLOW_HEIGHT = 180;

/** D.6 — hedef köşe sayısı bandı. FONKSİYONLAR BUNLARI ZORLAMAZ: düşük
 *  dokulu karede 300'ün altı köşe bulunabilir — o durumda OLDUĞU GİBİ döner,
 *  sahte köşe ÜRETİLMEZ. */
export const MIN_CORNERS = 300;
export const MAX_CORNERS = 500;

/** Shi-Tomasi köşe adayı. */
export interface Corner {
  x: number;
  y: number;
  score: number;
}

// ---------------------------------------------------------------------------
// Private yardımcılar
// ---------------------------------------------------------------------------

/**
 * 3×3 Sobel ile ayrı Ix/Iy bileşenleri — yapı tensörü her iki bileşene
 * ihtiyaç duyar (skaler büyüklük yetmez; sobelMagnitude kopyalanmaz).
 * Kenarlar kelepçeli (sınır dışına okuma yok). Standart kernel:
 * gx = sağ kolon − sol kolon, gy = alt satır − üst satır (orta satır/sütun
 * 2× ağırlıklı — klasik Sobel normalize).
 */
function sobelGradients(lum: Float32Array, w: number, h: number): { ix: Float32Array; iy: Float32Array } {
  const ix = new Float32Array(lum.length);
  const iy = new Float32Array(lum.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      const tl = lum[y0 * w + x0];
      const tc = lum[y0 * w + x];
      const tr = lum[y0 * w + x1];
      const ml = lum[y * w + x0];
      const mr = lum[y * w + x1];
      const bl = lum[y1 * w + x0];
      const bc = lum[y1 * w + x];
      const br = lum[y1 * w + x1];
      const i = y * w + x;
      ix[i] = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      iy[i] = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
    }
  }
  return { ix, iy };
}

/**
 * Ayrılabilir 3×3 kutu filtresi (kenarlar kelepçeli). Ix² / Iy² / Ix·Iy
 * görüntülerine uygulanır → yapı tensörü pencereleri. depth.ts'teki boxBlur
 * deseniyle aynı felsefe (yatay geçiş + dikey geçiş, sınır kelepçe) — kod
 * kopyalanmaz, flow.ts kendi helper'ını taşır.
 */
function boxBlur3(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      tmp[y * w + x] = (src[y * w + x0] + src[y * w + x] + src[y * w + x1]) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      out[y * w + x] = (tmp[y0 * w + x] + tmp[y * w + x] + tmp[y1 * w + x]) / 3;
    }
  }
  return out;
}

/** Bilinear örnekleme (kenar kelepçe). LK warp'lu konumları alt-pikseldir. */
function bilinear(tex: Float32Array, w: number, h: number, x: number, y: number): number {
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const a = tex[y0 * w + x0];
  const b = tex[y0 * w + x1];
  const c = tex[y1 * w + x0];
  const d = tex[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (d - b - c + a) * fx * fy;
}

/**
 * Piramit: her seviye bir öncekinin 2×2 ORTALAMASI (deterministik; kenarlar
 * kelepçeli). Seviye 0 = orijinal görüntü; boyutlar floor(w/2ᵉ) × floor(h/2ᵉ).
 */
function buildPyramid(lum: Float32Array, w: number, h: number, levels: number): Float32Array[] {
  const pyr: Float32Array[] = [lum];
  for (let l = 1; l < levels; l++) {
    const cw = Math.max(1, Math.floor(w / Math.pow(2, l - 1)));
    const ch = Math.max(1, Math.floor(h / Math.pow(2, l - 1)));
    const pw = Math.max(1, Math.floor(cw / 2));
    const ph = Math.max(1, Math.floor(ch / 2));
    const src = pyr[l - 1];
    const dst = new Float32Array(pw * ph);
    for (let y = 0; y < ph; y++) {
      const sy0 = Math.min(ch - 1, 2 * y);
      const sy1 = Math.min(ch - 1, 2 * y + 1);
      for (let x = 0; x < pw; x++) {
        const sx0 = Math.min(cw - 1, 2 * x);
        const sx1 = Math.min(cw - 1, 2 * x + 1);
        dst[y * pw + x] =
          (src[sy0 * cw + sx0] + src[sy0 * cw + sx1] + src[sy1 * cw + sx0] + src[sy1 * cw + sx1]) / 4;
      }
    }
    pyr.push(dst);
  }
  return pyr;
}

// ---------------------------------------------------------------------------
// MADDE 1 — Shi-Tomasi köşe tespiti
// ---------------------------------------------------------------------------

/**
 * Shi-Tomasi köşe tespiti (min-eigenvalue — Harris'in det−k·trace²
 * formülü DEĞİL, isim oradan gelir). Adımlar:
 *   1. Sobel ile ayrı Ix,Iy.
 *   2. Yapı tensörü pencereleri: Sxx=boxBlur(Ix²), Syy=boxBlur(Iy²),
 *      Sxy=boxBlur(Ix·Iy) (3×3 kutu).
 *   3. Tepki R = ((Sxx+Syy) − √((Sxx−Syy)² + 4·Sxy²)) / 2 (KÜÇÜK özdeğer).
 *   4. qualityLevel × maxR altındakiler elenir, R'ye göre azalan sıralanır.
 *   5. Greedy non-max suppression: minDistance çapında daha düşük skorlu
 *      adaylar elenir (320×180'de brute-force yeterli, kd-tree gerekmez).
 *      En fazla maxCorners döner.
 *
 * DÜRÜSTLÜK: düşük dokulu karede az köşe bulunabilir — OLDUĞU GİBİ döner;
 * MIN_CORNERS ZORLANMAZ (sahte köşe üretilmez).
 */
export function detectCorners(
  luminance: Float32Array,
  width: number,
  height: number,
  opts?: { maxCorners?: number; minDistance?: number; qualityLevel?: number },
): Corner[] {
  const maxCorners = opts?.maxCorners ?? MAX_CORNERS;
  const minDistance = opts?.minDistance ?? 7;
  const qualityLevel = opts?.qualityLevel ?? 0.01;

  const { ix, iy } = sobelGradients(luminance, width, height);
  const ix2 = new Float32Array(ix.length);
  const iy2 = new Float32Array(iy.length);
  const ixy = new Float32Array(ix.length);
  for (let i = 0; i < ix.length; i++) {
    ix2[i] = ix[i] * ix[i];
    iy2[i] = iy[i] * iy[i];
    ixy[i] = ix[i] * iy[i];
  }
  const sxx = boxBlur3(ix2, width, height);
  const syy = boxBlur3(iy2, width, height);
  const sxy = boxBlur3(ixy, width, height);

  const r = new Float32Array(ix.length);
  let maxR = 0;
  for (let i = 0; i < r.length; i++) {
    const a = sxx[i];
    const b = syy[i];
    const c = sxy[i];
    const score = (a + b - Math.sqrt((a - b) * (a - b) + 4 * c * c)) / 2;
    r[i] = Math.max(0, score);
    if (r[i] > maxR) maxR = r[i];
  }
  if (!(maxR > 0)) return [];

  const threshold = qualityLevel * maxR;
  const candidates: Corner[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (r[i] >= threshold) candidates.push({ x, y, score: r[i] });
    }
  }
  candidates.sort((p, q) => q.score - p.score);

  // Greedy NMS: korunan adayın minDistance çapı içindeki daha düşük skorlu
  // adaylar elenir (azalan sırada tarandığı için korunan her zaman en
  // yüksek skorludur). TAM sınırdaki (mesafe = minDistance) aday korunur.
  const kept: Corner[] = [];
  const minD2 = minDistance * minDistance;
  for (const c of candidates) {
    if (kept.length >= maxCorners) break;
    let ok = true;
    for (const k of kept) {
      const dx = k.x - c.x;
      const dy = k.y - c.y;
      if (dx * dx + dy * dy < minD2) {
        ok = false;
        break;
      }
    }
    if (ok) kept.push(c);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// MADDE 2 — piramidal Lucas-Kanade
// ---------------------------------------------------------------------------

/** D.6 — optik akış ayarları. Varsayılanlar standart LK (OpenCV-ish). */
export interface OpticalFlowOptions {
  maxCorners?: number;
  minDistance?: number;
  qualityLevel?: number;
  /** Piramit seviye sayısı. */
  pyramidLevels?: number;
  /** LK penceresi yarı-boyu (pencere = 2·R+1). */
  windowRadius?: number;
  /** Seviye başına maksimum iterasyon. */
  maxIterations?: number;
  /** Yakınsama eşiği (px): |du| + |dv| < ε → dur. */
  epsilon?: number;
  /**
   * Artık hata eşiği: son warp'ta pencerenin NORMALİZE LUMİNANS FARKI'nın
   * RMS'i (domain [0,1] → fark ∈ [−1,1] → RMS ≤ 1.0). BİRİM PİKSEL DEĞİL
   * — "piksel artığı" değildir; eşik aşılırsa iz kaybı (status = 0).
   *
   * Değer sentetik sahnelerde ÖLÇÜLEREK seçildi (2026-08-14 düzeltmesi):
   * iyi eşleşme (pan/rotate) RMS üst sınırı ≈ 0.027, kötü eşleşme (prev'le
   * alakasız periyotsuz desen) RMS alt sınırı ≈ 0.113 → eşik 0.055 = boşluğun
   * geometrik ortası. Periyodik sahnelerdeki tam-periyot "hizalı kaçış"
   * yanlış eşleşmeleri RMS eşiğiyle yakalanamaz (bilinen LK sınırı).
   */
  errorThreshold?: number;
}

/**
 * Bir piramit seviyesinde tek LK çözümü: 2×2 normal denklem
 *
 *   [Sxx Sxy; Sxy Syy] · [du; dv] = [−ΣIx·It; −ΣIy·It]
 *
 * Gradyanlar önceki görüntüden (pencere merkezi sabit), It = warp'lu
 * curr − prev (curr bilinear). maxIterations kez tekrarlanır ya da
 * |du|+|dv| < ε olunca durur. Dönüş: güncellenmiş (u,v) ve ok.
 *
 * ok = false (status 0) nedenleri:
 *   - pencere, warp'lu konumda çerçeve sınırı dışına taştı,
 *   - det < 1e-4 (yapı yok — düz bölge izlenemez; değerler pencerede
 *     ∇² ağırlıklı 225 örnek, 1e-4 pratikte yalnızca sıfır-gradyan hali),
 *   - son warp'ta pencere RMS hatası errorThreshold'u aştı (köşe kayboldu
 *     ya da doğru izlenmiyor).
 *
 * Yakınsama sağlanamaması (ε'a ulaşmadan iterasyon bitmesi) AYRI bir ok
 * dönüşüyle değil, son seviye RMS kontrolüyle yakalanır — seviye başına.
 */
function lkLevel(
  prev: Float32Array,
  curr: Float32Array,
  cw: number,
  ch: number,
  x0: number,
  y0: number,
  u: number,
  v: number,
  windowRadius: number,
  maxIterations: number,
  epsilon: number,
  errorThreshold: number,
): { u: number; v: number; ok: boolean } {
  const detMin = 1e-4;
  for (let it = 0; it < maxIterations; it++) {
    const xw = x0 + u;
    const yw = y0 + v;
    // Pencere taşması (warp'lu konum ± R çerçeve dışı) → izlenemez.
    if (
      xw - windowRadius < 0 ||
      xw + windowRadius > cw - 1 ||
      yw - windowRadius < 0 ||
      yw + windowRadius > ch - 1
    ) {
      return { u, v, ok: false };
    }
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let b1 = 0;
    let b2 = 0;
    for (let dy = -windowRadius; dy <= windowRadius; dy++) {
      for (let dx = -windowRadius; dx <= windowRadius; dx++) {
        const px = x0 + dx;
        const py = y0 + dy;
        const gx = bilinear(prev, cw, ch, px + 0.5, py) - bilinear(prev, cw, ch, px - 0.5, py);
        const gy = bilinear(prev, cw, ch, px, py + 0.5) - bilinear(prev, cw, ch, px, py - 0.5);
        const itv = bilinear(curr, cw, ch, xw + dx, yw + dy) - bilinear(prev, cw, ch, px, py);
        sxx += gx * gx;
        syy += gy * gy;
        sxy += gx * gy;
        b1 += gx * itv;
        b2 += gy * itv;
      }
    }
    const det = sxx * syy - sxy * sxy;
    if (det < detMin) return { u, v, ok: false };
    const du = (-b1 * syy + b2 * sxy) / det;
    const dv = (b1 * sxy - b2 * sxx) / det;
    u += du;
    v += dv;
    if (Math.abs(du) + Math.abs(dv) < epsilon) break;
  }
  // Son warp'ta pencere RMS hatası — köşe kayboldu ya da yanlış izleniyor.
  const xw = x0 + u;
  const yw = y0 + v;
  let ssd = 0;
  let cnt = 0;
  for (let dy = -windowRadius; dy <= windowRadius; dy++) {
    for (let dx = -windowRadius; dx <= windowRadius; dx++) {
      const e = bilinear(curr, cw, ch, xw + dx, yw + dy) - bilinear(prev, cw, ch, x0 + dx, y0 + dy);
      ssd += e * e;
      cnt++;
    }
  }
  const rms = cnt > 0 ? Math.sqrt(ssd / cnt) : Infinity;
  return { u, v, ok: rms <= errorThreshold };
}

/**
 * Piramidal Lucas-Kanade akışı (D.6).
 *
 * 1. Köşeler detectCorners(prev) ile (maxCorners: 500 bandı).
 * 2. pyramidLevels seviyeli piramitler (2×2 ortalama, deterministik).
 * 3. En KABA seviyede (u,v) = (0,0); her seviyede lkLevel çağrılır, sonuç
 *    (u,v) ×2 ölçeklenir (piramidal warp önerme) ve inceltilir.
 * 4. Nihai (u,v) = en ince seviye sonucu. status: pencere taşması / det
 *    sıfırı / RMS hata eşiği → 0.
 *
 * Çıktı FlowPoint[]: x,y KAYNAK karedeki köşe (piksel), u,v piksel akış.
 */
export function computeOpticalFlow(
  prevLum: Float32Array,
  currLum: Float32Array,
  width: number,
  height: number,
  opts?: OpticalFlowOptions,
): FlowPoint[] {
  const pyramidLevels = opts?.pyramidLevels ?? 3;
  const windowRadius = opts?.windowRadius ?? 7;
  const maxIterations = opts?.maxIterations ?? 10;
  const epsilon = opts?.epsilon ?? 0.01;
  const errorThreshold = opts?.errorThreshold ?? 0.055;

  const corners = detectCorners(prevLum, width, height, {
    maxCorners: opts?.maxCorners,
    minDistance: opts?.minDistance,
    qualityLevel: opts?.qualityLevel,
  });
  const prevPyr = buildPyramid(prevLum, width, height, pyramidLevels);
  const currPyr = buildPyramid(currLum, width, height, pyramidLevels);

  const points: FlowPoint[] = [];
  for (const c of corners) {
    let u = 0;
    let v = 0;
    let status: 0 | 1 = 1;
    for (let l = pyramidLevels - 1; l >= 0 && status === 1; l--) {
      const scale = Math.pow(2, l);
      const cw = Math.floor(width / scale);
      const ch = Math.floor(height / scale);
      const res = lkLevel(
        prevPyr[l],
        currPyr[l],
        cw,
        ch,
        c.x / scale,
        c.y / scale,
        u,
        v,
        windowRadius,
        maxIterations,
        epsilon,
        errorThreshold,
      );
      if (!res.ok) {
        status = 0;
        break;
      }
      u = res.u;
      v = res.v;
      if (l > 0) {
        u *= 2;
        v *= 2;
      }
    }
    points.push({ x: c.x, y: c.y, u, v, status });
  }
  return points;
}