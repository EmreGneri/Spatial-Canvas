// DAViD (Microsoft, ICCV 2025, MIT) insan derinliği + yumuşak ön plan maskesi, tarayıcıda.
// Yalnız `?derinlik=david` ile çağrılır (depth.ts). Hata → null + uyarı; çağıran sahne
// derinliğiyle devam eder. Ürün bayrağı burada YOK.
import * as ort from 'onnxruntime-web/webgpu';
import { ilerlemeliGetir } from '../../indirmeIlerleme.ts';

/**
 * depth.ts yardımcıları ÇAĞIRANDAN gelir, burada `import` edilmez: depth.ts → (dinamik) bu
 * modül → (statik) depth.ts döngüsü, iz sürücü işçisinin IIFE build'ini bozuyor
 * (detect.ts depth.ts'i işçiye taşıyor; Rolldown "IIFE code-splitting" hatası, ölçüldü).
 */
export interface DavidAraclari {
  gpuSirasinaGir: <T>(is: () => Promise<T>) => Promise<T>;
  onceRetry: <T>(f: () => Promise<T>) => () => Promise<T>;
  webgpuKullanilabilir: () => Promise<boolean>;
}

/** Resmî giriş: 512×512, BGR, [0,1], NCHW (model_cards/depth_model.md). */
export const DAVID_BOYUT = 512;
const KOK = '/models/microsoft-david/';
/**
 * DENEME (2026-10-24, görsel karşılaştırma): `&david=int8` → onnxruntime quantize_dynamic
 * (MatMul/Gemm ağırlıkları uint8) ile küçültülmüş kopyalar, 449 → 180 MB. Dosyalar yerelde
 * üretildi, fetch-assets'te yok; kalite kullanıcının gözüyle karşılaştırılacak.
 */
const INT8 = typeof location !== 'undefined' && new URLSearchParams(location.search).get('david') === 'int8';
const ek = INT8 ? '-int8' : '';
export const DAVID_DOSYALARI = {
  derinlik: `depth-model-vitb16_384${ek}.onnx`,
  maske: `foreground-segmentation-model-vitb16_384${ek}.onnx`,
} as const;

const VITE_DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
ort.env.wasm.wasmPaths = VITE_DEV ? '/node_modules/onnxruntime-web/dist/' : '/ort/';
ort.env.wasm.numThreads = 1;

export interface DavidHam {
  /** [S×S] ham derinlik (uzak = büyük, birimsiz). */
  derinlik: Float32Array;
  /** [S×S] yumuşak ön plan, 0..1'e kırpılmış. */
  maske: Float32Array;
  boyut: number;
  sureMs: { yukleme: number; cikarim: number };
}

/** RGBA (tuval) → BGR [0,1] NCHW. */
export function bgrTensoru(rgba: Uint8ClampedArray, S: number): Float32Array {
  const n = S * S, out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[i] = rgba[4 * i + 2] / 255;
    out[n + i] = rgba[4 * i + 1] / 255;
    out[2 * n + i] = rgba[4 * i] / 255;
  }
  return out;
}

let oturumlar: Record<keyof typeof DAVID_DOSYALARI, () => Promise<ort.InferenceSession>> | null = null;
let kapali = false;

function ilkDuzlem(t: ort.Tensor, S: number): Float32Array | null {
  const d = t.data;
  if (!(d instanceof Float32Array) || d.length < S * S || t.dims.at(-1) !== S || t.dims.at(-2) !== S) return null;
  const p = d.slice(0, S * S);
  return p.every(Number.isFinite) ? p : null;
}

/** Girdi: S×S letterbox RGBA. İki model sırayla (aynı GPU kuyruğu). */
export async function inferDavid(rgba: Uint8ClampedArray, { gpuSirasinaGir, onceRetry, webgpuKullanilabilir }: DavidAraclari): Promise<DavidHam | null> {
  const S = DAVID_BOYUT;
  if (kapali) return null;
  const oturum = (ad: keyof typeof DAVID_DOSYALARI) => onceRetry(async () => {
    const bayt = await ilerlemeliGetir(KOK + DAVID_DOSYALARI[ad], `DAViD ${ad}`);
    return gpuSirasinaGir(() => ort.InferenceSession.create(bayt, { executionProviders: ['webgpu'] }));
  });
  oturumlar ??= { derinlik: oturum('derinlik'), maske: oturum('maske') };
  if (!await webgpuKullanilabilir()) {
    kapali = true;
    console.warn('DAViD: WebGPU yok; sahne derinliğiyle devam.');
    return null;
  }
  try {
    const t0 = performance.now();
    const [sd, sm] = [await oturumlar.derinlik(), await oturumlar.maske()];
    const t1 = performance.now();
    const x = bgrTensoru(rgba, S);
    const kos = (s: ort.InferenceSession) => gpuSirasinaGir(async () => {
      const girdi = new ort.Tensor('float32', x, [1, 3, S, S]);
      let o: Record<string, ort.Tensor> = {};
      try {
        o = await s.run({ [s.inputNames[0]]: girdi });
        return ilkDuzlem(o[s.outputNames[0]], S);
      } finally {
        girdi.dispose();
        for (const t of Object.values(o)) t.dispose?.();
      }
    });
    const derinlik = await kos(sd);
    const maske = await kos(sm);
    if (!derinlik || !maske) throw new Error('DAViD çıktısı geçersiz (şekil/NaN)');
    for (let i = 0; i < maske.length; i++) maske[i] = Math.min(1, Math.max(0, maske[i]));
    return { derinlik, maske, boyut: S, sureMs: { yukleme: t1 - t0, cikarim: performance.now() - t1 } };
  } catch (err) {
    kapali = true;
    console.warn('DAViD başarısız; sayfa yenilenene kadar sahne derinliğiyle devam.', err);
    return null;
  }
}
