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

export interface EgitimOlaylari {
  ayar?(ayar: EgitimAyari): void;
  asama(metin: string): void;
  metrik(m: EgitimMetrik): void;
  bitti(m: EgitimMetrik | null): void;
  hata(e: Error): void;
}

/** A short quick run ends before the first refinement can grow its seed.
 * Four more thousand iterations put the next refinement inside the extended
 * growth window (measured first refinement: ~2529; cadence: 2500). Quality
 * improvement is experimental until a held-out run is measured. */
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

export interface Egitim {
  ayar: EgitimAyari;
  /** Eğitimi durdurur ve GPU kaynaklarını bırakır. */
  kapat(): void;
  /** Resume the same Gaussian trainer after its first completed budget. */
  devamEt(moreIters?: number): number;
  plyBlob(): Promise<Blob>;
  /** Serbest kamera; `ciz` kanvası bu kamerayla çizer. */
  kamera: GsKamera;
  /** Yörünge merkezi: kameraların baktığı ortak nokta (bkz. `bakisMerkezi`). */
  pivot: Vec3;
  /** Point-cloud extent around `pivot`; bounds free-fly navigation. */
  yaricap: number;
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
  const ex = await bekcili<{ frames: { source: Blob; name: string; t: number }[] }>(sj.extractSharpFrames(video, {
    maxFrames: secilen.maxFrames,
    signal,
    backgroundSafe: true,
    onProgress: (p: { stage: string; done: number; total: number }) => {
      hareket();
      olay.asama(`kareler seçiliyor ${p.done}/${p.total}`);
    },
  }), () => son, 90_000, 'kareler seçiliyor', signal);
  signal?.throwIfAborted();

  const s = sj.createSession({
    maxIters: secilen.maxIters,
    holdout: 'auto',
    sfm: sj.solveTierOpts(secilen.tier),
  });
  let closed = false;
  let complete = false;
  let trainWatch: ReturnType<typeof setInterval> | null = null;
  const clearWatch = () => {
    if (trainWatch !== null) clearInterval(trainWatch);
    trainWatch = null;
  };
  const close = () => {
    if (closed) return;
    closed = true;
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

    const e: Egitim = {
      ayar: secilen,
      kapat: close,
      devamEt: (moreIters) => {
        if (closed) throw new Error('Training session is closed');
        if (!complete) throw new Error('Training has not finished yet');
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
      plyBlob: () => s.exportPlyBlob(),
      kamera,
      pivot,
      yaricap: sahneYaricapi(noktalar, pivot),
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

/** 90th-percentile point distance: SfM leaves a few far outliers (sky, stray
 *  matches) that would otherwise let free-fly wander into empty space. */
export function sahneYaricapi(pts: Vec3[], merkez: Vec3): number {
  if (pts.length === 0) return 0;
  const d = pts.map((p) => Math.hypot(p[0] - merkez[0], p[1] - merkez[1], p[2] - merkez[2])).sort((a, b) => a - b);
  return d[Math.min(d.length - 1, Math.floor(d.length * 0.9))];
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
