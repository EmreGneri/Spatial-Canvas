// GÜN 3 — D.6: optik akış (Shi-Tomasi köşe tespiti + piramidal Lucas-Kanade).
// Saf CPU klasik CV (üretici model YASAK). Math.random YOK — her hesaplama
// deterministik dizi/tensör işlemidir: aynı girdi, aynı çıktı (repo kuralı;
// verify-flow.mjs iki koşuyu birebir karşılaştırır).
import type { FlowPoint } from './types.ts';

/** D.6 — çalışma çözünürlüğü. */
export const FLOW_WIDTH = 320;
export const FLOW_HEIGHT = 180;

/** D.6 — hedef köşe sayısı bandı. FONKSİYONLAR BUNLARI ZORLAMAZ: düşük
 *  dokulu karede MIN_CORNERS'ın altında köşe bulunabilir — o durumda OLDUĞU
 *  GİBİ döner, sahte köşe ÜRETİLMEZ. E2.1: MAX_CORNERS 500→800 (gerçek
 *  yakalamada 300 köşe → 3 eşleşme → 11 poz hatası; verim artırıldı). */
export const MIN_CORNERS = 300;
export const MAX_CORNERS = 800;

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
 *      En fazla maxCorners döner. E2.1: minDistance 7→5 — ölçülen tavan
 *      756 eşleşme (5) vs 697 (7); 384×288'de 800 köşe ≈ 11.7 px ortalama
 *      aralık verir, 5 px NMS çapı rahat.
 *   6. E2.1: 7 px KENAR BANDI DIŞLANIR — en ince LK penceresi (yarı-boy 7)
 *      o banttaki köşeyi HİÇ izleyemez (ölçüldü: 800 köşenin 111'i status=0
 *      ölü ağırlıktı). Bütçe izlenebilir köşelere gider.
 *   7. E2.1: grid kota (8×6 hücre, hücre başına kota) GLOBAL skor sırasında
 *      işlenir — hücre-hücre sıralı seçim komşu kümeleri bloklayıp kotayı
 *      %50'ye düşürüyordu (ölçüldü); global skor sırası + kota hem verimli
 *      NMS paketleme hem yayılım garantisi verir.
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
  const minDistance = opts?.minDistance ?? 5;
  // E2.1: 0.01 → 0.005 — orta güçlü köşeler de aday olur (video kareleri
  // düşük kontrastlı olabilir; katı eşik köşe havuzunu aç bırakıyordu).
  const qualityLevel = opts?.qualityLevel ?? 0.005;

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
  // E2.1 — KENAR BANDI DIŞLAMA: en ince LK penceresinin yarı-boyuna (7 px)
  // eşit banttaki köşe HİÇ izlenemez (warp + pencere çerçeve dışı taşar) —
  // ölçüldü: 800 köşenin 111'i bu banttaydı ve TAMAMI status=0'dı (ölü ağırlık,
  // yine de LK süresi harcıyor). Bütçe böylece izlenebilir köşelere gider.
  const BORDER_PX = 7;
  for (let y = BORDER_PX; y < height - BORDER_PX; y++) {
    for (let x = BORDER_PX; x < width - BORDER_PX; x++) {
      const i = y * width + x;
      if (r[i] >= threshold) candidates.push({ x, y, score: r[i] });
    }
  }
  candidates.sort((p, q) => q.score - p.score);

  // E2.1 — GRID BUCKETING: hücre başına kota (cap). Seçim GLOBAL skor sırasında
  // yapılır (verimli NMS paketleme), kota yayılımı garantiler — doku zengini
  // bölge tüm kotayı yemez (gerçek yakalamada köşeler tek kadraj köşesine
  // yığılıp RANSAC verimi düşüyordu; kareye yayılmış köşe daha iyi geometrik
  // kapsama verir). Hücre-hücre sıralı seçim YANLIŞ çıktı: komşu hücrelerdeki
  // yoğun kümeler birbirini bloklayıp kotayı %50'ye düşürüyordu (ölçüldü).
  const GRID_COLS = 8;
  const GRID_ROWS = 6;
  const perCell = Math.ceil(maxCorners / (GRID_COLS * GRID_ROWS)) + 2;
  const cellCount = new Int32Array(GRID_COLS * GRID_ROWS);
  const cellOf = (x: number, y: number) =>
    Math.min(GRID_COLS - 1, Math.floor((x * GRID_COLS) / width)) +
    GRID_COLS * Math.min(GRID_ROWS - 1, Math.floor((y * GRID_ROWS) / height));

  // Greedy NMS: korunan adayın minDistance çapı içindeki daha düşük skorlu
  // adaylar elenir (azalan sırada tarandığı için korunan her zaman en
  // yüksek skorludur). TAM sınırdaki (mesafe = minDistance) aday korunur.
  const kept: Corner[] = [];
  const minD2 = minDistance * minDistance;
  for (const c of candidates) {
    if (kept.length >= maxCorners) break;
    const cell = cellOf(c.x, c.y);
    if (cellCount[cell] >= perCell) continue;
    let ok = true;
    for (const k of kept) {
      const dx = k.x - c.x;
      const dy = k.y - c.y;
      if (dx * dx + dy * dy < minD2) {
        ok = false;
        break;
      }
    }
    if (ok) {
      kept.push(c);
      cellCount[cell]++;
    }
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
  /** Piramit seviye sayısı (E2.1: 3→4 — daha geniş hareket küresi). */
  pyramidLevels?: number;
  /** LK penceresi yarı-boyu (pencere = 2·R+1). */
  windowRadius?: number;
  /** Seviye başına maksimum iterasyon. */
  maxIterations?: number;
  /** Yakınsama eşiği (px): |du| + |dv| < ε → dur. */
  epsilon?: number;
  /** E2.1 — yapı tensörü determinant eşiği (zayıf yapı izlenmez; köşe
   *  detektörünün küçük özdeğeriyle aynı felsefe, LK penceresi içinde). */
  minEigThreshold?: number;
  /** E2.1 — geri-ileri tutarlılık: curr'den prev'e ters iz > 1 px saparsa
   *  eşleşme çöp sayılır (status=0) — RANSAC aykırı havuzu küçülür. */
  fbConsistency?: boolean;
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
  minEigThreshold: number,
): { u: number; v: number; ok: boolean } {
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
    if (det < minEigThreshold) return { u, v, ok: false };
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
 * Tek noktanın piramit boyunca izlenmesi (kaba → ince). E2.1: ileri iz
 * `trackPoint(prevPyr, currPyr, ...)`, geri-ileri tutarlılık kontrolü aynı
 * fonksiyonla TERS yönde çalışır — iki kod yolu da aynı hesabı kullanır.
 */
function trackPoint(
  prevPyr: Float32Array[],
  currPyr: Float32Array[],
  width: number,
  height: number,
  x: number,
  y: number,
  levels: number,
  windowRadius: number,
  maxIterations: number,
  epsilon: number,
  errorThreshold: number,
  minEigThreshold: number,
): { u: number; v: number; ok: boolean } {
  let u = 0;
  let v = 0;
  for (let l = levels - 1; l >= 0; l--) {
    const scale = Math.pow(2, l);
    const cw = Math.floor(width / scale);
    const ch = Math.floor(height / scale);
    const res = lkLevel(
      prevPyr[l],
      currPyr[l],
      cw,
      ch,
      x / scale,
      y / scale,
      u,
      v,
      windowRadius,
      maxIterations,
      epsilon,
      errorThreshold,
      minEigThreshold,
    );
    if (!res.ok) {
      // E2.1 — KABA seviyede düz bölge (det < eşik) izi ÖLDÜRMEZ: o ölçekte
      // sinyal yoksa mevcut (u,v) olduğu gibi inceltilir — küçük hareketlerin
      // asıl çözümü ince seviyelerdedir (4. seviye kaba piramitte doku
      // ortalamayla kaybolur; ölçüldü: 3→4 seviyede 140→45 eşleşmeye düşüş).
      // Gerçek yapı eksikliği EN İNCE seviyede (l===0) yakalanır: orada det/
      // RMS/sınır yolları status=0 döndürür.
      if (l > 0) {
        u *= 2;
        v *= 2;
        continue;
      }
      return { u, v, ok: false };
    }
    u = res.u;
    v = res.v;
    if (l > 0) {
      u *= 2;
      v *= 2;
    }
  }
  return { u, v, ok: true };
}

/**
 * Piramidal Lucas-Kanade akışı (D.6).
 *
 * 1. Köşeler detectCorners(prev) ile (maxCorners: 800 bandı, grid dağılımı).
 * 2. pyramidLevels seviyeli piramitler (2×2 ortalama, deterministik).
 * 3. En KABA seviyede (u,v) = (0,0); her seviyede lkLevel çağrılır, sonuç
 *    (u,v) ×2 ölçeklenir (piramidal warp önerme) ve inceltilir.
 * 4. E2.1 — GERİ-İLERİ TUTARLILIK: curr'de (x+u, y+v)'den prev'e ters iz;
 *    ters akış ileri akışın tersinden > 1 px saparsa eşleşme ÇÖP (status=0)
 *    — RANSAC'a giren aykırı havuzu küçülür (oklüzyon/kodlama artefaktı).
 * 5. Nihai (u,v) = en ince seviye sonucu. status: pencere taşması / det
 *    sıfırı / RMS hata eşiği / geri-ileri sapma → 0.
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
  const pyramidLevels = opts?.pyramidLevels ?? 4;
  const windowRadius = opts?.windowRadius ?? 7;
  const maxIterations = opts?.maxIterations ?? 10;
  const epsilon = opts?.epsilon ?? 0.01;
  const errorThreshold = opts?.errorThreshold ?? 0.055;
  const minEigThreshold = opts?.minEigThreshold ?? 1e-3;
  const fbConsistency = opts?.fbConsistency ?? true;

  const corners = detectCorners(prevLum, width, height, {
    maxCorners: opts?.maxCorners,
    minDistance: opts?.minDistance,
    qualityLevel: opts?.qualityLevel,
  });
  const prevPyr = buildPyramid(prevLum, width, height, pyramidLevels);
  const currPyr = buildPyramid(currLum, width, height, pyramidLevels);

  const points: FlowPoint[] = [];
  for (const c of corners) {
    const fwd = trackPoint(
      prevPyr,
      currPyr,
      width,
      height,
      c.x,
      c.y,
      pyramidLevels,
      windowRadius,
      maxIterations,
      epsilon,
      errorThreshold,
      minEigThreshold,
    );
    let status: 0 | 1 = fwd.ok ? 1 : 0;
    let u = fwd.u;
    let v = fwd.v;
    if (status === 1 && fbConsistency) {
      const back = trackPoint(
        currPyr,
        prevPyr,
        width,
        height,
        c.x + u,
        c.y + v,
        pyramidLevels,
        windowRadius,
        maxIterations,
        epsilon,
        errorThreshold,
        minEigThreshold,
      );
      // Tutarlılık eşiği 1 px — ÖKLİD mesafesi (u²+v² ≤ 1). Eksen başına
      // kontrol çapraz sapmada √2 ≈ 1.41 px'e izin veriyordu (Zeynep
      // denetim notu, 2026-08-16); ölçülen iyi eşleşmeler 0.36 px altında,
      // sıkılaştırma eşleşme kaybettirmez (verify-flow [2b] 756 korunur).
      const fbDx = back.u + u;
      const fbDy = back.v + v;
      if (!back.ok || fbDx * fbDx + fbDy * fbDy > 1) {
        status = 0;
      }
    }
    points.push({ x: c.x, y: c.y, u, v, status });
  }
  return points;
}