// MASKE ÖLÇÜM SAYFASI — tarayıcı tarafı (`bench/maske.html`, `scripts/olc-maske.mjs`
// sürer). DAVIS GT maskeleriyle: A = IS-Net (uygulamanın video yolu), B = A + derinlik
// tutarlı delik doldurma (B, A'dan YALNIZ doldurulan piksellerle ayrılır), C = BiRefNet
// (yardımcı). Çıktı: `window.__maske = { rapor, pngler }`, hata: `window.__maskeHata`.

import { segmentForeground } from '../engine/reconstruction/segmentation.ts';
import { estimateDepth } from '../depth.ts';
import { resampleBilinear } from '../engine/reconstruction/silhouette.ts';
import { delikleriDoldur } from '../engine/reconstruction/maskeDelik.ts';
import { alan, ardisikIoU, davisTolPx, delikKayitlari, gtIzgaraya, icDelikOrani, ikili, jaccard, sinirF } from './maskeOlcut.ts';

export interface MaskeManifesti {
  diziler: { ad: string; kareler: { jpgUrl: string; gtUrl: string }[] }[];
  yardimci: boolean;
  delikKaydi?: boolean;
}

type Yontem = 'A' | 'B' | 'C';
const MAX_PNG = 40;
const PNG_GENISLIK = 640;

interface KareSonucu {
  J: number; F: number; delik: number; alan: number; ardisik?: number; alanFarki?: number;
}

const log = (s: string) => console.log(`[maske] ${s}`);
const ort = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

function yukle(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`yüklenemedi: ${url}`));
    im.src = url;
  });
}

function pikseller(im: HTMLImageElement): ImageData {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** DAVIS GT: arka plan siyah, her nesne siyah olmayan; hepsi tek ön plan. */
function gtIkili(d: ImageData): Uint8Array {
  const o = new Uint8Array(d.width * d.height);
  for (let i = 0; i < o.length; i++) o[i] = (d.data[i * 4] | d.data[i * 4 + 1] | d.data[i * 4 + 2]) > 0 ? 1 : 0;
  return o;
}

/** Model maskesi (kendi ızgarasında) → W×H ikili. */
function yukariOrnekle(m: Float32Array, mw: number, mh: number, W: number, H: number): Uint8Array {
  return ikili(mw === W && mh === H ? m : resampleBilinear(m, mw, mh, W, H));
}

function bindirme(im: HTMLImageElement, A: Uint8Array, delta: Uint8Array, gt: Uint8Array, W: number, H: number): string {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 4;
    // Soluk kare: renkli işaretler öne çıksın.
    d.data[p] *= 0.45; d.data[p + 1] *= 0.45; d.data[p + 2] *= 0.45;
    if (delta[i]) { // doldurulan: GT içinde yeşil (doğru), dışında kırmızı (yanlış)
      if (gt[i]) { d.data[p] = 0; d.data[p + 1] = 230; d.data[p + 2] = 60; } else { d.data[p] = 255; d.data[p + 1] = 30; d.data[p + 2] = 30; }
    } else if (A[i] && (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !A[i - 1] || !A[i + 1] || !A[i - W] || !A[i + W])) {
      d.data[p] = 255; d.data[p + 1] = 255; d.data[p + 2] = 0; // A anahattı sarı
    }
  }
  ctx.putImageData(d, 0, 0);
  const olcek = Math.min(1, PNG_GENISLIK / W);
  const k = document.createElement('canvas');
  k.width = Math.round(W * olcek); k.height = Math.round(H * olcek);
  k.getContext('2d')!.drawImage(c, 0, 0, k.width, k.height);
  return k.toDataURL('image/png');
}

export async function maskeCalistir(man: MaskeManifesti) {
  const yontemler: Yontem[] = man.yardimci ? ['A', 'B', 'C'] : ['A', 'B'];
  const hatalar: { dizi: string; kare: number; mesaj: string }[] = [];
  const pngAdaylari: { ad: string; yanlis: number; url: string }[] = [];
  const dizilerRapor: Record<string, unknown>[] = [];
  const tum: Record<Yontem, KareSonucu[]> = { A: [], B: [], C: [] };
  const diziOrt: Record<Yontem, { J: number; F: number }[]> = { A: [], B: [], C: [] };
  const sure = { seg: [] as number[], derinlik: [] as number[], doldur: [] as number[], yardimci: [] as number[] };
  const dolgu = { px: 0, dogru: 0, yanlis: 0, kareSayisi: 0, kare: 0 };
  let cModel = '';
  let cKullanilamayan = 0;

  for (const dizi of man.diziler) {
    const oncekiBin: Partial<Record<Yontem, Uint8Array>> = {};
    const topla: Record<Yontem, KareSonucu[]> = { A: [], B: [], C: [] };
    const diziDolgu = { px: 0, dogru: 0, yanlis: 0, kareSayisi: 0 };
    for (let k = 0; k < dizi.kareler.length; k++) {
      try {
        log(`${dizi.ad} ${k + 1}/${dizi.kareler.length}`);
        const { jpgUrl, gtUrl } = dizi.kareler[k];
        const [im, gtIm] = await Promise.all([yukle(jpgUrl), yukle(gtUrl)]);
        const W = gtIm.naturalWidth, H = gtIm.naturalHeight;
        const gt = gtIkili(pikseller(gtIm));
        const tol = davisTolPx(W, H);

        let t = performance.now();
        const seg = await segmentForeground(im, 'webgpu', 'video');
        sure.seg.push(performance.now() - t);
        const A = yukariOrnekle(seg.mask, seg.width, seg.height, W, H);

        t = performance.now();
        const d = await estimateDepth(im, { detailStrength: 0, foregroundStretch: false, sobelRelief: 0, depthSmoothing: false });
        sure.derinlik.push(performance.now() - t);
        t = performance.now();
        const mD = seg.width === d.width && seg.height === d.height
          ? seg.mask : resampleBilinear(seg.mask, seg.width, seg.height, d.width, d.height);
        if (man.delikKaydi) {
          // Tüm kapalı delikler (doldurulan/doldurulmayan); node `__delikAl` ile boşaltır.
          const gtD = gtIzgaraya(gt, W, H, d.width, d.height);
          const tampon = ((window as unknown as Record<string, unknown>).__delikTampon ??= []) as unknown[];
          for (const r of delikKayitlari(mD, d.data, d.width, d.height, gtD)) tampon.push({ dizi: dizi.ad, kare: k, ...r });
        }
        const f = delikleriDoldur(mD, d.data, d.width, d.height).mask;
        const deltaF = new Float32Array(f.length);
        for (let i = 0; i < f.length; i++) deltaF[i] = f[i] >= 0.5 && mD[i] < 0.5 ? 1 : 0;
        const delta = yukariOrnekle(deltaF, d.width, d.height, W, H);
        const B = new Uint8Array(A);
        let filledPx = 0, dogru = 0;
        for (let i = 0; i < B.length; i++) {
          // delta := B \ A (A zaten 1 olan pikseller "doldurulan" sayılmaz)
          if (delta[i] && !A[i]) { B[i] = 1; filledPx++; if (gt[i]) dogru++; } else delta[i] = 0;
        }
        sure.doldur.push(performance.now() - t);

        const bins: Partial<Record<Yontem, Uint8Array>> = { A, B };
        if (man.yardimci) {
          const c = await segmentForeground(im, 'webgpu', 'foto');
          cModel = c.model;
          if (c.model === 'birefnet') bins.C = yukariOrnekle(c.mask, c.width, c.height, W, H);
          else cKullanilamayan++;
        }

        for (const y of yontemler) {
          const m = bins[y];
          if (!m) { delete oncekiBin[y]; continue; }
          const s: KareSonucu = { J: jaccard(m, gt), F: sinirF(m, gt, W, H, tol), delik: icDelikOrani(m, W, H), alan: alan(m) / m.length };
          const onc = oncekiBin[y];
          if (onc) {
            s.ardisik = ardisikIoU(onc, m);
            s.alanFarki = Math.abs(s.alan - alan(onc) / onc.length);
          }
          oncekiBin[y] = m;
          topla[y].push(s);
          tum[y].push(s);
        }

        dolgu.kare++;
        if (filledPx > 0) {
          const yanlis = filledPx - dogru;
          dolgu.kareSayisi++; diziDolgu.kareSayisi++;
          dolgu.px += filledPx; dolgu.dogru += dogru; dolgu.yanlis += yanlis;
          diziDolgu.px += filledPx; diziDolgu.dogru += dogru; diziDolgu.yanlis += yanlis;
          // Yalnız ilk MAX_PNG'ye girebilecek kareyi çiz (bellek sınırlı).
          if (pngAdaylari.length < MAX_PNG || yanlis > pngAdaylari[pngAdaylari.length - 1].yanlis) {
            pngAdaylari.push({ ad: `${dizi.ad}_${String(k).padStart(3, '0')}`, yanlis, url: bindirme(im, A, delta, gt, W, H) });
            pngAdaylari.sort((p, q) => q.yanlis - p.yanlis);
            if (pngAdaylari.length > MAX_PNG) pngAdaylari.length = MAX_PNG;
          }
        }
      } catch (e) {
        const mesaj = e instanceof Error ? e.message : String(e);
        hatalar.push({ dizi: dizi.ad, kare: k, mesaj });
        log(`HATA ${dizi.ad} kare ${k}: ${mesaj}`);
        // Hatalı kareden sonra ardışık ölçü sahte çifte düşmesin.
        delete oncekiBin.A; delete oncekiBin.B; delete oncekiBin.C;
      }
    }
    const ozet = (y: Yontem) => {
      const kk = topla[y];
      if (!kk.length) return null;
      const J = ort(kk.map((s) => s.J)), F = ort(kk.map((s) => s.F));
      diziOrt[y].push({ J, F });
      return {
        kare: kk.length, J, F, JF: (J + F) / 2, delik: ort(kk.map((s) => s.delik)), alan: ort(kk.map((s) => s.alan)),
        ardisik: ort(kk.filter((s) => s.ardisik != null).map((s) => s.ardisik!)),
        alanDalgalanma: ort(kk.filter((s) => s.alanFarki != null).map((s) => s.alanFarki!)),
      };
    };
    const satir: Record<string, unknown> = { ad: dizi.ad, dolgu: diziDolgu };
    for (const y of yontemler) satir[y] = ozet(y);
    dizilerRapor.push(satir);
  }

  const global = (y: Yontem) => {
    const kk = tum[y];
    if (!kk.length) return null;
    const J = ort(kk.map((s) => s.J)), F = ort(kk.map((s) => s.F));
    const dz = diziOrt[y];
    const jd = ort(dz.map((s) => s.J)), fd = ort(dz.map((s) => s.F));
    return {
      kare: kk.length, J, F, JF: (J + F) / 2, delik: ort(kk.map((s) => s.delik)), alan: ort(kk.map((s) => s.alan)),
      ardisik: ort(kk.filter((s) => s.ardisik != null).map((s) => s.ardisik!)),
      alanDalgalanma: ort(kk.filter((s) => s.alanFarki != null).map((s) => s.alanFarki!)),
      diziOrtalamasi: { diziSayisi: dz.length, J: jd, F: fd, JF: (jd + fd) / 2 },
    };
  };
  const gA = global('A'), gB = global('B');
  // B<A olan dizi sayısı (dizi ortalaması J&F)
  let bKotu = 0;
  for (const s of dizilerRapor as { A: { J: number; F: number } | null; B: { J: number; F: number } | null }[]) {
    if (s.A && s.B && s.B.J + s.B.F < s.A.J + s.A.F - 1e-9) bKotu++;
  }
  const rapor = {
    surum: 1,
    yardimci: man.yardimci,
    cModeli: man.yardimci ? cModel || null : null,
    cKullanilamayanKare: cKullanilamayan,
    kareSayisi: dolgu.kare,
    diziSayisi: man.diziler.length,
    global: { A: gA, B: gB, C: man.yardimci ? global('C') : null },
    farkBA: gA && gB ? {
      J: gB.J - gA.J, F: gB.F - gA.F, JF: gB.JF - gA.JF,
      diziOrtJF: gB.diziOrtalamasi.JF - gA.diziOrtalamasi.JF, bKotuDiziSayisi: bKotu,
    } : null,
    dolgu: {
      doldurulanPiksel: dolgu.px, dogru: dolgu.dogru, yanlis: dolgu.yanlis,
      kesinlik: dolgu.px ? dolgu.dogru / dolgu.px : null, dolguluKareSayisi: dolgu.kareSayisi, toplamKare: dolgu.kare,
    },
    sureMs: { seg: ort(sure.seg), derinlik: ort(sure.derinlik), doldur: ort(sure.doldur) },
    diziler: dizilerRapor,
    hataSayisi: hatalar.length,
    hatalar,
  };
  const pngler: Record<string, string> = {};
  for (const p of pngAdaylari) pngler[p.ad] = p.url;
  return { rapor, pngler };
}

/** Sayfa girişi: node `__maskeBaslat(manifest)` çağırır, `__maske`/`__maskeHata` bayraklarını bekler. */
export function maskeKur() {
  const w = window as unknown as Record<string, unknown>;
  w.__delikAl = () => { const t = (w.__delikTampon as unknown[]) ?? []; w.__delikTampon = []; return t; };
  w.__maskeBaslat = (man: MaskeManifesti) => {
    maskeCalistir(man)
      .then((s) => { w.__maske = s; })
      .catch((e) => { w.__maskeHata = e instanceof Error ? (e.stack ?? e.message) : String(e); });
  };
}
