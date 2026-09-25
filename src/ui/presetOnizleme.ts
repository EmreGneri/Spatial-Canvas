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

const ANAHTAR = 'spatial-canvas.preset-onizleme.v1';
export const ONIZLEME_EN = 192;
export const ONIZLEME_BOY = 120;

type Kapaklar = Record<string, string>;

export function kapaklariOku(): Kapaklar {
  try {
    const ham = localStorage.getItem(ANAHTAR);
    return ham ? (JSON.parse(ham) as Kapaklar) : {};
  } catch {
    return {};
  }
}

export function kapakYaz(ad: string, dataUrl: string): Kapaklar {
  const hepsi = { ...kapaklariOku(), [ad]: dataUrl };
  try {
    localStorage.setItem(ANAHTAR, JSON.stringify(hepsi));
  } catch {
    // Kota dolduysa kapaklar kaybolur ama uygulama çalışmaya devam eder.
  }
  return hepsi;
}

export function kapakSil(ad: string): Kapaklar {
  const hepsi = kapaklariOku();
  delete hepsi[ad];
  try {
    localStorage.setItem(ANAHTAR, JSON.stringify(hepsi));
  } catch {
    /* yoksay */
  }
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
