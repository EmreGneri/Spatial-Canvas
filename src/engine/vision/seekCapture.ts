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
 * kompozitörden bağımsız çalışır (gizli sekmede de gelir) ve zaman noktaları
 * saf bir fonksiyonda (`keyframeTimes`) hesaplandığı için test edilebilir.
 *
 * ARALIK KURALI (E4.3, 2026-08-16 — ÖNCEKİ DAVRANIŞ DEĞİŞTİ):
 * keyframe'ler eskiden klibin TAMAMINA yayılıyordu. O kural klibin KISA
 * olduğunu varsayıyordu (bu başlıktaki 12 sn'lik ölçüm) ve uzun klipte
 * sessizce çöküyor: 260.04 sn'lik yürüyüş klibinde 8 kare → 33.4 sn aralık →
 * ardışık kareler FARKLI SAHNE. Gerçek ölçüm (aynı klip, 384×288,
 * computeOpticalFlow):
 *
 *   aralık(sn) | eşleşme | medyan parallaks(px)
 *        0.25  |    378  |  3.61
 *        0.50  |    211  |  6.12
 *        1.00  |     64  | 12.41
 *        2.00  |      1  |  6.84
 *        4.00  |      0  |  —
 *       33.40  |      0  |  —     <- eski davranış, uygulamada 0 eşleşme/7 poz hatası
 *
 * Doğru zihin modeli: TABAN, tek çiftin aralığından değil poz ZİNCİRİNİN
 * birikiminden gelir. Kareler ardışık ÖRTÜŞMELİ olmak zorunda. Bu yüzden
 * aralık artık klip süresinden BAĞIMSIZ: hedef `gapSec`, klibe sığmazsa
 * küçülür.
 *
 * BİLİNEN SINIR — sabit aralık bu klibi tam çözmüyor. Kamera hızı klip
 * İÇİNDE 10 kat değişiyor (aynı 0.5 sn aralık t=13.0'da 6.12 px, t=14.0'da
 * 68 px parallaks üretiyor; ikincisi LK izleme küresini aşıyor). Ölçüm:
 *
 *   t=13.0 penceresi          t=14.0 penceresi
 *   0.25 sn → 378 eşleşme     0.125 sn → 260 eşleşme (15.02 px)
 *   0.50 sn → 211 eşleşme     0.25  sn →  59 eşleşme (33.86 px)
 *   1.00 sn →  64 eşleşme     0.50  sn →   3 eşleşme
 *
 * Doğru çözüm PARALLAKS GÜDÜMLÜ seçim (hedef banda göre aralığı uyarlamak);
 * sabit `gapSec` onun ucuz yaklaşığı. Varsayılan 0.125 sn bu klipte 7/7 poz
 * veriyor ama YAVAŞ segmentlerde çift başına parallaksı 3 px ölçek kapısının
 * altına düşürebilir — o durumda scale.ts dürüstçe 'parallaks-yetersiz'
 * raporlar (sessiz yanlış sonuç değil).
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
  /**
   * Ardışık keyframe'ler arası HEDEF süre (sn). Klibe sığmazsa küçülür.
   * KALİBRASYON KOLU — sabitlenmemesinin sebebi başlıktaki hız değişkenliği:
   * yavaş (tripod pan) çekimde parallaks biriktirmek için büyütmek,
   * koşan/çeviren kamerada küçültmek gerekir.
   */
  gapSec?: number;
}

/**
 * Varsayılan hedef aralık (sn) — TAHMİN DEĞİL, uçtan uca ÖLÇÜLDÜ.
 * 260 sn NYC yürüyüş klibi, t=13.0'dan 8 keyframe, tam zincir
 * (flow → PointMatch → chainPoseTrack):
 *
 *   aralık | medyan eşleşme | poz başarısı
 *   0.125  |            489 | 7/7   <- seçilen
 *   0.25   |            240 | 6/7
 *   0.5    |             12 | 3/7
 */
export const DEFAULT_GAP_SEC = 0.125;

/**
 * Keyframe zaman noktaları — SAF fonksiyon (DOM yok, test edilebilir).
 *
 * `[startFrac·d, endFrac·d]` penceresinin BAŞINDAN itibaren `gapSec`
 * aralıkla `maxFrames` nokta üretir. Pencere dar kalırsa aralık pencereye
 * sıkışır (klip dışına seek etmektense örtüşme artar).
 */
export function keyframeTimes(duration: number, opts: SeekCaptureOptions = {}): number[] {
  const maxFrames = Math.max(2, opts.maxFrames ?? 8);
  const startFrac = opts.startFrac ?? 0.05;
  const endFrac = opts.endFrac ?? 0.95;
  const gapSec = opts.gapSec ?? DEFAULT_GAP_SEC;
  const t0 = startFrac * duration;
  const t1 = endFrac * duration;
  // Klip oranı ARTIK yayılımı belirlemiyor; yalnızca üst sınırı veriyor.
  const span = Math.min(t1 - t0, gapSec * (maxFrames - 1));
  const out: number[] = [];
  for (let i = 0; i < maxFrames; i++) out.push(t0 + (span * i) / (maxFrames - 1));
  return out;
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

  const times = keyframeTimes(duration, opts);
  const out: KeyframeFrame[] = [];

  for (const t of times) {
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
