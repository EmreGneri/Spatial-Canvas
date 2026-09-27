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
  ayarSec, egitimBaslat, egitimOturumAyari, kameraCoz, kameraMerkezi,
  type Egitim, type EgitimAyari, type EgitimMetrik, type EgitimOlcumAyari, type GsKamera,
} from '../engine/reconstruction/egitim3dgs.ts';
import {
  BOLGELER, MESAFELER, bugunkuSinir, kaplama, keskinlik, kullanilabilirMesafe, olcumBirimi, psnr,
  sondaPozlari, ssim, tabanKamera,
  type Bolge, type Sonda, type Yon,
} from '../engine/reconstruction/gezinmeOlcum.ts';
import { kamerayiDonustur, simUygula, umeyama, type Sim3 } from '../engine/reconstruction/hizalama.ts';
import { cekimTuru, flySiniri, type CekimTuru } from '../ui/egitimControls.ts';
import { ciz } from './sentetikCizim.ts';
import { engelUzakligi, gtDerinlik } from './sentetikSahne.ts';
import { vokselDurumuAt } from '../engine/reconstruction/bosAlan.ts';
import { tekGozBenzetimi } from './tekGozBenzetimi.ts';
import { bosAlanSiniri, flyStep } from '../ui/egitimControls.ts';
import type { GezinmeDerinlikKaynagi } from '../engine/reconstruction/gezinmeDerinligi.ts';

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
  egitimOlcumu: EgitimOlcumRaporu;
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
  mod?: { secim?: string; eslestirme?: string; odakAlt?: number; geometri?: string; depthWeight?: number; bolgesel?: boolean };
  bosAlan?: { hizaliKare: number; voksel: number; boyut: [number, number, number]; kullanilabilir: Record<Bolge, Record<Yon, number>>;
    guven?: Egitim['gezinmeGuveni'];
    gtBosOrnek?: number; gtEngelIhlali?: number;
    gtErisilirOrnek?: number; gtErisilirIhlal?: number };
}

type RefineMark = { kind: string; iter: number; moved: number; grown: number; ms: number };
export interface EgitimOlcumRaporu {
  settings: { refineEvery: number; capMult: number; maxSplats: number; seed: number | null; actualCap: number };
  initialN: number;
  refinements: { iter: number; moved: number; grown: number; n: number; ms: number }[];
  elapsedMs: number;
  heldoutPsnrMean: number | null;
}

export function egitimOlcumRaporu(
  ayar: EgitimAyari, override: EgitimOlcumAyari | undefined, marks: readonly RefineMark[],
  finalN: number, actualCap: number, elapsedMs: number, holdouts: readonly { psnr: number }[],
): EgitimOlcumRaporu {
  const session = egitimOturumAyari(ayar, override);
  const refines = marks.filter((mark) => mark.kind === 'refine');
  let n = finalN - refines.reduce((sum, mark) => sum + mark.grown, 0);
  if (n < 0) throw new Error('Refinement growth exceeds final Gaussian count');
  const initialN = n;
  const refinements = refines.map((mark) => {
    n += mark.grown;
    return { iter: mark.iter, moved: mark.moved, grown: mark.grown, n, ms: mark.ms };
  });
  const psnrValues = holdouts.map((item) => item.psnr).filter(Number.isFinite);
  return {
    settings: {
      refineEvery: session.refineEvery,
      capMult: override?.capMult ?? 4,
      maxSplats: override?.maxSplats ?? 600000,
      seed: override?.seed ?? null,
      actualCap,
    },
    initialN,
    refinements,
    elapsedMs,
    heldoutPsnrMean: psnrValues.length ? psnrValues.reduce((sum, value) => sum + value, 0) / psnrValues.length : null,
  };
}

export interface SfmRaporu {
  surum: 1; yalnizSfm: true; etiket: string; klip: string; tarayici: string; gpu: string;
  ayar: EgitimAyari; mod: { secim?: string; eslestirme?: string; odakAlt?: number };
  sfm: { kayitli: number; toplamKare: number; ciftSayisi: number; medErr: number; rmsBA: number | null };
  sureler: Record<string, number>;
  hizalama?: GezinmeRaporu['hizalama'];
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
  egitim?: EgitimOlcumAyari;
  ayrilan: number;
  genislik: number;
  yalnizSfm: boolean;
  secim?: 'yenilik';
  eslestirme?: 'sirali';
  odakAlt?: number;
  geometri?: 'model' | 'sentetik';
  depthWeight?: number;
  bolgesel: boolean;
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

function egitimOlcumuOku(q: URLSearchParams): EgitimOlcumAyari | undefined {
  const keys = ['refine-every', 'cap-mult', 'max-splats', 'trainer-seed'];
  if (!keys.some((key) => q.has(key))) return undefined;
  const positiveInt = (key: string): number | undefined => {
    const raw = q.get(key);
    if (raw === null) return undefined;
    const n = tamsayi(raw, key);
    if (n === undefined || n === 0) throw new Error(`${key} must be a positive integer`);
    return n;
  };
  const capRaw = q.get('cap-mult');
  const capMult = capRaw === null ? undefined : Number(capRaw);
  if (capRaw !== null && (!Number.isFinite(capMult) || capMult! < 1))
    throw new Error('cap-mult must be a finite number >= 1');
  const seedRaw = q.get('trainer-seed');
  const seed = seedRaw === null ? undefined : tamsayi(seedRaw, 'trainer-seed');
  if (seedRaw !== null && seed === undefined) throw new Error('trainer-seed must be a non-negative integer');
  return {
    ...(q.has('refine-every') ? { refineEvery: positiveInt('refine-every') } : {}),
    ...(capMult !== undefined ? { capMult } : {}),
    ...(q.has('max-splats') ? { maxSplats: positiveInt('max-splats') } : {}),
    ...(seed !== undefined ? { seed } : {}),
  };
}

export function parametreleriOku(arama: string): Parametreler {
  const q = new URLSearchParams(arama);
  const klip = q.get('klip');
  if (!klip) throw new Error('missing ?klip= (Vite URL of the clip)');
  const katman = q.get('katman') ?? undefined;
  if (katman != null && katman !== 'quick' && katman !== 'standard') throw new Error(`katman must be quick|standard: ${katman}`);
  const secim = q.get('secim') ?? undefined;
  if (secim != null && secim !== 'yenilik') throw new Error(`secim must be yenilik: ${secim}`);
  const eslestirme = q.get('eslestirme') ?? undefined;
  if (eslestirme != null && eslestirme !== 'sirali') throw new Error(`eslestirme must be sirali: ${eslestirme}`);
  const geometri = q.get('geometri') ?? undefined;
  if (geometri != null && geometri !== 'model' && geometri !== 'sentetik') throw new Error(`geometri must be model|sentetik: ${geometri}`);
  const depthWeight = q.get('derinlik-kisiti');
  if (depthWeight != null && (!(Number(depthWeight) > 0) || !Number.isFinite(Number(depthWeight))))
    throw new Error(`derinlik-kisiti must be positive: ${depthWeight}`);
  if (geometri === 'sentetik' && !q.get('gt')) throw new Error('geometri=sentetik requires gt');
  return {
    klip,
    gt: q.get('gt') || undefined,
    etiket: q.get('etiket') || 'olcum',
    katman,
    kare: tamsayi(q.get('kare'), 'kare'),
    iter: tamsayi(q.get('iter'), 'iter'),
    egitim: egitimOlcumuOku(q),
    ayrilan: tamsayi(q.get('ayrilan'), 'ayrilan') ?? 6,
    genislik: tamsayi(q.get('genislik'), 'genislik') ?? 640,
    yalnizSfm: q.has('yalniz-sfm'), secim, eslestirme,
    odakAlt: tamsayi(q.get('odak-alt'), 'odak-alt'), geometri,
    depthWeight: depthWeight != null ? Number(depthWeight) : undefined,
    bolgesel: q.has('bolgesel'),
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
function gtHizala(kayitliKameralar: readonly { t: number; kamera: GsKamera }[], gt: Gt): GtHizalama {
  const kayitli = kayitliKameralar.filter((k) => Number.isFinite(k.t));
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

function sentetikDerinlikKaynagi(gt: Gt): GezinmeDerinlikKaynagi {
  let alignment: GtHizalama | null = null;
  return async (camera, name, _time, registered) => {
    alignment ??= gtHizala(registered.map((entry) => ({ kamera: entry.camera, t: entry.time })), gt);
    const w = 240, h = 135;
    const gtCamera = gtSondaKamerasi(camera, alignment.T, gt);
    const depth = gtDerinlik(gtCamera, w, h, gt.tohum);
    const seed = [...name].reduce((acc, ch) => (Math.imul(acc, 31) + ch.charCodeAt(0)) | 0, gt.tohum);
    return { data: tekGozBenzetimi(depth, w, h, seed), width: w, height: h };
  };
}

// ── measurement ──────────────────────────────────────────────────────────

async function cizimAl(e: Egitim, k: GsKamera, bg?: [number, number, number]): Promise<ImageData> {
  const { ctx } = tuval(k.w, k.h);
  const kb: GsKamera & { bg?: [number, number, number] } = bg ? { ...k, bg } : k;
  await e.kareCiz(kb, ctx);
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

async function olc(p: Parametreler): Promise<{ rapor: GezinmeRaporu | SfmRaporu; pngler: Record<string, string> }> {
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
  const oto = await ayarSec();
  const ayar: EgitimAyari = {
    ...oto,
    tier: p.katman ?? oto.tier,
    maxFrames: p.kare ?? oto.maxFrames,
    maxIters: p.iter ?? oto.maxIters,
  };

  const kameraSecenekleri = { secim: p.secim, eslestirme: p.eslestirme, odakAlt: p.odakAlt };
  if (p.yalnizSfm) {
    const kameraBaslangici = Math.round(performance.now() - t0);
    const result = await kameraCoz(dosya, ayar, kameraSecenekleri, undefined, gunluk);
    const timeline = [{ ms: 0, asama: 'hazırlık' },
      ...result.cizelge.map((v) => ({ ...v, ms: v.ms + kameraBaslangici }))];
    const elapsed = Math.round(performance.now() - t0);
    const sureler: Record<string, number> = {};
    for (let i = 0; i < timeline.length; i++) {
      const key = ilkKelime(timeline[i].asama);
      const end = timeline[i + 1]?.ms ?? elapsed;
      sureler[key] = (sureler[key] ?? 0) + Math.max(0, end - timeline[i].ms);
    }
    const alignment = gt ? gtHizala(result.kayitli, gt).ozet : undefined;
    const report: SfmRaporu = {
      surum: 1, yalnizSfm: true, etiket: p.etiket, klip: klipAdi,
      tarayici: navigator.userAgent, gpu: ayar.gpu, ayar,
      mod: kameraSecenekleri,
      sfm: { kayitli: result.kayitli.length, toplamKare: result.secilen,
        ciftSayisi: result.ciftSayisi, medErr: result.medErr, rmsBA: result.rmsBA },
      sureler, ...(alignment ? { hizalama: alignment } : {}), zamanCizelgesi: timeline,
    };
    return { rapor: report, pngler: {} };
  }

  const ayrilanKareler = await ayrilanKareleriAl(dosya, p.ayrilan);
  gunluk(`hazırlık: ${ayrilanKareler.length} ayrılan kare (${ayrilanKareler.map((k) => k.t.toFixed(2)).join(', ')} sn)`);

  const canvas = document.createElement('canvas');
  canvas.width = p.genislik;
  canvas.height = Math.round((p.genislik * 9) / 16);
  document.body.append(canvas);

  let bittiCoz!: (m: EgitimMetrik | null) => void;
  let bittiRed!: (e: Error) => void;
  const bittiSozu = new Promise<EgitimMetrik | null>((res, rej) => { bittiCoz = res; bittiRed = rej; });
  bittiSozu.catch(() => undefined); // surfaced by the await below
  let sonMetrikLog = 0;
  let refineMarks: RefineMark[] = [];
  let finalN = 0;
  let finalCap = 0;
  const depthSource: GezinmeDerinlikKaynagi | undefined = p.geometri === 'sentetik'
    ? sentetikDerinlikKaynagi(gt!)
    : p.geometri === 'model' || p.depthWeight ? 'model' : undefined;
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
  }, ayar, undefined, {
    olcum: {
      ayrilanKareler,
      egitim: p.egitim,
      refineMarks: (marks, n, cap) => { refineMarks = marks; finalN = n; finalCap = cap; },
    }, kamera: kameraSecenekleri,
    ...(depthSource ? { geometri: { kaynak: depthSource } } : {}),
    ...(p.depthWeight && depthSource ? { derinlikKisiti: {
      agirlik: p.depthWeight, kaynak: depthSource, bolgesel: p.bolgesel,
    } } : {}),
  });
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
    const hizalama = gt ? gtHizala(e.kayitliKameralar(), gt) : null;
    const bos = e.bosAlan ? bosAlanSiniri(e.bosAlan, birim, 0.04) : null;
    const bosMesafe = bos ? tabloYap((b, y) => {
      const camera = tabanKamera(pozlar, yukari, tur, BOLGELER[b]);
      const direction = y === 'sag' ? { forward: 0, right: 1, vertical: 0 }
        : y === 'sol' ? { forward: 0, right: -1, vertical: 0 }
          : y === 'ileri' ? { forward: 1, right: 0, vertical: 0 }
            : { forward: 0, right: 0, vertical: 1 };
      const target = flyStep(camera, direction, birim * 0.3, sinir, yukari, bos);
      const a = kameraMerkezi(camera), c = kameraMerkezi(target);
      return Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) / birim;
    }) : null;
    gunluk(`olcum: tur ${tur}, birim ${birim.toFixed(4)}, ${sondalar.length} sonda`);

    let gtBosOrnek = 0, gtEngelIhlali = 0, gtErisilirOrnek = 0, gtErisilirIhlal = 0;
    if (gt && hizalama && e.bosAlan) {
      const alan = e.bosAlan;
      const [nx, ny, nz] = alan.boyut;
      for (let index = 0; index < nx * ny * nz; index += 17) {
        if (vokselDurumuAt(alan, index) !== 'bos') continue;
        const x = index % nx, y = Math.floor(index / nx) % ny, z = Math.floor(index / (nx * ny));
        const point: [number, number, number] = [alan.min[0] + (x + 0.5) * alan.voksel,
          alan.min[1] + (y + 0.5) * alan.voksel, alan.min[2] + (z + 0.5) * alan.voksel];
        gtBosOrnek++;
        const ihlal = engelUzakligi(simUygula(hizalama.T, point), gt.tohum) < -alan.voksel * hizalama.T.s;
        if (ihlal) gtEngelIhlali++;
        if (bos && bos.aciklik[index] >= bos.yaricap) {
          gtErisilirOrnek++;
          if (ihlal) gtErisilirIhlal++;
        }
      }
    }
    if (hizalama) {
      const h = hizalama.ozet;
      gunluk(`olcum: GT hizalama rms ${h.rms.toFixed(4)} (yolun ${(h.rmsOrani * 100).toFixed(2)}%), ` +
        `açı ${h.aciHatasi.toFixed(2)}°, odak oranı ${h.odakOrani.toFixed(3)}, ${h.n} kamera`);
    }

    const pngler: Record<string, string> = {};
    const sonuclar: SondaSonucu[] = [];
    for (const [i, s] of sondalar.entries()) {
      const siyah = await cizimAl(e, s.kamera);
      const beyaz = await cizimAl(e, s.kamera, [1, 1, 1]);
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
      const tahmin = await cizimAl(e, kamera);
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
    const sureler = asamaSureleri(cizelge, tohumSonu, bittiMs, sonMs);
    const rapor: GezinmeRaporu = {
      surum: 1,
      etiket: p.etiket,
      klip: klipAdi,
      tarayici: navigator.userAgent,
      gpu: ayar.gpu,
      ayar: { ...ayar, ayrilan: p.ayrilan, genislik: p.genislik },
      tur,
      birim,
      sureler,
      sfm: { kayitli: kayitli.length, toplamKare },
      gauss,
      egitimOlcumu: egitimOlcumRaporu(ayar, p.egitim, refineMarks, finalN || gauss, finalCap, sureler.egitim ?? 0, ayrilan),
      ayrilan,
      sondalar: sonuclar,
      kullanilabilir,
      bugunku,
      mod: { ...kameraSecenekleri, geometri: p.geometri, depthWeight: p.depthWeight, bolgesel: p.bolgesel },
      ...(e.bosAlan && bosMesafe ? { bosAlan: {
        hizaliKare: e.derinlikOzeti?.hizaliKare ?? 0, voksel: e.bosAlan.voksel, boyut: e.bosAlan.boyut,
        kullanilabilir: bosMesafe, ...(e.gezinmeGuveni ? { guven: e.gezinmeGuveni } : {}),
        ...(gt ? { gtBosOrnek, gtEngelIhlali, gtErisilirOrnek, gtErisilirIhlal } : {}),
      } } : {}),
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
