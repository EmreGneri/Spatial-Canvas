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

// ── analitik ışın kesişimi (GT derinlik kaynağı) ─────────────────────────
//
// Sözleşme: `isinKes` `d`'yi İÇERİDE normalize eder ve en yakın kesişimin
// GERÇEK ÖKLİD uzaklığını döner (t parametresi = |d| birimiyle DEĞİL);
// yani `isinKes(o, d)` ile `isinKes(o, k·d)` (k > 0) aynı sonucu verir. Hiç
// kesişim yoksa Infinity. Bu, `gtDerinlik`'in piksel yönünü (kamera-uzayı
// z=1 olacak şekilde, yani birim değil) doğrudan besleyip sonucu
// `× cos(açı)` ile derinliğe çevirmesini basitleştirir (bkz. aşağı).

const ISIN_EPS = 1e-6;

/** A·t² + B·t + C = 0 köklerini küçükten büyüğe sıralı döner; yoksa null.
 * A ≈ 0 ise doğrusala düşer (tek kök, iki kere tekrarlanır). */
function ikinciDerece(A: number, B: number, C: number): [number, number] | null {
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) < 1e-12) return null;
    const t = -C / B;
    return [t, t];
  }
  const disk = B * B - 4 * A * C;
  if (disk < 0) return null;
  const kok = Math.sqrt(disk);
  const t1 = (-B - kok) / (2 * A);
  const t2 = (-B + kok) / (2 * A);
  return t1 <= t2 ? [t1, t2] : [t2, t1];
}

/** Gövdenin sonlu yan yüzeyi (silindir ekseni dünya y ekseni — dikey). */
function govdeYanKes(o: Vec3, u: Vec3, n: Govde): number {
  const dx = o[0] - n.x, dz = o[2] - n.z;
  const A = u[0] * u[0] + u[2] * u[2];
  if (A < 1e-12) return Infinity; // ışın eksene paralel: yan yüzeyi kesmez
  const B = 2 * (dx * u[0] + dz * u[2]);
  const C = dx * dx + dz * dz - n.r * n.r;
  const kokler = ikinciDerece(A, B, C);
  if (!kokler) return Infinity;
  const yMin = n.y - n.yukseklik / 2, yMax = n.y + n.yukseklik / 2;
  for (const t of kokler) {
    if (t > ISIN_EPS) {
      const yAt = o[1] + t * u[1];
      if (yAt >= yMin && yAt <= yMax) return t;
    }
  }
  return Infinity;
}

/** Gövdenin üst ya da alt kapağı (y = yDuzlem düzleminde disk, yarıçap r). */
function govdeKapakKes(o: Vec3, u: Vec3, n: Govde, yDuzlem: number): number {
  if (Math.abs(u[1]) < 1e-12) return Infinity;
  const t = (yDuzlem - o[1]) / u[1];
  if (t <= ISIN_EPS) return Infinity;
  const xAt = o[0] + t * u[0], zAt = o[2] + t * u[2];
  const dx = xAt - n.x, dz = zAt - n.z;
  if (dx * dx + dz * dz > n.r * n.r) return Infinity;
  return t;
}

/** Gövde: yan yüzey + üst kapak + alt kapak (renderer `openEnded=false` ile
 * her ikisini de çizer — bkz. sentetikCizim.ts `CylinderGeometry`). Ucuz
 * ret testi: ışının sonsuz doğrusuna gövdenin sınırlayıcı küresinden uzaksa
 * atlanır. */
function govdeKes(o: Vec3, u: Vec3, n: Govde): number {
  const merkezVek: Vec3 = [n.x - o[0], n.y - o[1], n.z - o[2]];
  const boyuna = merkezVek[0] * u[0] + merkezVek[1] * u[1] + merkezVek[2] * u[2];
  const dikeyKareUzaklik =
    merkezVek[0] * merkezVek[0] + merkezVek[1] * merkezVek[1] + merkezVek[2] * merkezVek[2]
    - boyuna * boyuna;
  const sinirR = Math.hypot(n.r, n.yukseklik / 2);
  if (dikeyKareUzaklik > sinirR * sinirR) return Infinity;

  let en = govdeYanKes(o, u, n);
  const ust = govdeKapakKes(o, u, n, n.y - n.yukseklik / 2);
  if (ust < en) en = ust;
  const alt = govdeKapakKes(o, u, n, n.y + n.yukseklik / 2);
  if (alt < en) en = alt;
  return en;
}

/** Çalı: tam küre. */
function caliKes(o: Vec3, u: Vec3, n: Cali): number {
  const dx = o[0] - n.x, dy = o[1] - n.y, dz = o[2] - n.z;
  const B = 2 * (dx * u[0] + dy * u[1] + dz * u[2]);
  const C = dx * dx + dy * dy + dz * dz - n.r * n.r;
  const disk = B * B - 4 * C; // A = 1 (u birim)
  if (disk < 0) return Infinity;
  const kok = Math.sqrt(disk);
  const t1 = (-B - kok) / 2, t2 = (-B + kok) / 2;
  if (t1 > ISIN_EPS) return t1;
  if (t2 > ISIN_EPS) return t2;
  return Infinity;
}

/** Zemin: y = ZEMIN_Y düzlemi, [xMin,xMax] × [zMin,zMax] ile sınırlı. */
function zeminKes(o: Vec3, u: Vec3, n: Zemin): number {
  if (Math.abs(u[1]) < 1e-12) return Infinity;
  const t = (ZEMIN_Y - o[1]) / u[1];
  if (t <= ISIN_EPS) return Infinity;
  const xAt = o[0] + t * u[0], zAt = o[2] + t * u[2];
  if (xAt < n.xMin || xAt > n.xMax || zAt < n.zMin || zAt > n.zMax) return Infinity;
  return t;
}

/** Fon: z = n.z (FON_Z) düzlemi, [xMin,xMax] × [yMin,yMax] ile sınırlı. */
function fonKes(o: Vec3, u: Vec3, n: Fon): number {
  if (Math.abs(u[2]) < 1e-12) return Infinity;
  const t = (n.z - o[2]) / u[2];
  if (t <= ISIN_EPS) return Infinity;
  const xAt = o[0] + t * u[0], yAt = o[1] + t * u[1];
  if (xAt < n.xMin || xAt > n.xMax || yAt < n.yMin || yAt > n.yMax) return Infinity;
  return t;
}

/** `u` zaten birim varsayılarak sahnedeki en yakın pozitif kesişimi bulur. */
function enYakinKesisim(o: Vec3, u: Vec3, sahne: SahneVerisi): number {
  let en = Infinity;
  for (const n of sahne.nesneler) {
    let t: number;
    if (n.tur === 'govde') t = govdeKes(o, u, n);
    else if (n.tur === 'cali') t = caliKes(o, u, n);
    else if (n.tur === 'zemin') t = zeminKes(o, u, n);
    else t = fonKes(o, u, n);
    if (t < en) en = t;
  }
  return en;
}

/**
 * `o`'dan `d` yönünde fırlatılan ışının sahnedeki en yakın kesişimine
 * ÖKLİD uzaklığı (`d` içeride normalize edilir — büyüklüğü sonucu etkilemez).
 * Kesişim yoksa Infinity. Nesneler: gövde (sonlu dikey silindir yan yüzeyi +
 * iki kapak), çalı (küre), zemin/fon (sınırlı düzlemler) — `sentetikCizim.ts`
 * ile birebir aynı geometri.
 */
export function isinKes(o: Vec3, d: Vec3, tohum: number = VARSAYILAN_TOHUM): number {
  const uzunluk = Math.hypot(d[0], d[1], d[2]);
  if (!(uzunluk > 0)) return Infinity;
  const u: Vec3 = [d[0] / uzunluk, d[1] / uzunluk, d[2] / uzunluk];
  return enYakinKesisim(o, u, sahneTanimi(tohum));
}

/**
 * Her piksel merkezinden (`u = x + 0.5`, `v = y + 0.5`) kamera ışını
 * fırlatıp analitik GT derinliğini (kamera-uzayı z, IŞIN UZUNLUĞU DEĞİL)
 * hesaplar. `w`/`h` `k.w`/`k.h`'ten farklıysa içsel parametreler oranla
 * ölçeklenir. Kesişim yoksa Infinity. Row-major, uzunluk `w*h`.
 *
 * Derinlik = ışın uzunluğu × optik eksene açının kosinüsü: piksel yönü
 * kamera uzayında `dCam = ((u−cx)/f, (v−cy)/fy, 1)`; `dCam`'i normalize
 * edip `Rᵀ` ile dünyaya taşıyınca hem `isinKes`'e verilecek birim yön hem
 * de kosinüs (`dCam`'in normalize z bileşeni, yani `1/|dCam|`) tek geçişte
 * çıkar — `C = -Rᵀt` kamera merkezi.
 */
export function gtDerinlik(
  k: GsKamera, w: number = k.w, h: number = k.h, tohum: number = VARSAYILAN_TOHUM,
): Float32Array {
  const out = new Float32Array(w * h);
  const sahne = sahneTanimi(tohum);
  const { R, t } = k;
  const C: Vec3 = [
    -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]),
    -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]),
    -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]),
  ];
  const olcekX = w / k.w, olcekY = h / k.h;
  const f = k.f * olcekX;
  const fy = (k.fy ?? k.f) * olcekY;
  const cx = k.cx * olcekX;
  const cy = k.cy * olcekY;

  let idx = 0;
  for (let y = 0; y < h; y++) {
    const dvy = (y + 0.5 - cy) / fy;
    for (let x = 0; x < w; x++, idx++) {
      const dcx = (x + 0.5 - cx) / f;
      const kameraUzunluk = Math.hypot(dcx, dvy, 1); // |dCam|, z bileşeni 1
      const kosinus = 1 / kameraUzunluk; // dCam'in normalize z'si = optik eksene açının kosinüsü
      const bx = dcx * kosinus, by = dvy * kosinus, bz = kosinus; // birim kamera yönü
      const wx = R[0] * bx + R[3] * by + R[6] * bz;
      const wy = R[1] * bx + R[4] * by + R[7] * bz;
      const wz = R[2] * bx + R[5] * by + R[8] * bz;
      const isinUzunlugu = enYakinKesisim(C, [wx, wy, wz], sahne);
      out[idx] = isinUzunlugu === Infinity ? Infinity : isinUzunlugu * kosinus;
    }
  }
  return out;
}
