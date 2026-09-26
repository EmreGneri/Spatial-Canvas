// GERÇEK 3DGS EĞİTİMİ — splat.js (MIT, src/vendor/splat.js) sarmalayıcısı.
//
// Videodan: keskin kare seç → SfM (kamera pozları) → Gaussian tohumla →
// WebGPU'da eğit. Sonuç splat.js'in KENDİ rasterizer'ıyla çizilir: bizim
// surfel renderer'ı (normal + tek ölçek) eğitilen anizotropik Gaussian'ı
// (3 ölçek + dönme + SH) kayıpsız taşıyamaz, çeviri sahneyi bulanıklaştırırdı.
//
// KORUMALAR (ölçüldü, bkz. src/vendor/splat.js/VENDORED.md):
// - Katman GPU'ya göre: `standard` + 40 kare Intel iGPU'yu çökertti
//   (DXGI_ERROR_DEVICE_HUNG); RTX'te geçti ve +3.6 dB verdi.
// - SfM GPU eşleştiricisi oturum cihazını kullanır. Sürücü sıfırlanmasında
//   GPU sözü yine asılı kalabilir; ilerleme bekçisi bunu kullanıcıya bildirir.

import { segmentForeground } from './segmentation.ts';
import { prepareSubjectFrames } from './subjectTrainingMasks.ts';
import {
  bendFrame, deformGaussianBuffer, fadeGaussianOpacity, type BendDirection, type DeformSpec, type Mat3,
} from './gaussianDeform.ts';

export type { BendDirection } from './gaussianDeform.ts';

export interface EgitimAyari {
  tier: 'quick' | 'standard';
  maxFrames: number;
  maxIters: number;
  /** `vendor / architecture` — kullanıcıya hangi GPU'da koştuğu söylenir. */
  gpu: string;
  /** Conservative quick preset for all adapters without an RTX measurement. */
  zayifGpu: boolean;
  /** Intel vendor was positively identified; unknown adapters must not trigger an iGPU warning. */
  entegreGpu: boolean;
}

export interface EgitimMetrik {
  iter: number;
  splats: number;
  itersPerSec: number;
  psnrTrain?: number;
  psnrHold?: number;
}

/** splat.js kamerası: R satır sıralı dünya→kamera (COLMAP: y aşağı, z ileri),
 *  içsel parametreler çizim kanvası çözünürlüğünde. */
export interface GsKamera {
  R: number[];
  t: number[];
  f: number;
  fy?: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

type Vec3 = [number, number, number];

interface GpuAdapterLike { info?: { vendor?: string; architecture?: string; device?: string; description?: string } }
type GpuLike = { requestAdapter(o?: object): Promise<GpuAdapterLike | null> };

export async function ayarSec(): Promise<EgitimAyari> {
  const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
  const a = await gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!a) throw new Error('WebGPU yok — 3D eğitim bu tarayıcıda çalışmaz (Chrome/Edge gerekir)');
  const vendor = a.info?.vendor ?? '?';
  const arch = a.info?.architecture ?? '?';
  // ponytail: yalnız iki GPU ölçüldü (Intel iGPU, RTX 5070). NVIDIA dışı her
  // şey temkinli katmana düşer; AMD/Apple ölçülünce buraya eklenir.
  const guclu = vendor.toLowerCase() === 'nvidia';
  const intelIdentity = `${arch} ${a.info?.device ?? ''} ${a.info?.description ?? ''}`;
  // Intel also sells discrete Arc GPUs; vendor alone cannot identify an iGPU.
  const entegreGpu = vendor.toLowerCase().includes('intel')
    && /gen-12lp|iris|uhd graphics|hd graphics/i.test(intelIdentity)
    && !/arc/i.test(intelIdentity);
  return guclu
    ? { tier: 'standard', maxFrames: 40, maxIters: 10000, gpu: `${vendor} / ${arch}`, zayifGpu: false, entegreGpu }
    : { tier: 'quick', maxFrames: 24, maxIters: 3000, gpu: `${vendor} / ${arch}`, zayifGpu: true, entegreGpu };
}

/** SfM çökmesinde söz hiç dönmez: `sonHareket` `ms`'den uzun sessiz kalırsa
 *  dürüst hata. İlerleme olayı gelen her iş için geçerli. */
export function bekcili<T>(
  p: Promise<T>, sonHareket: () => number, ms: number, asama: string, signal?: AbortSignal,
): Promise<T> {
  return new Promise((res, rej) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(id);
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = () => finish(() => rej(new DOMException('3D training cancelled', 'AbortError')));
    const id = setInterval(() => {
      if (performance.now() - sonHareket() > ms) {
        finish(() => rej(new Error(
          `${asama}: ${Math.round(ms / 1000)} sn ilerleme yok — işlem durmuş olabilir. ` +
          'Eğitimi yeniden başlat; tekrarlarsa sayfayı yenile.',
        )));
      }
    }, 1000);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    p.then((v) => finish(() => res(v)), (e) => finish(() => rej(e)));
  });
}

/** Kare seçiminde tespit edilen kesim (shot) bilgisinden kullanıcıya
 * gösterilecek kısa notu üretir. `selectFrames` (splat.js) varsayılan
 * olarak yalnız en uzun çekimi tutar (`shots: 'longest'`) ve diğerlerini
 * sessizce atar — video odalar arası kesimle kurgulanmışsa bütün bir oda
 * kaybolabilir. Tek çekim varsa ya da hiçbir şey atılmadıysa (`shot: null`,
 * `shots: 'all'` stratejisi) sessiz kal: gürültü ekleme. */
export function cekimOzeti(sel: {
  shots?: { start: number; end: number }[];
  shot?: { start: number; end: number } | null;
  analysis?: { t: number }[];
  frames?: { t: number }[];
}): string {
  const shots = sel.shots ?? [];
  if (shots.length <= 1 || !sel.shot || !sel.analysis) return '';
  const sure = sel.analysis[sel.shot.end].t - sel.analysis[sel.shot.start].t;
  const kare = sel.frames?.length ?? 0;
  return `video ${shots.length} ayrı çekimden oluşuyor, yalnız en uzunu ` +
    `(${sure.toFixed(1)} sn / ${kare} kare) kullanıldı, diğer ${shots.length - 1} çekim atlandı`;
}

export interface EgitimOlaylari {
  ayar?(ayar: EgitimAyari): void;
  asama(metin: string): void;
  metrik(m: EgitimMetrik): void;
  bitti(m: EgitimMetrik | null): void;
  hata(e: Error): void;
}

/** splat.js yoğunlaştırması (refine = ölü splat taşıma + büyüme) yalnız
 * `iter > 1500` ve son refine'dan `refineEvery` (varsayılan 2500) sonra
 * tetiklenir; varsayılan eğitici `iter < 0.75 × maxIters` iken büyür. 60k
 * ufka göre seçilmiş 2500 aralığı kısa bütçelerde pencereyi kaçırıyordu:
 * quick (3k) ilk refine'ı ~2518'de, pencere 2250'de kapanmış — hiç büyüme,
 * hiç taşıma yok; standard (10k) yalnız 2 büyüme. Aralık bütçeyle ölçeklenir
 * (quick 375, standard 1250); ölçüm: src/vendor/splat.js/VENDORED.md. */
export function egitimOturumAyari(ayar: EgitimAyari) {
  return {
    maxIters: ayar.maxIters,
    holdout: 'auto' as const,
    refineEvery: Math.max(300, Math.round(ayar.maxIters / 8)),
  };
}

/** Continuation of a finished quick run: the extended horizon reopens the
 * growth window (0.75 x new maxIters), so refinements every `refineEvery`
 * grow the model again. Measured on RTX, one clip: 3k -> 7k took 78k -> 180k
 * splats and held-out 28.1 -> 29.3 dB; iGPU time cost not yet measured. */
export const IGPU_CONTINUE_ITERS = 4000;

export function egitimDevamEt(
  session: { training: boolean; continueFor(moreIters: number): number },
  ayar: EgitimAyari,
  moreIters = IGPU_CONTINUE_ITERS,
): number {
  if (!Number.isSafeInteger(moreIters) || moreIters <= 0) {
    throw new RangeError('Additional iterations must be a positive integer');
  }
  if (session.training) throw new Error('Training is already running');
  const target = session.continueFor(moreIters);
  ayar.maxIters = target;
  return target;
}

interface BendSession {
  trainer: { device: { queue: { writeBuffer(buffer: unknown, offset: number, data: Float32Array): void } }; bufParams: unknown } | null;
  exportRawState(): Promise<{ data: Float32Array; n: number }>;
}

/** Bend region from the subject the cameras frame, not from the splat cloud:
 * trained scenes carry floaters tens of units out while the cameras orbit
 * ~1 unit from the pivot. Half-length = median camera distance to the pivot;
 * strength 1 is a 90 degree total bend across [-halfLength, halfLength]. */
export function bendRegion(cameras: readonly Vec3[], pivot: Vec3, strength: number) {
  const distances = cameras.map((c) => Math.hypot(c[0] - pivot[0], c[1] - pivot[1], c[2] - pivot[2]))
    .sort((a, b) => a - b);
  const median = distances[distances.length >> 1];
  const halfLength = median > 0 ? median : 1;
  return { halfLength, curvature: strength * (Math.PI / 4) / halfLength };
}

/** Scene-level wrapper around `bendFrame` (gaussianDeform.ts): the view hint
 * is the direction from the first training camera to the pivot, so free axis
 * selection needs no camera rotation, only data `Egitim` already exposes
 * (`yukari`, `pivot`, `kameralar`). Reused by later deform types (fade,
 * dome, noise) that need the same scene-relative frame. */
export function bendSceneFrame(direction: BendDirection, yukari: Vec3, pivot: Vec3, ilkKamera: Vec3): Mat3 {
  const forward: Vec3 = [pivot[0] - ilkKamera[0], pivot[1] - ilkKamera[1], pivot[2] - ilkKamera[2]];
  return bendFrame(direction, yukari, forward);
}

/** Scene-level deform choice; `strength` in [-1, 1], 0 = exact trained state.
 * bend: ±90° total across the region. dome: ±90° rim angle (tiny planet /
 * bowl) with the ground plane through the pivot, normal `yukari`. */
export type DeformSettings =
  | { kind: 'bend'; strength: number; direction?: BendDirection }
  | { kind: 'dome'; strength: number };

/** Settings -> `DeformSpec`; the region always comes from cameras + pivot. */
export function deformSpec(settings: DeformSettings, cameras: readonly Vec3[], pivot: Vec3, yukari: Vec3): DeformSpec {
  if (!Number.isFinite(settings.strength) || Math.abs(settings.strength) > 1) {
    throw new RangeError('Deform strength must be between -1 and 1');
  }
  const region = bendRegion(cameras, pivot, settings.strength);
  const ilkKamera = cameras[0] ?? pivot;
  if (settings.kind === 'dome') {
    return {
      kind: 'dome', halfLength: region.halfLength, frame: bendSceneFrame('yana', yukari, pivot, ilkKamera),
      curvature: settings.strength * (Math.PI / 2) / region.halfLength,
    };
  }
  return {
    kind: 'bend', curvature: region.curvature, halfLength: region.halfLength,
    frame: bendSceneFrame(settings.direction ?? 'yana', yukari, pivot, ilkKamera),
  };
}

/** A finished run is captured once. Every slider move starts from that same
 * trained state, so returning to zero is exact and never compounds bends. */
export function createGaussianBendController(
  session: BendSession, canEdit: () => boolean, redraw: () => void,
  center: readonly number[] | (() => readonly number[]) = [0, 0, 0],
) {
  let snapshot: { data: Float32Array; n: number } | null = null;
  let active = false;
  let pending = false;
  const write = (data: Float32Array) => {
    if (!session.trainer) throw new Error('Training session is closed');
    session.trainer.device.queue.writeBuffer(session.trainer.bufParams, 0, data);
    redraw();
  };
  return {
    /** `fadeHalfLength` (Infinity = off) fades opacity beyond that radius from
     * `center`, same region source and snapshot as the bend; composed with it
     * in the one write below, so the two effects never compound across calls. */
    async apply(deform: number | DeformSpec, halfLength = Infinity, frame?: Mat3, fadeHalfLength = Infinity): Promise<void> {
      const spec: DeformSpec = typeof deform === 'number' ? { kind: 'bend', curvature: deform, halfLength, frame } : deform;
      const curvature = spec.curvature;
      if (!Number.isFinite(curvature)) throw new RangeError('Bend curvature must be finite');
      const fadeActive = Number.isFinite(fadeHalfLength);
      if (fadeActive && !(fadeHalfLength > 0)) throw new RangeError('Fade half-length must be positive');
      if (curvature === 0 && !fadeActive && !active) return;
      if (!canEdit()) throw new Error('Bend is available after training has finished');
      if (pending) throw new Error('A bend update is already in progress');
      pending = true;
      try {
        if (!snapshot) {
          const raw = await session.exportRawState();
          if (!canEdit()) throw new Error('Training session is no longer ready for bending');
          snapshot = { data: raw.data.slice(0, raw.n * 16), n: raw.n };
        }
        if (curvature === 0 && !fadeActive) {
          write(snapshot.data);
        } else {
          const sceneCenter = typeof center === 'function' ? center() : center;
          const local = snapshot.data.slice();
          for (let index = 0; index < snapshot.n; index++) {
            const base = index * 16;
            for (let axis = 0; axis < 3; axis++) local[base + axis] -= sceneCenter[axis];
          }
          const deformed = curvature !== 0 ? deformGaussianBuffer(local, snapshot.n, spec) : local.slice();
          if (fadeActive) {
            // Fade reads position/opacity from the PRE-bend `local` snapshot: the
            // camera-framed region is a scene-relative fact, not something the
            // bend itself should be able to move splats in or out of.
            const faded = fadeGaussianOpacity(local, snapshot.n, fadeHalfLength);
            for (let index = 0; index < snapshot.n; index++) deformed[index * 16 + 13] = faded[index * 16 + 13];
          }
          for (let index = 0; index < snapshot.n; index++) {
            const base = index * 16;
            for (let axis = 0; axis < 3; axis++) deformed[base + axis] += sceneCenter[axis];
          }
          write(deformed);
        }
        active = curvature !== 0 || fadeActive;
      } finally {
        pending = false;
      }
    },
    restoreForTraining(): void {
      if (pending) throw new Error('Wait for the bend update before resuming training');
      if (active && snapshot) write(snapshot.data);
      active = false;
      snapshot = null;
    },
    dispose(): void { snapshot = null; active = false; },
  };
}

export interface Egitim {
  ayar: EgitimAyari;
  /** Eğitimi durdurur ve GPU kaynaklarını bırakır. */
  kapat(): void;
  /** Resume the same Gaussian trainer after its first completed budget. */
  devamEt(moreIters?: number): number;
  /** Strength in [-1, 1] = ±90° total bend across the camera-framed subject
   * (`bendRegion`); zero restores the exact trained state. `direction`
   * picks the free bend axis (`bendSceneFrame`), default 'yana'. */
  bend(strength: number, direction?: BendDirection): Promise<void>;
  /** Any deform (`DeformSettings`: bend, dome); replaces the previous one,
   * composes with `fade`, zero strength restores the exact trained state.
   * `bend(s, d)` is `deform({ kind: 'bend', strength: s, direction: d })`. */
  deform(settings: DeformSettings): Promise<void>;
  /** Far-background opacity fade, off by default: beyond the same
   * camera-framed region as `bend` (`bendRegion`), opacity fades out
   * smoothly with distance from the pivot. Composes with whatever bend is
   * active (one write, never compounding); an offline clip renderer can
   * call this directly to default it on without touching UI state. */
  fade(enabled: boolean): Promise<void>;
  plyBlob(): Promise<Blob>;
  /** Serbest kamera; `ciz` kanvası bu kamerayla çizer. */
  kamera: GsKamera;
  /** Yörünge merkezi: kameraların baktığı ortak nokta (bkz. `bakisMerkezi`). */
  pivot: Vec3;
  /** Training camera centres in capture order; free-fly stays near their volume. */
  kameralar: Vec3[];
  /** Kameraların baskın yukarı ekseni (dünya). */
  yukari: Vec3;
  kameraAyarla(k: GsKamera): void;
}

/**
 * Videodan eğitimi başlatır. `canvas` hazırlanınca canlı görüntü oraya
 * çizilir (eğitim sürerken sahne ekranda netleşir). Söz, eğitim BAŞLAYINCA
 * döner; bitiş `olay.bitti` ile gelir.
 */
export async function egitimBaslat(
  video: File,
  canvas: HTMLCanvasElement,
  olay: EgitimOlaylari,
  ayar?: EgitimAyari,
  signal?: AbortSignal,
  options?: { subjectOnly?: boolean },
): Promise<Egitim> {
  signal?.throwIfAborted();
  const secilen = ayar ?? await ayarSec();
  signal?.throwIfAborted();
  olay.ayar?.(secilen);
  // Dinamik: splat.js (+ mediabunny) yalnız eğitime basılınca iner.
  // @ts-expect-error vendored JS, tip dosyası yok
  const sj = await import('../../vendor/splat.js/index.js');
  signal?.throwIfAborted();
  let son = performance.now();
  const hareket = () => { son = performance.now(); };

  olay.asama('kareler seçiliyor');
  const ex = await bekcili<{
    frames: { source: Blob; name: string; t: number }[];
    shots?: { start: number; end: number }[];
    shot?: { start: number; end: number } | null;
    analysis?: { t: number }[];
  }>(sj.extractSharpFrames(video, {
    maxFrames: secilen.maxFrames,
    signal,
    backgroundSafe: true,
    onProgress: (p: { stage: string; done: number; total: number }) => {
      hareket();
      olay.asama(`kareler seçiliyor ${p.done}/${p.total}`);
    },
  }), () => son, 90_000, 'kareler seçiliyor', signal);
  signal?.throwIfAborted();
  // Video kesimle kurgulanmışsa (oda değişimi vb.) varsayılan seçici yalnız
  // en uzun çekimi tutar, gerisini sessizce atar — kullanıcı neden eksik
  // olduğunu bilemez. Tespit edildiyse bir kez bildir; tek çekimde sessiz kal.
  const cekimNot = cekimOzeti(ex);
  if (cekimNot) olay.asama(cekimNot);

  const s = sj.createSession({ ...egitimOturumAyari(secilen), sfm: sj.solveTierOpts(secilen.tier) });
  let closed = false;
  let complete = false;
  // Set once the cameras are solved; the bend is only reachable after training.
  let bendPivot: Vec3 = [0, 0, 0];
  const bend = createGaussianBendController(s, () => !closed && complete && !s.training,
    () => { if (s.view.camera) s.view.setCamera(s.view.camera); }, () => bendPivot);
  let trainWatch: ReturnType<typeof setInterval> | null = null;
  const clearWatch = () => {
    if (trainWatch !== null) clearInterval(trainWatch);
    trainWatch = null;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    bend.dispose();
    clearWatch();
    signal?.removeEventListener('abort', close);
    s.pause();
    s.dispose();
  };
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) {
    close();
    signal.throwIfAborted();
  }
  let sonMetrik: EgitimMetrik | null = null;
  s.on('stage', (e: { stage: string; done?: number; total?: number }) => {
    if (closed) return;
    hareket();
    olay.asama(`${e.stage} ${e.done ?? ''}/${e.total ?? ''}`);
  });
  s.on('log', hareket);
  s.on('metrics', (m: EgitimMetrik) => {
    if (closed) return;
    hareket(); sonMetrik = m; olay.metrik(m);
  });
  s.on('event', (e: { kind: string }) => {
    if (closed) return;
    if (e.kind === 'train-complete') { complete = true; clearWatch(); olay.bitti(sonMetrik); }
    if (e.kind === 'device-lost') {
      olay.hata(new Error('GPU cihazı kayboldu — eğitim durdu. Sayfayı yenile.'));
      close();
    }
    if (e.kind === 'train-error') {
      olay.hata((e as { error?: Error }).error ?? new Error('Eğitim döngüsü durdu'));
      close();
    }
  });

  const BEKCI_MS = 90_000;
  let releaseMasks: (() => void) | null = null;
  let maskAbort: AbortController | null = null;
  const armTrainWatch = () => {
    clearWatch();
    trainWatch = setInterval(() => {
      if (closed || !s.training) { clearWatch(); return; }
      if (performance.now() - son > BEKCI_MS) {
        olay.hata(new Error('Eğitim 90 sn ilerlemedi — GPU veya arka sekme zamanlayıcısı durmuş olabilir. Eğitimi yeniden başlat.'));
        close();
      }
    }, 1000);
  };
  try {
    let trainingFrames = ex.frames;
    if (options?.subjectOnly) {
      // Masks run before SfM allocates its training GPU device. The IS-Net
      // inference uses the app's WebGPU queue; nesting it inside a GPU job
      // would deadlock because that queue is deliberately non-reentrant.
      maskAbort = new AbortController();
      const maskSignal = signal
        ? AbortSignal.any([signal, maskAbort.signal])
        : maskAbort.signal;
      const prepared = await bekcili(
        prepareSubjectFrames(ex.frames, segmentForeground, maskSignal, (done, total, skipped) => {
          hareket();
          olay.asama(`nesne maskeleri ${done}/${total}${skipped ? ` · ${skipped} atlandı` : ''}`);
        }),
        () => son, BEKCI_MS, 'nesne maskeleri', maskSignal,
      );
      trainingFrames = prepared.frames;
      releaseMasks = prepared.release;
      olay.asama(`nesne maskeleri hazır · ${prepared.frames.length}/${ex.frames.length} kare · ` +
        `${prepared.skipped} atlandı`);
    }
    await bekcili(s.load(trainingFrames, { signal }), () => son, BEKCI_MS, 'kareler yükleniyor', signal);
    // decodeFrames has copied the matte into each Frame.alpha; releasing the
    // temporary canvases here keeps 24-40 high-resolution masks out of RAM.
    releaseMasks?.();
    releaseMasks = null;
    await bekcili(s.solve({ signal }), () => son, BEKCI_MS, 'kamera pozu (SfM)', signal);
    await bekcili(s.seed(), () => son, BEKCI_MS, 'Gaussian tohumlama', signal);
    signal?.throwIfAborted();
  } catch (e) {
    maskAbort?.abort();
    releaseMasks?.();
    try { close(); } catch { /* the GPU may already be gone */ }
    throw e;
  }

  try {
    // Başlangıç kamerası: ilk eğitim karesinin pozu, kanvas çözünürlüğüne ölçekli.
    const meta: GsKamera = s.trainer.camMeta[0];
    const olcek = canvas.width / meta.w;
    canvas.height = Math.round(meta.h * olcek);
    const kamera = kameraOlcekle(meta, olcek);
    s.view.attach(canvas);
    s.view.setCamera(kamera);
    const noktalar: Vec3[] = s.recon.points.map((p: { X: Vec3 }) => p.X);
    const pivot = bakisMerkezi(s.recon.cams, medyanNokta(noktalar));
    bendPivot = pivot;
    // Last-applied bend/fade settings: both `bend` and `fade` re-issue the
    // combined controller call, since they share one snapshot and one write.
    const noDeform: DeformSettings = { kind: 'bend', strength: 0, direction: 'yana' };
    let currentDeform: DeformSettings = noDeform;
    let fadeOn = false;
    const applyBendAndFade = () => {
      const spec = deformSpec(currentDeform, e.kameralar, pivot, e.yukari);
      return bend.apply(spec, Infinity, undefined, fadeOn ? bendRegion(e.kameralar, pivot, 0).halfLength : Infinity);
    };

    const e: Egitim = {
      ayar: secilen,
      kapat: close,
      devamEt: (moreIters) => {
        if (closed) throw new Error('Training session is closed');
        if (!complete) throw new Error('Training has not finished yet');
        bend.restoreForTraining();
        currentDeform = noDeform;
        fadeOn = false;
        complete = false;
        try {
          const target = egitimDevamEt(s, secilen, moreIters);
          hareket();
          armTrainWatch();
          return target;
        } catch (error) {
          complete = true;
          throw error;
        }
      },
      bend: (strength, direction = 'yana') => e.deform({ kind: 'bend', strength, direction }),
      deform: async (settings) => {
        const previous = currentDeform;
        currentDeform = settings;
        try {
          return await applyBendAndFade();
        } catch (error) {
          currentDeform = previous;
          throw error;
        }
      },
      fade: async (enabled) => {
        fadeOn = enabled;
        return applyBendAndFade();
      },
      plyBlob: () => s.exportPlyBlob(),
      kamera,
      pivot,
      kameralar: [...s.recon.cams].sort((a: { imgIdx: number }, b: { imgIdx: number }) => a.imgIdx - b.imgIdx).map(kameraMerkezi),
      yukari: s._camerasUp(),
      kameraAyarla: (k) => { e.kamera = k; s.view.setCamera(k); },
    };
    signal?.throwIfAborted();
    s.start();
    armTrainWatch();
    return e;
  } catch (error) {
    close();
    throw error;
  }
}

export function kameraOlcekle(m: GsKamera, k: number): GsKamera {
  return {
    R: [...m.R], t: [...m.t],
    f: m.f * k, ...(m.fy != null ? { fy: m.fy * k } : {}),
    cx: m.cx * k, cy: m.cy * k,
    w: Math.round(m.w * k), h: Math.round(m.h * k),
  };
}

export function medyanNokta(pts: Vec3[]): Vec3 {
  if (pts.length === 0) return [0, 0, 0];
  const med = (i: 0 | 1 | 2) => {
    const v = pts.map((p) => p[i]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  return [med(0), med(1), med(2)];
}

/**
 * Kamera bakış eksenlerine (en küçük kareler) en yakın nokta. Bir nesnenin
 * etrafında dönen çekimde bu nesnenin kendisidir — nokta medyanı ise çoğu
 * zaman uzak arka plana (tepe, gökyüzü sınırı) düşer ve yörünge sahneden
 * savrulur. Eksenler paralelse (ileri yürüyen video) sistem tekil olur:
 * `yedek` döner.
 */
export function bakisMerkezi(cams: { R: number[]; t: number[] }[], yedek: Vec3): Vec3 {
  // Σ (I − d dᵀ) P = Σ (I − d dᵀ) C
  const A = new Array(9).fill(0);
  const b = [0, 0, 0];
  for (const c of cams) {
    const d: Vec3 = [c.R[6], c.R[7], c.R[8]]; // R'nin 2. satırı = bakış yönü (dünya)
    const C = kameraMerkezi(c as GsKamera);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const m = (i === j ? 1 : 0) - d[i] * d[j];
      A[i * 3 + j] += m;
      b[i] += m * C[j];
    }
  }
  const det =
    A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
  // ponytail: tekillik eşiği kaba (kamera sayısına göre ölçekli); yanlış
  // pivot yalnız döndürme hissini bozar, görüntüyü değil.
  if (Math.abs(det) < 1e-3 * cams.length ** 3) return yedek;
  const inv = [
    A[4] * A[8] - A[5] * A[7], A[2] * A[7] - A[1] * A[8], A[1] * A[5] - A[2] * A[4],
    A[5] * A[6] - A[3] * A[8], A[0] * A[8] - A[2] * A[6], A[2] * A[3] - A[0] * A[5],
    A[3] * A[7] - A[4] * A[6], A[1] * A[6] - A[0] * A[7], A[0] * A[4] - A[1] * A[3],
  ].map((v) => v / det);
  return uygula(inv, b as Vec3);
}

// ── yörünge matematiği (satır sıralı 3×3) ────────────────────────────────

/** Rodrigues: birim eksen etrafında açı kadar dönme. */
function donme(ax: Vec3, a: number): number[] {
  const [x, y, z] = ax;
  const c = Math.cos(a), s = Math.sin(a), k = 1 - c;
  return [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k,
  ];
}

function carp(A: number[], B: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return o;
}

const devrik = (A: number[]) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const uygula = (A: number[], v: Vec3): Vec3 => [
  A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
  A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
  A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
];

/** Kamera merkezi C = −Rᵀt. */
export function kameraMerkezi(k: GsKamera): Vec3 {
  const c = uygula(devrik(k.R), k.t as Vec3);
  return [-c[0], -c[1], -c[2]];
}

/**
 * Kamerayı pivot etrafında katı döndürür: önce `yukari` ekseninde `yaw`,
 * sonra kameranın sağ ekseninde `pitch`; `yakinlas` < 1 pivota yaklaştırır.
 * Kamera Q ile taşınınca: R' = R·Qᵀ, C' = P + Q(C − P), t' = −R'C'.
 */
export function yorunge(k: GsKamera, pivot: Vec3, yukari: Vec3, yaw: number, pitch: number, yakinlas = 1): GsKamera {
  const sag: Vec3 = [k.R[0], k.R[1], k.R[2]]; // R'nin 0. satırı = kamera x ekseni (dünyada)
  const Q = carp(donme(sag, pitch), donme(yukari, yaw));
  const C = kameraMerkezi(k);
  const d = uygula(Q, [C[0] - pivot[0], C[1] - pivot[1], C[2] - pivot[2]]);
  const C2: Vec3 = [pivot[0] + d[0] * yakinlas, pivot[1] + d[1] * yakinlas, pivot[2] + d[2] * yakinlas];
  const R2 = carp(k.R, devrik(Q));
  const t2 = uygula(R2, C2);
  return { ...k, R: R2, t: [-t2[0], -t2[1], -t2[2]] };
}
