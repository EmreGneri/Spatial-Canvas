/**
 * OFFLINE PAYLAŞIM KLİBİ — kare kare, deterministik render'ın saf parçaları.
 * DOM'suz: `scripts/verify-klip-render.mjs` doğrular. Tarayıcı tarafı
 * (WebGPU kare, mediabunny kodlama) `Egitim3D.tsx`'te; orada yalnız bu
 * modülün verdiği kamera/deform/derece değerleri uygulanır.
 *
 * Gerçek zamanlı kayıt (captureStream + MediaRecorder) yerine her kare tek
 * tek kurulur: kamera + deform ayarlanır, beklenir, çizilir, okunur,
 * kodlanır. rAF'a ve sekme görünürlüğüne bağlı değildir; ~300 ms'lik gürültü
 * deformu kare hızını düşürmez, yalnız render süresini uzatır.
 */
import { turAcisi } from './paylasim.ts';
import { cekimTuru, flySiniri, yolKamerasi } from './egitimControls.ts';
import {
  kameraMerkezi, yorunge, type DeformSettings, type Egitim, type GsKamera,
} from '../engine/reconstruction/egitim3dgs.ts';

type Vec3 = [number, number, number];

export type DeformChoice = 'yok' | 'yana' | 'yukari' | 'kubbe' | 'gurultu';
// The dome's usable range on real scenes is 0.3-0.6 of the ±90° rim angle;
// beyond ~0.6 the rigid continuation drops the scene off the rim.
export const KUBBE_TAM_GUC = 0.6;

export function deformAyari(choice: DeformChoice, strength: number): DeformSettings {
  if (choice === 'yok') return { kind: 'bend', strength: 0, direction: 'yana' };
  if (choice === 'kubbe') return { kind: 'dome', strength: strength * KUBBE_TAM_GUC };
  if (choice === 'gurultu') return { kind: 'noise', strength };
  return { kind: 'bend', strength, direction: choice };
}

export function deformGostergesi(choice: DeformChoice, strength: number): string {
  if (choice === 'yok') return 'yok';
  if (choice === 'gurultu') return `%${Math.round(strength * 100)}`;
  return `${Math.round(strength * (choice === 'kubbe' ? KUBBE_TAM_GUC : 1) * 90)}°`;
}

// ── zaman çizelgesi ───────────────────────────────────────────────────────

export const KLIP_FPS = 30;

export function kareSayisi(sureSn: number, fps = KLIP_FPS): number {
  return Math.round(sureSn * fps);
}

/** Smoothstep: 0→0, 1→1, eğim iki uçta 0 (ease-in/out). */
export function yumusak(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Deform zarfı, t ∈ [0, 1): ilk `rampa` içinde 0→1, ortada 1'de durur,
 * son `rampa` içinde 1→0. Kare t = i/n olduğundan n. kare 0. kareye eşit
 * olur: döngüye alınan klip sıçramaz (başı ve sonu eğitilmiş sahne). */
export function zarf(t: number, rampa = 0.3): number {
  return yumusak(t / rampa) * yumusak((1 - t) / rampa);
}

/** Klibin tepe gücü: kaydırıcı sıfırsa türün varsayılanı. Gürültü tam güçte
 * heykeli fazla oynatıyor (Görev 4b) — klipte 0,8 ile sınırlı, varsayılan 0,7. */
export function klipTepeGucu(tur: DeformChoice, kaydirici: number): number {
  if (tur === 'yok') return 0;
  const varsayilan = tur === 'gurultu' ? 0.7 : tur === 'kubbe' ? 1 : 0.6;
  const g = kaydirici !== 0 ? kaydirici : varsayilan;
  return tur === 'gurultu' ? Math.sign(g) * Math.min(Math.abs(g), 0.8) : g;
}

/** t anındaki deform. Gürültünün `time`'ı periyot 1 ile döner: t = 0 ve 1
 * aynı alan; gücü ayrıca zarf taşır (t = 0'daki alan eğitilmiş durum değil). */
export function klipDeformu(tur: DeformChoice, tepe: number, t: number): DeformSettings {
  if (tur === 'yok') return deformAyari('yok', 0);
  const s = tepe * zarf(t);
  if (tur === 'gurultu') return { kind: 'noise', strength: s, time: t };
  return deformAyari(tur, s);
}

export interface KameraAdimi { yaw: number; pitch: number; uzaklik: number }

/**
 * Kamera yolu: mevcut tur açısı (`turAcisi`) sinüsle salınıma çevrilir —
 * sahne ~100°'lik bir yayla çekildi, tam tur görülmemiş arka yüzü gösterirdi.
 * Deformla birlikte yükselir/uzaklaşır. Kubbe ancak yüksekten ve uzaktan
 * küçük gezegen okunur (Görev 3: ~40° yukarı, ~3× uzak) — tepede oraya varır.
 */
export function kameraYolu(tur: DeformChoice, t: number, salinim: number): KameraAdimi {
  const e = zarf(t);
  const yaw = salinim * Math.sin(turAcisi(t, 1));
  if (tur === 'yok') return { yaw, pitch: 0, uzaklik: 1 };
  if (tur === 'kubbe') return { yaw, pitch: -0.7 * e, uzaklik: 1 + 2 * e };
  if (tur === 'yukari') return { yaw, pitch: -0.25 * e, uzaklik: 1 + 0.3 * e };
  return { yaw, pitch: -0.15 * e, uzaklik: 1 + 0.15 * e };
}

/** Önce `yukari` etrafında yaw, sonra YENİ sağ eksende pitch + uzaklık. */
export function klipKamerasi(taban: GsKamera, pivot: Vec3, yukari: Vec3, a: KameraAdimi): GsKamera {
  const donmus = yorunge(taban, pivot, yukari, a.yaw, 0);
  return yorunge(donmus, pivot, yukari, 0, a.pitch, a.uzaklik);
}

/**
 * İleri yürüyüş çekimi (`cekimTuru` = 'yol'): pivot uzak arka planda, onun
 * etrafında salınmak kamerayı yolun dışına, hiç görülmemiş ormana atar.
 * Kamera kaydedilen yolda baştan sona yumuşakça yürür, yürürken bakılan yöne
 * bakar. Deformun yükselme/uzaklaşması (`kameraYolu`) kameranın `olcek`
 * önündeki noktaya göre uygulanır; 'yok'ta kamera tam yol pozudur. Döngüde
 * son kareden ilk kareye yol başına dönülür (ileri yürüyüş geri oynatılmaz).
 */
export function yolKlipKamerasi(
  pozlar: readonly GsKamera[], yukari: Vec3, olcek: number, tur: DeformChoice, t: number,
): GsKamera {
  const k = yolKamerasi(pozlar, yukari, yumusak(t));
  const a = kameraYolu(tur, t, 0);
  if (a.pitch === 0 && a.uzaklik === 1) return k;
  const C = kameraMerkezi(k);
  const onde: Vec3 = [C[0] + k.R[6] * olcek, C[1] + k.R[7] * olcek, C[2] + k.R[8] * olcek];
  return yorunge(k, onde, yukari, 0, a.pitch, a.uzaklik);
}

/**
 * Çekim yayının ortası: kameraların pivot etrafındaki açıları (`yukari`
 * ekseninde, `referans` merkezine göre, sağ el kuralı = `yorunge` yaw'ı).
 * `aci` referanstan yay ortasına dönüş; `salinim` = yarı açıklığın yarısı —
 * kamera çekilen yayın içinde kalır.
 */
export function yayOrtasi(kameralar: readonly Vec3[], pivot: Vec3, yukari: Vec3, referans: Vec3 = kameralar[0] ?? pivot) {
  const duz = (c: Vec3): Vec3 => {
    const v: Vec3 = [c[0] - pivot[0], c[1] - pivot[1], c[2] - pivot[2]];
    const d = v[0] * yukari[0] + v[1] * yukari[1] + v[2] * yukari[2];
    return [v[0] - d * yukari[0], v[1] - d * yukari[1], v[2] - d * yukari[2]];
  };
  const r = duz(referans);
  const acilar = kameralar.map((c) => {
    const v = duz(c);
    const x: Vec3 = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
    return Math.atan2(x[0] * yukari[0] + x[1] * yukari[1] + x[2] * yukari[2], r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  });
  if (acilar.length === 0) return { aci: 0, salinim: 0.3 };
  const min = Math.min(...acilar), max = Math.max(...acilar);
  return { aci: (min + max) / 2, salinim: (max - min) / 4 };
}

// ── kadraj ────────────────────────────────────────────────────────────────

export type KlipOrani = '16:9' | '9:16';

export function klipBoyutu(oran: KlipOrani, kisa = 1080): { w: number; h: number } {
  const uzun = Math.round((kisa * 16) / 9);
  return oran === '16:9' ? { w: uzun, h: kisa } : { w: kisa, h: uzun };
}

/** Kamerayı W×H çıktıya taşır. Kısa kenar görüş açısını korur: 9:16'da özne
 * yatay klipteki boyutunda kalır, kadraj yukarı/aşağı uzar. Asal nokta
 * kaydırması aynı ölçekle taşınır, çıktının ortasına göre. */
export function kadrajKamerasi(k: GsKamera, W: number, H: number): GsKamera {
  const s = Math.min(W, H) / Math.min(k.w, k.h);
  return {
    ...k,
    f: k.f * s,
    ...(k.fy != null ? { fy: k.fy * s } : {}),
    cx: W / 2 + (k.cx - k.w / 2) * s,
    cy: H / 2 + (k.cy - k.h / 2) * s,
    w: W,
    h: H,
  };
}

// ── renk derecelendirme + vinyet ──────────────────────────────────────────

export interface Derece { kontrast: number; doygunluk: number; sicaklik: number }
export const KLIP_DERECE: Derece = { kontrast: 0.25, doygunluk: 1.1, sicaklik: 0.04 };
export const KLIP_VINYET = 0.8;

/** S eğrisi: 0 ve 1 sabit, gölgeler iner — fade'in soluklaştırdığı uzak
 * floater'lar asla aydınlanmaz (siyah zemin siyah kalır). */
export function tonEgrisi(x: number, kontrast: number): number {
  return x + kontrast * (yumusak(x) - x);
}

/** Karanlık, eliptik vinyet çarpanı (merkez 1, köşe ≈ 1 − guc). */
export function vinyetMaskesi(w: number, h: number, guc: number): Float32Array {
  const m = new Float32Array(w * h);
  const hw = w / 2, hh = h / 2;
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5 - hh) / hh;
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - hw) / hw;
      const r = Math.hypot(dx, dy) / Math.SQRT2;
      m[y * w + x] = 1 - guc * yumusak((r - 0.35) / 0.65);
    }
  }
  return m;
}

/** RGBA pikselleri yerinde derecelendirir: doygunluk → ton eğrisi + sıcaklık
 * (kanal başına LUT) → vinyet. Alfa dokunulmaz. */
export function derecele(px: Uint8ClampedArray, maske: Float32Array, d: Derece): void {
  const lut = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  const kazanc = [1 + d.sicaklik, 1, 1 - d.sicaklik];
  for (let i = 0; i < 256; i++) {
    const y = tonEgrisi(i / 255, d.kontrast) * 255;
    for (let c = 0; c < 3; c++) lut[c][i] = y * kazanc[c];
  }
  const [lr, lg, lb] = lut;
  const s = d.doygunluk;
  for (let p = 0, i = 0; i < maske.length; i++, p += 4) {
    const r = px[p], g = px[p + 1], b = px[p + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const v = maske[i];
    const ri = Math.min(255, Math.max(0, Math.round(l + s * (r - l))));
    const gi = Math.min(255, Math.max(0, Math.round(l + s * (g - l))));
    const bi = Math.min(255, Math.max(0, Math.round(l + s * (b - l))));
    px[p] = lr[ri] * v;
    px[p + 1] = lg[gi] * v;
    px[p + 2] = lb[bi] * v;
  }
}

// ── kodlayıcı ─────────────────────────────────────────────────────────────

/** H.264/MP4 varsa o (her mecra açar), yoksa VP9/WebM. */
export async function klipKodlayici(
  kodlayabilir: (codec: 'avc' | 'vp9') => Promise<boolean>,
): Promise<{ kap: 'mp4' | 'webm'; codec: 'avc' | 'vp9' }> {
  if (await kodlayabilir('avc')) return { kap: 'mp4', codec: 'avc' };
  if (await kodlayabilir('vp9')) return { kap: 'webm', codec: 'vp9' };
  throw new Error('Bu tarayıcıda H.264 ya da VP9 video kodlayıcı yok');
}

// ── orkestra ──────────────────────────────────────────────────────────────

export interface KlipOturumu {
  deform(s: DeformSettings): Promise<void>;
  fade(on: boolean): Promise<void>;
}

/**
 * Kareleri sırayla üretir: fade açık, her kare için deform (değişmediyse
 * tekrar yazılmaz) BEKLENİR, sonra `kare(i, t)`. Denetleyici üst üste
 * çağrıda hata attığı için hiçbir çağrı paralel değildir. Başarı, iptal ya
 * da hata — sonunda kullanıcının önceki deform/fade ayarı geri yüklenir
 * (sıfır güç + fade kapalı = eğitilmiş durum, bit bit).
 */
export async function klipKareleri(
  o: KlipOturumu,
  tur: DeformChoice,
  tepe: number,
  n: number,
  onceki: { deform: DeformSettings; fade: boolean },
  kare: (i: number, t: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let renderError: unknown;
  try {
    await o.fade(true);
    let son = '';
    for (let i = 0; i < n; i++) {
      signal?.throwIfAborted();
      const t = i / n;
      if (tur !== 'yok') {
        const ayar = klipDeformu(tur, tepe, t);
        const anahtar = JSON.stringify(ayar);
        if (anahtar !== son) {
          await o.deform(ayar);
          son = anahtar;
        }
      }
      await kare(i, t);
    }
    signal?.throwIfAborted();
  } catch (error) {
    renderError = error;
    throw error;
  } finally {
    // The fade restore must run even if the deform restore throws (e.g. the
    // session closed mid-render), and a restore failure must never hide the
    // original render error above.
    try {
      if (tur !== 'yok') {
        await o.deform(onceki.deform);
      }
    } catch (restoreError) {
      if (!renderError) throw restoreError;
    } finally {
      await o.fade(onceki.fade);
    }
  }
}

export interface KlipSecimi {
  tur: DeformChoice;
  /** Kullanıcının kaydırıcı değeri; klip bittiğinde geri yüklenir. */
  kaydirici: number;
  /** Kullanıcının fade ayarı; klipte fade her zaman açık, sonra geri yüklenir. */
  fade: boolean;
  oran: KlipOrani;
  sureSn: number;
}

/**
 * Tarayıcı tarafı: kareleri `Egitim.kareCiz` ile çizer, derecelendirir,
 * imzalar ve mediabunny ile MP4'e (yoksa WebM) kodlar. `ev` = eğitimin ilk
 * kamerası; kamera yolu çekim yayının ortasından başlar. İleri yürüyüş
 * çekiminde (`cekimTuru` = 'yol') `ev` kullanılmaz: kamera kaydedilen yolu izler.
 */
export async function klipRenderEt(
  e: Egitim, ev: GsKamera, secim: KlipSecimi,
  ilerleme: (oran: number) => void, signal?: AbortSignal,
): Promise<{ blob: Blob; kap: 'mp4' | 'webm'; kareSayisi: number }> {
  const { w, h } = klipBoyutu(secim.oran);
  const n = kareSayisi(secim.sureSn);
  const yol = cekimTuru(e.pozlar) === 'yol';
  const olcek = flySiniri(e.kameralar, e.pivot, 'yol').olcek;
  const yay = yayOrtasi(e.kameralar, e.pivot, e.yukari, kameraMerkezi(ev));
  const taban = kadrajKamerasi(yorunge(ev, e.pivot, e.yukari, yay.aci, 0), w, h);
  const kamera = (t: number) => yol
    ? kadrajKamerasi(yolKlipKamerasi(e.pozlar, e.yukari, olcek, secim.tur, t), w, h)
    : klipKamerasi(taban, e.pivot, e.yukari, kameraYolu(secim.tur, t, yay.salinim));
  const ara = document.createElement('canvas');
  ara.width = w;
  ara.height = h;
  const ctx = ara.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  const maske = vinyetMaskesi(w, h, KLIP_VINYET);
  const { imzaCiz } = await import('./imzaCiz');
  // @ts-expect-error vendored JS, tip dosyası yok
  const mb = await import('../vendor/splat.js/vendor/mediabunny.min.mjs');
  const kod = await klipKodlayici((codec) => mb.canEncodeVideo(codec, { width: w, height: h }));
  const hedef = new mb.BufferTarget();
  const cikti = new mb.Output({
    format: kod.kap === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target: hedef,
  });
  const kaynak = new mb.CanvasSource(ara, { codec: kod.codec, bitrate: mb.QUALITY_HIGH });
  cikti.addVideoTrack(kaynak, { frameRate: KLIP_FPS });
  await cikti.start();
  try {
    await klipKareleri(e, secim.tur, klipTepeGucu(secim.tur, secim.kaydirici), n,
      { deform: deformAyari(secim.tur, secim.kaydirici), fade: secim.fade },
      async (i, t) => {
        e.kareCiz(kamera(t), ctx);
        const img = ctx.getImageData(0, 0, w, h);
        derecele(img.data, maske, KLIP_DERECE);
        ctx.putImageData(img, 0, 0);
        imzaCiz(ctx, w, h);
        await kaynak.add(i / KLIP_FPS, 1 / KLIP_FPS);
        ilerleme((i + 1) / n);
      }, signal);
    kaynak.close();
    await cikti.finalize();
  } catch (error) {
    await cikti.cancel().catch(() => undefined);
    throw error;
  }
  const tip = kod.kap === 'mp4' ? 'video/mp4' : 'video/webm';
  return { blob: new Blob([hedef.buffer], { type: tip }), kap: kod.kap, kareSayisi: n };
}
