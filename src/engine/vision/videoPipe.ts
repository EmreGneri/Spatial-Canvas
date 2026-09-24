/**
 * GÜN 7 KABLOSU (Emre — App bağlantısı) — video köprüsünün CANLI ucu.
 *
 * `fuseVideoFrames` köprüsünün (fusion.ts) tasarımı sentetik testte
 * doğrulandı; burası aynı köprünün gerçek `HTMLVideoElement` → splat sahne
 * tarafıdır: kareleri yakar, eşleştirir, poz kurar, füzyonu çağırır ve
 * GaussianBuffer'ı kamera görüşüne sığdırır (`Engine.setGaussians` kapısı).
 *
 * ── DÜRÜSTLÜK KAYDILAR ─────────────────────────────────────────────────
 * 1. Tarayıcıda varsayılan yoğun derinlik, Depth Anything V2 modelinden
 *    gelir. Model kullanılamazsa luminance vekiline düşülür ve
 *    `diagnostics.derinlikKaynagi` bunu bildirir. Node/sentetik testlerde
 *    canvas olmadığından luminance yolu kullanılır.
 * 2. Ölçek hizalaması derinlik kaynağından BAĞIMSIZDIR: `fitScaleAlignment`
 *    üçgenlemeden gelen derinliğe doğrulur (flow eşleşmeleri + RANSAC +
 *    chainPoseTrack). Geçerli hizalama yoksa metrik ölçek iddiası yoktur;
 *    d_pred splat yerleşimi için yaklaşık derinlik sağlar.
 * 3. `fitBufferToCamera`: sahne birimini kamera görüşüne sığdırır (ağırlık
 *    merkezi → orijin, köşegen → 2). Füzyonun D.1 çıktısını DEĞİŞTİRMEZ —
 *    KOPYASINI ölçekler (konum + splat yarıçapı birlikte; iç tutarlılık
 *    korunur). Sunum ölçeğidir, ölçüm ölçeği değildir.
 * 4. Math.random YOK; RANSAC mulberry32 (deterministik).
 *
 * BOYUT SÖZLEŞMESİ: 384×288 (video 640×480'nin 4:3 alt kümesi; E2.1:
 * 256×192 → 384×288 — büyük kare = daha çok köşe adayı = daha çok eşleşme;
 * flow/poz/füzyon/hedef tek boyutta) — fovY = 60° dikey (D.3 varsayılan,
 * Engine PerspectiveCamera(60)).
 */

import type { GaussianBufferData } from '../../shaders/splatFixture.ts';
import { createGaussianBufferData } from '../../shaders/splatFixture.ts';
import type { CaptureDiagnostics, DepthProvider, PoseKaynak, PoseTrackRecord, FlowPoint, ScaleVerdict } from './types.ts';
import type { PointMatch } from './pose.ts';
import { chainPoseTrack } from './pose.ts';
import type { KeyframeMatch } from './fusion.ts';
import { fuseVideoFrames } from './fusion.ts';
import type { ScaleFit } from './scale.ts';
import { scaleVerdict } from './scale.ts';
import { createMidasDepthProvider } from './depthProvider.ts';
import { alignDepthChain } from './temporal.ts';
import { computeOpticalFlow } from './flow.ts';

export const KEYFRAME_WIDTH = 384;
export const KEYFRAME_HEIGHT = 288;
/** Dikey görüş açısı (radyan) — D.3 varsayılanı 60°. */
export const VIDEO_FOV_Y = Math.PI / 3;

export interface KeyframeFrame {
  /** Video zamanı — milisaniye (poz kaydı frameTimesMs). */
  timeMs: number;
  /** Luminance (0..1, satır 0 = üst) — yoğun d_pred yerine geçer (kayıt 1). */
  lum: Float32Array;
  /** RGB (0..1, w·h·3) — splat renkleri. */
  rgb: Float32Array;
}

export interface CaptureOptions {
  /** Kareler arası minimum süre (ms). */
  intervalMs?: number;
  /** Yakalanacak keyframe sayısı. */
  maxFrames?: number;
  /** Bekleme tavanı (ms) — başarı olmasa da sonuç. */
  timeoutMs?: number;
}

/**
 * Video elementinden zaman kapılı keyframe kareleri toplar. rVFC kullanır
 * (kare kimliği var); yoksa 66ms interval fallback. Kare çizimi TEK canvas
 * üzerinde yapılır (frame başına allocation yalnız getImageData + dönüşüm).
 * Video durağansa kare gelmez → timeout ile elinde olanla döner (dürüst:
 * donuk videodan poz üretilmez, çağıran az kareyle devam eder).
 */
export function captureKeyframes(
  video: HTMLVideoElement,
  opts: CaptureOptions = {},
): Promise<KeyframeFrame[]> {
  const intervalMs = opts.intervalMs ?? 250;
  const maxFrames = opts.maxFrames ?? 8;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const w = KEYFRAME_WIDTH;
  const h = KEYFRAME_HEIGHT;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return Promise.reject(new Error('captureKeyframes: 2d context yok'));

  const frames: KeyframeFrame[] = [];
  let lastCapture = -Infinity;
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    if (typeof video.cancelVideoFrameCallback === 'function' && rafId !== null) {
      video.cancelVideoFrameCallback(rafId);
    } else if (timerId !== null) {
      clearInterval(timerId);
    }
    resolve(frames);
  };

  let rafId: number | null = null;
  let timerId: number | null = null;
  let resolve!: (f: KeyframeFrame[]) => void;

  const grabFrame = () => {
    if (settled) return;
    if (video.readyState < 2) return;
    const now = performance.now();
    if (now - lastCapture < intervalMs) return;
    ctx.drawImage(video, 0, 0, w, h);
    const raw = ctx.getImageData(0, 0, w, h).data;
    const lum = new Float32Array(w * h);
    const rgb = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const r = raw[i * 4] / 255;
      const g = raw[i * 4 + 1] / 255;
      const b = raw[i * 4 + 2] / 255;
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      rgb[i * 3] = r;
      rgb[i * 3 + 1] = g;
      rgb[i * 3 + 2] = b;
    }
    const t = video.currentTime * 1000;
    frames.push({ timeMs: t, lum, rgb });
    lastCapture = now;
    if (frames.length >= maxFrames) finish();
  };

  const watchdog = window.setTimeout(finish, timeoutMs);
  const promise = new Promise<KeyframeFrame[]>((res) => {
    resolve = res;
    if ('requestVideoFrameCallback' in video && typeof video.requestVideoFrameCallback === 'function') {
      const tick = () => {
        if (settled) return;
        rafId = video.requestVideoFrameCallback(tick);
        grabFrame();
      };
      rafId = video.requestVideoFrameCallback(tick);
    } else {
      timerId = window.setInterval(grabFrame, 66);
    }
  });
  return promise;
}

export interface FusionSceneResult {
  /** Kamera görüşüne sığdırılmış buffer (setGaussians'a hazır). */
  data: GaussianBufferData;
  /** Ölçek hizalaması (null = üçgenleme yetersiz — d_pred ölçeğinde üretildi). */
  scale: ScaleFit | null;
  /** Poz zinciri (ilk keyframe orijinli — D.2). */
  poses: PoseTrackRecord[];
  stats: {
    keyframes: number;
    flowMatches: number;
    poseFails: number;
  };
  /** E1.2 — yakalama teşhisi (D6 gate/değerlendirme paneli okur). */
  diagnostics: CaptureDiagnostics;
}

/**
 * DepthProvider sözleşmesinin senkron yedek uygulaması:
 * d_pred = luminance ("parlaklık = yükseklik"). Tarayıcıdaki varsayılan
 * model yolu başarısız olursa veya Node'da canvas yoksa bu yol seçilir.
 */
export function luminanceDepthProvider(frame: KeyframeFrame): Float32Array {
  return frame.lum;
}

/** Tarihsel adı MiDaS olan Depth Anything sağlayıcısını kurmayı dener. */
function tryCreateMidasProvider(width: number, height: number): DepthProvider | null {
  try {
    return createMidasDepthProvider(width, height);
  } catch {
    return null;
  }
}

/**
 * E1.3 — TEK-ÇALIŞMA KİLİDİ. Eşzamanlı ikinci koşu reddedilir (iki füzyon
 * yarışı çifte setGaussians/flicker üretir); koşu bitince — başarı ya da
 * hata — kilit serbest kalır (try/finally). Asenkron model derinliği
 * boyunca da ikinci koşuyu engeller.
 */
let pipelineCalisiyor = false;

export interface BuildSceneOptions {
  /** Verilirse varsayılan model/fallback yerine bu provider'dan derinlik
   * alınır. Varsayılan: Depth Anything, başarısızsa luminance. */
  depthProvider?: DepthProvider;
}

/**
 * Yakalanan karelerden tek dünya sahnesini kurar: ardışık karelerde
 * `computeOpticalFlow` (Shi-Tomasi + piramidal LK, deterministik) → izlenebilir
 * izler `PointMatch` olur → `chainPoseTrack` (8-nokta + RANSAC + cheirality,
 * ilk keyframe orijini) → `fuseVideoFrames` (grid örneklemesi step=4;
 * d_pred modelden, fallback'te luminance'tan; ölçek üçgenlemeden).
 */
export async function buildFusionScene(
  frames: KeyframeFrame[],
  fovY: number = VIDEO_FOV_Y,
  opts: BuildSceneOptions = {},
): Promise<FusionSceneResult> {
  if (pipelineCalisiyor) {
    throw new Error('buildFusionScene: zaten calisiyor (tek-run kilidi)');
  }
  pipelineCalisiyor = true;
  try {
    const w = KEYFRAME_WIDTH;
    const h = KEYFRAME_HEIGHT;
    const K = { width: w, height: h, fovY };

    const frameMatches: PointMatch[][] = [];
    const kmatches: KeyframeMatch[] = [];
    let matched = 0;
    for (let i = 0; i + 1 < frames.length; i++) {
      const iz: FlowPoint[] = computeOpticalFlow(frames[i].lum, frames[i + 1].lum, w, h, {
        // E2.1: 300 → 800 köşe (gerçek yakalamada 3 eşleşme → 11 poz hatası).
        maxCorners: 800,
      });
      const pts: PointMatch[] = [];
      for (const p of iz) {
        if (p.status !== 1) continue;
        pts.push({ x1: p.x, y1: p.y, x2: p.x + p.u, y2: p.y + p.v });
      }
      frameMatches.push(pts);
      kmatches.push({ a: i, b: i + 1, matches: pts });
      matched += pts.length;
    }

    const times = frames.map((f) => f.timeMs);
    const poses = chainPoseTrack(frameMatches, K, times);

    // ── E5.1: DERİNLİK — luminance yerine Depth Anything + zamansal hizalama ──
    // Sağlayıcı SIRAYLA çağrılır (paralel değil): model tek cihaz kilidi
    // tutuyor (depth.ts), eşzamanlı çağrılar kilitte kuyruğa girip hiçbir
    // hız kazandırmadan bellek tepesi yaratırdı.
    //
    // GERİ DÜŞÜŞ YALNIZ VARSAYILANDA: çağıran AÇIKÇA bir provider verdiyse
    // onun hatası YUTULMAZ (çağıran o kaynağı seçti; sessizce başka veriyle
    // sahne kurmak yanlış sonucu doğruymuş gibi gösterirdi). Model indirmesi
    // gibi varsayılan yolun hatası ise yakalamayı düşürmez — parlaklığa
    // dönülür ve `derinlikKaynagi` bunu görünür kılar.
    let derinlikKaynagi: 'midas' | 'luminance' = 'luminance';
    const rawDepth: Float32Array[] = [];
    if (opts.depthProvider) {
      for (const f of frames) rawDepth.push(await opts.depthProvider(f));
    } else {
      const midas = typeof document !== 'undefined' ? tryCreateMidasProvider(w, h) : null;
      if (midas) {
        try {
          for (const f of frames) rawDepth.push(await midas(f));
          derinlikKaynagi = 'midas';
        } catch {
          rawDepth.length = 0;
        }
      }
      if (rawDepth.length !== frames.length) {
        rawDepth.length = 0;
        for (const f of frames) rawDepth.push(luminanceDepthProvider(f));
      }
    }

    // Her kare KENDİ içinde normalize geldiği için ham zincir katman kaydırır;
    // ortak izlerden affine hizalama keyframe-0 uzayına taşır (temporal.ts).
    const { depths: depth } = alignDepthChain(rawDepth, frameMatches, w, h);

    const res = fuseVideoFrames({
      poses,
      depth,
      rgb: frames.map((f) => f.rgb),
      matches: kmatches,
      width: w,
      height: h,
      fovY,
      sampleStep: 4,
    });

    // E1.2 — CaptureDiagnostics (naif doldurma; D6'da gate'lere bağlanır).
    const dagilim: Record<PoseKaynak, number> = { essential: 0, 'donme-fallback': 0, basarisiz: 0 };
    for (let i = 1; i < poses.length; i++) {
      // `!` yerine savunmalı okuma: `kaynak` bugün pose.ts'in TÜM dönüş
      // yollarında yazılıyor, ama eksik gelirse `dagilim[undefined]` NaN
      // üretir ve pozBasariOrani sessizce NaN'a düşerdi.
      const k = poses[i].kaynak;
      if (k && k in dagilim) dagilim[k] += 1;
      else dagilim.basarisiz += 1;
    }
    // POZ HATASI — GERÇEK sayaç. Eskiden `m.length >= 8` vekiliyle
    // hesaplanıyordu: 20 eşleşmesi olup RANSAC'ı tutmayan bir çift
    // "başarılı" sayılıyordu, yani hata SAYICI EKSİK RAPORLUYORDU.
    // `kaynak` alanı (E1.2) artık gerçek cevabı taşıyor.
    const fails = dagilim['donme-fallback'] + dagilim.basarisiz;
    const ciftSayisi = Math.max(1, poses.length - 1);
    const eslesmeSayilari = frameMatches.map((m) => m.length).sort((a, b) => a - b);
    const medyanEslesme = eslesmeSayilari.length ? eslesmeSayilari[Math.floor(eslesmeSayilari.length / 2)] : 0;
    const paralaks: number[] = [];
    for (const m of frameMatches) {
      for (const p of m) paralaks.push(Math.hypot(p.x2 - p.x1, p.y2 - p.y1));
    }
    paralaks.sort((a, b) => a - b);
    const medyanParallaksPx = paralaks.length ? paralaks[Math.floor(paralaks.length / 2)] : 0;
    // TABAN (baseline) — ARDIŞIK keyframe'ler ARASINDAKİ mesafe.
    // Eskiden `|t|` (ORİJİNE uzaklık) ortalanıyordu: monoküler zincirde her
    // adım birim uzunlukta olduğu için |t| indeksle BÜYÜR (1, 2, 3, …) ve
    // ortalaması ≈ n/2 çıkar — "taban uzunluğu" olarak ANLAMSIZ bir sayı.
    // D4'ün "min baz" kapısı bu sayıya bakacaktı; düzeltilmeseydi kapı
    // çöp üzerine kurulurdu.
    let bazToplam = 0;
    let bazN = 0;
    for (let i = 1; i < poses.length; i++) {
      if (poses[i].kaynak !== 'essential') continue;
      const a = poses[i - 1].t;
      const b = poses[i].t;
      bazToplam += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      bazN++;
    }
    // ÖLÇEK KARARI (E4.1) — kapılar scale.ts'te yaşar (`scaleVerdict`):
    // fit yok + hareket yok → 'ucgenleme-yetersiz' (E1.2 sözleşmesi korunur),
    // taban yok → 'baz-yok', parallaks eşik altı → 'parallaks-yetersiz'.
    // Önceden rmse/guven SABİT (0/1) yazılıyordu (Zeynep'in f5881e8
    // düzeltmesi); güven hesabı da scaleVerdict'e taşındı (Zeynep'in formülü:
    // guven = 1 − rmse/(0.25·|a|), negatif eğim → 0).
    const olcek: ScaleVerdict = scaleVerdict(res.scale, {
      bazUzunlugu: bazN > 0 ? bazToplam / bazN : 0,
      medyanParallaksPx,
    });

    return {
      data: fitBufferToCamera(res.data),
      scale: res.scale,
      poses,
      stats: { keyframes: frames.length, flowMatches: matched, poseFails: fails },
      diagnostics: {
        keyframeSayisi: frames.length,
        medyanEslesme,
        pozBasariOrani: ciftSayisi > 0 ? dagilim.essential / ciftSayisi : 0,
        pozKaynakDagilimi: dagilim,
        medyanParallaksPx,
        bazUzunlugu: bazN > 0 ? bazToplam / bazN : 0,
        olcek,
        teshis: 'iyi',
        derinlikKaynagi,
      },
    };
  } finally {
    pipelineCalisiyor = false;
  }
}

/**
 * Sahneyi kamera görüşüne sığdırır: ağırlık merkezi → dünya orijini,
 * maks köşegen → 2 birim (k = 1/maksYarıçap). Konumlar ve splat
 * yarıçapları (b.w) AYNI çarpanla ölçeklenir — iç tutarlılık korunur.
 * Kayıt 3'e bak.
 */
export function fitBufferToCamera(src: GaussianBufferData): GaussianBufferData {
  const n = src.count;
  const out = createGaussianBufferData(n);
  if (n === 0) return out;
  out.a.set(src.a.subarray(0, n * 4));
  out.b.set(src.b.subarray(0, n * 4));
  out.c.set(src.c.subarray(0, n * 4));
  out.keyframeIndex.set(src.keyframeIndex.subarray(0, n));

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += out.a[i * 4];
    cy += out.a[i * 4 + 1];
    cz += out.a[i * 4 + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;

  let maxSq = 0;
  for (let i = 0; i < n; i++) {
    const dx = out.a[i * 4] - cx;
    const dy = out.a[i * 4 + 1] - cy;
    const dz = out.a[i * 4 + 2] - cz;
    const sq = dx * dx + dy * dy + dz * dz;
    if (sq > maxSq) maxSq = sq;
  }
  const k = maxSq > 0 ? 1 / Math.sqrt(maxSq) : 1;

  for (let i = 0; i < n; i++) {
    out.a[i * 4] = (out.a[i * 4] - cx) * k;
    out.a[i * 4 + 1] = (out.a[i * 4 + 1] - cy) * k;
    out.a[i * 4 + 2] = (out.a[i * 4 + 2] - cz) * k;
    out.b[i * 4 + 3] *= k;
  }
  return out;
}
