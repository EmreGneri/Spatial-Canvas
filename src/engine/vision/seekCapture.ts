import { KEYFRAME_HEIGHT, KEYFRAME_WIDTH, type KeyframeFrame } from './videoPipe.ts';
import { computeOpticalFlow } from './flow.ts';

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
/**
 * Çift başına HEDEF parallaks (px, 384×288 ızgarasında).
 *
 * Ölçüldü (2026-08-16, NYC klibi): 15.02 px → 260 eşleşme, 12.41 px →
 * 64 eşleşme, 33.86 px → 59 eşleşme. Üstü LK izleme küresini zorlar,
 * altı üçgenlemeyi gürültüye boğar.
 */
export const PARALLAX_TARGET_PX = 15;

/** Kabul bandı [alt, üst] — hedefin etrafında aramayı erken bitirir. */
export const PARALLAX_BAND_PX: readonly [number, number] = [8, 28];

/** Bir zaman çiftinin medyan parallaksını (px) ölçen işlev. */
export type ParallaxMeasure = (tA: number, tB: number) => Promise<number>;

export interface SelectOptions extends SeekCaptureOptions {
  /** Aramanın başlayacağı saniye (varsayılan: startFrac × süre). */
  startSec?: number;
  /** İlk aralık tahmini (sn) — ölçümle hızla düzeltilir. */
  initialGapSec?: number;
  /** Keyframe başına ölçüm tavanı (her ölçüm bir seek + flow). */
  maxProbesPerFrame?: number;
  /** Toplam tarama tavanı (sn) — hareketsiz klipte sonsuz aramayı keser. */
  maxSpanSec?: number;
}

/**
 * PARALLAKS GÜDÜMLÜ keyframe zamanı seçimi — politika SAF, ölçüm enjekte.
 *
 * NEDEN sabit aralık yetmiyor: iki kısıt ters yönde çekiyor. Ardışık çiftin
 * İZLENEBİLMESİ küçük aralık ister; zincirin 3B YAPI üretmesi uzun toplam
 * taban ister. Sabit aralık birini seçmek zorunda kalıyor — 0.125 sn poz
 * başarısını verdi (0 hata) ama 8 kare yalnızca 0.875 sn'ye (≈1.2 m) yayıldı
 * ve sahne tek düz panoya çöktü. Parallaksa göre seçmek ikisini birden
 * sağlar: yavaş kamerada aralık uzar (taban büyür), hızlıda kısalır
 * (izlenebilirlik korunur).
 *
 * ARAMA: her adımda tahmini aralıkla bir aday ölçülür; parallaks banda
 * düşerse kabul, düşmezse aralık ORANLA düzeltilir (p ≈ hız·dt varsayımı —
 * hız kısa aralıkta yaklaşık sabit). Kare başına en fazla
 * `maxProbesPerFrame` ölçüm yapılır; her ölçüm gerçek yolda bir seek +
 * optik akış demek, sınırsız arama pahalıdır. Tavana gelinirse SON aday
 * kabul edilir — kare düşürmek zinciri kısaltırdı.
 *
 * BİTİŞ: klip sonu ya da `maxSpanSec` aşılırsa eldeki zamanlar döner
 * (hareketsiz kamerada parallaks hiç birikmez; sonsuz arama yerine kısa
 * zincir + ölçek kapısının dürüst reddi).
 */
export async function selectKeyframeTimes(
  duration: number,
  measure: ParallaxMeasure,
  opts: SelectOptions = {},
): Promise<number[]> {
  const maxFrames = Math.max(2, opts.maxFrames ?? 8);
  const startSec = opts.startSec ?? (opts.startFrac ?? 0.05) * duration;
  const endSec = (opts.endFrac ?? 0.95) * duration;
  const maxProbes = Math.max(1, opts.maxProbesPerFrame ?? 3);
  const maxSpan = opts.maxSpanSec ?? 30;
  const [bandAlt, bandUst] = PARALLAX_BAND_PX;

  const times = [startSec];
  let gapGuess = opts.initialGapSec ?? opts.gapSec ?? DEFAULT_GAP_SEC;

  while (times.length < maxFrames) {
    const from = times[times.length - 1];
    const sinir = Math.min(endSec, startSec + maxSpan);
    if (from >= sinir) break;

    let kabul: number | null = null;
    // Bütçe biterse SON aday değil EN İYİ aday alınır. Keskin hız
    // değişiminde (gerçek klipte t≈20'de 10×) son deneme bandın çok üstünde
    // kalabiliyor; bandı AŞMAK aşağıda kalmaktan kötüdür (LK izleyemez, çift
    // tamamen düşer), bu yüzden tercih sırası: (1) banda sığan en büyük
    // parallaks, (2) hiçbiri sığmıyorsa en küçük taşma.
    let enIyi: { t: number; p: number } | null = null;
    const dahaIyi = (a: { t: number; p: number }, b: { t: number; p: number }) => {
      const aOk = a.p <= bandUst;
      const bOk = b.p <= bandUst;
      if (aOk !== bOk) return aOk ? a : b;
      return aOk ? (a.p >= b.p ? a : b) : a.p <= b.p ? a : b;
    };

    for (let probe = 0; probe < maxProbes; probe++) {
      const aday = Math.min(sinir, from + gapGuess);
      if (aday <= from) break;
      const p = await measure(from, aday);
      const kayit = { t: aday, p };
      enIyi = enIyi ? dahaIyi(enIyi, kayit) : kayit;
      if (p >= bandAlt && p <= bandUst) {
        kabul = aday;
        break;
      }
      // p ≈ hız·dt → hedefe götüren dt = dt·(hedef/p). p=0 (hareketsiz)
      // durumunda oran patlar; tavanla sınırla ki tarama ilerlesin.
      const oran = p > 0 ? PARALLAX_TARGET_PX / p : 4;
      gapGuess = Math.max(1e-3, gapGuess * Math.min(4, Math.max(0.25, oran)));
      // Aday zaten sınırdaysa daha ileri gidilemez — onu kabul et.
      if (aday >= sinir) {
        kabul = aday;
        break;
      }
    }

    const secilen = kabul ?? enIyi?.t ?? null;
    if (secilen === null || secilen <= from) break;
    times.push(secilen);
  }

  return times;
}

/**
 * Parallaks ÖLÇÜMÜ için kullanılan köşe bütçesi. Üretim akışından (800) çok
 * daha düşük: burada eşleşmelerin kimliği değil MEDYAN BÜYÜKLÜĞÜ gerekiyor
 * ve o istatistik birkaç yüz izle de kararlı. Ölçüm keyframe başına
 * 1-3 kez koşuyor; tam bütçe boşuna zaman yakardı.
 */
const PROBE_CORNERS = 150;

/**
 * Videoyu PARALLAKSA göre örnekler (E5.3 — önceki sabit-aralık yolu yerine).
 *
 * Kare çizimi TEK canvas üzerinde yapılır. Sonda seçilen zamanlar için
 * YENİDEN SEEK YAPILMAZ: her ölçüm sırasında çekilen kare önbelleğe alınır,
 * seçim bitince oradan toplanır (seek + decode iki kez ödenmez).
 *
 * Bir seek zaman aşımına uğrarsa o aday parallaks 0 sayılır — seçici aralığı
 * büyütüp ilerler; tek bozuk zaman noktası çekimi düşürmez.
 */
export async function captureKeyframesBySeek(
  video: HTMLVideoElement,
  opts: SelectOptions = {},
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

  const onbellek = new Map<number, KeyframeFrame>();
  const grab = async (t: number): Promise<KeyframeFrame | null> => {
    const hit = onbellek.get(t);
    if (hit) return hit;
    if (!(await seekTo(video, t, seekTimeoutMs))) return null;
    const frame = drawFrame(ctx, video, w, h);
    onbellek.set(t, frame);
    return frame;
  };

  const measure: ParallaxMeasure = async (tA, tB) => {
    const a = await grab(tA);
    const b = await grab(tB);
    if (!a || !b) return 0; // seek gelmedi — seçici aralığı büyütüp ilerlesin
    const pts = computeOpticalFlow(a.lum, b.lum, w, h, { maxCorners: PROBE_CORNERS });
    const mags: number[] = [];
    for (const p of pts) if (p.status === 1) mags.push(Math.hypot(p.u, p.v));
    if (mags.length === 0) return 0;
    mags.sort((x, y) => x - y);
    return mags[mags.length >> 1];
  };

  const times = await selectKeyframeTimes(duration, measure, opts);
  const out: KeyframeFrame[] = [];
  for (const t of times) {
    const f = await grab(t);
    if (f) out.push(f);
  }
  return out;
}

/** Videonun o anki karesini keyframe ızgarasına çizip sayısallaştırır. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number,
): KeyframeFrame {
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
  return { timeMs: video.currentTime * 1000, lum, rgb };
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
