import type { CSSProperties } from 'react';

/**
 * ARAYÜZ TEMASI — tek kaynak (Zeynep).
 *
 * Eski arayüz "koyu terminal" diliydi: monospace her yerde, düz kutular, sağda
 * sonu gelmeyen bir slider listesi. Yeni yön modern cam (glassmorphism 2.0) ve
 * bento kart düzeni: yarı saydam yüzeyler, arkayı bulanıklaştıran katman, ince
 * açık kenar, yumuşak gölge.
 *
 * KULLANIM KURALI (araştırmadan çıkan tek cümle): cam YÜZEYLERDE kullanılır,
 * metinde değil. Panel/kart/çubuk cam olur; okunması gereken metin ve sayı düz
 * ve yüksek kontrastlı kalır.
 *
 * Tipografi: arayüz metni sistem sans-serif (modern), ÖLÇÜLEN DEĞERLER
 * monospace + tabular-nums (rakamlar zıplamasın — sayılar sürekli değişiyor).
 */

export const SANS =
  '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, system-ui, sans-serif';
export const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';

export const renk = {
  /** Sahne arkası — camın altında görünen derinlik. */
  zemin: '#07070b',
  metin: '#e8e9ef',
  metinSolgun: '#9aa0b4',
  metinSilik: '#6b7185',
  /** Vurgu: canlı ama tek — her yerde aynı mavi. */
  vurgu: '#5b9cff',
  vurguSicak: '#ff6b4a',
  iyi: '#3ddc84',
  uyari: '#f0b429',
  kotu: '#ff5d5d',
} as const;

/**
 * Cam yüzey. `blur` arkadaki sahneyi bulanıklaştırır; `saturate` camın altında
 * kalan rengi canlı tutar (yoksa gri bir sis olur).
 */
export function cam(opts: { yogunluk?: number; blur?: number; radius?: number } = {}): CSSProperties {
  const { yogunluk = 0.06, blur = 18, radius = 14 } = opts;
  return {
    background: `linear-gradient(160deg, rgba(255,255,255,${yogunluk + 0.03}), rgba(255,255,255,${yogunluk * 0.4}))`,
    backdropFilter: `blur(${blur}px) saturate(160%)`,
    WebkitBackdropFilter: `blur(${blur}px) saturate(160%)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius,
    boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.10)',
    color: renk.metin,
  };
}

/** Cam üstünde duran düğme. Etkin hâli vurgu rengiyle doldurulur. */
export function camDugme(etkin = false): CSSProperties {
  return {
    fontFamily: SANS,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: 0.2,
    padding: '6px 12px',
    borderRadius: 9,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: etkin ? 'rgba(91,156,255,0.55)' : 'rgba(255,255,255,0.14)',
    background: etkin
      ? 'linear-gradient(180deg, rgba(91,156,255,0.35), rgba(91,156,255,0.18))'
      : 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))',
    color: etkin ? '#eaf2ff' : renk.metin,
    cursor: 'pointer',
    transition: 'background 140ms ease, border-color 140ms ease, transform 100ms ease',
  };
}

/** Kartın/pass'in açık olduğunu gösteren nokta (referans arayüzdeki LED). */
export function led(acik: boolean, renkAcik: string = renk.iyi): CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: acik ? renkAcik : 'rgba(255,255,255,0.16)',
    boxShadow: acik ? `0 0 10px ${renkAcik}` : 'none',
    flex: '0 0 auto',
    transition: 'background 140ms ease, box-shadow 140ms ease',
  };
}

/** Ölçülen sayı: rakam genişliği sabit, okunur. */
export const sayi: CSSProperties = {
  fontFamily: MONO,
  fontVariantNumeric: 'tabular-nums',
  fontSize: 11,
  color: renk.metinSolgun,
};
