/**
 * AÇILIŞ SAHNESİ — çizimi ve derinliği TEK tanımdan türeyen örnek sahne.
 * DOM'suz, Node'dan test edilir.
 *
 * ── NEDEN ──────────────────────────────────────────────────────────────────
 * Ölçüldü (2026-10-23, dev sunucu): sayfa ilk açılışta 181,9 MB çekiyordu;
 * production'da ~167 MB. Bunun 131,4 MB'ı model — 84 MB nesne ayırma (IS-Net)
 * + 47 MB derinlik. Ve hepsi ziyaretçi HİÇBİR ŞEY YAPMADAN iniyordu, çünkü
 * sunum modu açılışta boru hattının tamamını koşturuyordu.
 *
 * Daha kötüsü: örnek sahnede IS-Net'in sonucu zaten ATILIYOR ("maske kadrajın
 * yalnız %5'ini özne saydı; ayırma KAPALI başlatıldı"). 84 MB, "bunu
 * kullanmayalım" kararı vermek için iniyordu.
 *
 * ── ÇÖZÜM ──────────────────────────────────────────────────────────────────
 * Modeller yalnız BİR GÖRÜNTÜDEN DERİNLİK ÇIKARMAK için gerekli. Bu sahneyi
 * biz çiziyoruz; derinliği zaten biliyoruz. Analitik derinlikle açılış canlı,
 * etkileşimli ve altı render modunun hepsi çalışır hâlde gelir — sıfır model
 * baytıyla. İndirme ancak ziyaretçi KENDİ görüntüsünü yüklediğinde başlar.
 *
 * ── DÜRÜSTLÜK ──────────────────────────────────────────────────────────────
 * Bu sahnenin derinliği ÖLÇÜLMÜŞ değil, YAZILMIŞTIR. Projenin tezi ölçümün
 * sınırını söylemek olduğu için bu ekranda da açıkça yazılır (`ACILIS_NOTU`);
 * ziyaretçinin kendi görüntüsü gerçek boru hattından geçer. Analitik sahneyi
 * model çıktısıymış gibi sunmak, tam da eleştirdiğimiz şey olurdu.
 *
 * ── TEK TANIM ──────────────────────────────────────────────────────────────
 * Geometri burada bir kez durur; hem 2B çizim hem derinlik haritası bunu
 * okur. Eskiden sahne `App.syntheticImage()` içinde elle çiziliydi; ikinci
 * bir yere kopyalansaydı biri değişip diğeri kalırdı ve derinlik sahneyle
 * uyuşmazdı — ekranda "bina burada, hacim şurada" diye görünürdü.
 */

export const ACILIS_EN = 512;
export const ACILIS_BOY = 512;

/** Ufuk çizgisi: üstü gökyüzü, altı zemin. */
export const UFUK_Y = 380;

export const ACILIS_NOTU =
  'örnek sahne · derinliği yazıldı, ölçülmedi — kendi görüntün gerçek boru hattından geçer';

export interface Bina {
  /** Sol kenar (px). */
  x: number;
  en: number;
  boy: number;
  /** Çizim rengi. */
  renk: string;
  /** 0..1, 1 = yakın. Yüksek bina = daha yakın (perspektif). */
  derinlik: number;
}

/**
 * Dört bina. Derinlikler BOYLA tutarlı: aynı gerçek yükseklikteki binalardan
 * kadrajda daha uzun görüneni daha yakındır. Sıralama boy ile aynı yönde
 * olmazsa sahne içten dışa dönük görünür — `verify-acilis-sahnesi` bunu
 * ayrıca denetler.
 */
export const BINALAR: readonly Bina[] = [
  { x: 300, en: 60, boy: 120, renk: '#5a5a68', derinlik: 0.30 },
  { x: 40, en: 70, boy: 160, renk: '#5a5a68', derinlik: 0.38 },
  { x: 150, en: 90, boy: 240, renk: '#5a5a68', derinlik: 0.52 },
  { x: 400, en: 100, boy: 300, renk: '#5a5a68', derinlik: 0.62 },
] as const;

/** Kırmızı küre — sahnenin en yakın nesnesi, tek KAVİSLİ yüzey. */
export const KURE = {
  x: 256,
  y: 430,
  r: 60,
  renk: '#c94f4f',
  /** Merkez (kameraya en yakın nokta). */
  tepe: 0.95,
  /** Siluet kenarı — kürenin kavisi burada yüzeye teğet. */
  etek: 0.74,
} as const;

export const GOK = { ust: '#9dc3e6', alt: '#e8d9b0', derinlik: 0.04 } as const;
export const ZEMIN = { renk: '#3a3a44', ufukta: 0.16, onde: 0.58 } as const;

/**
 * Sahnenin derinlik haritası. Sözleşme `depth.ts` ile aynı:
 * **0..1 normalize, 0 = uzak, 1 = yakın, satır 0 görüntünün ÜSTÜ.**
 *
 * Çizim sırasıyla AYNI sırada yazılır (gök → zemin → binalar → küre), çünkü
 * sonra çizilen öncekini örter; derinlik de aynı örtmeyi uygulamalı.
 */
export function acilisDerinligi(en: number = ACILIS_EN, boy: number = ACILIS_BOY): Float32Array {
  const d = new Float32Array(en * boy);
  const sx = en / ACILIS_EN;
  const sy = boy / ACILIS_BOY;
  const ufuk = UFUK_Y * sy;

  for (let y = 0; y < boy; y++) {
    for (let x = 0; x < en; x++) {
      let deger: number;
      if (y < ufuk) {
        deger = GOK.derinlik;
      } else {
        // Zemin ufuktan öne doğru yaklaşır; alt kenar kameraya en yakın yer.
        const t = (y - ufuk) / Math.max(1, boy - ufuk);
        deger = ZEMIN.ufukta + (ZEMIN.onde - ZEMIN.ufukta) * t;
      }
      d[y * en + x] = deger;
    }
  }

  for (const b of BINALAR) {
    const x0 = Math.round(b.x * sx);
    const x1 = Math.round((b.x + b.en) * sx);
    const y0 = Math.round((UFUK_Y - b.boy) * sy);
    const y1 = Math.round(UFUK_Y * sy);
    for (let y = Math.max(0, y0); y < Math.min(boy, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(en, x1); x++) {
        d[y * en + x] = b.derinlik;
      }
    }
  }

  // Küre: düz bir disk DEĞİL. Yarıçapa göre kubbe (küresel kesit) verilir,
  // yoksa altı render modunun hiçbirinde eğrilik görünmez ve sahnede tek
  // kavisli yüzey kaybolur.
  const kx = KURE.x * sx;
  const ky = KURE.y * sy;
  const kr = KURE.r * ((sx + sy) / 2);
  const y0 = Math.max(0, Math.floor(ky - kr));
  const y1 = Math.min(boy, Math.ceil(ky + kr));
  for (let y = y0; y < y1; y++) {
    for (let x = Math.max(0, Math.floor(kx - kr)); x < Math.min(en, Math.ceil(kx + kr)); x++) {
      const dx = (x - kx) / kr;
      const dy = (y - ky) / kr;
      const r2 = dx * dx + dy * dy;
      if (r2 > 1) continue;
      d[y * en + x] = KURE.etek + (KURE.tepe - KURE.etek) * Math.sqrt(1 - r2);
    }
  }

  return d;
}
