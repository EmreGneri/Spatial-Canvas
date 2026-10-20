// Fotoğraf derinliği için iki saf (modelsiz, DOM'suz) aşama:
//  - parça (tile) çıkarımı birleştirme: yüksek çözünürlüklü parçalardan YALNIZ
//    yüksek frekans alınır, global yerleşim ve genlik korunur;
//  - kılavuzlu süzgeç: derinlik kenarlarını fotoğrafın luminance kenarlarına oturtur.

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Izgarayı `nx`×`ny` örtüşen parçaya böler. `overlap` = parça boyunun oranı. */
export function tileGrid(w: number, h: number, nx: number, ny: number, overlap = 0.25): TileRect[] {
  const axis = (len: number, n: number) => {
    // n parça, komşu parçalar `overlap` kadar bindirir: tileLen = len / (n - (n-1)·overlap)
    const tileLen = Math.min(len, Math.ceil(len / (n - (n - 1) * overlap)));
    const step = n > 1 ? (len - tileLen) / (n - 1) : 0;
    return Array.from({ length: n }, (_, i) => ({ s: Math.round(i * step), l: tileLen }));
  };
  const xs = axis(w, nx);
  const ys = axis(h, ny);
  const out: TileRect[] = [];
  for (const y of ys) for (const x of xs) out.push({ x: x.s, y: y.s, w: x.l, h: y.l });
  return out;
}

/** Ayrılabilir kutu bulanıklığı (kenar sıkıştırmalı). */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return Float32Array.from(src);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let dx = -r; dx <= r; dx++) s += src[row + Math.min(w - 1, Math.max(0, dx))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / k;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = -r; dy <= r; dy++) s += tmp[Math.min(h - 1, Math.max(0, dy)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / k;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** En küçük kareler: global ≈ scale·tile + offset. Dejenere ya da ters eğilimliyse null. */
export function fitAffine(tile: Float32Array, global: Float32Array): { scale: number; offset: number } | null {
  const n = tile.length;
  if (n < 16) return null;
  let mt = 0;
  let mg = 0;
  for (let i = 0; i < n; i++) {
    mt += tile[i];
    mg += global[i];
  }
  mt /= n;
  mg /= n;
  let cov = 0;
  let vt = 0;
  for (let i = 0; i < n; i++) {
    const dt = tile[i] - mt;
    cov += dt * (global[i] - mg);
    vt += dt * dt;
  }
  if (!(vt > 1e-8)) return null;
  const scale = cov / vt;
  // Negatif ya da aşırı eğim = parça global ile uyuşmuyor (ters/bozuk çıkarım): kullanma.
  if (!(scale > 0.25 && scale < 4)) return null;
  return { scale, offset: mg - scale * mt };
}

export interface TileResult {
  rect: TileRect;
  /** rect.w × rect.h, [0,1] normalize derinlik (modelin parça çıktısı, ızgaraya örneklenmiş). */
  depth: Float32Array;
}

export const TILE_HP_RADIUS = 3;
export const TILE_FIT_RADIUS = 4;

/**
 * Parça çıkarımlarının yüksek frekansını global derinliğe ekler (yerinde).
 * Her parça önce düşük geçirilmiş halleri üzerinden global'e afin oturtulur
 * (genlik/ofset uyumu), sonra `aligned − blur(aligned)` eklenir. Düşük frekans
 * (sahne sıralaması, genlik) global'den gelir; parça yalnızca ince yapı katar.
 * İç kenarlarda ağırlık yumuşak sönümlenir, görüntü sınırında sönmez.
 * Dönüş: uygulanan parça sayısı.
 */
export function mergeTileDetail(
  depth: Float32Array,
  w: number,
  h: number,
  tiles: TileResult[],
  strength = 1,
): number {
  const accHp = new Float32Array(depth.length);
  const accW = new Float32Array(depth.length);
  let used = 0;
  for (const { rect, depth: td } of tiles) {
    const n = rect.w * rect.h;
    const globalSlice = new Float32Array(n);
    for (let j = 0; j < rect.h; j++) {
      const s = (rect.y + j) * w + rect.x;
      globalSlice.set(depth.subarray(s, s + rect.w), j * rect.w);
    }
    const fit = fitAffine(
      boxBlur(td, rect.w, rect.h, TILE_FIT_RADIUS),
      boxBlur(globalSlice, rect.w, rect.h, TILE_FIT_RADIUS),
    );
    if (!fit) continue;
    const aligned = new Float32Array(n);
    for (let i = 0; i < n; i++) aligned[i] = fit.scale * td[i] + fit.offset;
    const low = boxBlur(aligned, rect.w, rect.h, TILE_HP_RADIUS);
    const ramp = Math.max(1, Math.round(Math.min(rect.w, rect.h) * 0.2));
    const fx = (i: number) => {
      const left = rect.x === 0 ? Infinity : i;
      const right = rect.x + rect.w >= w ? Infinity : rect.w - 1 - i;
      return Math.min(1, (Math.min(left, right) + 1) / ramp);
    };
    const fy = (j: number) => {
      const top = rect.y === 0 ? Infinity : j;
      const bottom = rect.y + rect.h >= h ? Infinity : rect.h - 1 - j;
      return Math.min(1, (Math.min(top, bottom) + 1) / ramp);
    };
    for (let j = 0; j < rect.h; j++) {
      const wy = fy(j);
      for (let i = 0; i < rect.w; i++) {
        const wt = wy * fx(i);
        const g = (rect.y + j) * w + rect.x + i;
        accHp[g] += (aligned[j * rect.w + i] - low[j * rect.w + i]) * wt;
        accW[g] += wt;
      }
    }
    used++;
  }
  for (let i = 0; i < depth.length; i++) {
    if (accW[i] > 1e-6) depth[i] = Math.min(1, Math.max(0, depth[i] + (strength * accHp[i]) / accW[i]));
  }
  return used;
}

export const KENAR_YARICAP = 6;
// luminance 0..1 ölçeğinde; küçük eps = kenara daha sadık, büyük eps = doku sızıntısına daha dirençli.
export const KENAR_EPS = 0.01;

/**
 * Kılavuzlu süzgeç (He ve ark.): derinlik `p`, kılavuz `I` (luminance).
 * Çıktı yerel olarak I'nın doğrusal fonksiyonu: derinlik kenarları fotoğraf
 * kenarlarına yapışır, düz bölgeler yumuşar. `strength` orijinalle harman oranı.
 * Dönüş yeni dizi; girdiler değişmez.
 */
export function kenarHizala(
  depth: Float32Array,
  guide: Float32Array,
  w: number,
  h: number,
  strength = 0.5,
  radius = KENAR_YARICAP,
  eps = KENAR_EPS,
): Float32Array {
  const n = depth.length;
  const mI = boxBlur(guide, w, h, radius);
  const mP = boxBlur(depth, w, h, radius);
  const ip = new Float32Array(n);
  const ii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ip[i] = guide[i] * depth[i];
    ii[i] = guide[i] * guide[i];
  }
  const mIP = boxBlur(ip, w, h, radius);
  const mII = boxBlur(ii, w, h, radius);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i];
    const cov = mIP[i] - mI[i] * mP[i];
    a[i] = cov / (varI + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const mA = boxBlur(a, w, h, radius);
  const mB = boxBlur(b, w, h, radius);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const q = mA[i] * guide[i] + mB[i];
    out[i] = Math.min(1, Math.max(0, depth[i] + strength * (q - depth[i])));
  }
  return out;
}
