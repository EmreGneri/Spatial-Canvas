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
 * IBM PLEX — teknik arayüzler için çizilmiş, hümanist detaylı bir grotesk.
 *
 * NEDEN SİSTEM FONTU DEĞİL: sistem yığını bir karar değil, kararın
 * yokluğuydu — üretilmiş her koyu panelin dizgisi. Plex’in kendi karakteri
 * var ama dikkat çekmez; ekrandaki tek gösterili şey render olsun diye.
 *
 * YERELDEN SUNULUYOR (`public/fonts`, 230 KB). Google CDN kullanılmıyor:
 * sunum salonunda internet olmayabilir ve font gelmezse arayüz sessizce
 * sistem fontuna düşer. **latin-ext ŞART** — Türkçe ğ ş ı İ o alt kümede.
 */
export const SANS =
  '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
export const MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Consolas, monospace';

/**
 * KARANLIK ODA. İkinci eleştiri turu (2026-10-23) paletin hâlâ "AI”
 * durduğunu söyledi; sebep mor gradyan değildi, şuydu:
 *
 *  1. DURUM RENKLERİ TAILWIND VARSAYILANIYDI — #4ade80/#eab308/#f87171
 *     sırasıyla green-400/yellow-500/red-400. Seçilmemiş, miras alınmış.
 *  2. VURGU SAAS MAVİSİYDİ. Daha kötüsü: ekranda render edilen özne
 *     sıcak kehribar/kemik — arayüz, içeriğin tam KARŞITINI vurgu
 *     yapıyordu. İki ayrı dünya tek ekranda.
 *  3. YÜZEY MERDİVENİ MAVİ-GRİYDİ — her üretilmiş panelin rengi.
 *
 * Palet artık bir yerden geliyor: KARANLIK ODA. Güvenlik lambasının
 * kehribarı, film tabanının sıcak siyahı, alçı/kemik beyazı (zaten
 * ekrandaki büstün rengi), anotlanmış objektif grisi, pirinç ölçek
 * kadranı. Yüzeyler nötr-sıcak grafit; ekrandaki tek DOYGUN şey işin
 * kendisi kalıyor.
 *
 * Kontrastlar ölçüldü (WCAG, zemin üstünde): metin 16.8, solgun 7.9,
 * silik 5.9 — üçü de eski değerlerin üzerinde.
 */
export const renk = {
  /** Sayfanın en altı — film tabanının sıcak siyahı, mavi değil. */
  zemin: '#0b0a09',
  /** Yüzey basamakları (kart, panel, kutu) — anotlanmış grafit. */
  yuzey1: '#141311',
  yuzey2: '#1c1a18',
  yuzey3: '#242120',
  /** Kenarlar: renk değil, ışık. Çok düşük kontrast. */
  kenar: 'rgba(255,255,255,0.07)',
  kenarGuclu: 'rgba(255,255,255,0.13)',

  /** Kemik beyazı — ölçüldü 16.8:1. */
  metin: '#f0ece6',
  /** Ölçüldü: 7.9:1 — gövde metni için rahat. */
  metinSolgun: '#a9a39a',
  /** Ölçüldü: zeminde 5.9, en açık yüzeyde 4.7 — ikisi de AA. */
  metinSilik: '#918b82',

  /** TEK vurgu: karanlık oda güvenlik lambası. Render’ın kendi sıcaklığı. */
  vurgu: '#d9873f',
  vurguSakin: 'rgba(217,135,63,0.15)',

  /** Durum renkleri boyalı alet paneli ailesinden; Tailwind değil. */
  iyi: '#7fa263',
  uyari: '#c9a227',
  kotu: '#d2694f',
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
  bilgi: 'rgba(217,135,63,0.32)',
  iyi: 'rgba(127,162,99,0.34)',
  uyari: 'rgba(201,162,39,0.38)',
  kotu: 'rgba(210,105,79,0.38)',
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
    background: 'rgba(20,19,17,0.74)',
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
    borderColor: etkin ? 'rgba(217,135,63,0.45)' : renk.kenar,
    background: etkin ? renk.vurguSakin : renk.yuzey2,
    color: etkin ? '#f5d8b4' : renk.metin,
    cursor: 'pointer',
    transition: 'background 120ms ease, border-color 120ms ease',
  };
}

/**
 * BİRİNCİL EYLEM — ekranda EN FAZLA BİR TANE.
 *
 * NEDEN: ilk ekranda 22 birincil kontrol vardı ve hepsi aynı ağırlıktaydı;
 * ziyaretçi "ne yapacağını bilemedi" (hoca geri bildirimi, 2026-10-23).
 * Bir arayüzün ilk hamleyi söylemesinin yolu, o hamleyi tek DOLGU yapmak.
 * İkinci bir dolgu düğme eklenirse ikisi de birincil olmaktan çıkar.
 *
 * Metin kehribar üzerinde ölçüldü: 6.6:1.
 */
export function birincilDugme(): CSSProperties {
  return {
    ...dugme(false),
    fontWeight: 600,
    background: renk.vurgu,
    borderColor: renk.vurgu,
    color: '#1a1206',
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
