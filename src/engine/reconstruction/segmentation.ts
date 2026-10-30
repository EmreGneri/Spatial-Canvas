import { currentPhotoMeasurement, type PhotoMeasurement } from '../photoMeasurement.ts';
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
import { ilerlemeliGetir } from '../../indirmeIlerleme.ts';
import { dilateAndFeatherMask, keepMainComponents, resampleBilinear, VIDEO_FAR_MIN_FRAC } from './silhouette.ts';
import { localInference, localInferenceAvailable } from '../sidecarClient.ts';
import { gpuSirasinaGir, onceRetry } from '../../depth.ts';

// ORT runtime yerel — CDN yok (depth.ts ile aynı sözleşme). Aynı ORT örneği
// olduğu için değerler idempotent: depth.ts önce çalışsa bile aynı sonuç.
// `import.meta.env` Vite'a özgüdür (depth.ts:76 ile aynı gerekçe) — Node bu
// modülü import edebilsin diye opsiyonel zincirlemeyle okunur.
const VITE_DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
ort.env.wasm.wasmPaths = VITE_DEV ? '/node_modules/onnxruntime-web/dist/' : '/ort/';
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

/**
 * TARAYICI BiRefNet_lite (WebGPU, yalnız fotoğraf). Stok ONNX Chrome'da
 * çalışmıyordu (Split/Concat > 16 storage buffer; deform-conv GatherND CPU'ya
 * düşüp ~392 MB tamponla bad_alloc — onnxruntime#21968). Bu dosya aynı
 * ağırlıkların graf düzeltilmiş hali (`jiabins0303/birefnet-lite-1024-webgpu`,
 * MIT; DIS5K eğitim verisi uyarısı THIRD_PARTY_NOTICES'te). Girdi
 * `input_image` [1,3,1024,1024] (birefnetGirdisi ile aynı ön işleme), çıktı
 * `output_image` LOGIT → sigmoid. Ölçüm: docs/benchmarks/maske-olcumu.md.
 * Kapatmak için false: fotoğraf yolu eskisi gibi yardımcı → IS-Net olur.
 */
export const TARAYICI_BIREFNET = true;
const BIREFNET_PATH = '/models/jiabins0303/birefnet-lite-1024-webgpu/onnx/model_fp16.onnx';
/** Bu oranlar dışında maske "model pes etti" sayılır (ui/maskeKarari.ts üst ucu ile aynı). */
const BIREFNET_MIN_ORAN = 0.001;
const BIREFNET_MAX_ORAN = 0.92;

export type SegmentationResult = {
  /** 0..1 ön plan olasılığı (maske, kadraj bandı kırpılmış). */
  mask: Float32Array;
  width: number;
  height: number;
  /** Maskeyi gerçekte üreten model (yardımcı düşerse 'isnet'). */
  model: 'birefnet' | 'isnet';
};

let segSession: ort.InferenceSession | null = null;
/**
 * Kurulum GPU SIRASINDAN geçer (depth.ts:gpuSirasinaGir — canlı derinlik
 * döngüsüyle aynı kuyruk, bkz. dosya üstü ticari lisans notu + depth.ts:85-118
 * için: iki ORT WebGPU oturumu eşzamanlı kurulunca `getBindGroupLayout`
 * hatası). `onceRetry` ile sarılır: eşzamanlı çağrılar TEK kuruluma birleşir,
 * `loadDepthModel`in `yukleEstimator`iyle AYNI desen (device İLK çağrıda
 * bağlanır, `segSession` başarı sonrası kalıcı memoize eder).
 */
let yukleSession: (() => Promise<ort.InferenceSession>) | null = null;

export async function loadSegmentationModel(device: 'wasm' | 'webgpu' = 'webgpu') {
  if (segSession) return segSession;
  // WebGPU tercih edilir. Ağırlık fp16 olduğu için wasm yolunda desteklenmeyen
  // op'a düşülebilir; o durumda hata YUTULMAZ, çağırana bildirilir — sessiz
  // bozulma yasağı (bkz. vision/yetenek.ts).
  // MODEL YOL DEĞİL BAYT olarak verilir: `create(yol)` dosyayı kendi çeker ve
  // ilerleme bildirmez — 84 MB boyunca ekranda hiçbir şey değişmez.
  // `ilerlemeliGetir` aynı dosyayı akıtır, yüzdeyi bildirir ve tamponu verir.
  yukleSession ??= onceRetry(async () => {
    const bayt = await ilerlemeliGetir(MODEL_PATH, 'nesne ayırma modeli');
    return gpuSirasinaGir(() =>
      ort.InferenceSession.create(bayt, {
        executionProviders: device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
      }),
    );
  });
  segSession = await yukleSession();
  return segSession;
}

let birefnetSession: ort.InferenceSession | null = null;
let yukleBirefnet: (() => Promise<ort.InferenceSession>) | null = null;
/** İlk hatadan sonra oturum boyunca kapalı: 115 MB her fotoğrafta yeniden inmesin, OOM tekrarlanmasın. */
let birefnetKapali = false;
let birefnetDownload: Promise<ArrayBuffer> | null = null;
function downloadBirefnet() {
  return birefnetDownload ??= ilerlemeliGetir(BIREFNET_PATH, 'BiRefNet nesne ayırma modeli')
    .catch(error => { birefnetDownload = null; throw error; });
}

/** Download only the photo mask weights while depth loads; GPU setup stays serialized. */
export async function preloadPhotoMaskBytes(): Promise<void> {
  if (!TARAYICI_BIREFNET || birefnetKapali || birefnetSession || typeof navigator === 'undefined'
    || !('gpu' in navigator) || await localInferenceAvailable()) return;
  await downloadBirefnet();
}

/** BiRefNet logit → 0..1 olasılık; boş / tüm kare / NaN ise null (o kare IS-Net'e düşer). */
export function birefnetOlasilik(logit: Float32Array): Float32Array | null {
  const p = new Float32Array(logit.length);
  let fg = 0;
  for (let i = 0; i < logit.length; i++) {
    const v = 1 / (1 + Math.exp(-logit[i]));
    if (!(v >= 0)) return null; // NaN
    p[i] = v;
    if (v >= 0.5) fg++;
  }
  const oran = fg / p.length;
  return oran >= BIREFNET_MIN_ORAN && oran <= BIREFNET_MAX_ORAN ? p : null;
}

/**
 * Tarayıcı BiRefNet: [1,1,1024,1024] olasılık ya da null. ASLA fırlatmaz —
 * WebGPU yokluğu, kurulum/shader hatası, OOM, beklenmeyen şekil loglanır ve
 * oturum boyunca kapatır; çağıran IS-Net'e düşer. Kurulum ve çıkarım IS-Net
 * ile aynı GPU sırasından AYRI turlar olarak geçer (kuyruk yeniden girişli değil).
 */
export async function tarayiciBirefnet(girdi: { data: Float32Array; dims: number[] }, trace: PhotoMeasurement | null = currentPhotoMeasurement()): Promise<Float32Array | null> {
  if (!TARAYICI_BIREFNET || birefnetKapali) return null;
  try {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) throw new Error('WebGPU yok');
    // Yalnız WebGPU: wasm'a düşmek dakikalar sürer ve 32-bit yığında bad_alloc verir.
    yukleBirefnet ??= onceRetry(async () => {
      const pending = downloadBirefnet();
      const bayt = await pending;
      try { return await gpuSirasinaGir(() => ort.InferenceSession.create(bayt, { executionProviders: ['webgpu'] })); }
      finally { if (birefnetDownload === pending) birefnetDownload = null; }
    });
    birefnetSession ??= await yukleBirefnet();
    const session = birefnetSession;
    const run = () => session.run({ input_image: new ort.Tensor('float32', girdi.data, girdi.dims) });
    const r = await gpuSirasinaGir(() => trace ? trace.measure('mask.birefnet.run', run) : run());
    const out = r.output_image;
    if (out.dims.join('x') !== `1x1x${MODEL_INPUT_SIZE}x${MODEL_INPUT_SIZE}`) {
      throw new Error(`BiRefNet çıktısı beklenmeyen şekil: ${out.dims.join('x')}`);
    }
    const p = birefnetOlasilik(out.data as Float32Array);
    if (!p) console.warn('[seg] tarayıcı BiRefNet maskesi makul değil (boş/tüm kare); bu kare IS-Net ile');
    return p;
  } catch (e) {
    birefnetKapali = true;
    console.warn(`[seg] tarayıcı BiRefNet kullanılamıyor, IS-Net'e düşüldü: ${e instanceof Error ? e.message : String(e)}`);
    void birefnetSession?.release().catch(() => {});
    birefnetSession = null;
    return null;
  }
}

/**
 * Kaynak görüntüden nesne/arka plan maskesi üretir. Letterbox + kırpım depth
 * yoluyla aynı geometridedir (modelin gördüğü kare alanın iç kısmı), böylece
 * maske depth haritasıyla hizalanır. Çıktı maskesi kırpılmış rect boyutundadır.
 *
 * `kaynak: 'foto'` ve yerel yardımcı (sidecar/server.py) açıksa maske orada
 * BiRefNet_lite ile üretilir (zor kadrajlarda belirgin daha iyi). Yardımcı yoksa
 * ya da hata verirse aynı model tarayıcıda WebGPU ile denenir (`tarayiciBirefnet`,
 * graf düzeltilmiş export); o da olmazsa AYNI kare IS-Net ile işlenir. Video
 * kareleri her zaman IS-Net (BiRefNet kare başına çok yavaş).
 */
export async function segmentForeground(
  source: HTMLCanvasElement | HTMLImageElement,
  device: 'wasm' | 'webgpu' = 'webgpu',
  kaynak: 'foto' | 'video' = 'video',
): Promise<SegmentationResult> {
  const trace = kaynak === 'foto' ? currentPhotoMeasurement() : null;
  const lb = letterboxCanvas(source, MODEL_INPUT_SIZE);
  let raw: Float32Array | null = null;
  let model: SegmentationResult['model'] = 'isnet';
  if (kaynak === 'foto') {
    // Sıra: yardımcı BiRefNet → tarayıcı BiRefNet (WebGPU) → IS-Net.
    const girdi = birefnetGirdisi(source);
    let olasilik: Float32Array | null = null;
    if (await localInferenceAvailable()) {
      let yardimci = true;
      const run = () => localInference!.infer('mask', girdi, async () => {
        yardimci = false;
        return { data: new Float32Array(0), dims: [] };
      });
      const out = await (trace ? trace.measure('mask.sidecar.infer', run) : run());
      if (yardimci) olasilik = out.data;
    }
    olasilik ??= await tarayiciBirefnet(girdi, trace);
    if (olasilik) {
      model = 'birefnet';
      // BiRefNet girdisi kareye ESNETİLMİŞ görüntü (ölçüm bu yolla yapıldı);
      // çıktı letterbox iç dikdörtgeniyle aynı boyuta geri esnetilir → sözleşme aynı.
      raw = resampleBilinear(olasilik, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, lb.w, lb.h);
    }
  }
  raw ??= kirp((await isnetCikti(lb, device, trace)).data, lb);
  // TUR 10: sert kesim yerine dilate + feather — yüz/el kenarı delikleri
  // güven marjıyla kapanır; perde koruması (AND eşiği) değişmez.
  // GÜN E (bulgu 12): önce kopuk parçaları düşür (özneye bitişik OLMAYAN model
  // hataları — kapı kasası, zemin), sonra dilate + tüy.
  const main = keepMainComponents(raw, lb.w, lb.h, undefined, undefined, kaynak === 'video' ? VIDEO_FAR_MIN_FRAC : undefined);
  // Video masks refresh during playback: let a frame render between the two passes.
  if (kaynak === 'video') await new Promise<void>(resolve => setTimeout(resolve, 0));
  const mask = dilateAndFeatherMask(main, lb.w, lb.h);
  return { mask, width: lb.w, height: lb.h, model };
}

/** Kadraj bandını at: 1024² çıktının letterbox iç dikdörtgeni (0..1 olasılık). */
function kirp(out: Float32Array, lb: { x: number; y: number; w: number; h: number }): Float32Array {
  const raw = new Float32Array(lb.w * lb.h);
  for (let j = 0; j < lb.h; j++) {
    const rowStart = (j + lb.y) * MODEL_INPUT_SIZE + lb.x;
    raw.set(out.subarray(rowStart, rowStart + lb.w), j * lb.w);
  }
  return raw;
}

/** Tarayıcı IS-Net: letterbox karesi → [1,1,1024,1024] olasılık. */
async function isnetCikti(
  lb: { canvas: HTMLCanvasElement },
  device: 'wasm' | 'webgpu',
  trace: PhotoMeasurement | null,
): Promise<{ data: Float32Array; dims: number[] }> {
  const session = await loadSegmentationModel(device);
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
  // Çıkarım da SIRAYA GİRER — kurulumla aynı kuyruk, aynı gerekçe. Yükleme
  // ayrı bir kuyruk turu olarak YUKARIDA bitti (`await loadSegmentationModel`);
  // burası kuyruğa AYRI ve ARDIŞIK girer, iç içe DEĞİL (kuyruk yeniden girişli
  // değil — depth.ts:112).
  const run = () => session.run({
    input: new ort.Tensor('float32', tensor, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]),
  });
  const result = await gpuSirasinaGir(() => trace ? trace.measure('mask.isnet.run', run) : run());
  const tOut = result.output;
  const [batch, ch, outH, outW] = tOut.dims as [number, number, number, number];
  if (batch !== 1 || ch !== 1 || outW !== MODEL_INPUT_SIZE || outH !== MODEL_INPUT_SIZE) {
    throw new Error(`segmentasyon çıktısı beklenmeyen şekil: ${tOut.dims.join('x')}`);
  }
  return { data: tOut.data as Float32Array, dims: [1, 1, outH, outW] };
}

/** BiRefNet girdisi: kareye esnetilmiş görüntü, 1/255 + ImageNet mean/std (kendi preprocessor_config'i). */
function birefnetGirdisi(source: HTMLCanvasElement | HTMLImageElement): { data: Float32Array; dims: number[] } {
  const c = document.createElement('canvas');
  c.width = MODEL_INPUT_SIZE;
  c.height = MODEL_INPUT_SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(toCanvas(source), 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const px = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data;
  const n = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) data[k * n + i] = (px[i * 4 + k] / 255 - mean[k]) / std[k];
  }
  return { data, dims: [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE] };
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
