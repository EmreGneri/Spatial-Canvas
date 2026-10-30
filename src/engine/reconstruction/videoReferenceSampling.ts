/** Video-only sampling rules copied from the reference implementation. */
export interface OrneklemePenceresi {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Pencere kuantumu — bbox bu ızgaraya yuvarlanır (kararlılık, aşağıya bak). */
export const PENCERE_KUANTUM = 1 / 32;
/** Pencere payı (kadraj kesri) — siluet kenarı pencerenin tam dibinde kalmasın. */
export const PENCERE_PAY = 0.06;

/**
 * Maskenin sınırlayıcı kutusundan örnekleme penceresi üretir.
 *
 * KUANTALAMA ŞART: pencere maskeye birebir yapışsaydı, canlı yolda her maske
 * tazelemesinde (ya da 1 piksellik kaymada) pencere oynar ve TÜM örnekler
 * yerinden zıplardı — splat bulutu her tazelemede titrerdi. Kenarlar
 * `PENCERE_KUANTUM` ızgarasına yuvarlanır (dışa doğru), böylece küçük maske
 * değişimleri pencereyi HİÇ oynatmaz.
 *
 * Maske yoksa ya da dejenere ise `null` döner — pencere yalnız öznenin nerede
 * olduğu BİLİNİYORKEN anlamlıdır.
 */
export function maskeBboxPenceresi(
  mask: Float32Array | null | undefined,
  width: number,
  height: number,
  pay = PENCERE_PAY,
  kuantum = PENCERE_KUANTUM,
  onceki: OrneklemePenceresi | null = null,
): OrneklemePenceresi | null {
  if (!mask || mask.length !== width * height) return null;
  let x0 = width;
  let x1 = -1;
  let y0 = height;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] < 0.5) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  const nx0 = Math.max(0, x0 / width - pay);
  const nx1 = Math.min(1, (x1 + 1) / width + pay);
  const ny0 = Math.max(0, y0 / height - pay);
  const ny1 = Math.min(1, (y1 + 1) / height + pay);
  const asagi = (v: number) => Math.max(0, Math.floor(v / kuantum) * kuantum);
  const yukari = (v: number) => Math.min(1, Math.ceil(v / kuantum) * kuantum);
  const pen = { x0: asagi(nx0), y0: asagi(ny0), x1: yukari(nx1), y1: yukari(ny1) };
  // Dejenere pencere (sıfır alan) kimlik dönüşümünden kötüdür.
  if (pen.x1 - pen.x0 < kuantum || pen.y1 - pen.y0 < kuantum) return null;
  // HİSTEREZİS: kuantalama tek başına yetmez — bbox tam bir kuantum sınırına
  // otururken 1 piksellik kayma pencereyi bir kuantum ZIPLATIR ve canlı yolda
  // tüm örnekler aynı anda yerinden oynar. Önceki pencere ÇIPLAK bbox'ı
  // (paysız) `pay/2` içeriden hâlâ kapsıyorsa ve gereksiz büyük değilse aynen
  // korunur: pencere yalnız özne gerçekten pencereye yaklaşınca/taşınca oynar.
  // İçeriden ölçmenin nedeni: pay zaten siluetin pencere dibine gelmemesi
  // için var, dolayısıyla kapsama testi payın TAMAMINI harcamamalıdır.
  if (onceki) {
    const iç = pay / 2;
    const bx0 = x0 / width;
    const bx1 = (x1 + 1) / width;
    const by0 = y0 / height;
    const by1 = (y1 + 1) / height;
    // Kadraj kenarına dayanmış bir pencere kenarında iç pay ARANMAZ: özne o
    // yönde kadrajdan zaten çıkamaz (aksi halde alta/üste taşan her özne
    // histerezisi kalıcı olarak kapatırdı — ölçüldü: y1 = 1'de 0.97 < 0.9766).
    const lo = (k: number) => (k <= 0 ? 0 : k + iç);
    const hi = (k: number) => (k >= 1 ? 1 : k - iç);
    const kapsiyor =
      lo(onceki.x0) <= bx0 &&
      lo(onceki.y0) <= by0 &&
      hi(onceki.x1) >= bx1 &&
      hi(onceki.y1) >= by1;
    const bos = 2 * kuantum;
    const savurgan =
      nx0 - onceki.x0 > bos ||
      ny0 - onceki.y0 > bos ||
      onceki.x1 - nx1 > bos ||
      onceki.y1 - ny1 > bos;
    if (kapsiyor && !savurgan) return onceki;
  }
  return pen;
}

/** Izgara koordinatını (0..1) pencere üzerinden KAYNAK koordinatına taşır. */
export function pencereyeTasi(t: number, lo: number, hi: number): number {
  return lo + t * (hi - lo);
}


const SPARSE_LIMB_BBOX_TO_P75_RATIO = 1.3;
export function computeReferenceVideoBody(
  alpha: Float32Array,
  w: number,
  h: number,
  halfH: number,
  /** Kaynak karesinin en-boyu; verilmezse ızgara oranı (eski davranış). */
  sourceAspect?: number,
): { cx: number; cy: number; rx: number; ry: number } | null {
  // `sampleVolumePositions` ile AYNI oran kullanılmalı: ayrışırlarsa rx (ve
  // ondan türeyen zSpan) ikinci bir en-boy hatası taşır.
  const halfW = (sourceAspect && sourceAspect > 0 ? sourceAspect : w / h) * halfH;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let hit = false;
  const rowWidths: number[] = [];
  for (let y = 0; y < h; y++) {
    let rowMinX = Infinity;
    let rowMaxX = -Infinity;
    for (let x = 0; x < w; x++) {
      const m = alpha[y * w + x];
      if (m < 0.5) continue;
      const wx = (x / w - 0.5) * 2 * halfW;
      const wy = (1 - (y + 0.5) / h - 0.5) * 2 * halfH;
      sx += wx * m;
      sy += wy * m;
      sw += m;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
      if (wx < rowMinX) rowMinX = wx;
      if (wx > rowMaxX) rowMaxX = wx;
      hit = true;
    }
    if (rowMaxX >= rowMinX) rowWidths.push(rowMaxX - rowMinX);
  }
  if (!hit || sw <= 0) return null;
  // A silhouette bbox measures limb reach, not torso breadth. The 75th
  // percentile row span preserves shoulder and torso breadth. It is used only
  // when the bbox is a measured sparse-limb outlier; otherwise bbox width is
  // retained so ordinary poses do not flatten.
  rowWidths.sort((a, b) => a - b);
  const bboxWidth = maxX - minX;
  const p75Width = rowWidths[Math.floor((rowWidths.length - 1) * 0.75)];
  const robustWidth =
    bboxWidth / p75Width > SPARSE_LIMB_BBOX_TO_P75_RATIO ? p75Width : bboxWidth;
  return {
    cx: sx / sw,
    cy: sy / sw,
    rx: Math.max(0.01, robustWidth / 2),
    ry: Math.max(0.01, (maxY - minY) / 2),
  };
}

