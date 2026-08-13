/**
 * EXPORT MODÜLÜ (Gün 6 — Emre).
 *
 * PNG export: canvas.toBlob — mevcut frame'i indirir.
 * WebM export: MediaRecorder + canvas.captureStream — belirli süre kaydeder.
 *
 * DİKKAT (düzeltildi): renderer `preserveDrawingBuffer` olmadan kurulu, yani
 * WebGL çizim tamponu tarayıcı kareyi kompozit ettikten SONRA geçersizdir.
 * "Senkron çağırıyoruz" yetmez — senkronluk tıklamaya göredir, çizime göre
 * değil; tıklama son kareden sonra gelir ve `toBlob` boş/şeffaf PNG verirdi.
 * Çözüm: `onBeforeCapture` ile yakalamadan hemen önce, aynı görevde bir kare
 * çizdirilir (App bunu `engine.renderFrame()` ile bağlar).
 *
 * WebM bu sorundan etkilenmez: `captureStream` kareleri kompozisyon anında
 * alır, tampon geçerliyken.
 */

/**
 * Canvas'ın o anki içeriğini PNG olarak indirir.
 * GÜN 6 (opt): scale > 1 → canvas yeniden çizilir (yüksek çözünürlük çıktı).
 */
export interface PNGExportOptions {
  /** 0 = orijinal boyut; 1..4 = ölçek (ör. 2 = 2x daha büyük kare). Varsayılan 0. */
  scale?: number;
  /**
   * Yakalamadan hemen ÖNCE, aynı görevde çağrılır — bir kare çizdirmek için.
   * Verilmezse `preserveDrawingBuffer` olmayan bir renderer'da çıktı boş olur.
   */
  onBeforeCapture?: () => void;
}

export async function exportPNG(
  canvas: HTMLCanvasElement,
  filename = 'spatial-canvas',
  opts: PNGExportOptions = {},
): Promise<void> {
  const scale = opts.scale ?? 0;
  // Tamponu tazele. Ölçekli yolda da ŞART: drawImage de aynı geçersiz
  // tampondan okur, yoksa büyütülmüş kopya da boş çıkar.
  opts.onBeforeCapture?.();
  if (scale > 1) {
    // Upscale: mevcut frame'i daha büyük canvas'a ölçekle. WebGL buffer'ı
    // önce okumak istemeyiz (sync) — canvas'ı yeniden çizeriz, video/point
    // cloud statik değilse pikselleşme böylece azalır.
    const big = document.createElement('canvas');
    big.width = Math.round(canvas.width * scale);
    big.height = Math.round(canvas.height * scale);
    const ctx = big.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, big.width, big.height);
    canvas = big as HTMLCanvasElement;
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('toBlob başarısız'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.png`;
      a.click();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
}

export interface WebMExportOptions {
  /** Kayıt süresi (saniye). Varsayılan 5. */
  durationSec?: number;
  /** Bit hızı (bps). Varsayılan 8_000_000 (8 Mbps). */
  videoBitsPerSecond?: number;
}

/**
 * Canvas akışını WebM olarak kaydeder ve indirir.
 * MediaRecorder desteklenmiyorsa hata fırlatır.
 */
export function exportWebM(
  canvas: HTMLCanvasElement,
  opts: WebMExportOptions = {},
): Promise<void> {
  const durationSec = opts.durationSec ?? 5;
  const videoBitsPerSecond = opts.videoBitsPerSecond ?? 8_000_000;

  if (typeof MediaRecorder === 'undefined') {
    return Promise.reject(new Error('MediaRecorder desteklenmiyor'));
  }
  if (!canvas.captureStream) {
    return Promise.reject(new Error('canvas.captureStream desteklenmiyor'));
  }

  const stream = canvas.captureStream(60);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve, reject) => {
    recorder.onerror = (e) => reject(new Error(`MediaRecorder: ${e.error?.message ?? 'bilinmeyen'}`));
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spatial-canvas-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      resolve();
    };
    recorder.start();
    setTimeout(() => recorder.stop(), durationSec * 1000);
  });
}
