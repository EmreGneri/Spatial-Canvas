// Maske ölçütleri (saf, DOM yok). DAVIS 2016 protokolü: J = bölge IoU'su,
// F = kontur F-ölçüsü (bound_th 0.008). Hole-fill ölçümü için `maskeSayfasi.ts` kullanır.

/** Float maskeyi 0.5 eşiğiyle ikiliye çevirir. */
export function ikili(m: ArrayLike<number>, esik = 0.5): Uint8Array {
  const o = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) o[i] = m[i] >= esik ? 1 : 0;
  return o;
}

export function alan(m: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < m.length; i++) s += m[i];
  return s;
}

/** Bölge benzerliği (IoU). İkisi de boşsa 1. */
export function jaccard(pred: Uint8Array, gt: Uint8Array): number {
  let kes = 0, bir = 0;
  for (let i = 0; i < pred.length; i++) {
    if (pred[i] && gt[i]) kes++;
    if (pred[i] || gt[i]) bir++;
  }
  return bir === 0 ? 1 : kes / bir;
}

/** Ardışık kare kararlılığı: aynı IoU, yalnız anlam ayrımı için ayrı ad. */
export const ardisikIoU = jaccard;

/** Ön plan pikseli, 4-komşusu arka plan ya da görüntü dışıysa sınırdır. */
function sinirHaritasi(m: Uint8Array, w: number, h: number): Uint8Array {
  const b = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!m[i]) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1
      || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) b[i] = 1;
  }
  return b;
}

/** Sınır pikselleri `r` yarıçaplı disk ile genişletilir. */
function genislet(b: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const ofs: number[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) ofs.push(dx, dy);
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!b[y * w + x]) continue;
    for (let k = 0; k < ofs.length; k += 2) {
      const xx = x + ofs[k], yy = y + ofs[k + 1];
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) o[yy * w + xx] = 1;
    }
  }
  return o;
}

/** DAVIS bound_th = 0.008 * köşegen. */
export function davisTolPx(w: number, h: number): number {
  return Math.ceil(0.008 * Math.sqrt(w * w + h * h));
}

/** DAVIS kontur F-ölçüsü. */
export function sinirF(pred: Uint8Array, gt: Uint8Array, w: number, h: number, tolPx: number): number {
  const pb = sinirHaritasi(pred, w, h), gb = sinirHaritasi(gt, w, h);
  const np = alan(pb), ng = alan(gb);
  if (np === 0 && ng === 0) return 1;
  if (np === 0 || ng === 0) return 0;
  const gd = genislet(gb, w, h, tolPx), pd = genislet(pb, w, h, tolPx);
  let pEslesen = 0, gEslesen = 0;
  for (let i = 0; i < pb.length; i++) {
    if (pb[i] && gd[i]) pEslesen++;
    if (gb[i] && pd[i]) gEslesen++;
  }
  const P = pEslesen / np, R = gEslesen / ng;
  return P + R === 0 ? 0 : (2 * P * R) / (P + R);
}

/** Sınıra değmeyen (kapalı) 4-bağlı arka plan pikselleri / ön plan pikselleri. */
export function icDelikOrani(mask: Uint8Array, w: number, h: number): number {
  const on = alan(mask);
  if (on === 0) return 0;
  const gor = new Uint8Array(w * h);
  const yigin = new Int32Array(w * h);
  let kapali = 0;
  for (let s = 0; s < w * h; s++) {
    if (mask[s] || gor[s]) continue;
    let sp = 0, boyut = 0, sinira = false;
    yigin[sp++] = s; gor[s] = 1;
    while (sp > 0) {
      const i = yigin[--sp];
      boyut++;
      const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) sinira = true;
      if (x > 0 && !mask[i - 1] && !gor[i - 1]) { gor[i - 1] = 1; yigin[sp++] = i - 1; }
      if (x < w - 1 && !mask[i + 1] && !gor[i + 1]) { gor[i + 1] = 1; yigin[sp++] = i + 1; }
      if (y > 0 && !mask[i - w] && !gor[i - w]) { gor[i - w] = 1; yigin[sp++] = i - w; }
      if (y < h - 1 && !mask[i + w] && !gor[i + w]) { gor[i + w] = 1; yigin[sp++] = i + w; }
    }
    if (!sinira) kapali += boyut;
  }
  return kapali / on;
}

export interface DelikKaydi {
  alan: number; alanOrani: number; fark: number | null; icMedyan: number; halkaMedyan: number | null;
  olasilikOrt: number; olasilikMaks: number; bboxW: number; bboxH: number; doluluk: number;
  derinlikStd: number; doldurulurMu: boolean; gtOrani: number;
}

/** GT'yi (W×H) derinlik ızgarasına (w×h) piksel merkezlerinden en yakın komşuyla indirger. */
export function gtIzgaraya(gt: Uint8Array, W: number, H: number, w: number, h: number): Uint8Array {
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(H - 1, Math.floor(((y + 0.5) * H) / h));
    for (let x = 0; x < w; x++) o[y * w + x] = gt[sy * W + Math.min(W - 1, Math.floor(((x + 0.5) * W) / w))];
  }
  return o;
}

// `delikleriDoldur` (maskeDelik.ts) ile aynı tanım; medyan: artan sırala, length>>1.
const medyan = (a: number[]) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };

/** Kapalı (sınıra değmeyen) 4-bağlı arka plan bileşenlerinin TÜMÜ (>=4 px), doldurulsun ya da değil. */
export function delikKayitlari(
  mask: ArrayLike<number>, depth: ArrayLike<number>, w: number, h: number, gt: Uint8Array,
  esik = 0.12, maxOran = 0.25, halka = 3,
): DelikKaydi[] {
  const n = w * h;
  const id = new Uint8Array(n);
  let fg = 0;
  for (let i = 0; i < n; i++) if (mask[i] >= 0.5) fg++;
  const out: DelikKaydi[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (mask[s] >= 0.5 || id[s]) continue;
    const px: number[] = [];
    let sinir = false;
    stack.push(s); id[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      px.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) sinir = true;
      if (x > 0 && mask[p - 1] < 0.5 && !id[p - 1]) { id[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] < 0.5 && !id[p + 1]) { id[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - w] < 0.5 && !id[p - w]) { id[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] < 0.5 && !id[p + w]) { id[p + w] = 1; stack.push(p + w); }
    }
    if (sinir || px.length < 4) continue;
    const ring = new Set<number>();
    let x0 = w, y0 = h, x1 = -1, y1 = -1, pSum = 0, pMax = 0, dSum = 0, gtN = 0;
    for (const p of px) {
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      pSum += mask[p]; if (mask[p] > pMax) pMax = mask[p];
      dSum += depth[p]; gtN += gt[p];
      for (let dy = -halka; dy <= halka; dy++) for (let dx = -halka; dx <= halka; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (mask[q] >= 0.5) ring.add(q);
      }
    }
    const m = px.length, dOrt = dSum / m;
    let v = 0;
    for (const p of px) v += (depth[p] - dOrt) ** 2;
    const ic = medyan(px.map((p) => depth[p]));
    const hm = ring.size < 8 ? null : medyan([...ring].map((q) => depth[q]));
    const fark = hm == null ? null : Math.abs(ic - hm);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    out.push({
      alan: m, alanOrani: fg ? m / fg : 0, fark, icMedyan: ic, halkaMedyan: hm,
      olasilikOrt: pSum / m, olasilikMaks: pMax, bboxW: bw, bboxH: bh, doluluk: m / (bw * bh),
      derinlikStd: Math.sqrt(v / m), doldurulurMu: fark != null && fark <= esik && m <= maxOran * fg, gtOrani: gtN / m,
    });
  }
  return out;
}

/**
 * "Eksik bölge" ölçütü: GT ön planında maskenin kaçırdığı BÜYÜK parçalar (kol/el/
 * bacak gibi). GT\maske'nin 4-bağlı bileşenlerinden alanı GT alanının
 * `minOran`'ından (varsayılan %0,5; kenar şeritleri sayılmasın) büyük olanlar;
 * `oran` bu bileşenlerin toplam alanının GT alanına oranı, `adet` bileşen sayısı.
 */
export function eksikBolge(pred: Uint8Array, gt: Uint8Array, w: number, h: number, minOran = 0.005): { oran: number; adet: number } {
  const n = w * h;
  const gtAlan = alan(gt);
  if (gtAlan === 0) return { oran: 0, adet: 0 };
  const goruldu = new Uint8Array(n);
  const yigin = new Int32Array(n);
  let toplam = 0, adet = 0;
  for (let s = 0; s < n; s++) {
    if (!gt[s] || pred[s] || goruldu[s]) continue;
    let sp = 0, boy = 0;
    yigin[sp++] = s; goruldu[s] = 1;
    while (sp > 0) {
      const p = yigin[--sp];
      boy++;
      const x = p % w, y = (p / w) | 0;
      const dene = (q: number) => { if (gt[q] && !pred[q] && !goruldu[q]) { goruldu[q] = 1; yigin[sp++] = q; } };
      if (x > 0) dene(p - 1);
      if (x < w - 1) dene(p + 1);
      if (y > 0) dene(p - w);
      if (y < h - 1) dene(p + w);
    }
    if (boy >= minOran * gtAlan) { toplam += boy; adet++; }
  }
  return { oran: toplam / gtAlan, adet };
}
