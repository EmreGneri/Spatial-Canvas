// SAM 2.1 VİDEO BELLEK BANKASI (saf JS, ORT yok). `jax-image-tools/sam21-tiny-video-onnx`
// grafikleri bankayı TAŞIMAZ: upstream'de tamsayı kare indeksli sözlüklerdir. Bu dosya
// `SAM2Base._prepare_memory_conditioned_features`'ın ileri izleme kolunu birebir izler:
//   uzamsal bellek = seçili koşul (çapa) kareleri (t_pos 0) + önceki 6 kare (t_pos 1..6);
//     her bloğun konumuna maskmem_tpos_enc[7 - t_pos - 1] eklenir.
//   işaretçiler   = koşul kareleri (pos = kare - t) + önceki 15 kare (pos = t_diff);
//     konum = Linear(sinusPe(pos / 15, 256)) → 64; her 256'lık işaretçi 4 × 64 token.
// Test: scripts/verify-sam-bellek.mjs.

export const SAM_TOKEN = 4096; // 64×64 uzamsal token / blok
export const SAM_MEM = 64;
export const SAM_GIZLI = 256;
const NUM_MASKMEM = 7;
const MAX_ISARETCI = 16;
/** Ek ağırlık dosyası (scripts/sam21-ekler.mjs): tpos 7×64 | noMem 256 | projW 64×256 | projB 64. */
export const EKLER_BAYT = (7 * 64 + 256 + 64 * 256 + 64) * 4;

export interface SamEkler { tpos: Float32Array; noMem: Float32Array; projW: Float32Array; projB: Float32Array }

export function ekleriAyristir(buf: ArrayBuffer): SamEkler {
  if (buf.byteLength !== EKLER_BAYT) throw new Error(`sam21-ekler: ${buf.byteLength} bayt, beklenen ${EKLER_BAYT}`);
  const f = new Float32Array(buf);
  let o = 0;
  const al = (n: number) => f.subarray(o, (o += n));
  return { tpos: al(7 * 64), noMem: al(256), projW: al(64 * 256), projB: al(64) };
}

/** upstream `get_1d_sine_pe(pos, dim, temperature=10000)`. */
export function sinusPe(pos: number, dim: number): Float32Array {
  const yari = dim / 2;
  const o = new Float32Array(dim);
  for (let i = 0; i < yari; i++) {
    const a = pos / 10000 ** ((2 * Math.floor(i / 2)) / yari);
    o[i] = Math.sin(a);
    o[yari + i] = Math.cos(a);
  }
  return o;
}

export interface BellekKaydi {
  kare: number;
  /** Çapa (koşul) karesi mi: maske dışarıdan verildi. */
  kosul: boolean;
  /** memory_encoder `memory_tokens` [4096,1,64]. */
  ozellik: Float32Array;
  /** memory_encoder `memory_pos_enc` [4096,1,64] (tpos eklenmemiş). */
  konum: Float32Array;
  /** mask_decoder `object_pointer` [256]. */
  isaretci: Float32Array;
}

export interface BellekGirdisi {
  uzamsal: Float32Array; uzamsalKonum: Float32Array; uzamsalUzunluk: number;
  isaretci: Float32Array; isaretciKonum: Float32Array; isaretciUzunluk: number;
}

export class SamBellek {
  private kosullar: BellekKaydi[] = [];
  private kareler = new Map<number, BellekKaydi>();
  private readonly maxKosul: number;
  private readonly ek: SamEkler;

  /**
   * `maxKosul`: tutulan en çok çapa karesi. Upstream varsayılanı sınırsız (-1);
   * akışta çapalar birikir ve her blok 4096 token ekler.
   * ponytail: en yeni N çapa; upstream'in "en yakın önce/sonra" seçimi ileri izlemede aynı sonucu verir.
   */
  constructor(ek: SamEkler, { maxKosul = 4 }: { maxKosul?: number } = {}) {
    this.ek = ek;
    this.maxKosul = maxKosul;
  }

  bos(): boolean { return this.kosullar.length === 0; }
  kayitSayisi(): number { return this.kosullar.length + this.kareler.size; }
  sifirla(): void { this.kosullar = []; this.kareler.clear(); }
  /** Yeniden çapa: izlenen (koşulsuz) kareler şüpheli, atılır; eski çapalar kalır. */
  kosulsuzlariSil(): void { this.kareler.clear(); }

  ekle(k: BellekKaydi): void {
    if (k.kosul) {
      this.kosullar.push(k);
      if (this.kosullar.length > this.maxKosul) this.kosullar.shift();
    } else this.kareler.set(k.kare, k);
    // İşaretçiler 15 kare geriye bakar; uzamsal bellek 6. Daha eskisi hiç okunmaz.
    for (const t of this.kareler.keys()) if (t <= k.kare - MAX_ISARETCI) this.kareler.delete(t);
  }

  /** `kare` için memory_attention girdileri (koşul karesi yoksa çağrılmamalı). */
  girdi(kare: number): BellekGirdisi {
    const kosul = this.kosullar.filter((c) => c.kare <= kare);
    const kosulKare = new Set(kosul.map((c) => c.kare));
    const ara = (t: number) => (kosulKare.has(t) ? undefined : this.kareler.get(t));

    const bloklar: { k: BellekKaydi; tpos: number }[] = kosul.map((k) => ({ k, tpos: NUM_MASKMEM - 1 }));
    for (let tPos = 1; tPos < NUM_MASKMEM; tPos++) {
      const k = ara(kare - (NUM_MASKMEM - tPos));
      if (k) bloklar.push({ k, tpos: NUM_MASKMEM - tPos - 1 });
    }
    const blok = SAM_TOKEN * SAM_MEM;
    const uzamsal = new Float32Array(bloklar.length * blok);
    const uzamsalKonum = new Float32Array(bloklar.length * blok);
    bloklar.forEach(({ k, tpos }, i) => {
      uzamsal.set(k.ozellik, i * blok);
      const tp = this.ek.tpos.subarray(tpos * SAM_MEM, (tpos + 1) * SAM_MEM);
      const hedef = uzamsalKonum.subarray(i * blok, (i + 1) * blok);
      for (let t = 0; t < SAM_TOKEN; t++) {
        for (let c = 0; c < SAM_MEM; c++) hedef[t * SAM_MEM + c] = k.konum[t * SAM_MEM + c] + tp[c];
      }
    });

    const isaretler: { pos: number; p: Float32Array }[] = kosul.map((k) => ({ pos: kare - k.kare, p: k.isaretci }));
    for (let d = 1; d < MAX_ISARETCI; d++) {
      const k = ara(kare - d);
      if (k) isaretler.push({ pos: d, p: k.isaretci });
    }
    const parca = SAM_GIZLI / SAM_MEM; // 4
    const isaretci = new Float32Array(isaretler.length * parca * SAM_MEM);
    const isaretciKonum = new Float32Array(isaretci.length);
    isaretler.forEach(({ pos, p }, i) => {
      const pe = sinusPe(pos / (MAX_ISARETCI - 1), SAM_GIZLI);
      const proj = new Float32Array(SAM_MEM);
      for (let o = 0; o < SAM_MEM; o++) {
        let s = this.ek.projB[o];
        const w = o * SAM_GIZLI;
        for (let j = 0; j < SAM_GIZLI; j++) s += this.ek.projW[w + j] * pe[j];
        proj[o] = s;
      }
      for (let k = 0; k < parca; k++) {
        const tok = (i * parca + k) * SAM_MEM;
        isaretci.set(p.subarray(k * SAM_MEM, (k + 1) * SAM_MEM), tok);
        isaretciKonum.set(proj, tok);
      }
    });
    return {
      uzamsal, uzamsalKonum, uzamsalUzunluk: bloklar.length * SAM_TOKEN,
      isaretci, isaretciKonum, isaretciUzunluk: isaretler.length * parca,
    };
  }
}

/** Bir maskenin özeti: yeniden çapa kararı bu sayılarla verilir. */
export interface MaskeOzeti { nesneSkoru: number; alan: number; merkezX: number; merkezY: number }

/** Alan bu oranın dışına çıkarsa (×1,8 / ÷1,8) izleme şüpheli. */
const ALAN_SICRAMA = 1.8;
/** Ağırlık merkezi (normalize koordinat) bu kadar kayarsa şüpheli. */
const MERKEZ_SICRAMA = 0.2;
/** Taze IS-Net maskesiyle IoU bunun altındaysa yeniden çapa. */
export const ISNET_IOU_ESIGI = 0.5;

export type CapaSebebi = 'nesne-kayboldu' | 'alan-sicradi' | 'merkez-sicradi' | 'isnet-uyusmuyor';

/** `isnetIoU`: o karede taze IS-Net maskesiyle IoU (kontrol karesi değilse verilmez). */
export function yenidenCapaMi(su: MaskeOzeti, onceki: MaskeOzeti | null, isnetIoU?: number, iouEsigi = ISNET_IOU_ESIGI): CapaSebebi | null {
  if (!(su.nesneSkoru > 0) || su.alan <= 0) return 'nesne-kayboldu';
  if (onceki && onceki.alan > 0) {
    const r = su.alan / onceki.alan;
    if (r > ALAN_SICRAMA || r < 1 / ALAN_SICRAMA) return 'alan-sicradi';
    if (Math.hypot(su.merkezX - onceki.merkezX, su.merkezY - onceki.merkezY) > MERKEZ_SICRAMA) return 'merkez-sicradi';
  }
  if (isnetIoU != null && isnetIoU < iouEsigi) return 'isnet-uyusmuyor';
  return null;
}

/** Olasılık/logit maskesinden özet (eşik: logit 0 ≡ olasılık 0,5 — çağıran uygun eşiği verir). */
export function maskeOzeti(m: ArrayLike<number>, w: number, h: number, nesneSkoru: number, esik = 0.5): MaskeOzeti {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (m[y * w + x] >= esik) { n++; sx += x; sy += y; }
  }
  return { nesneSkoru, alan: n / (w * h), merkezX: n ? sx / n / w : 0.5, merkezY: n ? sy / n / h : 0.5 };
}
