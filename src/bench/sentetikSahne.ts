// SENTETİK ORMAN YOLU — saf sahne tanımı (three.js YOK, DOM YOK).
//
// Görev 3 (docs/plans/2026-09-27-gezinme-1-olcum.md): gezinme ölçümünün
// yan-bakış referansı (ground truth) için tohumlu, deterministik bir orman
// yolu sahnesi. Bu dosya yalnız SAYI üretir (kamera pozları, nesne listesi,
// analitik engel uzaklığı); çizim `sentetikCizim.ts`'te (three.js) yapılır.
//
// Dünya sözleşmesi `GsKamera` ile birebir aynı (COLMAP): x sağ, y AŞAĞI,
// z ileri. Zemin `y = ZEMIN_Y` (göz yüksekliği ~0), yürüyüş +z yönünde.
import type { GsKamera } from '../engine/reconstruction/egitim3dgs.ts';

export type Vec3 = [number, number, number];

// ── dünya sabitleri ──────────────────────────────────────────────────────

/** Dünya "yukarı" ekseni; y aşağı olduğundan yukarısı −y'dir. */
export const YUKARI: Vec3 = [0, -1, 0];
/** Zemin düzlemi (y aşağı: göz hizası 0, zemin bunun altında). */
export const ZEMIN_Y = 1.6;
/** Uzak fon duvarının z konumu. */
export const FON_Z = 34;
/** Kaydedilen yolun uzunluğu (z: 0 → bu değer). */
export const YOL_UZUNLUK = 14;

/** Klip/GT kamerasının içsel parametreleri. */
export const SAHNE_GENISLIK = 960;
export const SAHNE_YUKSEKLIK = 540;
export const SAHNE_F = SAHNE_GENISLIK * 0.9;
export const SAHNE_CX = SAHNE_GENISLIK / 2;
export const SAHNE_CY = SAHNE_YUKSEKLIK / 2;

/** Patikanın boş kalan yarı genişliği (|x| < bu değer nesnesiz). */
export const PATIKA_YARI_GENISLIK = 0.9;
const NESNE_X_MIN = 1.2;
const NESNE_X_MAX = 7;
const NESNE_Z_MIN = -2;
const NESNE_Z_MAX = 26;

export const AGAC_SAYISI = 70;
export const CALI_SAYISI = 40;
const AGAC_R_MIN = 0.12;
const AGAC_R_MAX = 0.35;
// Kamera hiç yukarı bakmasa da gövde çerçevenin üstünden taşsın diye uzun.
const AGAC_YUKSEKLIK_MIN = 9;
const AGAC_YUKSEKLIK_MAX = 15;
const CALI_R_MIN = 0.2;
const CALI_R_MAX = 0.5;

/** Klibin kullandığı sabit tohum: `yolPozu` sahneden bağımsızdır, yalnız
 * `sahneTanimi`/`engelUzakligi`'nin varsayılanı budur. */
export const VARSAYILAN_TOHUM = 20260927;

// ── mulberry32 (tohumlu, deterministik PRNG) ─────────────────────────────

/** [0, 1) döner; aynı tohum aynı diziyi üretir. `sentetikCizim.ts` doku
 * üretiminde de bunu kullanır — tek bir gürültü kaynağı. */
export function mulberry32(tohum: number): () => number {
  let s = tohum >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── sahne nesneleri ───────────────────────────────────────────────────────

export interface Govde {
  tur: 'govde';
  x: number; y: number; z: number;
  r: number; yukseklik: number;
  dokuTohumu: number;
  renk: Vec3;
}
export interface Cali {
  tur: 'cali';
  x: number; y: number; z: number;
  r: number;
  dokuTohumu: number;
  renk: Vec3;
}
export interface Zemin {
  tur: 'zemin';
  xMin: number; xMax: number; zMin: number; zMax: number;
  dokuTohumu: number;
}
export interface Fon {
  tur: 'fon';
  xMin: number; xMax: number; yMin: number; yMax: number; z: number;
  dokuTohumu: number;
}
export type SahneNesnesi = Govde | Cali | Zemin | Fon;

export interface SahneVerisi {
  tohum: number;
  nesneler: SahneNesnesi[];
}

const onbellek = new Map<number, SahneVerisi>();

/** Tohumlu sahne içeriği: patikanın iki yanında gövdeler ve çalılar, zemin
 * düzlemi, uzak fon duvarı. Aynı tohum her zaman aynı sahneyi üretir. */
export function sahneTanimi(tohum: number): SahneVerisi {
  const onceki = onbellek.get(tohum);
  if (onceki) return onceki;

  const rng = mulberry32(tohum);
  const nesneler: SahneNesnesi[] = [];

  const yanlisX = () => {
    const taraf = rng() < 0.5 ? -1 : 1;
    return taraf * (NESNE_X_MIN + rng() * (NESNE_X_MAX - NESNE_X_MIN));
  };
  const rastgeleZ = () => NESNE_Z_MIN + rng() * (NESNE_Z_MAX - NESNE_Z_MIN);

  for (let i = 0; i < AGAC_SAYISI; i++) {
    const x = yanlisX();
    const z = rastgeleZ();
    const r = AGAC_R_MIN + rng() * (AGAC_R_MAX - AGAC_R_MIN);
    const yukseklik = AGAC_YUKSEKLIK_MIN + rng() * (AGAC_YUKSEKLIK_MAX - AGAC_YUKSEKLIK_MIN);
    const renk: Vec3 = [0.32 + rng() * 0.10, 0.22 + rng() * 0.07, 0.14 + rng() * 0.05];
    nesneler.push({
      tur: 'govde', x, y: ZEMIN_Y - yukseklik / 2, z, r, yukseklik,
      dokuTohumu: (rng() * 0x7fffffff) | 0, renk,
    });
  }
  for (let i = 0; i < CALI_SAYISI; i++) {
    const x = yanlisX();
    const z = rastgeleZ();
    const r = CALI_R_MIN + rng() * (CALI_R_MAX - CALI_R_MIN);
    const renk: Vec3 = [0.17 + rng() * 0.09, 0.30 + rng() * 0.11, 0.11 + rng() * 0.05];
    nesneler.push({
      tur: 'cali', x, y: ZEMIN_Y - r, z, r,
      dokuTohumu: (rng() * 0x7fffffff) | 0, renk,
    });
  }
  nesneler.push({
    tur: 'zemin',
    xMin: -12, xMax: 12, zMin: NESNE_Z_MIN - 2, zMax: FON_Z + 1,
    dokuTohumu: (rng() * 0x7fffffff) | 0,
  });
  nesneler.push({
    tur: 'fon',
    xMin: -24, xMax: 24, yMin: -30, yMax: ZEMIN_Y + 2, z: FON_Z,
    dokuTohumu: (rng() * 0x7fffffff) | 0,
  });

  const sonuc: SahneVerisi = { tohum, nesneler };
  onbellek.set(tohum, sonuc);
  return sonuc;
}

// ── GT kamera yolu ────────────────────────────────────────────────────────

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const caprazCarpim = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Yatay ufuk seviyeli, `ileri` yönüne bakan kamera (`C` merkezinde). */
function bakanKamera(C: Vec3, ileri: Vec3): GsKamera {
  const z = norm(ileri);
  const x = norm(caprazCarpim([-YUKARI[0], -YUKARI[1], -YUKARI[2]], z));
  const y = caprazCarpim(z, x);
  const R = [...x, ...y, ...z];
  const t: Vec3 = [0, 1, 2].map(
    (r) => -(R[r * 3] * C[0] + R[r * 3 + 1] * C[1] + R[r * 3 + 2] * C[2]),
  ) as Vec3;
  return { R, t, f: SAHNE_F, cx: SAHNE_CX, cy: SAHNE_CY, w: SAHNE_GENISLIK, h: SAHNE_YUKSEKLIK };
}

const MEANDER_GENLIK = 0.15;
const MEANDER_HZ = 1.5;
const BOB_GENLIK = 0.03;
const BOB_HZ = 12;
const YAW_GENLIK = (4 * Math.PI) / 180;
const YAW_HZ = 6;

/**
 * GT kamerası, patika üzerinde `t01` ∈ [0, 1] (0 = başlangıç, 1 = son).
 * z 0 → `YOL_UZUNLUK`, hafif x kıvrımı, yürüyüş salınımı (y), ±4° bakış
 * sapması (yaw). Sahneden bağımsızdır (tohum almaz).
 */
export function yolPozu(t01: number): GsKamera {
  const t = Math.min(1, Math.max(0, t01));
  const z = t * YOL_UZUNLUK;
  const x = MEANDER_GENLIK * Math.sin(2 * Math.PI * MEANDER_HZ * t);
  const y = BOB_GENLIK * Math.sin(2 * Math.PI * BOB_HZ * t);
  const yaw = YAW_GENLIK * Math.sin(2 * Math.PI * YAW_HZ * t);
  const ileri: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  return bakanKamera([x, y, z], ileri);
}

// ── analitik engel uzaklığı ───────────────────────────────────────────────

/**
 * `p`'nin en yakın gövde/çalı yüzeyine ve zemine işaretli uzaklığı (içeride
 * negatif). Gövdeler dikey eksende sonsuz kabul edilir (yalnız x/z'ye göre
 * dairesel uzaklık); çalılar tam küre (3B uzaklık). 3. parçanın GT boş alanı.
 */
export function engelUzakligi(p: Vec3, tohum: number = VARSAYILAN_TOHUM): number {
  const sahne = sahneTanimi(tohum);
  let en = Infinity;
  for (const n of sahne.nesneler) {
    if (n.tur === 'govde') {
      const d = Math.hypot(p[0] - n.x, p[2] - n.z) - n.r;
      if (d < en) en = d;
    } else if (n.tur === 'cali') {
      const d = Math.hypot(p[0] - n.x, p[1] - n.y, p[2] - n.z) - n.r;
      if (d < en) en = d;
    } else if (n.tur === 'zemin') {
      const d = ZEMIN_Y - p[1];
      if (d < en) en = d;
    }
  }
  return en;
}
