import { KEYFRAME_HEIGHT, KEYFRAME_WIDTH, type KeyframeFrame } from './videoPipe.ts';

/**
 * ARAMA (SEEK) TABANLI KEYFRAME YAKALAMA — render şeridi (Zeynep, Gün 6).
 *
 * `videoPipe.captureKeyframes` (Emre) OYNATMA sırasında `requestVideoFrameCallback`
 * ile kare toplar; canlı kaynak (kamera/stream) için doğru yol budur. DOSYADAN
 * yüklenen video için iki sorunu var:
 *
 *  1. **Görünürlüğe bağımlı.** rVFC ve rAF yalnızca sayfa KOMPOZİT edilirken
 *     çalışır. Sekme arka plandayken (`document.hidden`) video ilerlemez,
 *     `currentTime` sabit kalır ve yakalama sıfır kare döner. Ölçüldü
 *     (2026-08-14, 1920×1080 · 12.0 sn klip): gizli sayfada 12.4 sn boyunca
 *     rVFC 0, rAF 0, `currentTime` 0 → 0, video kendiliğinden duraklıyor.
 *  2. **Tabanı (baseline) dar.** 8 kare × 250 ms = klibin yalnızca 2 saniyesi.
 *     Poz çözümü PARALLAKS ister; 12 saniyelik el kamerası çekiminin 2
 *     saniyesi neredeyse hareketsizdir, essential matrix dejenereye yaklaşır.
 *
 * Bu fonksiyon `currentTime` ATAYIP `seeked` olayını bekler. `seeked`
 * kompozitörden bağımsız çalışır (gizli sekmede de gelir) ve keyframe'leri
 * klibin TAMAMINA eşit aralıkla yayar — yani hem test edilebilir hem de
 * geometrik olarak daha iyi bir taban üretir.
 *
 * Çıktı `KeyframeFrame[]` — `videoPipe.buildFusionScene` girdisiyle BİREBİR
 * aynı sözleşme; füzyon tarafında tek satır değişmez.
 */

export interface SeekCaptureOptions {
  /** Yakalanacak keyframe sayısı. */
  maxFrames?: number;
  /** Klibin başından atlanacak oran (0..1) — ilk karelerde otofokus/pompalama olur. */
  startFrac?: number;
  /** Klibin sonunda bırakılacak oran (0..1). */
  endFrac?: number;
  /** Tek bir seek için bekleme tavanı (ms). */
  seekTimeoutMs?: number;
}

/**
 * Videoyu `maxFrames` eşit zaman noktasında örnekler.
 *
 * Kare çizimi TEK canvas üzerinde yapılır (kare başına yalnız `getImageData`
 * + dönüşüm ayrılır). Bir seek zaman aşımına uğrarsa O KARE ATLANIR ve
 * yakalama devam eder — tek bozuk zaman noktası tüm çekimi düşürmez; kaç kare
 * gerçekten geldiği çağırana döner (sessizce eksik veri üretilmez).
 */
export async function captureKeyframesBySeek(
  video: HTMLVideoElement,
  opts: SeekCaptureOptions = {},
): Promise<KeyframeFrame[]> {
  const maxFrames = Math.max(2, opts.maxFrames ?? 8);
  const startFrac = opts.startFrac ?? 0.05;
  const endFrac = opts.endFrac ?? 0.95;
  const seekTimeoutMs = opts.seekTimeoutMs ?? 4000;

  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('video süresi okunamadı (canlı akış için captureKeyframes kullanın)');
  }
  // Oynatma yakalamayı bozar: seek sırasında kare ilerlemesin.
  video.pause();

  const w = KEYFRAME_WIDTH;
  const h = KEYFRAME_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const t0 = startFrac * duration;
  const t1 = endFrac * duration;
  const out: KeyframeFrame[] = [];

  for (let i = 0; i < maxFrames; i++) {
    const t = maxFrames > 1 ? t0 + ((t1 - t0) * i) / (maxFrames - 1) : t0;
    const ok = await seekTo(video, t, seekTimeoutMs);
    if (!ok) continue; // bu zaman noktası gelmedi — atla, çekimi düşürme
    ctx.drawImage(video, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const lum = new Float32Array(w * h);
    const rgb = new Float32Array(w * h * 3);
    for (let p = 0, k = 0, c = 0; p < px.length; p += 4, k++, c += 3) {
      const r = px[p] / 255;
      const g = px[p + 1] / 255;
      const b = px[p + 2] / 255;
      // videoPipe ile aynı luminance katsayıları (Rec.601).
      lum[k] = 0.299 * r + 0.587 * g + 0.114 * b;
      rgb[c] = r;
      rgb[c + 1] = g;
      rgb[c + 2] = b;
    }
    out.push({ timeMs: video.currentTime * 1000, lum, rgb });
  }
  return out;
}

/** `currentTime` atar ve `seeked`'i bekler. Zaman aşımında false döner. */
function seekTo(video: HTMLVideoElement, time: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      clearTimeout(timer);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    // Zaten tam o noktadaysak 'seeked' gelmez — kısa yol.
    if (Math.abs(video.currentTime - time) < 1e-3 && video.readyState >= 2) {
      finish(true);
      return;
    }
    video.currentTime = time;
  });
}
