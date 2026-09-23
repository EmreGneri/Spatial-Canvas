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
// - SfM eşleştirici KENDİ cihazını açar; oturumun `device-lost` olayı onu
//   kapsamaz ve çökmede söz HİÇ dönmez. Bekçi: ilerleme olayı kesilirse
//   dürüst hata fırlatılır, UI sonsuza dek "çalışıyor" demez.

export interface EgitimAyari {
  tier: 'quick' | 'standard';
  maxFrames: number;
  maxIters: number;
  /** `vendor / architecture` — kullanıcıya hangi GPU'da koştuğu söylenir. */
  gpu: string;
  /** Entegre GPU şüphesi: UI "yüksek performans" ipucu gösterir. */
  zayifGpu: boolean;
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

interface GpuAdapterLike { info?: { vendor?: string; architecture?: string } }
type GpuLike = { requestAdapter(o?: object): Promise<GpuAdapterLike | null> };

export async function ayarSec(): Promise<EgitimAyari> {
  const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
  const a = await gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!a) throw new Error('WebGPU yok — 3D eğitim bu tarayıcıda çalışmaz (Chrome/Edge gerekir)');
  const vendor = a.info?.vendor ?? '?';
  const arch = a.info?.architecture ?? '?';
  // ponytail: yalnız iki GPU ölçüldü (Intel iGPU, RTX 5070). NVIDIA dışı her
  // şey temkinli katmana düşer; AMD/Apple ölçülünce buraya eklenir.
  const guclu = vendor === 'nvidia';
  return guclu
    ? { tier: 'standard', maxFrames: 40, maxIters: 10000, gpu: `${vendor} / ${arch}`, zayifGpu: false }
    : { tier: 'quick', maxFrames: 24, maxIters: 3000, gpu: `${vendor} / ${arch}`, zayifGpu: true };
}

/** SfM çökmesinde söz hiç dönmez: `sonHareket` `ms`'den uzun sessiz kalırsa
 *  dürüst hata. İlerleme olayı gelen her iş için geçerli. */
function bekcili<T>(p: Promise<T>, sonHareket: () => number, ms: number, asama: string): Promise<T> {
  return new Promise((res, rej) => {
    const id = setInterval(() => {
      if (performance.now() - sonHareket() > ms) {
        clearInterval(id);
        rej(new Error(
          `${asama}: ${Math.round(ms / 1000)} sn ilerleme yok — GPU büyük ihtimalle sıfırlandı. ` +
          'Sayfayı yenile; tekrarlarsa tarayıcıyı yeniden başlat.',
        ));
      }
    }, 1000);
    p.then((v) => { clearInterval(id); res(v); }, (e) => { clearInterval(id); rej(e); });
  });
}

export interface EgitimOlaylari {
  asama(metin: string): void;
  metrik(m: EgitimMetrik): void;
  bitti(m: EgitimMetrik | null): void;
  hata(e: Error): void;
}

export interface Egitim {
  ayar: EgitimAyari;
  /** Eğitimi durdurur ve GPU kaynaklarını bırakır. */
  kapat(): void;
  plyBlob(): Promise<Blob>;
  /** Serbest kamera; `ciz` kanvası bu kamerayla çizer. */
  kamera: GsKamera;
  /** Yörünge merkezi: kameraların baktığı ortak nokta (bkz. `bakisMerkezi`). */
  pivot: Vec3;
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
): Promise<Egitim> {
  const secilen = ayar ?? await ayarSec();
  // Dinamik: splat.js (+ mediabunny) yalnız eğitime basılınca iner.
  // @ts-expect-error vendored JS, tip dosyası yok
  const sj = await import('../../vendor/splat.js/index.js');
  let son = performance.now();
  const hareket = () => { son = performance.now(); };

  olay.asama('kareler seçiliyor');
  const ex = await sj.extractSharpFrames(video, {
    maxFrames: secilen.maxFrames,
    onProgress: (p: { stage: string; done: number; total: number }) => {
      olay.asama(`kareler seçiliyor ${p.done}/${p.total}`);
    },
  });

  const s = sj.createSession({
    maxIters: secilen.maxIters,
    holdout: 'auto',
    sfm: sj.solveTierOpts(secilen.tier),
  });
  let sonMetrik: EgitimMetrik | null = null;
  s.on('stage', (e: { stage: string; done?: number; total?: number }) => {
    hareket();
    olay.asama(`${e.stage} ${e.done ?? ''}/${e.total ?? ''}`);
  });
  s.on('log', hareket);
  s.on('metrics', (m: EgitimMetrik) => { hareket(); sonMetrik = m; olay.metrik(m); });
  s.on('event', (e: { kind: string }) => {
    if (e.kind === 'train-complete') olay.bitti(sonMetrik);
    if (e.kind === 'device-lost') olay.hata(new Error('GPU cihazı kayboldu — eğitim durdu. Sayfayı yenile.'));
  });

  const BEKCI_MS = 90_000;
  try {
    await bekcili(s.load(ex.frames), () => son, BEKCI_MS, 'kareler yükleniyor');
    await bekcili(s.solve(), () => son, BEKCI_MS, 'kamera pozu (SfM)');
    await bekcili(s.seed(), () => son, BEKCI_MS, 'Gaussian tohumlama');
  } catch (e) {
    try { s.dispose(); } catch { /* cihaz zaten gitmiş olabilir */ }
    throw e;
  }

  // Başlangıç kamerası: ilk eğitim karesinin pozu, kanvas çözünürlüğüne ölçekli.
  const meta: GsKamera = s.trainer.camMeta[0];
  const olcek = canvas.width / meta.w;
  canvas.height = Math.round(meta.h * olcek);
  const kamera = kameraOlcekle(meta, olcek);
  s.view.attach(canvas);
  s.view.setCamera(kamera);

  const e: Egitim = {
    ayar: secilen,
    kapat: () => { s.pause(); s.dispose(); },
    plyBlob: () => s.exportPlyBlob(),
    kamera,
    pivot: bakisMerkezi(s.recon.cams, medyanNokta(s.recon.points.map((p: { X: Vec3 }) => p.X))),
    yukari: s._camerasUp(),
    kameraAyarla: (k) => { e.kamera = k; s.view.setCamera(k); },
  };
  s.start();
  return e;
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
