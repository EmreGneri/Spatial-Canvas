/**
 * PRESET ÖNİZLEMELERİ — kütüphanenin kapakları.
 *
 * İKİ KAYNAK, SIRASIYLA:
 *  1. GERÇEK KARE. Preset uygulandığında sahnenin küçük bir kopyası alınır ve
 *     saklanır. Yani bir preset'i bir kez denediğinde kapağı kendiliğinden
 *     oluşur; "önizlemeleri üret" düğmesi de hepsini sırayla gezip aynı şeyi
 *     yapar (sonunda başlangıç durumu geri yüklenir).
 *  2. YER TUTUCU. Henüz denenmemiş preset için kapak UYDURULMAZ: preset'in
 *     KENDİ renk alanlarından türetilmiş sade bir gradyan çizilir ve kart
 *     üzerinde "önizleme yok" etiketi kalır. Sahte bir görüntüyü gerçekmiş
 *     gibi göstermek, projenin dürüstlük kuralına aykırı olurdu.
 *
 * Kapaklar localStorage'da JPEG dataURL olarak durur (PNG yerine JPEG: 26
 * kapak ~250 KB yerine ~60 KB tutuyor, kapak için kayıp önemsiz).
 */

const ANAHTAR = 'spatial-canvas.preset-onizleme.v2';

/**
 * KAPAKLAR KAYNAĞA BAĞLIDIR. Kapak "bu preset ŞU SAHNEDE böyle görünür"
 * demektir; sahne değişince eski kapak yalan söyler. Ölçüldü: sentetik
 * görselle üretilen 8 kapak, başka bir görsel yüklendikten sonra aynen
 * duruyordu ve yeni sahneyi hiç temsil etmiyordu.
 *
 * Kapaklar bu yüzden KAYNAK BAŞINA saklanır: kimlik değişince kütüphane yer
 * tutucuya döner, eski kaynağa dönülünce kapaklar geri gelir — silmek yerine
 * ayırmak, üretim emeğini çöpe atmaz (ölçüldü: tek dosyada saklarken geri
 * dönüşte 0 kapak kalıyordu).
 *
 * Son `KAYNAK_SINIRI` kaynak tutulur; en eski düşer. Her kaynak ~8 kapak ×
 * ~4,5 KB = ~36 KB, üç kaynak ~110 KB — localStorage kotası için rahat.
 */
const KAYNAK_SINIRI = 3;

interface KapakDosyasi {
  /** Kaynak kimliği → o kaynakta üretilmiş kapaklar. Sıra: eskiden yeniye. */
  kaynaklar: { kaynak: string; kapaklar: Kapaklar }[];
}

/** Şu anki kaynağın kimliği; App her yeni medyada günceller. */
let aktifKaynak = 'baslangic';
const dinleyiciler = new Set<() => void>();

export function kaynakBelirle(kimlik: string): void {
  if (kimlik === aktifKaynak) return;
  aktifKaynak = kimlik;
  // Kütüphane açıkken kaynak değişirse kapaklar ANINDA yer tutucuya dönmeli;
  // yoksa yeni sahnede eski kapaklar duruyormuş gibi görünür.
  for (const d of dinleyiciler) d();
}

/** Kütüphane paneli kaynak değişimini buradan duyar. */
export function kaynakDinle(geriCagri: () => void): () => void {
  dinleyiciler.add(geriCagri);
  return () => dinleyiciler.delete(geriCagri);
}
export const ONIZLEME_EN = 192;
export const ONIZLEME_BOY = 120;

type Kapaklar = Record<string, string>;

function dosyaOku(): KapakDosyasi {
  try {
    const ham = localStorage.getItem(ANAHTAR);
    if (!ham) return { kaynaklar: [] };
    const d = JSON.parse(ham) as KapakDosyasi;
    return Array.isArray(d.kaynaklar) ? d : { kaynaklar: [] };
  } catch {
    return { kaynaklar: [] };
  }
}

function dosyaYaz(dosya: KapakDosyasi): void {
  try {
    localStorage.setItem(ANAHTAR, JSON.stringify(dosya));
  } catch {
    // Kota dolduysa kapaklar kaybolur ama uygulama çalışmaya devam eder.
  }
}

/** YALNIZ aktif kaynağın kapakları — başka sahnenin kapağı gösterilmez. */
export function kapaklariOku(): Kapaklar {
  return dosyaOku().kaynaklar.find((k) => k.kaynak === aktifKaynak)?.kapaklar ?? {};
}

export function kapakYaz(ad: string, dataUrl: string): Kapaklar {
  const hepsi = { ...kapaklariOku(), [ad]: dataUrl };
  const dosya = dosyaOku();
  const kalan = dosya.kaynaklar.filter((k) => k.kaynak !== aktifKaynak);
  // Aktif kaynak sona gider (en yeni); sınırı aşan EN ESKİ düşer.
  dosyaYaz({ kaynaklar: [...kalan, { kaynak: aktifKaynak, kapaklar: hepsi }].slice(-KAYNAK_SINIRI) });
  return hepsi;
}

export function kapakSil(ad: string): Kapaklar {
  const hepsi = kapaklariOku();
  delete hepsi[ad];
  const dosya = dosyaOku();
  const kalan = dosya.kaynaklar.filter((k) => k.kaynak !== aktifKaynak);
  dosyaYaz({ kaynaklar: [...kalan, { kaynak: aktifKaynak, kapaklar: hepsi }].slice(-KAYNAK_SINIRI) });
  return hepsi;
}

/**
 * Sahnenin o anki karesinden kapak üretir. `renderFrame` ÇAĞRILMAK ZORUNDA:
 * WebGL çizim tamponu compositing sonrası geçersizdir, yakalamadan hemen önce
 * aynı görevde bir kare çizilmezse kapak boş çıkar (export.ts ile aynı kural).
 */
export function kapakUret(canvas: HTMLCanvasElement, renderFrame: () => void): string | null {
  try {
    renderFrame();
    const k = document.createElement('canvas');
    k.width = ONIZLEME_EN;
    k.height = ONIZLEME_BOY;
    const ctx = k.getContext('2d');
    if (!ctx) return null;
    // Sahnenin ortasından oranı bozmadan kırp (kapakta kenar boşluğu değil
    // konu görünsün).
    const kaynakOran = canvas.width / canvas.height;
    const hedefOran = ONIZLEME_EN / ONIZLEME_BOY;
    let sx = 0;
    let sy = 0;
    let sw = canvas.width;
    let sh = canvas.height;
    if (kaynakOran > hedefOran) {
      sw = canvas.height * hedefOran;
      sx = (canvas.width - sw) / 2;
    } else {
      sh = canvas.width / hedefOran;
      sy = (canvas.height - sh) / 2;
    }
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, ONIZLEME_EN, ONIZLEME_BOY);
    return k.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

/**
 * Yer tutucu: preset'in kendi renklerinden iki durak. Renk bulunamazsa
 * arayüzün kendi gri-mavi ekseninde kalır — uydurma renk katmaz.
 */
export function yerTutucu(state: unknown): string {
  const renkler = (JSON.stringify(state).match(/#[0-9a-fA-F]{6}/g) ?? []).slice(0, 2);
  const a = renkler[0] ?? '#1d222d';
  const b = renkler[1] ?? '#12151c';
  return `linear-gradient(135deg, ${a}, ${b})`;
}
