// `?videoMaske=sam` DENETLEYİCİSİ (saf; modeller enjekte edilir → Node'da test edilir:
// scripts/verify-sam-video-maske.mjs). Uygulama (App.tsx) ve ölçüm (maskeSayfasi.ts) AYNI
// kararı kullanır: ilk kare / sahne kesimi / istek → IS-Net çapası; arada SAM izler;
// sıçrama ya da periyodik IS-Net kontrolü uyuşmazsa aynı karede yeniden çapa.
// Model hatası YUTULMAZ: fırlar, çağıran IS-Net yoluna döner ve loglar.
import { ISNET_IOU_ESIGI, maskeOzeti, yenidenCapaMi, type MaskeOzeti } from './samBellek.ts';

export const samVideoIstendi = (search: string) => new URLSearchParams(search).get('videoMaske') === 'sam';

/** Her bu kadar SAM karesinde bir taze IS-Net ile IoU kontrolü (ölçüm: maske-olcumu.md). */
export const SAM_KONTROL_KARE = 15;
/** App.tsx IS-Net video maskesiyle aynı geçerlilik aralığı. */
const MIN_KAPSAMA = 0.08;
const MAX_KAPSAMA = 0.92;

export interface MaskeSonucu { mask: Float32Array; ham: Float32Array; width: number; height: number }
interface SamCikti { olasilik: Float32Array; nesneSkoru: number }
export interface SamIzleyiciArayuzu<K> {
  capaGerekli(): boolean;
  sifirla(): void;
  kodla(kaynak: never): Promise<K>;
  /** Kodun GPU tamponlarını bırakır (her adımın sonunda, hatada da). */
  birak?(kod: K): void;
  capa(kod: K, maske1024: Float32Array, yeniden?: boolean): Promise<SamCikti>;
  izle(kod: K): Promise<SamCikti>;
}
export interface SamBagimliliklar<S, K> {
  /** Kontrol (ve varsayılan çapa) ayırıcısı: IS-Net (segmentForeground). */
  segment(kaynak: S): Promise<MaskeSonucu>;
  /** Çapa ayırıcısı farklıysa (ör. fotoğraf yolu / BiRefNet). */
  capaSegment?(kaynak: S): Promise<MaskeSonucu>;
  izleyici(): Promise<SamIzleyiciArayuzu<K>>;
  /** Ayırıcının ham maskesi → SAM 1024² ızgarası (samIzgarasina). */
  izgaraya(ham: Float32Array, w: number, h: number): Float32Array;
  /** SAM olasılığı → ayırıcıyla aynı sözleşme (samMaskesi). */
  maskeye(olasilik: Float32Array, w: number, h: number): MaskeSonucu;
}
/** iouEsigi: kontrol karesinde IS-Net ile IoU bunun altındaysa yeniden çapa. */
export interface SamSecenek { her?: number; kontrol?: number; sicrama?: boolean; iouEsigi?: number }
export type SamAdimi = MaskeSonucu & { sebep: string | null };

function kapsama(m: Float32Array): number {
  let n = 0;
  for (let i = 0; i < m.length; i++) if (m[i] >= 0.5) n++;
  return n / m.length;
}

function iou(a: Float32Array, b: Float32Array): number {
  let kes = 0, bir = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] >= 0.5, y = b[i] >= 0.5;
    if (x && y) kes++;
    if (x || y) bir++;
  }
  return bir === 0 ? 1 : kes / bir;
}

export class SamVideoMaskesi<S, K> {
  private readonly d: SamBagimliliklar<S, K>;
  private readonly s: Required<SamSecenek>;
  private z: SamIzleyiciArayuzu<K> | null = null;
  private kare = -1;
  private onceki: MaskeOzeti | null = null;
  private istek = false;

  constructor(d: SamBagimliliklar<S, K>, s: SamSecenek = {}) {
    this.d = d;
    this.s = { her: s.her ?? 0, kontrol: s.kontrol ?? SAM_KONTROL_KARE, sicrama: s.sicrama ?? true, iouEsigi: s.iouEsigi ?? ISNET_IOU_ESIGI };
  }

  /** Seek / kaynak değişimi = sahne kesimi: bellek atılır, sonraki kare çapa. */
  sifirla(): void { this.z?.sifirla(); this.kare = -1; this.onceki = null; this.istek = false; }
  /** Dış tetik (ör. ölçülen derinlik kayması): sonraki kare yeniden çapa. */
  capaIste(): void { this.istek = true; }

  /**
   * Bir kare. null: güvenilir maske yok (çapa geçersiz) — çağıran maskeyi kaldırır,
   * sonraki karede yeniden dener. Fırlatırsa: SAM kullanılamıyor.
   */
  async adim(kaynak: S, w: number, h: number): Promise<SamAdimi | null> {
    const z = this.z ??= await this.d.izleyici();
    const kod = await z.kodla(kaynak as never);
    try {
      return await this.adimKodla(z, kod, kaynak, w, h);
    } finally {
      z.birak?.(kod);
    }
  }

  private async adimKodla(z: SamIzleyiciArayuzu<K>, kod: K, kaynak: S, w: number, h: number): Promise<SamAdimi | null> {
    this.kare++;
    const capaYap = async (sebep: string, yeniden: boolean, hazir?: MaskeSonucu): Promise<SamAdimi | null> => {
      const s = hazir ?? await (this.d.capaSegment ?? this.d.segment)(kaynak);
      const k = kapsama(s.mask);
      if (k < MIN_KAPSAMA || k >= MAX_KAPSAMA) return null;
      await z.capa(kod, this.d.izgaraya(s.ham, s.width, s.height), yeniden);
      this.onceki = maskeOzeti(s.ham, s.width, s.height, 10);
      return { ...s, sebep };
    };
    if (z.capaGerekli()) {
      const r = await capaYap('ilk', false);
      if (!r) this.kare = -1; // çapa tutmadı: sayaç baştan
      return r;
    }
    if (this.istek || (this.s.her > 0 && this.kare % this.s.her === 0)) {
      const sebep = this.istek ? 'istek' : 'her';
      this.istek = false;
      const r = await capaYap(sebep, false);
      if (r) return r;
      // Çapa geçersizse izlemeye devam (eski bellek hâlâ en iyi tahmin).
    }
    const r = await z.izle(kod);
    const o = this.d.maskeye(r.olasilik, w, h);
    let kontrol: MaskeSonucu | undefined, uyum: number | undefined;
    if (this.s.kontrol > 0 && this.kare % this.s.kontrol === 0) {
      kontrol = await this.d.segment(kaynak);
      uyum = iou(o.ham, kontrol.ham);
    }
    const su = maskeOzeti(o.ham, o.width, o.height, r.nesneSkoru);
    const sebep = this.s.sicrama ? yenidenCapaMi(su, this.onceki, uyum, this.s.iouEsigi)
      : uyum != null ? yenidenCapaMi({ ...su, nesneSkoru: 1, alan: 1 }, null, uyum, this.s.iouEsigi) : null;
    if (sebep) {
      // Kontrol ayırıcısı çapa ayırıcısıyla aynıysa taze sonucu yeniden kullan.
      const c = await capaYap(sebep, true, this.d.capaSegment ? undefined : kontrol);
      if (c) return c;
      if (su.alan <= 0) return null;
    }
    this.onceki = su;
    return { ...o, sebep: null };
  }
}
