/**
 * GENEL NESNE/ARKA PLAN AYIRMA (CPU, OPSİYONEL MODÜL).
 *
 * Depth siluet eşiği (SILHOUETTE_BIN_LO = 0.05) ince uzuvları korumak için
 * düşük tutulur; arka plan duvarları/zeminler bu eşiğin üstüne düştüğünde
 * siluete sızabiliyor. Bu modül subject-agnostic bir ön plan maskesi üretir
 * (BriaRMBG-1.4: insan, nesne, araç, manzara fark etmeksizin ön planı
 * ayırır) ve silhouette.ts'ye AND koşulu olarak girer — siluet yalnızca
 * "depth eşiği VE nesne maskesi"nin kesiştiği piksellerde aday olur.
 *
 * Model: briaai/RMBG-1.4 (SegformerForSemanticSegmentation mimarisi, çıkış
 * grafikte sigmoid'lenmiş 0..1 olasılık). ONNX dışa aktarımının giriş adı
 * 'input' olduğu için transformers.js'nin pixel_values sözleşmesiyle çalışmaz
 * — encoder_forward session input adlarıyla eşleştirme yaptığından
 * model._call({ input }) ile doğrudan beslenir (scripts/verify-seg.mjs
 * çalıştırılabilir kanıttır).
 *
 * Çıktı sözleşmesi: nesne maskesi, 1024² letterbox karesinin İÇ kırpımında
 * (kadraj bandı atılır). Engine, maskeyi depth haritasının boyutuna
 * resampleBilinear ile ölçekler — iki aşamanın letterbox yuvarlama farkları
 * (518 vs 1024) burada dengelenir.
 *
 * TUR 10 (mask): ham RMBG çıktısı sert 0.5 eşiğiyle kesilmez — önce
 * MASK_DILATE_RADIUS (4px) morfolojik genişletme, sonra MASK_FEATHER_RADIUS
 * (2px) kenar yumuşatma uygulanır. RMBG'nin öznenin İÇİNE düşen < 0.5
 * hataları (yüz/el kenarı delikleri) güven marjıyla ön plan adayı olmaya
 * devam eder; uzak arka plan 0 kalır (perde koruması sürer — AND eşiği aynı).
 */

import {
  AutoImageProcessor,
  env,
  RawImage,
  SegformerForSemanticSegmentation,
} from '@huggingface/transformers';
import { dilateAndFeatherMask, keepLargestComponent } from './silhouette.ts';

// Model ağırlıkları ve ORT runtime yerel — CDN yok, ağ yok (depth.ts ile aynı
// sözleşme). Değerler idempotent: depth.ts önce çalışsa bile aynı sonuç.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm!.wasmPaths = import.meta.env.DEV
  ? '/node_modules/onnxruntime-web/dist/'
  : '/ort/';
env.backends.onnx.wasm!.numThreads = 1;

const MODEL = 'briaai/RMBG-1.4';
/** BriaRMBG eğitim çözünürlüğü: işlemci her girdiyi bu kareye büyütür. */
const MODEL_INPUT_SIZE = 1024;

export type SegmentationResult = {
  /** 0..1 ön plan olasılığı (maske, kadraj bandı kırpılmış). */
  mask: Float32Array;
  width: number;
  height: number;
};

let segModel: Awaited<
  ReturnType<typeof SegformerForSemanticSegmentation.from_pretrained>
> | null = null;
let segProcessor: Awaited<ReturnType<typeof AutoImageProcessor.from_pretrained>> | null = null;

export async function loadSegmentationModel(device: 'wasm' | 'webgpu' = 'wasm') {
  if (segModel && segProcessor) return { model: segModel, processor: segProcessor };
  const model = await SegformerForSemanticSegmentation.from_pretrained(MODEL, {
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
  });
  const processor = await AutoImageProcessor.from_pretrained(MODEL);
  segModel = model;
  segProcessor = processor;
  return { model, processor };
}

/**
 * Kaynak görüntüden nesne/arka plan maskesi üretir. Letterbox + kırpım depth
 * yoluyla aynı geometridedir (modelin gördüğü kare alanın iç kısmı), böylece
 * maske depth haritasıyla hizalanır. Çıktı maskesi kırpılmış rect boyutundadır.
 */
export async function segmentForeground(
  source: HTMLCanvasElement | HTMLImageElement,
  device: 'wasm' | 'webgpu' = 'wasm',
): Promise<SegmentationResult> {
  const { model, processor } = await loadSegmentationModel(device);
  const lb = letterboxCanvas(source, MODEL_INPUT_SIZE);
  const input = await RawImage.fromCanvas(lb.canvas);
  const processed = await processor(input);
  // ONNX giriş adı 'input' (BriaRMBG dışa aktarımı) — transformers.js'nin
  // pixel_values anahtarı session adıyla eşleşmez, doğrudan _call beslenir.
  const result = (await model._call({ input: processed.pixel_values })) as {
    output: { dims: number[]; data: Float32Array };
  };
  const [batch, ch, outH, outW] = result.output.dims as [number, number, number, number];
  if (batch !== 1 || ch !== 1) {
    throw new Error(`RMBG çıktısı beklenmeyen şekil: ${result.output.dims.join('x')}`);
  }
  const out = result.output.data;
  // Kadraj bandını at: kırpılmış rect maskesi (çıktı zaten 0..1 olasılık).
  const raw = new Float32Array(lb.w * lb.h);
  for (let j = 0; j < lb.h; j++) {
    const rowStart = (j + lb.y) * outW + lb.x;
    raw.set(out.subarray(rowStart, rowStart + lb.w), j * lb.w);
  }
  // TUR 10: sert kesim yerine dilate + feather — yüz/el kenarı delikleri
  // güven marjıyla kapanır; perde koruması (AND eşiği) değişmez.
  // GÜN E (bulgu 12): önce kopuk parçaları düşür (özneye bitişik OLMAYAN RMBG
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
