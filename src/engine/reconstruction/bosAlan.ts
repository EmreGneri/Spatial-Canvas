// BOŞ ALAN IZGARASI — serbest gezinmenin sınırı (gezinme parça 3, görev 3;
// bkz. docs/plans/2026-09-27-gezinme-3-geometri.md).
//
// Seçilen karelerin (SfM ölçeğine hizalanmış) derinlik haritalarından bir
// hacim ızgarası kurulur: her örnek pikselin kamera ışını 3B DDA
// (Amanatides–Woo) ile izlenir; ışının yüzeyden bir voksel öncesine kadar
// geçtiği vokseller `bos`, yüzeyin düştüğü voksel `dolu` sayacını artırır.
// Sayaçlardan voksel durumu (`bos` / `dolu` / `bilinmiyor`), işaretli
// açıklık alanı (Felzenszwalb–Huttenlocher ayrılabilir EDT), zemin düzlemi
// (tohumlu RANSAC) ve çarpışmasız adım (`serbestAdim`) çıkar.
//
// Saf veri + fonksiyon: DOM/GPU yok; tarayıcıda (worker dahil) ve Node'da
// aynı çalışır. Dünya sözleşmesi `GsKamera` ile aynı (COLMAP: R satır
// sıralı dünya→kamera, x sağ, y AŞAĞI, z ileri; derinlik = kamera-uzayı z,
// ışın uzunluğu değil). Birimler SfM birimidir (metrik olmak zorunda değil).

import type { GsKamera } from './egitim3dgs.ts';
import { kameraMerkezi } from './egitim3dgs.ts';

export type Vec3 = [number, number, number];
export type VokselDurumu = 'bos' | 'dolu' | 'bilinmiyor';

/**
 * Hacim ızgarası. Voksel (ix, iy, iz) `[min + i·voksel, min + (i+1)·voksel)`
 * aralığını kaplar; düz indeks `ix + nx·(iy + ny·iz)`. Sayaçlar 65535'te
 * doyar (taşmaz). Kurulduktan sonra değiştirilmez kabul edilir
 * (`aciklikAt`'ın önbelleği buna dayanır).
 */
export interface BosAlan {
  /** Izgaranın alt köşesi (dünya). */
  min: Vec3;
  /** [nx, ny, nz] voksel sayısı. */
  boyut: [number, number, number];
  /** Voksel kenarı (dünya birimi). */
  voksel: number;
  /** Vokselden geçen (yüzeyden ≥ 1 voksel önce) ışın sayısı (ham). */
  bos: Uint16Array;
  /** Bu vokselden serbest geçen ışını olan FARKLI kare sayısı. Bir kare
   *  kameraya yakın vokselleri tek başına onlarca kez geçer; tek-göz
   *  derinliğinde tek bozuk kare bir engelin içinden `bos` oyabilir. `bos`
   *  durumu en az `enAzKare` farklı karenin kanıtını ister. */
  bosKare: Uint16Array;
  /** Yüzeyi bu voksele düşen ışın sayısı. */
  dolu: Uint16Array;
  /** `'bos'` için gereken en az farklı kare sayısı (bkz. `vokselDurumu`). */
  enAzKare: number;
}

export interface BosAlanKaresi {
  /** Kamera-uzayı z derinliği, satır sıralı `w*h`. NaN/≤ 0 = geçersiz,
   *  +Infinity = "hiçbir şey görmedi" (gökyüzü). */
  derinlik: Float32Array;
  /** Poz + içsel parametreler (`kamera.w`×`kamera.h` çözünürlüğünde olabilir;
   *  harita farklı boyuttaysa içseller orantılı ölçeklenir). */
  kamera: GsKamera;
  /** Harita boyutu; verilmezse `derinlik.length`'ten `kamera` oranıyla çıkarılır. */
  w?: number;
  h?: number;
}

export interface BosAlanSecenek {
  /** Voksel kenarı (dünya birimi). */
  voksel: number;
  /** Izgara sınırı. Verilmezse: kamera merkezleri ± 0.5·L yatay, en yüksek
   *  kameranın 0.3·L üstü, tahmini zeminin 0.2·L altı (L = kamera yolu uzunluğu). */
  sinir?: { min: Vec3; max: Vec3 };
  /** Her `adimPx` pikselden biri örneklenir (varsayılan 4). */
  adimPx?: number;
  /** Dünya "yukarı" ekseni (varsayılan sınır ve zemin tahmini için). */
  yukari: Vec3;
  /**
   * Sonsuz derinlik (ya da `enUzak`tan uzak) pikselin ışını ızgara sınırına
   * kadar `bos` sayılsın mı? Varsayılan HAYIR: tek-göz modelinde "uzak"
   * güvenilmez (disparite ≈ 0 → metrik derinlik patlar/NaN olur; dokusuz
   * duvar ya da ince dal da "uzak" görünebilir), bunu boşluk kanıtı saymak
   * gerçek geometriyi oyar. Yalnız sonsuzluğun GERÇEKTEN boşluk olduğu
   * kaynaklarda (analitik GT, gökyüzü dönüşü veren LiDAR) açın.
   */
  sonsuzBos?: boolean;
  /** Bundan büyük derinlikler "hiçbir şey görmedi" sayılır (`sonsuzBos`'a
   *  tabi). Varsayılan Infinity: sonlu her derinlik bir yüzeydir. */
  enUzak?: number;
  /** `'bos'` için en az kaç FARKLI karenin serbest geçişi gerekir (varsayılan 2). */
  enAzKare?: number;
  /** Keep this fraction of each finite ray uncarved before the estimated surface.
   *  Model depth is uncertain near occlusion edges; default 0 preserves the
   *  exact-depth behavior used by analytic and LiDAR sources. */
  guvenPayiOrani?: number;
}

export interface ZeminDuzlemi {
  /** Birim normal, `yukari` yönünde (n·yukari > 0). */
  n: Vec3;
  /** Düzlem: n·p + d = 0. */
  d: number;
  /** Düzleme `esik` içinde yakın `dolu` voksel sayısı. */
  destek: number;
}

/** Tek ızgaranın en çok voksel sayısı (16.8M: üç sayaç 100 MB + kurulumda
 *  geçici `sonKare` 34 MB; `aciklik` sonucu 67 MB + geçici ~84 MB) —
 *  tarayıcı belleği için. */
export const MAKS_VOKSEL = 1 << 24;
const DOYMA = 0xffff;

// ── küçük vektör yardımcıları ───────────────────────────────────────────

const ic = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const capraz = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function birim(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 0) || !Number.isFinite(l)) throw new RangeError('bosAlan: sıfır/sonlu olmayan vektör');
  return [v[0] / l, v[1] / l, v[2] / l];
}
/** `u`'ya dik iki birim eksen (u ile sağ el sistemi). */
function dikTaban(u: Vec3): [Vec3, Vec3] {
  const ax = Math.abs(u[0]), ay = Math.abs(u[1]), az = Math.abs(u[2]);
  const e: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const h1 = birim(capraz(u, e));
  const h2 = capraz(u, h1);
  return [h1, h2];
}

/** mulberry32: tohumlu, deterministik [0, 1) üreteci. */
function mulberry32(tohum: number): () => number {
  let s = tohum >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── harita ve ışın geometrisi ───────────────────────────────────────────

/** Harita boyutu: açık `w`/`h`, yoksa `kamera` oranıyla tek ölçekten. */
function haritaBoyutu(kare: BosAlanKaresi): [number, number] {
  const { derinlik, kamera } = kare;
  if (kare.w !== undefined || kare.h !== undefined) {
    const w = kare.w ?? kamera.w, h = kare.h ?? kamera.h;
    if (w * h !== derinlik.length) {
      throw new RangeError(`bosAlanKur: derinlik boyutu ${derinlik.length} ≠ ${w}×${h}`);
    }
    return [w, h];
  }
  if (derinlik.length === kamera.w * kamera.h) return [kamera.w, kamera.h];
  const s = Math.sqrt(derinlik.length / (kamera.w * kamera.h));
  const w = Math.round(kamera.w * s), h = Math.round(kamera.h * s);
  if (!(w > 0 && h > 0) || w * h !== derinlik.length) {
    throw new RangeError(
      `bosAlanKur: derinlik boyutu ${derinlik.length} kamera ${kamera.w}×${kamera.h} oranıyla çözülemedi; w/h verin`,
    );
  }
  return [w, h];
}

/**
 * Bir karenin örnek piksellerini gezer: `ziyaret(Dx, Dy, Dz, z)` — D dünya
 * yönü (kamera-uzayı z bileşeni 1 olacak ölçekte, birim DEĞİL; yüzey =
 * C + z·D), z ham derinlik. Piksel merkezi `(x + 0.5, y + 0.5)`, içseller
 * harita/kamera oranıyla ölçeklenir (`gtDerinlik` ile aynı sözleşme).
 */
function pikselleriGez(
  kare: BosAlanKaresi, adimPx: number,
  ziyaret: (Dx: number, Dy: number, Dz: number, z: number) => void,
): void {
  const k = kare.kamera;
  const [w, h] = haritaBoyutu(kare);
  const sx = w / k.w, sy = h / k.h;
  const f = k.f * sx, fy = (k.fy ?? k.f) * sy, cx = k.cx * sx, cy = k.cy * sy;
  const R = k.R, D = kare.derinlik;
  const bas = Math.floor(adimPx / 2) % adimPx;
  for (let py = Math.min(bas, h - 1); py < h; py += adimPx) {
    const yc = (py + 0.5 - cy) / fy;
    for (let px = Math.min(bas, w - 1); px < w; px += adimPx) {
      const xc = (px + 0.5 - cx) / f;
      ziyaret(
        R[0] * xc + R[3] * yc + R[6],
        R[1] * xc + R[4] * yc + R[7],
        R[2] * xc + R[5] * yc + R[8],
        D[py * w + px],
      );
    }
  }
}

// ── varsayılan sınır ────────────────────────────────────────────────────

/**
 * Sınır verilmezse: `yukari`ya dik iki yatay eksende kamera merkezlerinin
 * kapsamı ± 0.5·L; yukarıda en yüksek kamera + 0.3·L; aşağıda tahmini zemin
 * − 0.2·L (en fazla en alçak kameranın L altına). L = ardışık kamera
 * merkezleri arası yol uzunluğu (SfM biriminde ölçeksiz, bu yüzden paylar
 * L'nin kesri); L ≈ 0 ise örnek derinliklerin medyanı. Zemin tahmini: yatay
 * kutu içinde en alçak kameranın altına düşen yüzey noktalarının %5
 * yüzdeliği (zemin en alçak yüzeydir; nesneler üstündedir). Sonsuz/uzak
 * derinlikler sınırı ŞİŞİRMEZ: kutu yalnız kameralardan ve zeminden çıkar,
 * ızgara dışındaki yüzeylerin ışınları sınırda kesilir.
 * Yönlü kutunun dünya eksenli sarmalayıcısı döner.
 */
function varsayilanSinir(
  kareler: BosAlanKaresi[], yukari: Vec3, adimPx: number, enUzak: number,
): { min: Vec3; max: Vec3 } {
  const u = birim(yukari);
  const [h1, h2] = dikTaban(u);
  const merkezler = kareler.map((k) => kameraMerkezi(k.kamera) as Vec3);
  let L = 0;
  for (let i = 1; i < merkezler.length; i++) {
    const a = merkezler[i], b = merkezler[i - 1];
    L += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity, cMin = Infinity, cMax = -Infinity;
  for (const C of merkezler) {
    const a = ic(C, h1), b = ic(C, h2), c = ic(C, u);
    aMin = Math.min(aMin, a); aMax = Math.max(aMax, a);
    bMin = Math.min(bMin, b); bMax = Math.max(bMax, b);
    cMin = Math.min(cMin, c); cMax = Math.max(cMax, c);
  }

  // Yüzey noktaları: en alçak kameranın altındakiler (zemin adayı) + medyan için derinlikler.
  const alti: number[] = []; // [a, b, c] üçlüleri
  const derinlikler: number[] = [];
  for (let i = 0; i < kareler.length; i++) {
    const C = merkezler[i];
    pikselleriGez(kareler[i], adimPx, (Dx, Dy, Dz, z) => {
      if (!(z > 0) || !(z <= enUzak) || z === Infinity) return;
      derinlikler.push(z);
      const P: Vec3 = [C[0] + z * Dx, C[1] + z * Dy, C[2] + z * Dz];
      const c = ic(P, u);
      if (c < cMin) alti.push(ic(P, h1), ic(P, h2), c);
    });
  }
  if (!(L > 0)) {
    derinlikler.sort((x, y) => x - y);
    L = derinlikler.length ? derinlikler[derinlikler.length >> 1] : 1;
  }
  const yatay = 0.5 * L;
  const yukseklikler: number[] = [];
  for (let i = 0; i < alti.length; i += 3) {
    const a = alti[i], b = alti[i + 1];
    if (a >= aMin - yatay && a <= aMax + yatay && b >= bMin - yatay && b <= bMax + yatay) yukseklikler.push(alti[i + 2]);
  }
  let alt: number;
  if (yukseklikler.length) {
    yukseklikler.sort((x, y) => x - y);
    const zemin = yukseklikler[Math.floor(0.05 * (yukseklikler.length - 1))];
    alt = Math.max(zemin - 0.2 * L, cMin - L);
  } else {
    alt = cMin - 0.3 * L;
  }
  const ust = cMax + 0.3 * L;

  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const a of [aMin - yatay, aMax + yatay]) for (const b of [bMin - yatay, bMax + yatay]) for (const c of [alt, ust]) {
    for (let e = 0; e < 3; e++) {
      const p = a * h1[e] + b * h2[e] + c * u[e];
      if (p < min[e]) min[e] = p;
      if (p > max[e]) max[e] = p;
    }
  }
  return { min, max };
}

// ── ışın taşıma (Amanatides–Woo) ────────────────────────────────────────

/**
 * Izgara koordinatında (voksel birimi) `g0 + t·d` ışınının `[0, tSon)`
 * parçasının geçtiği her vokselin `bos` sayacını bir artırır (t dünya
 * birimi; `d` = birim yön / voksel). Vokselin son serbest geçişi başka bir
 * kareden geldiyse (`sonKare[i] ≠ etiket`) `bosKare` de artar; kareler
 * sırayla işlendiğinden farklı kare sayımı kesindir. Parça ızgara kutusuna kırpılır.
 * `haric` vokseline varınca durur (aynı ışının yüzey vokseli asla `bos`
 * sayılmaz — sıyırarak gelen ışında yüzey vokseli uzun bir kiriş taşır).
 */
function isinTasi(
  alan: BosAlan, sonKare: Uint16Array, etiket: number, g0x: number, g0y: number, g0z: number,
  dx: number, dy: number, dz: number, tSon: number, haric: number,
): void {
  const [nx, ny, nz] = alan.boyut;
  let tGir = 0, tCik = tSon;
  if (dx !== 0) {
    let a = -g0x / dx, b = (nx - g0x) / dx;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > tGir) tGir = a;
    if (b < tCik) tCik = b;
  } else if (g0x < 0 || g0x >= nx) return;
  if (dy !== 0) {
    let a = -g0y / dy, b = (ny - g0y) / dy;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > tGir) tGir = a;
    if (b < tCik) tCik = b;
  } else if (g0y < 0 || g0y >= ny) return;
  if (dz !== 0) {
    let a = -g0z / dz, b = (nz - g0z) / dz;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > tGir) tGir = a;
    if (b < tCik) tCik = b;
  } else if (g0z < 0 || g0z >= nz) return;
  if (!(tGir < tCik)) return;

  const kisit = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  let ix = kisit(Math.floor(g0x + tGir * dx), nx);
  let iy = kisit(Math.floor(g0y + tGir * dy), ny);
  let iz = kisit(Math.floor(g0z + tGir * dz), nz);
  const adX = dx > 0 ? 1 : -1, adY = dy > 0 ? 1 : -1, adZ = dz > 0 ? 1 : -1;
  let tMaxX = dx > 0 ? (ix + 1 - g0x) / dx : dx < 0 ? (ix - g0x) / dx : Infinity;
  let tMaxY = dy > 0 ? (iy + 1 - g0y) / dy : dy < 0 ? (iy - g0y) / dy : Infinity;
  let tMaxZ = dz > 0 ? (iz + 1 - g0z) / dz : dz < 0 ? (iz - g0z) / dz : Infinity;
  const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  const katman = nx * ny;
  const bos = alan.bos, bosKare = alan.bosKare;
  let i = ix + nx * iy + katman * iz;
  for (;;) {
    if (i === haric) return;
    if (bos[i] !== DOYMA) bos[i]++;
    if (sonKare[i] !== etiket) {
      sonKare[i] = etiket;
      if (bosKare[i] !== DOYMA) bosKare[i]++;
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      if (tMaxX >= tCik) return;
      ix += adX;
      if (ix < 0 || ix >= nx) return;
      i += adX; tMaxX += tDX;
    } else if (tMaxY < tMaxZ) {
      if (tMaxY >= tCik) return;
      iy += adY;
      if (iy < 0 || iy >= ny) return;
      i += adY * nx; tMaxY += tDY;
    } else {
      if (tMaxZ >= tCik) return;
      iz += adZ;
      if (iz < 0 || iz >= nz) return;
      i += adZ * katman; tMaxZ += tDZ;
    }
  }
}

/** Noktanın voksel indeksi; ızgara dışında −1. */
export function vokselIndeksi(alan: BosAlan, p: Vec3): number {
  const [nx, ny, nz] = alan.boyut, v = alan.voksel;
  const ix = Math.floor((p[0] - alan.min[0]) / v);
  const iy = Math.floor((p[1] - alan.min[1]) / v);
  const iz = Math.floor((p[2] - alan.min[2]) / v);
  if (!(ix >= 0 && ix < nx && iy >= 0 && iy < ny && iz >= 0 && iz < nz)) return -1;
  return ix + nx * (iy + ny * iz);
}

/**
 * Derinlik karelerinden boş alan ızgarası kurar. Her örnek piksel için
 * kamera merkezinden yüzeye 3B DDA: yüzeyden `voksel` kadar öncesine kadar
 * geçilen vokseller `bos++`, yüzeyin vokseli `dolu++`. Yüzey ızgara
 * dışındaysa ışın sınıra kadar `bos` sayılır (ışın o parçayı gerçekten
 * geçti). NaN/≤ 0 derinlik atlanır; sonsuz (ya da `enUzak`tan uzak)
 * derinlik yalnız `sonsuzBos` ile sınıra kadar `bos` olur (bkz. seçenek).
 */
export function bosAlanKur(kareler: BosAlanKaresi[], secenek: BosAlanSecenek): BosAlan {
  const v = secenek.voksel;
  if (!(v > 0) || !Number.isFinite(v)) throw new RangeError(`bosAlanKur: voksel ${v} geçersiz`);
  const adimPx = Math.max(1, Math.floor(secenek.adimPx ?? 4));
  const sonsuzBos = secenek.sonsuzBos ?? false;
  const enUzak = secenek.enUzak ?? Infinity;
  const enAzKare = Math.max(1, Math.floor(secenek.enAzKare ?? 2));
  const guvenPayiOrani = secenek.guvenPayiOrani ?? 0;
  if (!(guvenPayiOrani >= 0 && guvenPayiOrani < 1)) throw new RangeError('bosAlanKur: güven payı 0..1 arasında olmalı');
  for (const k of kareler) haritaBoyutu(k); // boyut hatası ızgara ayrılmadan yakalanır

  const sinir = secenek.sinir ?? varsayilanSinir(kareler, secenek.yukari, adimPx, enUzak);
  const min: Vec3 = [sinir.min[0], sinir.min[1], sinir.min[2]];
  const boyut = [0, 1, 2].map((a) => {
    const n = Math.ceil((sinir.max[a] - sinir.min[a]) / v - 1e-9);
    if (!(n >= 1)) throw new RangeError(`bosAlanKur: sınır ekseni ${a} boş (${sinir.min[a]} … ${sinir.max[a]})`);
    return n;
  }) as [number, number, number];
  const toplam = boyut[0] * boyut[1] * boyut[2];
  if (toplam > MAKS_VOKSEL) {
    throw new RangeError(`bosAlanKur: ${boyut.join('×')} voksel sınırı (${MAKS_VOKSEL}) aşıyor; vokseli büyütün`);
  }
  const alan: BosAlan = {
    min, boyut, voksel: v, enAzKare,
    bos: new Uint16Array(toplam), bosKare: new Uint16Array(toplam), dolu: new Uint16Array(toplam),
  };
  const dolu = alan.dolu;
  // Vokselin son serbest geçişini yazan kare etiketi (0 = hiç). Etiket
  // `k mod 65535 + 1`: ardışık kareler hep farklıdır; yalnız aradaki 65534
  // karede hiç dokunulmamış bir voksel tam 65535 kare arayla tekrar
  // geçilirse bir artış kaçar (sayaç zaten 65535'te doyar).
  const sonKare = new Uint16Array(toplam);

  for (let k = 0; k < kareler.length; k++) {
    const kare = kareler[k];
    const etiket = (k % DOYMA) + 1;
    const C = kameraMerkezi(kare.kamera);
    const g0x = (C[0] - min[0]) / v, g0y = (C[1] - min[1]) / v, g0z = (C[2] - min[2]) / v;
    pikselleriGez(kare, adimPx, (Dx, Dy, Dz, z) => {
      if (!(z > 0)) return; // NaN, 0, negatif: geçersiz
      const Dn = Math.hypot(Dx, Dy, Dz);
      const dx = Dx / Dn / v, dy = Dy / Dn / v, dz = Dz / Dn / v; // voksel / dünya birimi
      if (z === Infinity || z > enUzak) {
        if (sonsuzBos) isinTasi(alan, sonKare, etiket, g0x, g0y, g0z, dx, dy, dz, Infinity, -1);
        return;
      }
      const L = z * Dn; // ışın boyunca yüzeye dünya uzaklığı
      const ix = Math.floor(g0x + L * dx), iy = Math.floor(g0y + L * dy), iz = Math.floor(g0z + L * dz);
      let yuzey = -1;
      if (ix >= 0 && ix < boyut[0] && iy >= 0 && iy < boyut[1] && iz >= 0 && iz < boyut[2]) {
        yuzey = ix + boyut[0] * (iy + boyut[1] * iz);
      }
      isinTasi(alan, sonKare, etiket, g0x, g0y, g0z, dx, dy, dz,
        L - Math.max(v, guvenPayiOrani * L), yuzey);
      if (yuzey >= 0 && dolu[yuzey] !== DOYMA) dolu[yuzey]++;
    });
  }
  return alan;
}

// ── durum ───────────────────────────────────────────────────────────────

/**
 * Sayaç kuralı: `bos ≥ 2`, `dolu ≤ 0.1·bos` ve en az `enAzKare` farklı
 * karenin serbest geçişi (`bosKare`) → 'bos'; aksi `dolu ≥ 2` → 'dolu';
 * aksi 'bilinmiyor'.
 */
export function vokselDurumu(bos: number, dolu: number, bosKare: number, enAzKare = 2): VokselDurumu {
  if (bos >= 2 && dolu * 10 <= bos && bosKare >= enAzKare) return 'bos';
  if (dolu >= 2) return 'dolu';
  return 'bilinmiyor';
}

/** `alan`'ın `i` indeksli vokselinin durumu. */
export function vokselDurumuAt(alan: BosAlan, i: number): VokselDurumu {
  return vokselDurumu(alan.bos[i], alan.dolu[i], alan.bosKare[i], alan.enAzKare);
}

/** `p`'nin vokselinin durumu; ızgara dışı 'bilinmiyor'. */
export function durum(alan: BosAlan, p: Vec3): VokselDurumu {
  const i = vokselIndeksi(alan, p);
  return i < 0 ? 'bilinmiyor' : vokselDurumuAt(alan, i);
}

// ── uzaklık dönüşümü ────────────────────────────────────────────────────

const EDT_SONSUZ = 1e20;

/** Felzenszwalb–Huttenlocher 1B kare uzaklık dönüşümü (alt zarf parabolleri). */
function edt1B(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = f[q] + q * q;
    let s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    while (s <= z[k]) {
      k--;
      s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = q - v[k];
    d[q] = r * r + f[v[k]];
  }
}

/** `out`'un `b`'den `adim` aralıklı `uzunluk` elemanlık doğrusunu yerinde dönüştürür. */
function edtHat(
  out: Float32Array, b: number, uzunluk: number, adim: number,
  f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array,
): void {
  let tohum = false;
  for (let q = 0, i = b; q < uzunluk; q++, i += adim) {
    const x = out[i];
    f[q] = x;
    if (x < EDT_SONSUZ) tohum = true;
  }
  if (!tohum) return; // tüm doğru sonsuz: değişmez
  edt1B(f, uzunluk, d, v, z);
  for (let q = 0, i = b; q < uzunluk; q++, i += adim) out[i] = d[q];
}

/**
 * Tam 3B öklid KARE uzaklık dönüşümü (voksel birimi): her voksel için
 * `maske[i] ≠ 0` olan en yakın voksele kare uzaklık; hiç tohum yoksa
 * Infinity. Ayrılabilir (x, y, z geçişleri), O(n). `cikti` verilirse oraya yazar.
 */
export function edt3B(
  maske: Uint8Array, boyut: [number, number, number], cikti?: Float32Array,
): Float32Array {
  const [nx, ny, nz] = boyut;
  const n = nx * ny * nz;
  if (maske.length !== n) throw new RangeError(`edt3B: maske ${maske.length} ≠ ${n}`);
  const out = cikti ?? new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = maske[i] ? 0 : EDT_SONSUZ;
  const m = Math.max(nx, ny, nz);
  const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);

  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) edtHat(out, nx * (iy + ny * iz), nx, 1, f, d, v, z);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) edtHat(out, ix + nx * ny * iz, ny, nx, f, d, v, z);
  for (let i = 0, katman = nx * ny; i < katman; i++) edtHat(out, i, nz, katman, f, d, v, z);
  for (let i = 0; i < n; i++) if (out[i] >= EDT_SONSUZ * 0.5) out[i] = Infinity;
  return out;
}

/**
 * İşaretli açıklık alanı (dünya birimi), voksel merkezlerinde:
 * - `'bos'` voksel: en yakın `'bos'` OLMAYAN voksele (ızgara dışı da
 *   bilinmiyor sayılır) merkezden merkeze uzaklık − voksel/2 ≥ 0.5·voksel.
 *   Sınır iki merkezin ortasındaki yüzde kabul edilir: açıklık ≈ serbest
 *   bölgenin sınırına uzaklık.
 * - Diğerleri: −(en yakın `'bos'` voksele uzaklık − voksel/2) ≤ −0.5·voksel
 *   (hiç `'bos'` yoksa ızgara köşegeniyle sınırlı).
 * İşaret sayesinde bilinmeyen/dolu bölgenin içinde de bir eğim vardır:
 * `serbestAdim` dışarıdan boşluğa dönüşü buna göre izin verir. Tam
 * Felzenszwalb–Huttenlocher EDT (ayrılabilir, O(n)).
 */
export function aciklik(alan: BosAlan): Float32Array {
  const [nx, ny, nz] = alan.boyut;
  const n = nx * ny * nz, v = alan.voksel;
  const maske = new Uint8Array(n);
  for (let i = 0; i < n; i++) maske[i] = vokselDurumuAt(alan, i) === 'bos' ? 0 : 1;
  const disari = edt3B(maske, alan.boyut); // bos vokseller: en yakın bos-olmayana
  for (let i = 0; i < n; i++) maske[i] ^= 1;
  const iceri = edt3B(maske, alan.boyut); // bos-olmayanlar: en yakın bos'a
  const kosegen = Math.hypot(nx, ny, nz);
  const out = disari;
  let i = 0;
  for (let iz = 0; iz < nz; iz++) {
    const kz = Math.min(iz + 1, nz - iz);
    for (let iy = 0; iy < ny; iy++) {
      const kyz = Math.min(kz, iy + 1, ny - iy);
      for (let ix = 0; ix < nx; ix++, i++) {
        if (maske[i]) {
          const kenar = Math.min(kyz, ix + 1, nx - ix);
          out[i] = (Math.min(Math.sqrt(disari[i]), kenar) - 0.5) * v;
        } else {
          out[i] = -(Math.min(Math.sqrt(iceri[i]), kosegen) - 0.5) * v;
        }
      }
    }
  }
  return out;
}

const aciklikOnbellegi = new WeakMap<BosAlan, Float32Array>();

/**
 * `p`'de açıklık (trilineer, voksel merkezleri arasında). `izgara` verilmezse
 * `aciklik(alan)` bir kez hesaplanıp alan başına önbelleklenir. Izgara
 * dışında: sınırdaki değerin en fazla 0'ı eksi kutuya uzaklık (bilinmiyor,
 * uzaklaştıkça azalır).
 */
export function aciklikAt(alan: BosAlan, p: Vec3, izgara?: Float32Array): number {
  let g = izgara ?? aciklikOnbellegi.get(alan);
  if (!g) {
    g = aciklik(alan);
    aciklikOnbellegi.set(alan, g);
  }
  const [nx, ny] = alan.boyut, v = alan.voksel;
  let disari2 = 0;
  const idx0 = [0, 0, 0], idx1 = [0, 0, 0], kesir = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const n = alan.boyut[a];
    const lo = alan.min[a], hi = lo + n * v;
    let q = p[a];
    if (q < lo) { disari2 += (lo - q) ** 2; q = lo; } else if (q > hi) { disari2 += (q - hi) ** 2; q = hi; }
    let s = (q - lo) / v - 0.5;
    if (s < 0) s = 0; else if (s > n - 1) s = n - 1;
    const i0 = Math.min(Math.floor(s), n - 1);
    idx0[a] = i0; idx1[a] = Math.min(i0 + 1, n - 1); kesir[a] = s - i0;
  }
  const at = (x: number, y: number, z: number) => g![x + nx * (y + ny * z)];
  const [x0, y0, z0] = idx0, [x1, y1, z1] = idx1, [fx, fy, fz] = kesir;
  const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx;
  const c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx;
  const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx;
  const c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx;
  const deger = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  return disari2 > 0 ? Math.min(deger, 0) - Math.sqrt(disari2) : deger;
}

// ── zemin ───────────────────────────────────────────────────────────────

/**
 * `'dolu'` voksel merkezleri üzerinde deterministik (tohumlu) RANSAC:
 * normali `yukari` ile ≤ `aciDerece` (15°) olan, en çok destekli düzlem.
 * Her yeni en iyi aday, iç noktalarına en küçük kareler ile inceltilir;
 * inceltilmiş normal koniden çıkarsa aday reddedilir (eğik bir yüzeyin
 * yataya denk gelen şeridi zemin sayılmaz). Döner `{ n, d, destek }`
 * (n·p + d = 0, n `yukari` yönünde) ya da null.
 */
export function zeminBul(
  alan: BosAlan, yukari: Vec3,
  secenek: { tohum?: number; deneme?: number; esik?: number; aciDerece?: number } = {},
): ZeminDuzlemi | null {
  const u = birim(yukari);
  const esik = secenek.esik ?? alan.voksel;
  const deneme = secenek.deneme ?? 300;
  const cosMax = Math.cos(((secenek.aciDerece ?? 15) * Math.PI) / 180);
  const [nx, ny] = alan.boyut, v = alan.voksel;

  let m = 0;
  for (let i = 0; i < alan.dolu.length; i++) if (vokselDurumuAt(alan, i) === 'dolu') m++;
  if (m < 3) return null;
  const P = new Float64Array(3 * m);
  for (let i = 0, j = 0; i < alan.dolu.length; i++) {
    if (vokselDurumuAt(alan, i) !== 'dolu') continue;
    const iz = Math.floor(i / (nx * ny)), r = i - iz * nx * ny, iy = Math.floor(r / nx), ix = r - iy * nx;
    P[j++] = alan.min[0] + (ix + 0.5) * v;
    P[j++] = alan.min[1] + (iy + 0.5) * v;
    P[j++] = alan.min[2] + (iz + 0.5) * v;
  }
  // Puanlama için deterministik alt örnek (en fazla ~20k nokta).
  const adim = Math.max(1, Math.floor(m / 20000));
  const say = (n: Vec3, d: number, hepsi: boolean): number => {
    let c = 0;
    const s = hepsi ? 1 : adim;
    for (let k = 0; k < m; k += s) {
      if (Math.abs(n[0] * P[3 * k] + n[1] * P[3 * k + 1] + n[2] * P[3 * k + 2] + d) <= esik) c++;
    }
    return c;
  };
  /** İç noktalara (normal yönündeki artığa) en küçük kareler; koniden çıkarsa null. */
  const incelt = (n0: Vec3, d0: number): { n: Vec3; d: number } | null => {
    let n = n0, d = d0;
    for (let tur = 0; tur < 3; tur++) {
      const [e1, e2] = dikTaban(n);
      let c = 0, mx = 0, my = 0, mz = 0;
      for (let k = 0; k < m; k++) {
        const x = P[3 * k], y = P[3 * k + 1], z = P[3 * k + 2];
        if (Math.abs(n[0] * x + n[1] * y + n[2] * z + d) > esik) continue;
        c++; mx += x; my += y; mz += z;
      }
      if (c < 3) return null;
      const o: Vec3 = [mx / c, my / c, mz / c];
      let Saa = 0, Sab = 0, Sbb = 0, Sac = 0, Sbc = 0;
      for (let k = 0; k < m; k++) {
        const x = P[3 * k], y = P[3 * k + 1], z = P[3 * k + 2];
        if (Math.abs(n[0] * x + n[1] * y + n[2] * z + d) > esik) continue;
        const q: Vec3 = [x - o[0], y - o[1], z - o[2]];
        const a = ic(q, e1), b = ic(q, e2), h = ic(q, n);
        Saa += a * a; Sab += a * b; Sbb += b * b; Sac += a * h; Sbc += b * h;
      }
      const det = Saa * Sbb - Sab * Sab;
      if (!(Math.abs(det) > 1e-12 * (Saa * Sbb + 1e-30))) return null; // iç noktalar doğrusal
      const alfa = (Sac * Sbb - Sbc * Sab) / det, beta = (Sbc * Saa - Sac * Sab) / det;
      let yeni = birim([n[0] - alfa * e1[0] - beta * e2[0], n[1] - alfa * e1[1] - beta * e2[1], n[2] - alfa * e1[2] - beta * e2[2]]);
      if (ic(yeni, u) < 0) yeni = [-yeni[0], -yeni[1], -yeni[2]];
      if (ic(yeni, u) < cosMax) return null;
      n = yeni; d = -ic(n, o);
    }
    return { n, d };
  };

  const rng = mulberry32(secenek.tohum ?? 0x5eed);
  let en: ZeminDuzlemi | null = null;
  let enPuan = 0;
  for (let it = 0; it < deneme; it++) {
    const i = Math.floor(rng() * m), j = Math.floor(rng() * m), k = Math.floor(rng() * m);
    if (i === j || j === k || i === k) continue;
    const a: Vec3 = [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
    const b: Vec3 = [P[3 * j] - a[0], P[3 * j + 1] - a[1], P[3 * j + 2] - a[2]];
    const c: Vec3 = [P[3 * k] - a[0], P[3 * k + 1] - a[1], P[3 * k + 2] - a[2]];
    const x = capraz(b, c);
    const l = Math.hypot(x[0], x[1], x[2]);
    if (!(l > 1e-12)) continue;
    let n: Vec3 = [x[0] / l, x[1] / l, x[2] / l];
    if (ic(n, u) < 0) n = [-n[0], -n[1], -n[2]];
    if (ic(n, u) < cosMax) continue;
    const puan = say(n, -ic(n, a), false);
    if (puan <= enPuan) continue;
    const ince = incelt(n, -ic(n, a));
    if (!ince) continue;
    const destek = say(ince.n, ince.d, true);
    if (destek < 3) continue;
    enPuan = puan;
    if (!en || destek > en.destek) en = { n: ince.n, d: ince.d, destek };
  }
  return en;
}

// ── serbest adım ────────────────────────────────────────────────────────

/**
 * C'den `hedef`e hareketi boş alanla sınırlar. İzinli küme: vokseli `'bos'`
 * ve açıklığı ≥ `yaricap` olan noktalar.
 * - C izinliyse: C→hedef doğrusu en fazla voksel/2 aralıkla örneklenir
 *   (tek hedef testi ince bir engelin içinden "tünel" açabilirdi); hepsi
 *   izinliyse hedef aynen döner, değilse ilk izinsiz örnek ile önceki
 *   arasında ikili aramayla izin verilen en uzak nokta.
 * - C izinli değilse (bilinmeyende ya da engele fazla yakın): yalnız
 *   açıklığı C'dekinin altına düşürmeyen hareket; izinli kümeye girilince
 *   oradan itibaren normal kural geçerlidir.
 */
export function serbestAdim(
  alan: BosAlan, aciklikIzgarasi: Float32Array, C: Vec3, hedef: Vec3, yaricap: number,
): Vec3 {
  const fark: Vec3 = [hedef[0] - C[0], hedef[1] - C[1], hedef[2] - C[2]];
  const uzunluk = Math.hypot(fark[0], fark[1], fark[2]);
  if (!(uzunluk > 0)) return [hedef[0], hedef[1], hedef[2]];
  const nokta = (s: number): Vec3 => [C[0] + s * fark[0], C[1] + s * fark[1], C[2] + s * fark[2]];
  const acik = (p: Vec3) => aciklikAt(alan, p, aciklikIzgarasi);
  const izinli = (p: Vec3) => durum(alan, p) === 'bos' && acik(p) >= yaricap;

  const c0 = acik(C);
  const tolerans = 1e-6 * alan.voksel;
  let kurtarma = !izinli(C);
  const kurtarmaUygun = (p: Vec3) => izinli(p) || acik(p) >= c0 - tolerans;

  const n = Math.max(1, Math.ceil(uzunluk / (0.5 * alan.voksel)));
  let sOnce = 0;
  for (let k = 1; k <= n; k++) {
    const s = k / n;
    const p = nokta(s);
    let uygun: boolean;
    if (kurtarma) {
      if (izinli(p)) { kurtarma = false; uygun = true; } else uygun = acik(p) >= c0 - tolerans;
    } else {
      uygun = izinli(p);
    }
    if (uygun) { sOnce = s; continue; }
    const kosul = kurtarma ? kurtarmaUygun : izinli;
    let lo = sOnce, hi = s;
    for (let t = 0; t < 30; t++) {
      const orta = 0.5 * (lo + hi);
      if (kosul(nokta(orta))) lo = orta; else hi = orta;
    }
    return nokta(lo);
  }
  return [hedef[0], hedef[1], hedef[2]];
}
