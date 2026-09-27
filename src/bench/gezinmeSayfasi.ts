// GEZİNME ÖLÇÜM SAYFASI — tarayıcı tarafı (`bench/gezinme.html`, yalnız Vite dev
// sunucusu üzerinden `scripts/olc-gezinme.mjs` ile sürülür; üretim build'ine
// girmez). Plan: docs/plans/2026-09-27-gezinme-1-olcum.md, Görev 5.
//
// Akış: klibi indir → sabit ayrılan kareleri <video>'dan yakala → eğit
// (`egitimBaslat`, ölçüm kancasıyla) → bitince sonda pozlarında çiz, ölç →
// `window.__gezinme = { rapor, pngler }` (hata: `window.__gezinmeHata`).
//
// GT (sentetik sahne) verilirse: SfM'nin keyfi çerçevesi, kayıtlı her
// kameranın merkezi ile aynı zamanlı GT merkezi arasında Umeyama Sim(3) ile GT
// dünyasına hizalanır; her sonda kamerası oraya taşınıp `sentetikCizim.ciz`
// ile GT'si çizilir.

import {
  ayarSec, egitimBaslat, kameraMerkezi,
  type Egitim, type EgitimAyari, type EgitimMetrik, type GsKamera,
} from '../engine/reconstruction/egitim3dgs.ts';
import {
  BOLGELER, MESAFELER, bugunkuSinir, kaplama, keskinlik, kullanilabilirMesafe, olcumBirimi, psnr,
  sondaPozlari, ssim, tabanKamera,
  type Bolge, type Sonda, type Yon,
} from '../engine/reconstruction/gezinmeOlcum.ts';
import { kamerayiDonustur, umeyama, type Sim3 } from '../engine/reconstruction/hizalama.ts';
import { cekimTuru, flySiniri, type CekimTuru } from '../ui/egitimControls.ts';
import { ciz } from './sentetikCizim.ts';

// ── report schema ────────────────────────────────────────────────────────

/** "Good" thresholds, relative to the region's centre probe (`_0`). With GT:
 *  `ssim ≥ ssim_0 − ssimDusus` and `psnr ≥ psnr_0 − psnrDusus`; without GT:
 *  `keskinlik / keskinlik_0 ≥ keskinlikOrani` and `kaplama ≥ kaplamaMin`. */
export const ESIKLER = { ssimDusus: 0.08, psnrDusus: 2, keskinlikOrani: 0.6, kaplamaMin: 0.97 } as const;

export interface SondaSonucu {
  id: string; bolge: Bolge; yon: Yon; d: number;
  kaplama: number; keskinlik: number; psnr?: number; ssim?: number; iyi: boolean;
}

export interface GezinmeRaporu {
  surum: 1;
  etiket: string;
  klip: string;
  tarayici: string;
  gpu: string;
  ayar: EgitimAyari & { ayrilan: number; genislik: number };
  tur: CekimTuru;
  birim: number;
  /** Stage durations (ms) by the first word of each progress text, in order
   *  of appearance, up to the end of seeding; then `egitim` (seed end →
   *  training complete) and `olcum` (probing after training). */
  sureler: Record<string, number>;
  sfm: { kayitli: number; toplamKare: number; medErr?: number; rmsBA?: number };
  gauss: number;
  ayrilan: { ad: string; psnr: number; ssim: number }[];
  sondalar: SondaSonucu[];
  kullanilabilir: Record<Bolge, Record<Yon, number>>;
  bugunku: Record<Bolge, Record<Yon, number>>;
  esikler: { olcut: 'gt' | 'gtsiz' } & typeof ESIKLER;
  /** GT alignment quality: `rms` in GT metres, `rmsOrani` = rms / GT path
   *  length; `aciHatasi` = median camera rotation disagreement after the
   *  centre-only fit (degrees); `odakOrani` = reconstructed / GT focal. */
  hizalama?: { rms: number; rmsOrani: number; n: number; olcek: number; aciHatasi: number; odakOrani: number };
  zamanCizelgesi: { ms: number; asama: string }[];
}

interface GtKare { t: number; R: number[]; tv: number[]; f: number; cx: number; cy: number }
interface Gt { tohum: number; w: number; h: number; fps: number; kareler: GtKare[] }

interface Parametreler {
  klip: string;
  gt?: string;
  etiket: string;
  katman?: 'quick' | 'standard';
  kare?: number;
  iter?: number;
  ayrilan: number;
  genislik: number;
}

type AyrilanKare = { source: Blob; name: string; t: number };

// ── small helpers ────────────────────────────────────────────────────────

const gunlukEl = typeof document !== 'undefined' ? document.getElementById('log') : null;
function gunluk(metin: string): void {
  if (gunlukEl) gunlukEl.textContent = metin;
  console.log(`[gezinme] ${metin}`);
}

function tamsayi(v: string | null, ad: string): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${ad} must be a non-negative integer: ${v}`);
  return n;
}

export function parametreleriOku(arama: string): Parametreler {
  const q = new URLSearchParams(arama);
  const klip = q.get('klip');
  if (!klip) throw new Error('missing ?klip= (Vite URL of the clip)');
  const katman = q.get('katman') ?? undefined;
  if (katman != null && katman !== 'quick' && katman !== 'standard') throw new Error(`katman must be quick|standard: ${katman}`);
  return {
    klip,
    gt: q.get('gt') || undefined,
    etiket: q.get('etiket') || 'olcum',
    katman,
    kare: tamsayi(q.get('kare'), 'kare'),
    iter: tamsayi(q.get('iter'), 'iter'),
    ayrilan: tamsayi(q.get('ayrilan'), 'ayrilan') ?? 6,
    genislik: tamsayi(q.get('genislik'), 'genislik') ?? 640,
  };
}

function olayBekle(el: EventTarget, ad: string, ms = 60_000): Promise<void> {
  return new Promise((res, rej) => {
    const temizle = () => { clearTimeout(zaman); el.removeEventListener(ad, tamam); el.removeEventListener('error', hata); };
    const tamam = () => { temizle(); res(); };
    const hata = () => { temizle(); rej(new Error(`media error while waiting for '${ad}'`)); };
    const zaman = setTimeout(() => { temizle(); rej(new Error(`timed out waiting for '${ad}'`)); }, ms);
    el.addEventListener(ad, tamam, { once: true });
    el.addEventListener('error', hata, { once: true });
  });
}

function blobVer(c: HTMLCanvasElement, tur: string, kalite?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('canvas.toBlob failed'))), tur, kalite));
}

function tuval(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  return { c, ctx };
}

function pngDataUrl(img: ImageData): string {
  const { c, ctx } = tuval(img.width, img.height);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** First word of a progress text: the stage key (`features 3/12` → `features`). */
const ilkKelime = (metin: string) => metin.trim().split(/\s+/)[0] ?? '';

/**
 * Stage durations from the timeline: every entry lasts until the next one and
 * is booked under its first word, up to `tohumSonu`; `egitim` = `tohumSonu`
 * → `bitti`, `olcum` = `bitti` → `son`.
 */
export function asamaSureleri(
  cizelge: { ms: number; asama: string }[], tohumSonu: number, bitti: number, son: number,
): Record<string, number> {
  const sureler: Record<string, number> = {};
  for (let i = 0; i < cizelge.length; i++) {
    const { ms, asama } = cizelge[i];
    if (ms >= tohumSonu) break;
    const sonraki = Math.min(cizelge[i + 1]?.ms ?? tohumSonu, tohumSonu);
    const k = ilkKelime(asama);
    sureler[k] = (sureler[k] ?? 0) + (sonraki - ms);
  }
  sureler.egitim = bitti - tohumSonu;
  sureler.olcum = son - bitti;
  return sureler;
}

// ── held-out frames ──────────────────────────────────────────────────────

/** `K` fixed held-out frames at `t_i = (i + 0.5) / K · D`, grabbed by seeking a
 *  <video> and encoding the canvas as JPEG 0.95. */
async function ayrilanKareleriAl(dosya: File, K: number): Promise<AyrilanKare[]> {
  if (K <= 0) return [];
  const url = URL.createObjectURL(dosya);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    const meta = olayBekle(video, 'loadedmetadata');
    video.src = url;
    await meta;
    let D = video.duration;
    if (!Number.isFinite(D)) {
      // Streamed WebM without a duration: seeking far past the end makes the
      // element discover it.
      const bekle = olayBekle(video, 'seeked');
      video.currentTime = 1e9;
      await bekle;
      D = video.duration;
    }
    if (!(D > 0) || !Number.isFinite(D)) throw new Error(`clip duration unknown: ${D}`);
    const { c, ctx } = tuval(video.videoWidth, video.videoHeight);
    const kareler: AyrilanKare[] = [];
    for (let i = 0; i < K; i++) {
      const t = ((i + 0.5) / K) * D;
      const bekle = olayBekle(video, 'seeked');
      video.currentTime = t;
      await bekle;
      ctx.drawImage(video, 0, 0, c.width, c.height);
      kareler.push({ source: await blobVer(c, 'image/jpeg', 0.95), name: `olcum_t${t.toFixed(3)}.jpg`, t });
    }
    return kareler;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

// ── GT alignment ─────────────────────────────────────────────────────────

const gtKamerasi = (gt: Gt, k: GtKare): GsKamera => ({ R: k.R, t: k.tv, f: k.f, cx: k.cx, cy: k.cy, w: gt.w, h: gt.h });

function enYakinGtKare(gt: Gt, t: number): GtKare {
  let en = gt.kareler[0];
  for (const k of gt.kareler) if (Math.abs(k.t - t) < Math.abs(en.t - t)) en = k;
  return en;
}

/** Rotation angle (degrees) between two row-major rotations: acos((tr(A·Bᵀ) − 1) / 2). */
function donmeAcisi(A: number[], B: number[]): number {
  let iz = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) iz += A[i * 3 + k] * B[i * 3 + k];
  return (Math.acos(Math.max(-1, Math.min(1, (iz - 1) / 2))) * 180) / Math.PI;
}

const medyan = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[(v.length - 1) >> 1] : NaN;
};

interface GtHizalama { T: Sim3; ozet: NonNullable<GezinmeRaporu['hizalama']> }

/** Sim(3) from the reconstruction to the GT world over every registered camera,
 *  each paired with the GT frame nearest its video timestamp. */
function gtHizala(e: Egitim, gt: Gt): GtHizalama {
  const kayitli = e.kayitliKameralar().filter((k) => Number.isFinite(k.t));
  if (kayitli.length < 3) throw new Error(`GT alignment needs >= 3 timed registered cameras, got ${kayitli.length}`);
  const eslesen = kayitli.map((k) => ({ k, g: enYakinGtKare(gt, k.t) }));
  const T = umeyama(eslesen.map(({ k }) => kameraMerkezi(k.kamera)), eslesen.map(({ g }) => kameraMerkezi(gtKamerasi(gt, g))));
  let L = 0;
  const gtMerkezler = gt.kareler.map((k) => kameraMerkezi(gtKamerasi(gt, k)));
  for (let i = 1; i < gtMerkezler.length; i++) {
    const [a, b] = [gtMerkezler[i - 1], gtMerkezler[i]];
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const aci = medyan(eslesen.map(({ k, g }) => donmeAcisi(kamerayiDonustur(k.kamera, T).R, g.R)));
  const odak = medyan(eslesen.map(({ k }) => k.kamera.f / (gt.kareler[0].f * (k.kamera.w / gt.w))));
  return { T, ozet: { rms: T.rms, rmsOrani: T.rms / (L || 1), n: eslesen.length, olcek: T.s, aciHatasi: aci, odakOrani: odak } };
}

/** A probe camera re-expressed in the GT world, with the GT camera's own
 *  intrinsics scaled to the probe's canvas: the reconstruction reproduces the
 *  training images under its SOLVED focal, so the matching reference view is
 *  what the real (GT) lens sees from the aligned pose. */
function gtSondaKamerasi(k: GsKamera, T: Sim3, gt: Gt): GsKamera {
  const d = kamerayiDonustur(k, T);
  const g = gt.kareler[0];
  const sx = k.w / gt.w, sy = k.h / gt.h;
  return { R: d.R, t: d.t, f: g.f * sx, fy: g.f * sy, cx: g.cx * sx, cy: g.cy * sy, w: k.w, h: k.h };
}

// ── measurement ──────────────────────────────────────────────────────────

function cizimAl(e: Egitim, k: GsKamera, bg?: [number, number, number]): ImageData {
  const { ctx } = tuval(k.w, k.h);
  const kb: GsKamera & { bg?: [number, number, number] } = bg ? { ...k, bg } : k;
  e.kareCiz(kb, ctx);
  return ctx.getImageData(0, 0, k.w, k.h);
}

function iyiMi(s: Pick<SondaSonucu, 'psnr' | 'ssim' | 'keskinlik' | 'kaplama'>, m: SondaSonucu, gtVar: boolean): boolean {
  if (gtVar) {
    return (s.ssim ?? -Infinity) >= (m.ssim ?? Infinity) - ESIKLER.ssimDusus
      && (s.psnr ?? -Infinity) >= (m.psnr ?? Infinity) - ESIKLER.psnrDusus;
  }
  const oran = m.keskinlik > 0 ? s.keskinlik / m.keskinlik : 0;
  return oran >= ESIKLER.keskinlikOrani && s.kaplama >= ESIKLER.kaplamaMin;
}

const bolgeAdlari = Object.keys(BOLGELER) as Bolge[];
const yonAdlari = Object.keys(MESAFELER) as Yon[];
function tabloYap(deger: (b: Bolge, y: Yon) => number): Record<Bolge, Record<Yon, number>> {
  return Object.fromEntries(bolgeAdlari.map((b) => [b, Object.fromEntries(yonAdlari.map((y) => [y, deger(b, y)]))])) as
    Record<Bolge, Record<Yon, number>>;
}

async function olc(p: Parametreler): Promise<{ rapor: GezinmeRaporu; pngler: Record<string, string> }> {
  const t0 = performance.now();
  const cizelge: { ms: number; asama: string }[] = [];
  const isaretle = (asama: string) => {
    const ms = Math.round(performance.now() - t0);
    cizelge.push({ ms, asama });
    return ms;
  };

  isaretle('hazırlık');
  gunluk(`hazırlık: ${p.klip}`);
  const klipYaniti = await fetch(p.klip);
  if (!klipYaniti.ok) throw new Error(`clip fetch failed: ${klipYaniti.status} ${p.klip}`);
  const klipAdi = decodeURIComponent(new URL(p.klip, location.href).pathname.split('/').pop() || 'klip');
  const klipBlob = await klipYaniti.blob();
  const dosya = new File([klipBlob], klipAdi, { type: klipBlob.type || (klipAdi.endsWith('.webm') ? 'video/webm' : 'video/mp4') });
  let gt: Gt | null = null;
  if (p.gt) {
    const r = await fetch(p.gt);
    if (!r.ok) throw new Error(`GT fetch failed: ${r.status} ${p.gt}`);
    gt = await r.json() as Gt;
    if (!gt.kareler?.length) throw new Error('GT has no frames');
  }
  const ayrilanKareler = await ayrilanKareleriAl(dosya, p.ayrilan);
  gunluk(`hazırlık: ${ayrilanKareler.length} ayrılan kare (${ayrilanKareler.map((k) => k.t.toFixed(2)).join(', ')} sn)`);

  const oto = await ayarSec();
  const ayar: EgitimAyari = {
    ...oto,
    tier: p.katman ?? oto.tier,
    maxFrames: p.kare ?? oto.maxFrames,
    maxIters: p.iter ?? oto.maxIters,
  };

  const canvas = document.createElement('canvas');
  canvas.width = p.genislik;
  canvas.height = Math.round((p.genislik * 9) / 16);
  document.body.append(canvas);

  let bittiCoz!: (m: EgitimMetrik | null) => void;
  let bittiRed!: (e: Error) => void;
  const bittiSozu = new Promise<EgitimMetrik | null>((res, rej) => { bittiCoz = res; bittiRed = rej; });
  bittiSozu.catch(() => undefined); // surfaced by the await below
  let sonMetrikLog = 0;
  const e = await egitimBaslat(dosya, canvas, {
    asama: (m) => { isaretle(m); gunluk(m); },
    metrik: (m) => {
      const simdi = performance.now();
      if (simdi - sonMetrikLog < 5000) return;
      sonMetrikLog = simdi;
      gunluk(`egitim ${m.iter}/${ayar.maxIters} · ${m.splats} splat · ${m.itersPerSec.toFixed(2)} it/s` +
        `${m.psnrHold != null ? ` · holdout ${m.psnrHold.toFixed(2)} dB` : ''}`);
    },
    bitti: (m) => bittiCoz(m),
    hata: (err) => bittiRed(err),
  }, ayar, undefined, { olcum: { ayrilanKareler } });
  let sonMetrik: EgitimMetrik | null;
  try {
    sonMetrik = await bittiSozu;
  } catch (err) {
    e.kapat();
    throw err;
  }
  // Seed end: the last seeding progress event before training started.
  const tohumOlaylari = cizelge.filter((z) => ilkKelime(z.asama) === 'seed');
  const ilkEgitim = cizelge.find((z) => ilkKelime(z.asama) === 'train');
  const bittiMs = isaretle('bitti');
  const tohumSonu = tohumOlaylari.at(-1)?.ms ?? ilkEgitim?.ms ?? bittiMs;
  gunluk(`bitti: ${sonMetrik?.iter ?? '?'} iter, ${sonMetrik?.splats ?? '?'} splat`);

  try {
    isaretle('olcum');
    const { pozlar, pivot, yukari } = e;
    const tur = cekimTuru(pozlar, pivot);
    const birim = olcumBirimi(pozlar.map(kameraMerkezi), pivot, tur);
    const sondalar: Sonda[] = sondaPozlari(pozlar, yukari, pivot, tur);
    const sinir = flySiniri(e.kameralar, pivot, tur);
    const bugunku = tabloYap((b, y) => bugunkuSinir(tabanKamera(pozlar, yukari, tur, BOLGELER[b]), y, sinir, yukari, birim));
    gunluk(`olcum: tur ${tur}, birim ${birim.toFixed(4)}, ${sondalar.length} sonda`);

    const hizalama = gt ? gtHizala(e, gt) : null;
    if (hizalama) {
      const h = hizalama.ozet;
      gunluk(`olcum: GT hizalama rms ${h.rms.toFixed(4)} (yolun ${(h.rmsOrani * 100).toFixed(2)}%), ` +
        `açı ${h.aciHatasi.toFixed(2)}°, odak oranı ${h.odakOrani.toFixed(3)}, ${h.n} kamera`);
    }

    const pngler: Record<string, string> = {};
    const sonuclar: SondaSonucu[] = [];
    for (const [i, s] of sondalar.entries()) {
      const siyah = cizimAl(e, s.kamera);
      const beyaz = cizimAl(e, s.kamera, [1, 1, 1]);
      const r: SondaSonucu = {
        id: s.id, bolge: s.bolge, yon: s.yon, d: s.d,
        kaplama: kaplama(siyah.data, beyaz.data),
        keskinlik: keskinlik(siyah.data, siyah.width, siyah.height),
        iyi: false,
      };
      pngler[s.id] = pngDataUrl(siyah);
      if (gt && hizalama) {
        const gtImg = ciz(gtSondaKamerasi(s.kamera, hizalama.T, gt), gt.tohum);
        r.psnr = psnr(siyah.data, gtImg.data);
        r.ssim = ssim(siyah.data, gtImg.data, siyah.width, siyah.height);
        pngler[`${s.id}_gt`] = pngDataUrl(gtImg);
      }
      sonuclar.push(r);
      if (i % 10 === 0) gunluk(`olcum: sonda ${i + 1}/${sondalar.length}`);
    }
    const merkez = new Map(sonuclar.filter((r) => r.d === 0).map((r) => [r.bolge, r]));
    for (const r of sonuclar) r.iyi = iyiMi(r, merkez.get(r.bolge)!, Boolean(hizalama));
    const kullanilabilir = tabloYap((b, y) => kullanilabilirMesafe(
      sonuclar.filter((r) => r.bolge === b && (r.d === 0 || r.yon === y)).map(({ d, iyi }) => ({ d, iyi })),
    ));

    gunluk('olcum: ayrılan kareler');
    const ayrilan: GezinmeRaporu['ayrilan'] = [];
    for (const { ad, kamera, psnr: p0 } of await e.degerlendir()) {
      const kaynak = ayrilanKareler.find((k) => k.name === ad);
      if (!kaynak) continue;
      const tahmin = cizimAl(e, kamera);
      const bmp = await createImageBitmap(kaynak.source);
      const { ctx } = tuval(kamera.w, kamera.h);
      ctx.drawImage(bmp, 0, 0, kamera.w, kamera.h);
      bmp.close();
      const gercek = ctx.getImageData(0, 0, kamera.w, kamera.h);
      ayrilan.push({ ad, psnr: p0, ssim: ssim(tahmin.data, gercek.data, kamera.w, kamera.h) });
    }
    ayrilan.sort((a, b) => a.ad.localeCompare(b.ad));

    const kayitli = e.kayitliKameralar();
    const decode = [...cizelge].reverse().find((z) => /^decode \d+\/\d+/.test(z.asama));
    const toplamKare = decode ? Number(decode.asama.split(/\s+/)[1].split('/')[1]) : kayitli.length;
    const gauss = sonMetrik?.splats ?? (await e.gaussianlar()).n;

    const sonMs = isaretle('son');
    const rapor: GezinmeRaporu = {
      surum: 1,
      etiket: p.etiket,
      klip: klipAdi,
      tarayici: navigator.userAgent,
      gpu: ayar.gpu,
      ayar: { ...ayar, ayrilan: p.ayrilan, genislik: p.genislik },
      tur,
      birim,
      sureler: asamaSureleri(cizelge, tohumSonu, bittiMs, sonMs),
      sfm: { kayitli: kayitli.length, toplamKare },
      gauss,
      ayrilan,
      sondalar: sonuclar,
      kullanilabilir,
      bugunku,
      esikler: { olcut: hizalama ? 'gt' : 'gtsiz', ...ESIKLER },
      ...(hizalama ? { hizalama: hizalama.ozet } : {}),
      zamanCizelgesi: cizelge,
    };
    gunluk(`tamam: ${sonuclar.length} sonda, ${ayrilan.length} ayrılan kare, ${Math.round(sonMs / 1000)} sn`);
    return { rapor, pngler };
  } finally {
    e.kapat();
  }
}

/** Entry point for `bench/gezinme.ts`. */
export async function gezinmeCalistir(): Promise<void> {
  const w = window as unknown as { __gezinme?: unknown; __gezinmeHata?: string };
  try {
    w.__gezinme = await olc(parametreleriOku(location.search));
  } catch (err) {
    const mesaj = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(err);
    gunluk(`HATA: ${mesaj}`);
    w.__gezinmeHata = mesaj;
  }
}
