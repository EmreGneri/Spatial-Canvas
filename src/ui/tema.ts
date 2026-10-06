import type { CSSProperties } from 'react';

/**
 * ARAYÜZ TEMASI — tek kaynak (Zeynep).
 *
 * ── İLK TURDAN ÇIKAN DERS (eleştiri, 2026-09-25) ──────────────────────────
 * İlk cam denemesi "AI üretimi" gibi duruyordu. Sebepleri ölçüldü ve üçü de
 * burada kapatıldı:
 *
 *  1. MOR-MAVİ GRADYAN. En bilinen "yapay arayüz" imzası. Palet tek eksene
 *     indirildi: siyah → gri → koyu mavi. Mor yok, ikinci vurgu rengi yok.
 *  2. HER YÜZEY CAMDI (panel, kart, şerit, log kutusu). Premium his malzeme
 *     çeşidinden değil TUTARLILIKTAN gelir: cam yalnız ÜSTTE YÜZEN iki
 *     yüzeyde (üst şerit, raf gövdesi); kartlar ve kutular düz koyu yüzey.
 *  3. ÜÇ AYRI IŞIK (slider glow + LED glow + toggle glow). Işık artık tek
 *     yerde: etkin LED. Kontroller ışımaz.
 *
 * Ölçülen erişilebilirlik düzeltmeleri: solgun metin kontrastı 4.0 → 5.6
 * (WCAG AA sınırı 4.5), kontrol yüksekliği 24-28 → 32 px, kutucuk 15 → 18 px.
 */

/**
 * SİSTEM YIĞINI. "Inter" BİLEREK YOK: yığında `-apple-system`'den sonra
 * duruyordu, yani macOS'ta hiç render edilmiyordu — işe yaramayan ama
 * "her AI arayüzünde Inter var" izlenimi veren bir kalıntıydı. Sistem fontu
 * kullanıcının kendi arayüzüyle aynı ritmi tutar; yüklenecek dosya da yok.
 */
export const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif';
export const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';

/**
 * TEK EKSEN: siyah → gri → koyu mavi. Her yüzey bu merdivenin bir basamağı;
 * "biraz mor", "biraz teal" yok. Vurgu da aynı ailenin canlı ucu.
 */
export const renk = {
  /** Sayfanın en altı — sahnenin siyahıyla aynı aile. */
  zemin: '#0a0c10',
  /** Yüzey basamakları (kart, panel, kutu). */
  yuzey1: '#12151c',
  yuzey2: '#171b24',
  yuzey3: '#1d222d',
  /** Kenarlar: renk değil, ışık. Çok düşük kontrast. */
  kenar: 'rgba(255,255,255,0.07)',
  kenarGuclu: 'rgba(255,255,255,0.13)',

  metin: '#e9ecf2',
  /** Ölçüldü: zeminde 7.4:1 — gövde metni için rahat. */
  metinSolgun: '#9aa3b5',
  /** Ölçüldü: 5.6:1 — eski #6b7185 (4.0) AA sınırının altındaydı. */
  metinSilik: '#7d8697',

  /** Tek vurgu: koyu mavinin canlı ucu. */
  vurgu: '#4d8dff',
  vurguSakin: 'rgba(77,141,255,0.16)',

  iyi: '#4ade80',
  uyari: '#eab308',
  kotu: '#f87171',
} as const;

/**
 * ANLAM TAŞIYAN KENARLAR. Nötr kenar renk DEĞİL ışıktır (`kenar`); ama bir
 * kutu UYARI ya da HATA taşıyorsa kenarın da bunu söylemesi gerekir.
 *
 * Bu jetonlar olmadığı için yedi ayrı yerde elle hex yazılmıştı (`#6b4a12`,
 * `#4a3a12`, `#2a3a4a`, `#3a3a46`) — hepsi birbirine yakın ama hiçbiri aynı,
 * ve hiçbiri paletten türemiyordu. Durum rengi + düşük alfa: kenar her zaman
 * kendi durumunun rengidir, ayrı bir koyu ton icat edilmez.
 */
export const kenarDurum = {
  bilgi: 'rgba(77,141,255,0.32)',
  iyi: 'rgba(74,222,128,0.32)',
  uyari: 'rgba(234,179,8,0.38)',
  kotu: 'rgba(248,113,113,0.38)',
} as const;

/** ÜÇ KADEME yarıçap — ölçümde 6 farklı değer çıkmıştı, tutarsızdı. */
export const yaricap = { kontrol: 6, kart: 10, panel: 14 } as const;

/** BOŞLUK 4'ün katları — ritim buradan gelir. */
export const bosluk = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const;

/** TİPOGRAFİ ÖLÇEĞİ — tek düzlem yerine net kademeler. */
export const yazi = {
  kucuk: 11,
  govde: 12,
  orta: 13,
  baslik: 15,
  buyuk: 18,
} as const;

/**
 * CAM — yalnız ÜSTTE YÜZEN yüzeylerde (üst şerit, raf gövdesi). İçerik
 * kartları bunu KULLANMAZ; onlar `yuzey()` ile düz durur.
 */
export function cam(opts: { blur?: number; radius?: number } = {}): CSSProperties {
  const { blur = 24, radius = yaricap.panel } = opts;
  return {
    background: 'rgba(18,21,28,0.72)',
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: renk.kenar,
    borderRadius: radius,
    boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
    color: renk.metin,
  };
}

/** Düz koyu yüzey — kart, kutu, liste. Gradyan ve bulanıklık YOK. */
export function yuzey(kademe: 1 | 2 | 3 = 1, radius: number = yaricap.kart): CSSProperties {
  return {
    background: kademe === 1 ? renk.yuzey1 : kademe === 2 ? renk.yuzey2 : renk.yuzey3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: renk.kenar,
    borderRadius: radius,
    color: renk.metin,
  };
}

/**
 * Düğme. Etkin hâli DOLGU ile ayrışır, ışımayla değil — ekranda aynı anda
 * birden çok ışık kaynağı olması "efekt gösterisi" hissi veriyordu.
 */
export function dugme(etkin = false): CSSProperties {
  return {
    fontFamily: SANS,
    fontSize: yazi.govde,
    fontWeight: 500,
    lineHeight: 1,
    minHeight: 32,
    padding: '8px 12px',
    borderRadius: yaricap.kontrol,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: etkin ? 'rgba(77,141,255,0.45)' : renk.kenar,
    background: etkin ? renk.vurguSakin : renk.yuzey2,
    color: etkin ? '#dce9ff' : renk.metin,
    cursor: 'pointer',
    transition: 'background 120ms ease, border-color 120ms ease',
  };
}

/** Tek ışık kaynağı: etkin LED. Kontroller ışımaz. */
export function led(acik: boolean, renkAcik: string = renk.iyi): CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: acik ? renkAcik : 'rgba(255,255,255,0.18)',
    boxShadow: acik ? `0 0 8px ${renkAcik}99` : 'none',
    flex: '0 0 auto',
  };
}

/** Ölçülen sayı: rakam genişliği sabit (değerler sürekli değişiyor). */
export const sayi: CSSProperties = {
  fontFamily: MONO,
  fontVariantNumeric: 'tabular-nums',
  fontSize: yazi.kucuk,
  color: renk.metinSolgun,
};
