/**
 * GÜN 7 KABLOSU (Emre — App bağlantısı) — video köprüsünün CANLI ucu.
 *
 * `fuseVideoFrames` köprüsünün (fusion.ts) tasarımı sentetik testte
 * doğrulandı; burası aynı köprünün gerçek `HTMLVideoElement` → splat sahne
 * tarafıdır: kareleri yakar, eşleştirir, poz kurar, füzyonu çağırır ve
 * GaussianBuffer'ı kamera görüşüne sığdırır (`Engine.setGaussians` kapısı).
 *
 * ── DÜRÜSTLÜK KAYDILAR ─────────────────────────────────────────────────
 * 1. Video yolunda yoğun derinlik MODEL çıktısı DEĞİLDİR: depth[k] =
 *    luminance haritası (App'in kamera/video tasarımı: "parlaklık =
 *    yükseklik", depth modeli yalnız tek fotoğrafta çalışır). Splat
 *    derinliği bu haritadan gelir — görsel kalitesi luminance'ın kalitesidir.
 * 2. Ölçek hizalaması luminance'a BAĞLI DEĞİLDİR: `fitScaleAlignment`
 *    üçgenlemeden gelen metrik derinliğe doğrulur (flow eşleşmeleri +
 *    RANSAC + chainPoseTrack). Yani şekil fiziği gerçektir; d_pred yalnız
 *    splat yerleşim marjıdır.
 * 3. `fitBufferToCamera`: sahne birimini kamera görüşüne sığdırır (ağırlık
 *    merkezi → orijin, köşegen → 2). Füzyonun D.1 çıktısını DEĞİŞTİRMEZ —
 *    KOPYASINI ölçekler (konum + splat yarıçapı birlikte; iç tutarlılık
 *    korunur). Sunum ölçeğidir, ölçüm ölçeği değildir.
 * 4. Math.random YOK; RANSAC mulberry32 (deterministik).
 *
 * BOYUT SÖZLEŞMESİ: 256×192 (video 640×480'nin 4:3 alt kümesi) — flow/poz/
 * füzyon/hedef tek boyutta; fovY = 60° dikey (D.3 varsayılan, Engine
 * PerspectiveCamera(60)).
 */

import type { GaussianBufferData } from '../../shaders/splatFixture.ts';
import { createGaussianBufferData } from '../../shaders/splatFixture.ts';
import type { CaptureDiagnostics, DepthProvider, PoseKaynak, PoseTrackRecord, FlowPoint, ScaleVerdict } from './types.ts';
import type { PointMatch } from './pose.ts';
import { chainPoseTrack } from './pose.ts';
import type { KeyframeMatch } from './fusion.ts';
import { fuseVideoFrames } from './fusion.ts';
import type { ScaleFit } from './scale.ts';
import { computeOpticalFlow } from './flow.ts';

export const KEYFRAME_WIDTH = 256;
export const KEYFRAME_HEIGHT = 192;
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
 * E1.2 — DepthProvider sözleşmesinin (types.ts) bugünkü SENKRON uygulaması:
 * d_pred = luminance ("parlaklık = yükseklik", kayıt 1). D5'te MiDaS bağlanınca
 * bu, asenkron provider sözleşmesini uygulayan bir sarmalayıcının içine girer.
 */
export function luminanceDepthProvider(frame: KeyframeFrame): Float32Array {
  return frame.lum;
}

/**
 * E1.3 — TEK-ÇALIŞMA KİLİDİ. Eşzamanlı ikinci koşu reddedilir (iki füzyon
 * yarışı çifte setGaussians/flicker üretir); koşu bitince — başarı ya da
 * hata — kilit serbest kalır (try/finally). D5'te asenkron MiDaS provider'ı
 * koşuyu uzatınca bu kilit gerçek koruma olur; bugün de kötüye kullanımı
 * yakalar.
 */
let pipelineCalisiyor = false;

export interface BuildSceneOptions {
  /** E1.2 sözleşmesi — verilirse luminance yerine bu provider'dan derinlik
   *  alınır (D5: MiDaS). Varsayılan: luminanceDepthProvider. */
  depthProvider?: DepthProvider;
}

/**
 * Yakalanan karelerden tek dünya sahnesini kurar: ardışık karelerde
 * `computeOpticalFlow` (Shi-Tomasi + piramidal LK, deterministik) → izlenebilir
 * izler `PointMatch` olur → `chainPoseTrack` (8-nokta + RANSAC + cheirality,
 * ilk keyframe orijini) → `fuseVideoFrames` (grid örneklemesi step=4 →
 * 64×48×KF aday splat; d_pred = luminance; ölçek üçgenlemeden).
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
        maxCorners: 300,
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
    const fails = poses.length - 1 - frameMatches.filter((m) => m.length >= 8).length;

    const depthProvider = opts.depthProvider ?? ((f: KeyframeFrame) => Promise.resolve(luminanceDepthProvider(f)));
    const depth = await Promise.all(frames.map(depthProvider));

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
    for (let i = 1; i < poses.length; i++) dagilim[poses[i].kaynak!] += 1;
    const ciftSayisi = Math.max(1, poses.length - 1);
    const eslesmeSayilari = frameMatches.map((m) => m.length).sort((a, b) => a - b);
    const medyanEslesme = eslesmeSayilari.length ? eslesmeSayilari[Math.floor(eslesmeSayilari.length / 2)] : 0;
    const paralaks: number[] = [];
    for (const m of frameMatches) {
      for (const p of m) paralaks.push(Math.hypot(p.x2 - p.x1, p.y2 - p.y1));
    }
    paralaks.sort((a, b) => a - b);
    const medyanParallaksPx = paralaks.length ? paralaks[Math.floor(paralaks.length / 2)] : 0;
    let bazToplam = 0;
    let bazN = 0;
    for (let i = 1; i < poses.length; i++) {
      if (poses[i].kaynak === 'essential') {
        bazToplam += Math.hypot(poses[i].t[0], poses[i].t[1], poses[i].t[2]);
        bazN++;
      }
    }
    const olcek: ScaleVerdict = res.scale
      ? { durum: 'gecerli', a: res.scale.scaleA, b: res.scale.scaleB, rmse: 0, guven: 1 }
      : { durum: 'gecersiz', sebep: 'ucgenleme-yetersiz' };

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