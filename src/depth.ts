import { env, pipeline, RawImage } from '@huggingface/transformers';

// Model weights and the ORT runtime both live locally — no CDN, no network.
env.allowRemoteModels = false;
env.allowLocalModels = true; // off by default in the browser build
env.localModelPath = '/models/';
// Dev: Vite refuses module imports from /public (500 on `?import`), so point at
// the onnxruntime-web dist inside node_modules (served through the transform
// pipeline). Prod: static /ort/ files from public/ are copied into dist.
env.backends.onnx.wasm!.wasmPaths = import.meta.env.DEV
  ? '/node_modules/onnxruntime-web/dist/'
  : '/ort/';
env.backends.onnx.wasm!.numThreads = 1; // single-thread => no COOP/COEP headers needed

const MODEL = 'onnx-community/depth-anything-v2-base';

// Depth Anything V2 training resolution. The image processor resizes every
// input to this square, so we letterbox to the same size: the model then sees
// its native square without any aspect distortion.
const MODEL_INPUT_SIZE = 518;

export type DepthResult = {
  /** Normalized 0..1, 0 = far, 1 = near. Row 0 is the TOP of the image. */
  data: Float32Array;
  width: number;
  height: number;
};

export type DepthEstimateOptions = {
  /**
   * 'letterbox' (default): keep the aspect ratio, pad to a square. The model
   * never sees a squeezed image — vertical portraits keep their face geometry.
   * 'distort': old behavior, plain resize to the square.
   */
  aspect?: 'distort' | 'letterbox';
  /**
   * Trim the darkest/brightest `percentile`% of values before min-max
   * normalization. One blown-out pixel no longer crushes the whole range.
   * 0 disables the trim.
   */
  percentile?: number;
  /**
   * RGB-directed detail strength (λ). The depth model smooths facial detail
   * (eye sockets, nose, lip lines); the source image's luminance high
   * frequency brings it back: D_final = D + λ · HighFreq · Mask_fg, where
   * HighFreq = Luminance − Blur(Luminance) and Mask_fg = smoothstep(0.15, 0.8, D).
   * 0 disables. Default 0.25 — yüz bölgesindeki detayların z baskınlığı
   * düşük α kavisinde korunur.
   */
  detailStrength?: number;
  /**
   * Ön plan ROI derinlik genişletmesi: model yüzü %2-3'lük dar bir aralığa
   * sıkıştırır (burun ↔ göz çukuru mikro farkları kaybolur). Maskelenmiş ön
   * planın min/max derinliği alınıp [STRETCH_LO, STRETCH_HI] aralığına
   * yeniden dağıtılır: D_new = lo + (hi−lo) · (D − Dmin)/(Dmax − Dmin).
   * Maske ile yumuşak harmanlanır (maske dışına bulaşmaz). false = kapalı.
   * Varsayılan açık.
   */
  foregroundStretch?: boolean;
  /**
   * Sobel mikro kabartma (β): yüz bölgesindeki luminance gradyanlarına göre
   * keskin mikro rölyef enjekte edilir: Z_disp = β · √(Gx² + Gy²) · Mask_fg.
   * 0 = kapalı. Varsayılan 0.02.
   */
  sobelRelief?: number;
  /**
   * Dikey dilimlenme yumuşatması: model derinliği sert bant adımları içerir
   * (yandan bakınca plaka katmanlaşması). Küçük menzilli bilateral bu mikro
   * sıçramaları yayar; |ΔD| ≫ σ_r olan gerçek kenarlar korunur. false =
   * kapalı. Varsayılan açık.
   */
  depthSmoothing?: boolean;
};

let estimator: Awaited<ReturnType<typeof pipeline<'depth-estimation'>>> | null = null;

export async function loadDepthModel(device: 'wasm' | 'webgpu' = 'wasm') {
  if (estimator) return estimator;
  estimator = await pipeline('depth-estimation', MODEL, {
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
  });
  return estimator;
}

/**
 * Runs depth estimation and normalizes to the contract in ARCHITECTURE.md:
 * 0 = far, 1 = near, top-left origin. The shader layer never renormalizes.
 */
export async function estimateDepth(
  source: HTMLCanvasElement | HTMLImageElement,
  opts: DepthEstimateOptions = {},
): Promise<DepthResult> {
  const model = await loadDepthModel();
  const useLetterbox = (opts.aspect ?? 'letterbox') === 'letterbox';
  const detailStrength = opts.detailStrength ?? DETAIL_STRENGTH_DEFAULT;
  const stretchEnabled = opts.foregroundStretch ?? FOREGROUND_STRETCH_DEFAULT;
  const sobelRelief = opts.sobelRelief ?? SOBEL_RELIEF_DEFAULT;
  const smoothingEnabled = opts.depthSmoothing ?? DEPTH_SMOOTHING_DEFAULT;

  let input: RawImage;
  let rect: { x: number; y: number; w: number; h: number } | null = null;
  let lumCanvas: HTMLCanvasElement | null = null;
  if (useLetterbox) {
    const lb = letterboxCanvas(source, MODEL_INPUT_SIZE);
    input = await RawImage.fromCanvas(lb.canvas);
    rect = lb;
    lumCanvas = lb.canvas;
  } else {
    const src = toCanvas(source);
    input = await RawImage.fromCanvas(src);
    lumCanvas = scaleCanvasTo(src, MODEL_INPUT_SIZE);
  }

  const { predicted_depth } = await model(input);

  const [height, width] = predicted_depth.dims.slice(-2) as [number, number];
  let data = predicted_depth.data as Float32Array;
  let outWidth = width;
  let outHeight = height;
  // Luminance, modelin gördüğü aynı kare uzayında hesaplanır — detay
  // haritası depth ile birebir hizalı olsun diye (letterbox: kare canvas).
  let lum: Float32Array | null = null;
  if (detailStrength > 0) lum = luminanceOf(lumCanvas!);
  if (rect) {
    // The pipeline interpolates the output back to the input (square) size;
    // crop the letterbox frame so padded areas never enter the depth map.
    data = cropDepth(data, width, rect);
    if (lum) lum = cropDepth(lum, width, rect);
    outWidth = rect.w;
    outHeight = rect.h;
  }

  const normalized = normalizeDepth(data, opts.percentile ?? 1);
  if (smoothingEnabled) {
    smoothDepthSteps(normalized, outWidth, outHeight);
  }
  if (detailStrength > 0 && lum) {
    applyDetail(normalized, lum, outWidth, outHeight, detailStrength);
  }
  // Yüz detay aşamaları aynı ön plan maskesiyle çalışır (smoothstep(0.15, 0.8, D)).
  const maskFg =
    stretchEnabled || sobelRelief > 0 ? foregroundMask(normalized, outWidth, outHeight) : null;
  if (stretchEnabled) {
    applyForegroundStretch(normalized, maskFg!, outWidth, outHeight);
  }
  if (sobelRelief > 0 && lum) {
    applySobelRelief(normalized, lum, maskFg!, outWidth, outHeight, sobelRelief);
  }
  return { data: normalized, width: outWidth, height: outHeight };
}

function toCanvas(source: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement {
  if (source instanceof HTMLCanvasElement) return source;
  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0);
  return canvas;
}

/**
 * Draws the source onto a `size`x`size` canvas, aspect preserved and centered.
 * Padding uses the image's average color (from a 16x16 thumbnail) instead of
 * black: the model treats uniform fills as "unknown area", so we want it to be
 * as close to the photo's own tone as possible. The padded frame is cropped
 * away after inference, so it never reaches the depth map.
 */
function letterboxCanvas(
  source: HTMLCanvasElement | HTMLImageElement,
  size: number,
): { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } {
  const src = toCanvas(source);
  const scale = Math.min(size / src.width, size / src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const x = Math.floor((size - w) / 2);
  const y = Math.floor((size - h) / 2);

  const thumb = document.createElement('canvas');
  thumb.width = 16;
  thumb.height = 16;
  const tctx = thumb.getContext('2d', { willReadFrequently: true })!;
  tctx.drawImage(src, 0, 0, 16, 16);
  const tdata = tctx.getImageData(0, 0, 16, 16).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < tdata.length; i += 4) {
    r += tdata[i];
    g += tdata[i + 1];
    b += tdata[i + 2];
  }
  const n = tdata.length / 4;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(src, x, y, w, h);
  return { canvas, x, y, w, h };
}

/** Copies the letterbox frame out of the square output. Rows stay top-first. */
function cropDepth(
  data: Float32Array,
  square: number,
  rect: { x: number; y: number; w: number; h: number },
): Float32Array {
  const out = new Float32Array(rect.w * rect.h);
  for (let j = 0; j < rect.h; j++) {
    const rowStart = (j + rect.y) * square + rect.x;
    out.set(data.subarray(rowStart, rowStart + rect.w), j * rect.w);
  }
  return out;
}

/**
 * Min-max normalization with an optional percentile trim (histogram based,
 * no sort). Depth models emit a few outlier logits (usually far-field noise);
 * without trimming they compress the whole 0..1 range and flatten foreground
 * detail.
 */
function normalizeDepth(data: Float32Array, pct: number): Float32Array {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of data) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const span = mx - mn || 1;
  let lo = mn;
  let hi = mx;
  if (pct > 0) {
    const bins = new Float64Array(256);
    for (const v of data) {
      const b = Math.min(255, Math.max(0, Math.floor(((v - mn) / span) * 256)));
      bins[b]++;
    }
    const limit = (data.length * pct) / 100;
    let acc = 0;
    for (let i = 0; i < 256 && acc < limit; i++) {
      acc += bins[i];
      lo = mn + (i / 256) * span;
    }
    acc = 0;
    for (let i = 255; i >= 0 && acc < limit; i--) {
      acc += bins[i];
      hi = mn + ((i + 1) / 256) * span;
    }
  }
  const s = hi - lo || 1;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.min(1, Math.max(0, (data[i] - lo) / s));
  return out;
}

// ---------------------------------------------------------------------------
// RGB-directed depth detailing. The depth model smooths facial detail; the
// source image's luminance high frequency brings it back, masked to the
// foreground only so the background keeps its flat structure.
// ---------------------------------------------------------------------------

const DETAIL_STRENGTH_DEFAULT = 0.25;
const DETAIL_BLUR_RADIUS = 3;
// Düşük eşik: gölgeli/koyu yüz bölgeleri (göz çukuru, çene altı, siyah saç)
// da detay/stretch/sobel maskesine girer — yüzey deliği üretmezler.
const DETAIL_MASK_NEAR = 0.15;
const DETAIL_MASK_FAR = 0.8;

/** Grayscale luminance of a canvas: Y = 0.299R + 0.587G + 0.114B (0..1). */
function luminanceOf(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const out = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < px.length; i += 4) {
    out[i / 4] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
  }
  return out;
}

/** Distort path: scale the source to the model's square so the luminance
 *  space matches the depth output pixel-for-pixel. */
function scaleCanvasTo(source: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0, size, size);
  return canvas;
}

/**
 * D_final = D + λ · (Y − Blur(Y)) · Mask_fg. Applied in-place on the
 * normalized depth; output stays in 0..1 (contract).
 */
function applyDetail(
  depth: Float32Array,
  lum: Float32Array,
  w: number,
  h: number,
  lambda: number,
) {
  const blur = boxBlur(lum, w, h, DETAIL_BLUR_RADIUS);
  for (let i = 0; i < depth.length; i++) {
    const highFreq = lum[i] - blur[i];
    const mask = smoothstep(DETAIL_MASK_NEAR, DETAIL_MASK_FAR, depth[i]);
    depth[i] = Math.min(1, Math.max(0, depth[i] + lambda * highFreq * mask));
  }
}

/** Separable box blur (x pass then y pass); keeps the kernel small. */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        s += src[row + Math.min(w - 1, Math.max(0, x + dx))];
      }
      tmp[row + x] = s / k;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        s += tmp[Math.min(h - 1, Math.max(0, y + dy)) * w + x];
      }
      out[y * w + x] = s / k;
    }
  }
  return out;
}

/** GLSL-style smoothstep: 0 below e0, 1 above e1, smooth Hermite between. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Yüz detay aşamaları (ROI stretch + Sobel mikro kabartma). Depth Anything
// ön planı dar bir aralığa sıkıştırır; bu iki aşama yüz bölgesindeki mikro
// derinlik farklarını görünür yapar. Sıra: normalize → detay (λ) → stretch
// → sobel; böylece Sobel rölyefi stretch'in yeniden dağıtımından etkilenmez.
// ---------------------------------------------------------------------------

const FOREGROUND_STRETCH_DEFAULT = true;
const SOBEL_RELIEF_DEFAULT = 0.02;
/** Stretch hedef aralığı: tam [0,1]'e açmak arka planla çakışırdı. */
const STRETCH_LO = 0.1;
const STRETCH_HI = 0.95;
/** Yumuşatma eşiği: ön plan maskesi bu değerin ALTINDAYSa stretch kapsamı dışı. */
const STRETCH_MASK_LO = 0.1;

const DEPTH_SMOOTHING_DEFAULT = true;
const SMOOTH_RADIUS = 1;
const SMOOTH_SIGMA_S = 1.2;
const SMOOTH_SIGMA_R = 0.02;

/**
 * Dikey dilimlenme yumuşatması (hafif bilateral, ayrılabilir: yatay + dikey
 * geçiş). Uzamsal çekirdek Gauss; derinlik farkı ağırlığı da Gauss —
 * |ΔD| ≫ σ_r olan gerçek kenarlar (yüz/beden sınırı) korunurken modelin
 * bant içi sert adımları yayılır. Küçük kernel + küçük σ_r: Sobel mikro
 * kabartmanın yüksek frekanslı yüz detayları ezilmez. In-place, 0..1
 * sözleşmesinde kalır.
 */
function smoothDepthSteps(depth: Float32Array, w: number, h: number) {
  const weights: { d: number; g: number }[] = [];
  for (let dx = -SMOOTH_RADIUS; dx <= SMOOTH_RADIUS; dx++) {
    weights.push({ d: dx, g: Math.exp(-(dx * dx) / (2 * SMOOTH_SIGMA_S * SMOOTH_SIGMA_S)) });
  }
  const tmp = new Float32Array(depth.length);
  // yatay geçiş → tmp (kenarlar kelepçeli)
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const c = depth[row + x];
      let s = 0;
      let ws = 0;
      for (const { d, g } of weights) {
        const xn = Math.min(w - 1, Math.max(0, x + d));
        const v = depth[row + xn];
        const rw = g * Math.exp(-((v - c) * (v - c)) / (2 * SMOOTH_SIGMA_R * SMOOTH_SIGMA_R));
        s += v * rw;
        ws += rw;
      }
      tmp[row + x] = ws > 0 ? s / ws : c;
    }
  }
  // dikey geçiş → depth (kenarlar kelepçeli)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = tmp[y * w + x];
      let s = 0;
      let ws = 0;
      for (const { d, g } of weights) {
        const yn = Math.min(h - 1, Math.max(0, y + d));
        const v = tmp[yn * w + x];
        const rw = g * Math.exp(-((v - c) * (v - c)) / (2 * SMOOTH_SIGMA_R * SMOOTH_SIGMA_R));
        s += v * rw;
        ws += rw;
      }
      depth[y * w + x] = ws > 0 ? s / ws : c;
    }
  }
}

/** Ön plan maskesi: w_fg = smoothstep(0.15, 0.8, D) — detay maskesiyle aynı. */
function foregroundMask(depth: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(depth.length);
  for (let i = 0; i < depth.length; i++) {
    out[i] = smoothstep(DETAIL_MASK_NEAR, DETAIL_MASK_FAR, depth[i]);
  }
  return out;
}

/**
 * Ön plan derinliğini [STRETCH_LO, STRETCH_HI]'e yeniden dağıtır. Min/max
 * taraması yalnızca M ≥ 0.10 maskesi içinde yapılır (arka plan siluet artığı
 * hesaba katılmaz); maskeli bölge tek ton ise dokunulmaz. Uygulamada maske
 * ile yumuşak harman: maske = 1 tam genişletilir, maske = 0 hiç dokunulmaz —
 * sınırda bıçak kesimi oluşmaz.
 */
function applyForegroundStretch(depth: Float32Array, mask: Float32Array, w: number, h: number) {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < depth.length; i++) {
    if (mask[i] >= STRETCH_MASK_LO) {
      if (depth[i] < mn) mn = depth[i];
      if (depth[i] > mx) mx = depth[i];
    }
  }
  const span = mx - mn;
  if (!(span > 1e-4)) return; // ön plan tek ton → genişletilecek bir şey yok
  for (let i = 0; i < depth.length; i++) {
    const m = mask[i];
    if (m > 0.001) {
      const stretched = STRETCH_LO + (STRETCH_HI - STRETCH_LO) * ((depth[i] - mn) / span);
      depth[i] = depth[i] + (stretched - depth[i]) * m;
    }
  }
}

/**
 * Z_disp = β · √(Gx² + Gy²) · Mask_fg. 3×3 Sobel luminance gradyanları,
 * kenarlar kelepçeli (clamp-to-edge); sonuç depth'e eklenir (0..1 sözleşmesi
 * arayan kademede kırpılır).
 */
function applySobelRelief(
  depth: Float32Array,
  lum: Float32Array,
  mask: Float32Array,
  w: number,
  h: number,
  beta: number,
) {
  const mag = sobelMagnitude(lum, w, h);
  for (let i = 0; i < depth.length; i++) {
    depth[i] += beta * mag[i] * mask[i];
  }
}

/** Sobel büyüklüğü |G| = √(Gx² + Gy²); clamp-to-edge sınır işlemi.
 *  `outPool` verilirse (video yolu) yazılacak buffer odur — alloc yok.
 *  Gün C: havuzlu/havuzsuz iki KOPYA gövde tek gövdeye indirildi. */
function sobelMagnitude(
  lum: Float32Array,
  w: number,
  h: number,
  outPool?: Float32Array | null,
): Float32Array {
  const out =
    outPool && outPool.length === lum.length ? outPool : new Float32Array(lum.length);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      const tl = lum[ym * w + xm];
      const t = lum[ym * w + x];
      const tr = lum[ym * w + xp];
      const l = lum[y * w + xm];
      const r = lum[y * w + xp];
      const bl = lum[yp * w + xm];
      const b = lum[yp * w + x];
      const br = lum[yp * w + xp];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      out[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/**
 * Kamera/video yolu (Gün 1 kararı): depth modeli YOK — parlaklık = yükseklik.
 * Aynı DepthResult sözleşmesi: 0..1, 0 = uzak (karanlık), 1 = yakın (parlak),
 * satır 0 = üst. Görsel modelden geçmediği için çıkarım süresi yok.
 *
 * GÜN 6 — Video 3D geliştirmesi (1 + 2):
 * - Yerel kontrast + ön plan vurgusu: luminance yalnızca global parlaklık
 *   yerine, merkezdeki özneyi yükseltir (yüz/nesne arka plandan ayrılır).
 * - Kenar kabartma (Sobel): yüz hatları 3D'de belirginleşir (fotoğraf
 *   yolundaki applySobelRelief ile aynı ilke, luminance üzerinde CPU).
 */
// Canlı kamerada saniyede ~10 kez çağrılır: her karede yeni canvas + yeni 2D
// context açmak yerine tek bir çizim yüzeyi yeniden kullanılır.
let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
// Luminance buffer'ı da aynı nedenle yeniden kullanılır: video yolunda her
// frame'de yeni Float32Array ayırmak çöp biriktirir, scratch değişmez.
let scratchData: Float32Array | null = null;
// GÜN 6 (opt): geçici işlem buffer'ları — her karede boxBlur/Sobel için yeni
// Float32Array ayırmak GC baskısı yaratır. Boyut değişince yeniden boyutlandırılır.
let scratchBlur: Float32Array | null = null;
let scratchMag: Float32Array | null = null;
/** Gün C: yumuşatılmış taban (low-pass) — işaretli detay bundan türetilir. */
let scratchLow: Float32Array | null = null;
/** Gün C: zamansal kararlı normalizasyonun EMA uçları (null = ilk kare). */
let lumLo: number | null = null;
let lumHi: number | null = null;

/** Havuz getir/boyutlandır — video yolunda kare başına alloc olmasın. */
function pool(buf: Float32Array | null, n: number): Float32Array {
  return buf && buf.length === n ? buf : new Float32Array(n);
}

/**
 * Luminance yolunun kare-arası durumunu sıfırlar (kaynak değişiminde çağrılır:
 * yeni video/kamera eski karenin EMA aralığını miras almasın).
 */
export function resetLuminanceState() {
  lumLo = null;
  lumHi = null;
}

/**
 * Görsel işleme oluşumunu yapılandıran seçenekler. Varsayılanlar flu haline
 * göre ayarlanır: video oynatıcı modu iyi görünmelidir, gerçek zamanlıdır.
 */
export interface LuminanceOptions {
  /**
   * Mikro rölyef gücü (β_video). GÜN C: artık |Sobel| DEĞİL, İŞARETLİ yüksek
   * frekans (raw − low-pass) ile çarpılır — fotoğraf yolundaki applyDetail ile
   * aynı ilke. |Sobel| her kenarda POZİTİF olduğu için her kenarı z'de sırt
   * (ridge) yapıyordu: yüz hatları kabartma değil tel kafes gibi çıkıyordu ve
   * arka plan detayı da öne fırlıyordu. Varsayılan 0.35.
   */
  edgeStrength?: number;
  /** Merkez/ön plan vurgusu (α_video): yüz bölgesini z'de yükseltir. Varsayılan 0.3. */
  centerBoost?: number;
  /** Ön plan vurgusunun uzamsal yarıçapı (0..1, normalize). Varsayılan 0.35. */
  centerRadius?: number;
  /** Yumuşatma yarıçapı (piksel) — yüksek frekanslı codec gürültüsünü bastırır. Varsayılan 1. */
  smoothingRadius?: number;
  /**
   * GÜN C — NETLİK (defocus) ipucu ağırlığı, 0..1. Parlaklık kötü bir derinlik
   * vekilidir (beyaz duvar öne fırlar, siyah saç dibe çöker). Videoda ise
   * neredeyse her zaman geçerli bir ipucu vardır: ÖZNE NET, arka plan flu.
   * Yerel gradyan enerjisi geniş yarıçapla yumuşatılıp ortalamasına
   * normalleştirilir (net bölge → 1, flu bölge → 0) ve z tabanı bununla
   * harmanlanır. 0 = kapalı (eski saf parlaklık davranışı). Varsayılan 0.55.
   */
  focusStrength?: number;
  /**
   * GÜN C — zamansal kararlı normalizasyon. Kare başına min/max ile
   * normalleştirmek, tek bir parlama/gölge sahnenin TAMAMININ z eşlemesini
   * kaydırdığı için bulutu nefes aldırıyordu (titreme kaynağı temporal lerp'in
   * arkasında kalıyordu). Uçlar EMA ile taşınır. Varsayılan açık.
   */
  stableRange?: boolean;
}

export function luminanceHeightMap(
  source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
  size = 256,
  opts: LuminanceOptions = {},
): DepthResult {
  let srcW: number;
  let srcH: number;
  if (source instanceof HTMLVideoElement) {
    srcW = source.videoWidth;
    srcH = source.videoHeight;
  } else if (source instanceof HTMLImageElement) {
    srcW = source.naturalWidth;
    srcH = source.naturalHeight;
  } else {
    srcW = source.width;
    srcH = source.height;
  }
  const height = Math.max(1, Math.round(size * (srcH / Math.max(1, srcW))));

  if (!scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
    scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  }
  const canvas = scratchCanvas;
  const ctx = scratchCtx!;
  if (canvas.width !== size || canvas.height !== height) {
    canvas.width = size;
    canvas.height = height;
  }
  ctx.drawImage(source, 0, 0, size, height);

  const px = ctx.getImageData(0, 0, size, height).data;
  const n = size * height;
  // Çözünürlük değiştiyse EMA aralığı başka bir kareye aittir — sıfırla.
  if (scratchData && scratchData.length !== n) resetLuminanceState();
  scratchData = pool(scratchData, n);
  const data = scratchData;
  for (let i = 0; i < px.length; i += 4) {
    data[i / 4] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
  }

  // GÜN 6/C — video 3D iyileştirmeleri (CPU'da, gerçek zamanlı):
  const edgeStrength = opts.edgeStrength ?? 0.35;
  const centerBoost = opts.centerBoost ?? 0.3;
  const centerRadius = opts.centerRadius ?? 0.35;
  const smoothingRadius = opts.smoothingRadius ?? 1;
  const focusStrength = opts.focusStrength ?? 0.55;

  // NETLİK İPUCU (Gün C): HAM luminance'ın gradyan enerjisi → geniş yarıçaplı
  // yumuşatma → ortalamaya göre normalizasyon. Net (ön plan) bölge 1'e, flu
  // arka plan 0'a gider. Kare içi ortalamayla ölçeklendiği için parlaklık
  // değişimlerine karşı zamansal olarak kararlıdır.
  let focus: Float32Array | null = null;
  if (focusStrength > 0) {
    scratchMag = pool(scratchMag, n);
    focus = sobelMagnitude(data, size, height, scratchMag);
    boxBlurInPlace(focus, size, height, Math.max(2, Math.round(size / 24)));
    let sum = 0;
    for (let i = 0; i < n; i++) sum += focus[i];
    const scale = 1 / Math.max(1e-6, (2 * sum) / n);
    for (let i = 0; i < n; i++) focus[i] = Math.min(1, focus[i] * scale);
  }

  // Taban (low-pass) + İŞARETLİ detay: gürültü ölür, rölyef kalır.
  const low = (scratchLow = pool(scratchLow, n));
  low.set(data);
  if (smoothingRadius > 0) boxBlurInPlace(low, size, height, smoothingRadius);
  for (let i = 0; i < n; i++) {
    const base = focus ? low[i] * (1 - focusStrength) + focus[i] * focusStrength : low[i];
    data[i] = base + edgeStrength * (data[i] - low[i]);
  }

  if (centerBoost > 0) {
    // Merkeze radyal vurgu: yüz/gövde arka plandan ayrılsın. Ekranda merkeze
    // yakın piksel daha "yakın" (z yükselir); arka plan ayırt edici özelliği
    // görüntünün dışa dönük kenarlarında kalır.
    const cx = (size - 1) / 2;
    const cy = (height - 1) / 2;
    const rMax = Math.max(1, Math.min(cx, cy));
    const rad = Math.max(0.01, centerRadius);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - cx) / rMax;
        const dy = (y - cy) / rMax;
        const d2 = dx * dx + dy * dy;
        const g = Math.exp(-(d2 / (2 * rad * rad)));
        data[y * size + x] += centerBoost * g;
      }
    }
  }
  // 0..1 sözleşmesi (normalize et — global boost/edge sonrası en/çok kayabilir).
  return {
    data: normalizeInPlace(data, opts.stableRange !== false),
    width: size,
    height,
  };
}

/**
 * In-place min-max normalize (0..1 sözleşmesi). `stable` iken uçlar kareler
 * arasında EMA ile taşınır: tek karelik parlama tüm sahnenin z eşlemesini
 * kaydırmaz (video titreme kaynağı). Boyut değişiminde/kaynak değişiminde
 * resetLuminanceState() ile sıfırlanır.
 */
const LUM_RANGE_ALPHA = 0.15;

function normalizeInPlace(data: Float32Array, stable: boolean): Float32Array {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of data) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  let lo = mn;
  let hi = mx;
  if (stable) {
    lumLo = lumLo === null ? mn : lumLo + LUM_RANGE_ALPHA * (mn - lumLo);
    lumHi = lumHi === null ? mx : lumHi + LUM_RANGE_ALPHA * (mx - lumHi);
    lo = lumLo;
    hi = lumHi;
  }
  const span = hi - lo || 1;
  for (let i = 0; i < data.length; i++) data[i] = Math.min(1, Math.max(0, (data[i] - lo) / span));
  return data;
}

/** In-place separable box blur (video yolunda temporal smoothing ile birlikte).
 *  GÜN C: takas buffer'ı modül havuzundan (scratchBlur) gelir — kare başına
 *  alloc yok. Eski parametreli hâli havuzu ASLA doldurmuyordu (yalnızca
 *  tmpPool !== tmp iken yazıyordu, tmpPool ilk çağrıda null'dı) — yani her
 *  karede yeni Float32Array ayrılıyordu. */
function boxBlurInPlace(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  // tmp her iki geçişte de TAMAMEN yazılır — temizlemeye gerek yok.
  scratchBlur = pool(scratchBlur, src.length);
  const tmp = scratchBlur;
  const k = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        s += src[row + Math.min(w - 1, Math.max(0, x + dx))];
      }
      tmp[row + x] = s / k;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        s += tmp[Math.min(h - 1, Math.max(0, y + dy)) * w + x];
      }
      src[y * w + x] = s / k;
    }
  }
  return src;
}
