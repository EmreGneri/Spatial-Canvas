/**
 * ÖZNE KIRPMA (nesne ayırma — parçacık yoğunluğu).
 *
 * Örnekleme grid'i (POSITION_TEXTURE_SIZE, sabit bütçe) nesne ayırma AÇIKKEN
 * bile tüm fotoğraf karesini kaplıyordu: arka plan noktaları çizilmese de
 * (splatOpacityGate / shader) grid HÂLÂ oraya harcanıyordu — bir büst kare
 * alanının ~%19'unu kaplıyorsa bütçenin yalnızca ~%19'u özneye düşüyordu.
 *
 * Bu modül sampleVolumePositions/sampleImageGrid/sampleAoGrid'e HİÇ
 * dokunmaz: onlar zaten "grid, dünya konumuyla BİREBİR" sözleşmesini
 * (14cfdfa/1fd9b87 — önem remap'inin ayrı bükmesi düzleşme/esneme
 * hatasına yol açmıştı) importanceSampling KAPALI varsayılanıyla koruyor.
 * Burada onun yerine GİRDİYİ küçültüyoruz (depth/mask/rgb'nin bbox+pay
 * alt-dizisini kırpıp AYNI fonksiyonlara veriyoruz) — grid yine 1:1 ve
 * düzenli kalır, yalnızca hangi piksel karesini kapladığı küçülür. Dünya
 * ölçeği otomatik düzelir: halfW artık kırpılmış bölgenin en/boy oranından
 * gelir (sampler.ts'teki depthWidth/depthHeight'a bağlı), yani kadraj oranı
 * da özneninkiyle hizalanır — kare olmayan fotoğraflarda eksik/taşan
 * aralık sorunu ayrı bir düzeltme gerektirmez.
 */

export interface CropRect {
  /** Piksel aralığı, x1/y1 HARİÇ (half-open): [x0, x1) × [y0, y1). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Maskenin (≥ 0.5) piksel sınır kutusunu + pay (bbox boyutunun oranı) döner.
 * Maske boşsa (hiç piksel yok) ya da neredeyse tüm kareyi kaplıyorsa (kırpma
 * anlamsız/gereksiz zoom) null döner — çağıran taraf tam kareye düşer.
 */
export function computeMaskCropRect(
  mask: Float32Array,
  w: number,
  h: number,
  marginFrac = 0.12,
): CropRect | null {
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x] < 0.5) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const mx = Math.round(bw * marginFrac);
  const my = Math.round(bh * marginFrac);
  const x0 = Math.max(0, minX - mx);
  const y0 = Math.max(0, minY - my);
  const x1 = Math.min(w, maxX + 1 + mx);
  const y1 = Math.min(h, maxY + 1 + my);
  // Kırpma kareyi zar zor küçültüyorsa (özne zaten kareyi dolduruyor) atla —
  // yeniden örnekleme + zum'a değmez.
  if (x1 - x0 >= w * 0.92 && y1 - y0 >= h * 0.92) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Çok kanallı (interleaved) bir Float32Array'in dikdörtgen alt bölgesini
 * kırpar (depth: 1 kanal, rgb: 3 kanal). Satır satır subarray kopyası.
 */
export function cropChannels(
  src: Float32Array,
  w: number,
  h: number,
  channels: number,
  rect: CropRect,
): { data: Float32Array; width: number; height: number } {
  const cw = rect.x1 - rect.x0;
  const ch = rect.y1 - rect.y0;
  const out = new Float32Array(cw * ch * channels);
  for (let y = 0; y < ch; y++) {
    const srcStart = ((rect.y0 + y) * w + rect.x0) * channels;
    const dstStart = y * cw * channels;
    out.set(src.subarray(srcStart, srcStart + cw * channels), dstStart);
  }
  return { data: out, width: cw, height: ch };
}

/**
 * Bir dikdörtgeni bir piksel uzayından (fromW×fromH) başka birine
 * (toW×toH) ölçekler — depth çözünürlüğündeki bbox'ı fotoğrafın kendi
 * çözünürlüğüne taşımak için (letterbox/model çözünürlüğü farkı).
 * Kenarlar dışa doğru yuvarlanır (taşma yok, komşu piksel kaybı yok).
 */
export function scaleRect(
  rect: CropRect,
  fromW: number,
  fromH: number,
  toW: number,
  toH: number,
): CropRect {
  const sx = toW / fromW;
  const sy = toH / fromH;
  return {
    x0: Math.max(0, Math.floor(rect.x0 * sx)),
    y0: Math.max(0, Math.floor(rect.y0 * sy)),
    x1: Math.min(toW, Math.ceil(rect.x1 * sx)),
    y1: Math.min(toH, Math.ceil(rect.y1 * sy)),
  };
}

export interface SeparationCropInput {
  depth: Float32Array;
  depthWidth: number;
  depthHeight: number;
  mask?: Float32Array;
  rgb?: Float32Array;
  rgbWidth?: number;
  rgbHeight?: number;
}

/**
 * Nesne ayırma AÇIKKEN girdiyi özne bbox'ına (+ pay) kırpar; KAPALIYKEN ya
 * da maske/bbox yoksa (computeMaskCropRect null) girdiyi OLDUĞU GİBİ döner
 * — Engine.ts'teki çağıran taraf koşulsuz bu fonksiyonu çağırabilir, dallanma
 * burada toplanır (setDepth ve nesne ayırma toggle'ı aynı mantığı paylaşır).
 */
export function applySeparationCrop(
  input: SeparationCropInput,
  active: boolean,
): SeparationCropInput {
  if (!active || !input.mask) return input;
  const rect = computeMaskCropRect(input.mask, input.depthWidth, input.depthHeight);
  if (!rect) return input;
  const d = cropChannels(input.depth, input.depthWidth, input.depthHeight, 1, rect);
  const m = cropChannels(input.mask, input.depthWidth, input.depthHeight, 1, rect);
  const out: SeparationCropInput = {
    depth: d.data,
    depthWidth: d.width,
    depthHeight: d.height,
    mask: m.data,
  };
  if (input.rgb && input.rgbWidth && input.rgbHeight) {
    const rgbRect = scaleRect(rect, input.depthWidth, input.depthHeight, input.rgbWidth, input.rgbHeight);
    const r = cropChannels(input.rgb, input.rgbWidth, input.rgbHeight, 3, rgbRect);
    out.rgb = r.data;
    out.rgbWidth = r.width;
    out.rgbHeight = r.height;
  }
  return out;
}
