/**
 * GENEL NESNE/ARKA PLAN AYIRMA (CPU, OPSİYONEL MODÜL).
 *
 * Depth siluet eşiği (SILHOUETTE_BIN_LO = 0.05) ince uzuvları korumak için
 * düşük tutulur; arka plan duvarları/zeminler bu eşiğin üstüne düştüğünde
 * siluete sızabiliyor. Bu modül subject-agnostic bir ön plan maskesi üretir
 * (insan, nesne, araç, manzara fark etmeksizin ön planı ayırır) ve
 * silhouette.ts'ye AND koşulu olarak girer — siluet yalnızca "depth eşiği VE
 * nesne maskesi"nin kesiştiği piksellerde aday olur.
 *
 * ── MODEL DEĞİŞTİ (2026-09-24, TİCARİ LİSANS GEREĞİ) ──────────────────────
 * Eski: `briaai/RMBG-1.4`. Model kartı birebir şunu diyor: "available as a
 * source-available model for NON-COMMERCIAL use" — ticari kullanım BRIA ile
 * ayrı, ücretli anlaşma ister. Abonelikli üründe ağırlığı kendi sunucumuzdan
 * servis etmek dağıtımdır, o yüzden çıkarıldı.
 *
 * Yeni: `imgly/isnet-general-onnx` — **MIT**, aynı IS-Net ailesi, aynı ONNX
 * giriş/çıkış adları (`input`/`output`), aynı 1024² girdi.
 *
 * ÖLÇÜLDÜ (gerçek fotoğraf, aynı letterbox, WebGPU fp16):
 *   ön plan oranı  IS-Net %20.7 · RMBG %20.1
 *   belirsiz bant  IS-Net %2.96 · RMBG %0.88
 *   iki maskenin örtüşmesi (IoU) **0.8916**
 * Aynı özneyi buluyor; kenar bandı biraz yumuşak. Zaten dilate + feather
 * uyguladığımız için fark boru hattında sönümleniyor.
 *
 * ── NEDEN transformers.js DEĞİL, DOĞRUDAN ORT ────────────────────────────
 * imgly deposunun config'i minimaldir (`{"model_type":"isnet"}`) ve
 * `AutoConfig` onu çözemiyor; Vite eksik JSON'a index.html döndürdüğü için
 * hata "Unexpected token '<'" olarak görünür (gerçek sebebi gizler). Eski
 * kod da zaten kütüphaneyi atlayıp `model._call({input})` çağırıyordu —
 * oturumu doğrudan kurmak katmanı azaltır, giriş/çıkış adlarını açık eder.
 * ORT İKİNCİ KOPYA DEĞİL: transformers.js de aynı node_modules paketini
 * yüklüyor (ağ kaydıyla doğrulandı).
 *
 * Çıktı sözleşmesi: nesne maskesi, 1024² letterbox karesinin İÇ kırpımında
 * (kadraj bandı atılır). Engine, maskeyi depth haritasının boyutuna
 * resampleBilinear ile ölçekler — iki aşamanın letterbox yuvarlama farkları
 * (518 vs 1024) burada dengelenir.
 *
 * TUR 10 (mask): ham model çıktısı sert 0.5 eşiğiyle kesilmez — önce
 * MASK_DILATE_RADIUS (4px) morfolojik genişletme, sonra MASK_FEATHER_RADIUS
 * (2px) kenar yumuşatma uygulanır. Modelin öznenin İÇİNE düşen < 0.5
 * hataları (yüz/el kenarı delikleri) güven marjıyla ön plan adayı olmaya
 * devam eder; uzak arka plan 0 kalır (perde koruması sürer — AND eşiği aynı).
 */

// WEBGPU GİRİŞ NOKTASI ŞART. Düz `onnxruntime-web` içe aktarımı wasm-only
// bundle'ı verir ve `executionProviders: ['webgpu']` sessizce wasm'a düşer —
// ölçüldü: aynı fotoğrafta 13.8 sn (wasm) vs ~0.8 sn (webgpu). Node tarafı
// (scripts/verify-seg.mjs) düz içe aktarımı kullanır; orada zaten wasm yolu
// doğrudur ve webgpu yoktur.
import * as ort from 'onnxruntime-web/webgpu';
import { dilateAndFeatherMask, keepLargestComponent } from './silhouette.ts';

// ORT runtime yerel — CDN yok (depth.ts ile aynı sözleşme). Aynı ORT örneği
// olduğu için değerler idempotent: depth.ts önce çalışsa bile aynı sonuç.
ort.env.wasm.wasmPaths = import.meta.env.DEV ? '/node_modules/onnxruntime-web/dist/' : '/ort/';
ort.env.wasm.numThreads = 1;

/** Model yolu — yerel, `public/models` altında (`npm run fetch:assets`). */
const MODEL_PATH = '/models/imgly/isnet-general-onnx/onnx/model_fp16.onnx';
/** IS-Net eğitim çözünürlüğü: girdi bu kareye letterbox'lanır. */
const MODEL_INPUT_SIZE = 1024;
/**
 * Normalizasyon `preprocessor_config.json`'dan: do_rescale=false, mean=128,
 * std=256 → (piksel[0..255] − 128) / 256. Eskiden bunu transformers.js'in
 * işlemcisi yapıyordu; oturumu doğrudan kurduğumuz için burada açık yazılır.
 */
const NORM_MEAN = 128;
const NORM_STD = 256;

export type SegmentationResult = {
  /** 0..1 ön plan olasılığı (maske, kadraj bandı kırpılmış). */
  mask: Float32Array;
  width: number;
  height: number;
};

let segSession: ort.InferenceSession | null = null;

export async function loadSegmentationModel(device: 'wasm' | 'webgpu' = 'webgpu') {
  if (segSession) return segSession;
  // WebGPU tercih edilir. Ağırlık fp16 olduğu için wasm yolunda desteklenmeyen
  // op'a düşülebilir; o durumda hata YUTULMAZ, çağırana bildirilir — sessiz
  // bozulma yasağı (bkz. vision/yetenek.ts).
  segSession = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
  });
  return segSession;
}

/**
 * Kaynak görüntüden nesne/arka plan maskesi üretir. Letterbox + kırpım depth
 * yoluyla aynı geometridedir (modelin gördüğü kare alanın iç kısmı), böylece
 * maske depth haritasıyla hizalanır. Çıktı maskesi kırpılmış rect boyutundadır.
 */
export async function segmentForeground(
  source: HTMLCanvasElement | HTMLImageElement,
  device: 'wasm' | 'webgpu' = 'webgpu',
): Promise<SegmentationResult> {
  const session = await loadSegmentationModel(device);
  const lb = letterboxCanvas(source, MODEL_INPUT_SIZE);
  const ctx = lb.canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('segmentForeground: 2d context yok');
  const px = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data;
  // NCHW + kanal ayrık: ONNX girdisi böyle bekliyor (RGBA satır düzeninden
  // üç ayrı düzleme taşınır).
  const n = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const tensor = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    tensor[i] = (px[i * 4] - NORM_MEAN) / NORM_STD;
    tensor[n + i] = (px[i * 4 + 1] - NORM_MEAN) / NORM_STD;
    tensor[2 * n + i] = (px[i * 4 + 2] - NORM_MEAN) / NORM_STD;
  }
  const result = await session.run({
    input: new ort.Tensor('float32', tensor, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]),
  });
  const tOut = result.output;
  const [batch, ch, , outW] = tOut.dims as [number, number, number, number];
  if (batch !== 1 || ch !== 1) {
    throw new Error(`segmentasyon çıktısı beklenmeyen şekil: ${tOut.dims.join('x')}`);
  }
  const out = tOut.data as Float32Array;
  // Kadraj bandını at: kırpılmış rect maskesi (çıktı zaten 0..1 olasılık).
  const raw = new Float32Array(lb.w * lb.h);
  for (let j = 0; j < lb.h; j++) {
    const rowStart = (j + lb.y) * outW + lb.x;
    raw.set(out.subarray(rowStart, rowStart + lb.w), j * lb.w);
  }
  // TUR 10: sert kesim yerine dilate + feather — yüz/el kenarı delikleri
  // güven marjıyla kapanır; perde koruması (AND eşiği) değişmez.
  // GÜN E (bulgu 12): önce kopuk parçaları düşür (özneye bitişik OLMAYAN model
  // hataları — kapı kasası, zemin), sonra dilate + tüy.
  const mask = dilateAndFeatherMask(keepLargestComponent(raw, lb.w, lb.h), lb.w, lb.h);
  return { mask, width: lb.w, height: lb.h };
}

/** Kaynağı `size`×`size` kareye, en-boy korunarak ortalar (depth.ts ile aynı
 *  letterbox geometrisi). Kadraj bandı görüntünün KENDİ kenar şeridinin ayna
 *  uzantısıyla doldurulur — düz ortalama ton dolgusu, çerçeveye değen özneyi
 *  (saç, kol, omuz) RMBG'nin "bilinmeyen bölge" önceliğine kaptırıp maskeyi
 *  içeri çekiyordu ("çok orta fokuslu"); yansımalı devam, kenar pikselinin
 *  ön plan adayı sayılmaya devam etmesini sağlar. Yansımanın erişmediği
 *  köşeler (ancak aşırı dar/geniş kadrajda) ortalama tonla dolar. */
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
  // Yansımalı dolgu: her band, görüntüyü ilgili kenarından aynalayarak doldurur.
  // Canvas'ın kendinden kendine çizimi güvenlidir (kaynak, blit'ten önce okunur);
  // dikey aynalar önce, yataylar sonra çizilir ki köşeler de sürekli kalsın.
  // DÜZELTME: 5 argümanlı drawImage(image, dx, dy, dw, dh) KAYNAK olarak
  // canvas'ın TAMAMINI alır ve hedef dikdörtgene sıkıştırır — aynalanan şey
  // kenar şeridi değil, küçültülmüş bütün kare oluyordu (RMBG'ye uydurma
  // içerik gidiyordu). 9 argümanlı biçim kaynak dikdörtgenini de verir.
  ctx.save();
  ctx.translate(2 * x, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, x, y, w, h, x, y, w, h);
  ctx.restore();
  ctx.save();
  ctx.translate(2 * (x + w), 0);
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, x, y, w, h, x, y, w, h);
  ctx.restore();
  const topBand = Math.min(y, h);
  if (topBand > 0) {
    ctx.save();
    ctx.translate(0, 2 * y);
    ctx.scale(1, -1);
    ctx.drawImage(canvas, 0, y, size, topBand, 0, y, size, topBand);
    ctx.restore();
  }
  const bottomBand = Math.min(size - (y + h), h);
  if (bottomBand > 0) {
    ctx.save();
    ctx.translate(0, 2 * (y + h));
    ctx.scale(1, -1);
    ctx.drawImage(canvas, 0, y + h - bottomBand, size, bottomBand, 0, y + h - bottomBand, size, bottomBand);
    ctx.restore();
  }
  return { canvas, x, y, w, h };
}

function toCanvas(source: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement {
  if (source instanceof HTMLCanvasElement) return source;
  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0);
  return canvas;
}
