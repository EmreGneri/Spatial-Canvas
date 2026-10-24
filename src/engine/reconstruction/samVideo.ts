/**
 * SAM 2.1-TINY VİDEO MASKE YAYILIMI (opt-in, `?videoMaske=sam`).
 *
 * Çapa maskesi mevcut ayırıcıdan (IS-Net) gelir; SAM onu bellek bankasıyla kare
 * kare taşır. Grafikler `jax-image-tools/sam21-tiny-video-onnx` (Apache-2.0,
 * facebook/sam2.1-hiera-tiny'den): vision_encoder → (memory_attention) →
 * mask_decoder → memory_encoder. Banka JS'de (samBellek.ts). Grafiklerde olmayan
 * küçük ağırlıklar: sam21-ekler.bin (scripts/sam21-ekler.mjs).
 *
 * Upstream'den bilinçli sapma: maske girdili çapada upstream nesne işaretçisini
 * decoder'ın MASKE istemiyle üretir; bu export'un decoder'ı yalnız nokta/kutu
 * alır. İşaretçi, maskenin sınır kutusu istemiyle üretilir (kutu = iki nokta,
 * etiket 2/3, + dolgu noktası -1 — upstream'in video yolu gibi).
 *
 * Ön işleme: kare 1024×1024'e ESNETİLİR, /255 + ImageNet ort./std
 * (facebook/sam2.1-hiera-tiny preprocessor_config). Çıktı aynı esnetilmiş ızgarada.
 * Ölçüm: docs/benchmarks/maske-olcumu.md.
 */
import * as ort from 'onnxruntime-web/webgpu';
import { gpuSirasinaGir, onceRetry } from '../../depth.ts';
import { ilerlemeliGetir } from '../../indirmeIlerleme.ts';
import { SAM_GIZLI, SAM_MEM, SAM_TOKEN, SamBellek, ekleriAyristir, type SamEkler } from './samBellek.ts';
import { dilateAndFeatherMask, keepMainComponents, resampleBilinear } from './silhouette.ts';

const VITE_DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
ort.env.wasm.wasmPaths = VITE_DEV ? '/node_modules/onnxruntime-web/dist/' : '/ort/';
ort.env.wasm.numThreads = 1;

const KOK = '/models/jax-image-tools/sam21-tiny-video-onnx/';
const EKLER_YOLU = '/models/facebook/sam2.1-hiera-tiny/sam21-ekler.bin';
export const SAM_BOYUT = 1024;
const IZGARA = 64; // 1024 / 16
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

interface Oturumlar {
  vision: ort.InferenceSession; decoder: ort.InferenceSession;
  dikkat: ort.InferenceSession; kodlayici: ort.InferenceSession; ek: SamEkler;
}

let yukle: (() => Promise<Oturumlar>) | null = null;

/** Dört oturum + ek ağırlıklar; yalnız WebGPU (wasm'da kare başına saniyeler). Hata çağırana gider. */
export function samYukle(): Promise<Oturumlar> {
  yukle ??= onceRetry(async () => {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) throw new Error('WebGPU yok');
    const r = await fetch(EKLER_YOLU);
    if (!r.ok) throw new Error(`sam21-ekler: ${r.status}`);
    const ek = ekleriAyristir(await r.arrayBuffer());
    const kur = async (ad: string, etiket: string, ek: ort.InferenceSession.SessionOptions = {}) => {
      const bayt = await ilerlemeliGetir(`${KOK}${ad}.onnx`, etiket);
      return gpuSirasinaGir(() => ort.InferenceSession.create(bayt, { executionProviders: ['webgpu'], ...ek }));
    };
    // Sırayla: iki oturum eşzamanlı kurulunca getBindGroupLayout hatası (depth.ts:85-118).
    // vision_encoder eniyileme KAPALI: konum gömmesi `If`inin sabit katlanması bu ORT
    // sürümünde "Can't merge shape info (4 vs 5)" ile kurulumu düşürüyor (her seviyede; ölçüldü).
    // feats0/feats1 yalnız decoder'a gider: GPU'da kalır (12 MB geri okuma + yükleme yok).
    const vision = await kur('vision_encoder', 'SAM görüntü kodlayıcı', {
      graphOptimizationLevel: 'disabled',
      preferredOutputLocation: { feats0: 'gpu-buffer', feats1: 'gpu-buffer', pos0: 'gpu-buffer', pos1: 'gpu-buffer', feats2: 'cpu', pos2: 'cpu' },
    });
    const decoder = await kur('mask_decoder', 'SAM maske çözücü');
    const dikkat = await kur('memory_attention', 'SAM bellek dikkati');
    const kodlayici = await kur('memory_encoder', 'SAM bellek kodlayıcı');
    return { vision, decoder, dikkat, kodlayici, ek };
  });
  return yukle();
}

/** Bir karenin görüntü kodu (vision_encoder çıktısı), varyantlar arasında paylaşılabilir. */
export interface SamKod {
  feats0: ort.Tensor; feats1: ort.Tensor;
  /** [1,256,64,64] ham (memory_encoder ve çapa bunu ister). */
  feats2: Float32Array;
  /** [4096,1,256] token düzeni (memory_attention). */
  feats2Tok: Float32Array; pos2Tok: Float32Array;
}

export interface SamKare {
  /** 1024×1024 esnetilmiş ızgarada ön plan olasılığı. */
  olasilik: Float32Array;
  nesneSkoru: number;
  /** Bu karenin model süresi (ms, GPU sırası beklemesi dahil). */
  sureMs: number;
}

/** [C,H*W] → [H*W,C]. */
function tokenlara(x: Float32Array, c: number, n: number): Float32Array {
  const o = new Float32Array(c * n);
  for (let k = 0; k < c; k++) {
    const s = k * n;
    for (let i = 0; i < n; i++) o[i * c + k] = x[s + i];
  }
  return o;
}

/** [H*W,C] → [C,H*W]. */
function kanallara(x: Float32Array, c: number, n: number): Float32Array {
  const o = new Float32Array(c * n);
  for (let i = 0; i < n; i++) {
    const s = i * c;
    for (let k = 0; k < c; k++) o[k * n + i] = x[s + k];
  }
  return o;
}

function girdiTensoru(kaynak: CanvasImageSource): ort.Tensor {
  const c = document.createElement('canvas');
  c.width = SAM_BOYUT; c.height = SAM_BOYUT;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(kaynak, 0, 0, SAM_BOYUT, SAM_BOYUT);
  const px = ctx.getImageData(0, 0, SAM_BOYUT, SAM_BOYUT).data;
  const n = SAM_BOYUT * SAM_BOYUT;
  const d = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) d[k * n + i] = (px[i * 4 + k] / 255 - MEAN[k]) / STD[k];
  return new ort.Tensor('float32', d, [1, 3, SAM_BOYUT, SAM_BOYUT]);
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Çıkarım boyunca tek akış: kodla → (çapa | izle). Banka örneğe aittir. */
export class SamVideoIzleyici {
  private readonly o: Oturumlar;
  readonly bellek: SamBellek;
  private kare = -1;
  private pos2Tok: Float32Array | null = null;
  /** Grafik başına çalıştırma süreleri (ms, sıra beklemesi dahil) — ölçüm raporu okur. */
  readonly asamaMs: Record<string, number[]> = {};

  private async zaman<T>(ad: string, is: () => Promise<T>): Promise<T> {
    const t = performance.now();
    const r = await gpuSirasinaGir(is);
    (this.asamaMs[ad] ??= []).push(performance.now() - t);
    return r;
  }

  constructor(o: Oturumlar, secenek?: { maxKosul?: number }) {
    this.o = o;
    this.bellek = new SamBellek(o.ek, secenek);
  }

  static async kur(secenek?: { maxKosul?: number }): Promise<SamVideoIzleyici> {
    return new SamVideoIzleyici(await samYukle(), secenek);
  }

  /** Sahne kesimi / kaynak değişimi: bellek atılır, sonraki kare çapa ister. */
  sifirla(): void { this.bellek.sifirla(); this.kare = -1; }
  capaGerekli(): boolean { return this.bellek.bos(); }

  async kodla(kaynak: CanvasImageSource): Promise<SamKod> {
    const girdi = girdiTensoru(kaynak);
    const r = await this.zaman('vision', () => this.o.vision.run({ pixel_values: girdi }));
    r.pos0.dispose(); r.pos1.dispose(); // kullanılmıyor
    const f2 = r.feats2.data as Float32Array, p2 = r.pos2.data as Float32Array;
    const n = IZGARA * IZGARA;
    if (f2.length !== SAM_GIZLI * n || p2.length !== SAM_GIZLI * n) {
      r.feats0.dispose(); r.feats1.dispose();
      throw new Error(`SAM vision çıktısı beklenmeyen: ${r.feats2.dims.join('x')}`);
    }
    // Konum kodlaması yalnız ızgara boyutuna bağlı: bir kez çevrilir.
    this.pos2Tok ??= tokenlara(p2, SAM_GIZLI, n);
    return { feats0: r.feats0, feats1: r.feats1, feats2: f2, feats2Tok: tokenlara(f2, SAM_GIZLI, n), pos2Tok: this.pos2Tok };
  }

  /** GPU'da tutulan feats0/feats1 tamponlarını bırakır (kod artık kullanılmayacak). */
  birak(kod: SamKod): void { kod.feats0.dispose(); kod.feats1.dispose(); }

  private async cozucu(kod: SamKod, ozellik: Float32Array, noktalar: number[], etiketler: number[]) {
    const np = etiketler.length;
    const r = await this.zaman('decoder', () => this.o.decoder.run({
      feats0: kod.feats0, feats1: kod.feats1,
      feats2: new ort.Tensor('float32', ozellik, [1, SAM_GIZLI, IZGARA, IZGARA]),
      input_points: new ort.Tensor('float32', new Float32Array(noktalar), [1, 1, np, 2]),
      input_labels: new ort.Tensor('int32', Int32Array.from(etiketler), [1, 1, np]),
    }));
    const yuksek = r.high_res_masks;
    const d = yuksek.dims;
    if (d[d.length - 1] !== SAM_BOYUT || d[d.length - 2] !== SAM_BOYUT) throw new Error(`SAM decoder çıktısı beklenmeyen: ${d.join('x')}`);
    // Çoklu maske dönerse en yüksek IoU tahmini (graf zaten seçiyorsa tek kanal gelir).
    const adet = (yuksek.data as Float32Array).length / (SAM_BOYUT * SAM_BOYUT);
    let sec = 0;
    if (adet > 1) {
      const iou = r.iou_scores.data as Float32Array;
      for (let i = 1; i < adet; i++) if (iou[i] > iou[sec]) sec = i;
    }
    const n = SAM_BOYUT * SAM_BOYUT;
    return {
      logit: (yuksek.data as Float32Array).slice(sec * n, (sec + 1) * n),
      isaretci: (r.object_pointer.data as Float32Array).slice(0, SAM_GIZLI),
      skor: (r.object_score_logits.data as Float32Array)[0],
    };
  }

  private async bellegeYaz(kod: SamKod, logit: Float32Array, skor: number, isaretci: Float32Array, kosul: boolean) {
    const r = await this.zaman('memory_encoder', () => this.o.kodlayici.run({
      vision_features: new ort.Tensor('float32', kod.feats2, [1, SAM_GIZLI, IZGARA, IZGARA]),
      pred_masks_high_res: new ort.Tensor('float32', logit, [1, 1, SAM_BOYUT, SAM_BOYUT]),
      object_score_logits: new ort.Tensor('float32', new Float32Array([skor]), [1, 1]),
      is_mask_from_pts: new ort.Tensor('bool', new Uint8Array([0]), [1]),
    }));
    const ozellik = r.memory_tokens.data as Float32Array, konum = r.memory_pos_enc.data as Float32Array;
    if (ozellik.length !== SAM_TOKEN * SAM_MEM) throw new Error(`SAM memory_encoder çıktısı beklenmeyen: ${r.memory_tokens.dims.join('x')}`);
    this.bellek.ekle({ kare: this.kare, kosul, ozellik, konum, isaretci });
  }

  /**
   * Çapa: `maske` 1024×1024 esnetilmiş ızgarada 0..1 (≥0,5 ön plan). Upstream
   * `_use_mask_as_output`: logit = ±10, nesne skoru +10; özellik = feats2 + no_mem_embed.
   * Boş maske çapa olamaz (fırlatır). `yeniden`: bu kare az önce izlendi ve
   * reddedildi — aynı kare indeksine yazılır, izlenmiş (koşulsuz) bellek atılır.
   */
  async capa(kod: SamKod, maske: Float32Array, yeniden = false): Promise<SamKare> {
    const t0 = performance.now();
    if (yeniden && this.kare >= 0) this.bellek.kosulsuzlariSil();
    else this.kare++;
    let x0 = SAM_BOYUT, y0 = SAM_BOYUT, x1 = -1, y1 = -1;
    const logit = new Float32Array(maske.length);
    for (let y = 0; y < SAM_BOYUT; y++) for (let x = 0; x < SAM_BOYUT; x++) {
      const i = y * SAM_BOYUT + x;
      const on = maske[i] >= 0.5;
      logit[i] = on ? 10 : -10;
      if (on) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) throw new Error('SAM çapası: boş maske');
    const n = IZGARA * IZGARA;
    const oz = new Float32Array(kod.feats2);
    for (let c = 0; c < SAM_GIZLI; c++) { const v = this.o.ek.noMem[c]; for (let i = 0; i < n; i++) oz[c * n + i] += v; }
    const d = await this.cozucu(kod, oz, [x0, y0, x1 + 1, y1 + 1, 0, 0], [2, 3, -1]);
    await this.bellegeYaz(kod, logit, 10, d.isaretci, true);
    const olasilik = new Float32Array(maske.length);
    for (let i = 0; i < maske.length; i++) olasilik[i] = maske[i] >= 0.5 ? 1 : 0;
    return { olasilik, nesneSkoru: 10, sureMs: performance.now() - t0 };
  }

  /** Bellekle bir sonraki kareyi izler (önce bir çapa olmalı). */
  async izle(kod: SamKod): Promise<SamKare> {
    if (this.bellek.bos()) throw new Error('SAM izleme: çapa yok');
    const t0 = performance.now();
    this.kare++;
    const g = this.bellek.girdi(this.kare);
    const r = await this.zaman('memory_attention', () => this.o.dikkat.run({
      current_vision_features: new ort.Tensor('float32', kod.feats2Tok, [SAM_TOKEN, 1, SAM_GIZLI]),
      current_vision_position_embeddings: new ort.Tensor('float32', kod.pos2Tok, [SAM_TOKEN, 1, SAM_GIZLI]),
      spatial_memory: new ort.Tensor('float32', g.uzamsal, [g.uzamsalUzunluk, 1, SAM_MEM]),
      spatial_memory_position_embeddings: new ort.Tensor('float32', g.uzamsalKonum, [g.uzamsalUzunluk, 1, SAM_MEM]),
      pointer_memory: new ort.Tensor('float32', g.isaretci, [g.isaretciUzunluk, 1, SAM_MEM]),
      pointer_memory_position_embeddings: new ort.Tensor('float32', g.isaretciKonum, [g.isaretciUzunluk, 1, SAM_MEM]),
    }));
    const kosullu = r.conditioned_features.data as Float32Array;
    if (kosullu.length !== SAM_TOKEN * SAM_GIZLI) throw new Error(`SAM memory_attention çıktısı beklenmeyen: ${r.conditioned_features.dims.join('x')}`);
    const d = await this.cozucu(kod, kanallara(kosullu, SAM_GIZLI, SAM_TOKEN), [0, 0], [-1]);
    await this.bellegeYaz(kod, d.logit, d.skor, d.isaretci, false);
    const olasilik = new Float32Array(d.logit.length);
    // Nesne yok derse maske boş (upstream: skor ≤ 0 → maske logit'i -1024).
    if (d.skor > 0) for (let i = 0; i < olasilik.length; i++) olasilik[i] = sigmoid(d.logit[i]);
    return { olasilik, nesneSkoru: d.skor, sureMs: performance.now() - t0 };
  }
}

/** segmentForeground sözleşmesi: kaynağın 1024'e sığan boyutu (letterbox iç dikdörtgeni). */
export function sigdir(w: number, h: number): { w: number; h: number } {
  const s = Math.min(SAM_BOYUT / w, SAM_BOYUT / h);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Çapa: ayırıcının ham maskesi (kaynak oranlı ızgara) → SAM'in esnetilmiş 1024² ızgarası. */
export function samIzgarasina(ham: Float32Array, w: number, h: number): Float32Array {
  return w === SAM_BOYUT && h === SAM_BOYUT ? ham : resampleBilinear(ham, w, h, SAM_BOYUT, SAM_BOYUT);
}

/**
 * SAM olasılığı → segmentForeground ile AYNI sözleşme ve son işlem (ana bileşenler +
 * genişletme + tüy), kaynak oranlı ızgarada. `ham` çapa/kontrol için genişletilmemiş hali.
 */
export function samMaskesi(olasilik: Float32Array, kaynakW: number, kaynakH: number) {
  const { w, h } = sigdir(kaynakW, kaynakH);
  const r = resampleBilinear(olasilik, SAM_BOYUT, SAM_BOYUT, w, h);
  for (let i = 0; i < r.length; i++) r[i] = Math.min(1, Math.max(0, r[i]));
  const ham = keepMainComponents(r, w, h);
  return { mask: dilateAndFeatherMask(ham, w, h), ham, width: w, height: h };
}
