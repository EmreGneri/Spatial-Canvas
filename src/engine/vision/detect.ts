// NESNE TESPİTİ — tracker HUD'un "bu kutu ne" cevabı (COCO sınıfları).
//
// Tracker tek başına kontrast noktası izler: kutunun NEREDE olduğunu bilir,
// NE olduğunu bilmez. Bu modül etiketi getirir (person, car, dog, bench...).
// Tempo bölüşümü: tespit SEYREK koşar (pahalı), aradaki karelerde kutuları
// zaten var olan optik akış taşır — klasik "detect + track" düzeni.
//
// Sidecar/uzak servis YOK: model `public/models` içinden yerel yüklenir
// (projenin CDN'siz kuralı). WebGPU yoksa tespit AÇILMAZ — ölçüldü, wasm
// yolu canlı tempoyu taşımıyor.
import { loadTransformers, webgpuKullanilabilir, onceRetry } from '../../depth.ts';

const MODEL = 'Xenova/yolos-tiny';

/**
 * İşlemcinin girdi kenarı. Modelin KENDİ varsayılanı (shortest_edge 512,
 * longest_edge 1333) canlı kullanım için israf: ölçüldü (WebGPU, gerçek
 * NYC sokak karesi, eşik 0.5) —
 *
 *   varsayılan (749×1333)  665 ms · 26 tespit
 *   512        (480×855)   148 ms · 39 tespit
 *   384        (360×641)    68 ms · 35 tespit   ← seçildi
 *   320        (300×534)    56 ms · 39 tespit
 *   256        (240×428)    39 ms · 29 tespit
 *
 * Küçültmek yalnız hızlandırmadı, tespit sayısını da DÜŞÜRMEDİ — yani
 * varsayılan boyutun getirdiği çözünürlük bu sahnede karşılığını vermiyor.
 * 384 seçildi: 10× hız, tespit sayısı varsayılanın üstünde.
 */
export const DETECT_INPUT_EDGE = 384;

/** Bu skorun altındaki tespit atılır. */
export const DETECT_THRESHOLD = 0.5;

export interface Detection {
  /** COCO sınıf adı — 'person', 'car', 'dog', 'bench'... */
  label: string;
  score: number;
  /** Kaynak piksel uzayında kutu. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DetectModel {
  proc: { (img: unknown): Promise<Record<string, unknown>>; size: unknown; post_process_object_detection: (
    out: unknown, threshold: number, sizes: number[][],
  ) => { boxes: number[][]; classes: number[]; scores: number[] }[] };
  model: { (inputs: Record<string, unknown>): Promise<unknown>; config: { id2label: Record<number, string> } };
  fromCanvas: (c: HTMLCanvasElement) => unknown;
}

/** `onceRetry`: eşzamanlı çağrılar tek yüklemede birleşir, hata cache'i
 *  düşürür (tek seferlik hata oturumu kalıcı bozmaz) — depth.ts deseni. */
const yukleDetectModel = onceRetry<DetectModel>(async () => {
  const tf = await loadTransformers();
  // transformers.js tipleri görev-özel yüzeyleri (post_process_object_detection,
  // config.id2label) taşımıyor; köprü tek yerde, `unknown` üzerinden kurulur.
  const proc = (await tf.AutoImageProcessor.from_pretrained(MODEL)) as unknown as DetectModel['proc'];
  proc.size = { shortest_edge: DETECT_INPUT_EDGE, longest_edge: Math.round(DETECT_INPUT_EDGE * 1.67) };
  const model = (await tf.AutoModelForObjectDetection.from_pretrained(MODEL, {
    device: 'webgpu',
    dtype: 'fp16',
  })) as unknown as DetectModel['model'];
  return { proc, model, fromCanvas: (c: HTMLCanvasElement) => tf.RawImage.fromCanvas(c) };
});

export async function detectKullanilabilir(): Promise<boolean> {
  return webgpuKullanilabilir();
}

/** Modeli önden ısıt — ilk çıkarım boru hattı derlemesini de ödediği için
 *  kullanıcının baktığı ana denk gelmesin (liveDepth'teki aynı gerekçe). */
export async function isitDetectModel(): Promise<void> {
  const { proc, model, fromCanvas } = await yukleDetectModel();
  if (typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, c.width, c.height);
  try {
    const inputs = await proc(fromCanvas(c));
    await model(inputs);
  } catch {
    /* ısıtma başarısızsa sessiz: gerçek kullanım kendi hatasını raporlar */
  }
}

/**
 * Bir kareyi tespit eder. Kutular KAYNAK piksel uzayındadır (verilen
 * canvas'ın kendi boyutu) — çağıran kendi gösterim uzayına ölçekler.
 */
export async function algila(
  source: HTMLCanvasElement,
  opts: { threshold?: number; maxCount?: number } = {},
): Promise<Detection[]> {
  const { proc, model, fromCanvas } = await yukleDetectModel();
  const inputs = await proc(fromCanvas(source));
  const out = await model(inputs);
  const r = proc.post_process_object_detection(
    out,
    opts.threshold ?? DETECT_THRESHOLD,
    [[source.height, source.width]],
  )[0];
  const list: Detection[] = [];
  for (let i = 0; i < r.classes.length; i++) {
    const [x0, y0, x1, y1] = r.boxes[i];
    list.push({
      label: model.config.id2label[r.classes[i]] ?? '?',
      score: r.scores[i],
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
    });
  }
  // Skoru yüksek olan önce: tavan uygulanırsa güçlü tespitler korunur.
  list.sort((a, b) => b.score - a.score);
  return opts.maxCount ? list.slice(0, opts.maxCount) : list;
}
