// OTOMATİK YÜZEN (FLOATER) TEMİZLEME — saf fonksiyon, DOM/GPU yok.
//
// Uyarlama: PlayCanvas splat-transform `filterFloaters`
// (src/lib/voxel/filter-floaters.ts, voxel-query.ts, gpu/gpu-voxelization.ts;
// MIT, Copyright (c) 2011-2026 PlayCanvas Ltd.). Aynı üç adım, GPU yerine CPU:
//  1. Her voksel için yoğunluk toplanır: σ += α·exp(−½·d²), d² = Gaussian
//     merkezine EN YAKIN voksel noktasının Mahalanobis uzaklığı (küçük
//     Gaussian'lar voksel merkezleri arasında kaybolmasın diye). Kapsama
//     3σ AABB'dir.
//  2. Beer–Lambert: 1 − e^−σ ≥ `opaklikEsigi` (0.1) olan voksel dolu.
//  3. Merkezi dolu vokselde olan ya da kapsamındaki bir dolu voksel
//     MERKEZİNDE katkısı ≥ `enAzKatki` (1/255) olan Gaussian kalır; kalanı
//     yüzendir.
//
// Birimler: PlayCanvas varsayılanı 0.05 m (metrik sahne). Bizim kurulumumuz
// monoküler SfM, METRİK DEĞİL: voksel `yuzenVokseli` ile sahne ölçeğinin
// kesri olarak verilir (kameradan SfM noktalarına medyan uzaklık × oran).
//
// Veri sözleşmesi `GaussianState` (egitim3dgs.ts): 16 float/Gaussian,
// 0..2 konum, 3..5 log ölçek, 6..9 dörtlü wxyz, 13 opaklık logiti.

type Vec3 = [number, number, number];

export interface YuzenSecenek {
  /** Voksel kenarı (dünya birimi). Izgara `maksVoksel`'i aşarsa ikiye katlanır. */
  voksel: number;
  /** Değerlendirilen kutu. Merkezi dışında kalan Gaussian'a dokunulmaz (kanıt
   *  yok). Verilmezse canlı merkezlerin eksen başına %2–%98 yüzdeliği, her
   *  yana en büyük yüzdelik aralığı kadar genişletilip gerçek AABB'ye kırpılmış. */
  sinir?: { min: Vec3; max: Vec3 };
  /** Dolu voksel için Beer–Lambert opaklık eşiği (PlayCanvas: 0.1). */
  opaklikEsigi?: number;
  /** Dolu voksel merkezinde tutulmak için en az katkı (PlayCanvas: 1/255). */
  enAzKatki?: number;
  /** Bu alfanın altı zaten ölü: katkı vermez, raporlanmaz (EGITIM_GORUNUR_ESIGI). */
  oluEsigi?: number;
  /** Izgara voksel tavanı (varsayılan 8M ≈ 32 MB Float32). */
  maksVoksel?: number;
}

export interface YuzenSonucu {
  /** Silinecek (yüzen) Gaussian indeksleri, artan sırada. */
  indeksler: number[];
  /** Canlı (alfa ≥ oluEsigi) Gaussian sayısı. */
  canli: number;
  /** Merkezi kutu içinde olan canlı Gaussian sayısı (değerlendirilen). */
  kapsanan: number;
  /** Dolu voksel sayısı. */
  dolu: number;
  /** Kullanılan voksel (tavan yüzünden büyümüş olabilir). */
  voksel: number;
  boyut: [number, number, number];
}

const STRIDE = 16;

/**
 * Ölçeksiz voksel kenarı: her kamera için SfM noktalarına medyan uzaklık,
 * bunların medyanı × `oran`. Sahne 3 kat büyürse voksel de 3 kat büyür.
 */
export function yuzenVokseli(kameralar: readonly Vec3[], noktalar: readonly Vec3[], oran: number): number {
  if (!kameralar.length || !noktalar.length) throw new RangeError('yuzenVokseli: kamera ve nokta gerekli');
  const adim = Math.max(1, Math.ceil(noktalar.length / 2000));
  const medyan = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
  const kameraBasi = kameralar.map((c) => {
    const d: number[] = [];
    for (let i = 0; i < noktalar.length; i += adim) {
      const p = noktalar[i];
      d.push(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
    }
    return medyan(d);
  });
  return medyan(kameraBasi) * oran;
}

/**
 * Değerlendirme bölgesi + voksel: kamera merkezlerinin AABB'si, her yana
 * medyan sahne derinliği D (`yuzenVokseli(…, 1)`) kadar; voksel = oran·D.
 * Gezinilen çevre kapsanır, uzak arka plan (ormanda onlarca D) ızgarayı
 * şişirip vokseli tavan yüzünden kabalaştırmaz; dışında kalana dokunulmaz.
 */
export function yuzenBolgesi(
  kameralar: readonly Vec3[], noktalar: readonly Vec3[], oran: number,
): { voksel: number; sinir: { min: Vec3; max: Vec3 } } {
  const D = yuzenVokseli(kameralar, noktalar, 1);
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of kameralar) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], c[k] - D); max[k] = Math.max(max[k], c[k] + D);
  }
  return { voksel: D * oran, sinir: { min, max } };
}

export function yuzenleriBul(data: Float32Array, n: number, secenek: YuzenSecenek): YuzenSonucu {
  let v = secenek.voksel;
  if (!(v > 0) || !Number.isFinite(v)) throw new RangeError(`yuzenleriBul: voksel ${v} geçersiz`);
  if (data.length < n * STRIDE) throw new RangeError(`yuzenleriBul: veri ${data.length} < ${n}×${STRIDE}`);
  const opaklikEsigi = secenek.opaklikEsigi ?? 0.1;
  const enAzKatki = secenek.enAzKatki ?? 1 / 255;
  const oluEsigi = secenek.oluEsigi ?? 0.004;
  const maksVoksel = secenek.maksVoksel ?? 1 << 23;

  // Gaussian başına: alfa, dünya←yerel dönüş (satır sıralı), 1/ölçek, 3σ AABB.
  const alfa = new Float32Array(n);
  const R = new Float32Array(9 * n);
  const ters = new Float32Array(3 * n);
  const kap = new Float32Array(3 * n);
  const canlilar: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    const a = 1 / (1 + Math.exp(-data[o + 13]));
    const sx = Math.exp(data[o + 3]), sy = Math.exp(data[o + 4]), sz = Math.exp(data[o + 5]);
    let w = data[o + 6], x = data[o + 7], y = data[o + 8], z = data[o + 9];
    const ql = Math.hypot(w, x, y, z);
    if (!(a >= oluEsigi) || !(ql > 0) || !(sx > 0 && sy > 0 && sz > 0)
      || !Number.isFinite(data[o] + data[o + 1] + data[o + 2] + sx + sy + sz)) continue;
    w /= ql; x /= ql; y /= ql; z /= ql;
    const r = 9 * i;
    R[r] = 1 - 2 * (y * y + z * z); R[r + 1] = 2 * (x * y - w * z); R[r + 2] = 2 * (x * z + w * y);
    R[r + 3] = 2 * (x * y + w * z); R[r + 4] = 1 - 2 * (x * x + z * z); R[r + 5] = 2 * (y * z - w * x);
    R[r + 6] = 2 * (x * z - w * y); R[r + 7] = 2 * (y * z + w * x); R[r + 8] = 1 - 2 * (x * x + y * y);
    ters[3 * i] = 1 / sx; ters[3 * i + 1] = 1 / sy; ters[3 * i + 2] = 1 / sz;
    for (let k = 0; k < 3; k++) {
      kap[3 * i + k] = 3 * Math.hypot(R[r + 3 * k] * sx, R[r + 3 * k + 1] * sy, R[r + 3 * k + 2] * sz);
    }
    alfa[i] = a;
    canlilar.push(i);
  }

  // Kutu.
  let min: Vec3, max: Vec3;
  if (secenek.sinir) {
    min = [...secenek.sinir.min] as Vec3; max = [...secenek.sinir.max] as Vec3;
  } else if (canlilar.length) {
    // Yüzenler kendileri aykırı nokta: kutu yüzdelik kutudan EN BÜYÜK eksen
    // aralığı kadar her yana taşar (gerçek AABB ile kırpılır). Çok uzak arka
    // plan sıçramaları ızgarayı şişirmez, sahneye yakın yüzenler kapsanır.
    min = [0, 0, 0]; max = [0, 0, 0];
    const sirali = [0, 1, 2].map((k) => canlilar.map((i) => data[i * STRIDE + k]).sort((a, b) => a - b));
    const yuzde = sirali.map((xs) => [xs[Math.floor(0.02 * (xs.length - 1))], xs[Math.ceil(0.98 * (xs.length - 1))]]);
    const pay = Math.max(...yuzde.map(([lo, hi]) => hi - lo)) + 1e-6;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.max(sirali[k][0], yuzde[k][0] - pay);
      max[k] = Math.min(sirali[k][sirali[k].length - 1], yuzde[k][1] + pay) + 1e-6;
    }
  } else {
    return { indeksler: [], canli: 0, kapsanan: 0, dolu: 0, voksel: v, boyut: [0, 0, 0] };
  }
  const boyutHesapla = (vv: number) => [0, 1, 2].map((k) => Math.max(1, Math.ceil((max[k] - min[k]) / vv))) as [number, number, number];
  let boyut = boyutHesapla(v);
  while (boyut[0] * boyut[1] * boyut[2] > maksVoksel) { v *= 2; boyut = boyutHesapla(v); }
  const [nx, ny, nz] = boyut;
  const katman = nx * ny;
  const sigma = new Float32Array(nx * ny * nz);
  const h = 0.5 * v;

  /** Gaussian i'nin dünya noktasındaki katkısı α·exp(−½ d²); `kirp` ile 3σ dışı 0. */
  const katki = (i: number, px: number, py: number, pz: number, kirp = false): number => {
    const o = i * STRIDE, r = 9 * i;
    const dx = px - data[o], dy = py - data[o + 1], dz = pz - data[o + 2];
    // yerel = Rᵀ d
    const lx = (R[r] * dx + R[r + 3] * dy + R[r + 6] * dz) * ters[3 * i];
    const ly = (R[r + 1] * dx + R[r + 4] * dy + R[r + 7] * dz) * ters[3 * i + 1];
    const lz = (R[r + 2] * dx + R[r + 5] * dy + R[r + 8] * dz) * ters[3 * i + 2];
    const d2 = lx * lx + ly * ly + lz * lz;
    // Yoğunlukta 3σ elipsoidin dışı (AABB köşeleri) atlanır: katkı ≤ α·e^−4.5
    // ≈ 0.011α, exp'siz ~3.5× hızlı (600k Gaussian: 15 → 4 sn).
    // ponytail: PlayCanvas bunu da toplar; fark dolu eşiğinin (σ ≥ 0.105) altında.
    return kirp && d2 > 9 ? 0 : alfa[i] * Math.exp(-0.5 * d2);
  };
  const aralik = (i: number, k: number, ek: number): [number, number] => {
    const c = data[i * STRIDE + k], e = kap[3 * i + k] + ek, nk = boyut[k];
    return [Math.max(0, Math.floor((c - e - min[k]) / v)), Math.min(nk - 1, Math.floor((c + e - min[k]) / v))];
  };

  // 1. Yoğunluk (en yakın voksel noktasında).
  for (const i of canlilar) {
    const o = i * STRIDE;
    const [x0, x1] = aralik(i, 0, h), [y0, y1] = aralik(i, 1, h), [z0, z1] = aralik(i, 2, h);
    for (let iz = z0; iz <= z1; iz++) {
      const cz = min[2] + (iz + 0.5) * v;
      const pz = Math.min(Math.max(data[o + 2], cz - h), cz + h);
      for (let iy = y0; iy <= y1; iy++) {
        const cy = min[1] + (iy + 0.5) * v;
        const py = Math.min(Math.max(data[o + 1], cy - h), cy + h);
        for (let ix = x0; ix <= x1; ix++) {
          const cx = min[0] + (ix + 0.5) * v;
          const px = Math.min(Math.max(data[o], cx - h), cx + h);
          const j = ix + nx * iy + katman * iz;
          if (sigma[j] < 7) sigma[j] += katki(i, px, py, pz, true); // 1−e^−7 ≈ 1: doymuş
        }
      }
    }
  }

  // 2. Dolu = 1 − e^−σ ≥ eşik ⇔ σ ≥ −ln(1 − eşik).
  const sigmaEsik = -Math.log(1 - opaklikEsigi);
  const dolu = new Uint8Array(sigma.length);
  let doluSay = 0;
  for (let j = 0; j < sigma.length; j++) if (sigma[j] >= sigmaEsik) { dolu[j] = 1; doluSay++; }

  // 3. Tutma kararı.
  const indeksler: number[] = [];
  let kapsanan = 0;
  for (const i of canlilar) {
    const o = i * STRIDE;
    const gx = Math.floor((data[o] - min[0]) / v), gy = Math.floor((data[o + 1] - min[1]) / v), gz = Math.floor((data[o + 2] - min[2]) / v);
    if (!(gx >= 0 && gx < nx && gy >= 0 && gy < ny && gz >= 0 && gz < nz)) continue; // kanıt yok: tut
    kapsanan++;
    if (dolu[gx + nx * gy + katman * gz]) continue;
    const [x0, x1] = aralik(i, 0, 0), [y0, y1] = aralik(i, 1, 0), [z0, z1] = aralik(i, 2, 0);
    let tut = false;
    for (let iz = z0; iz <= z1 && !tut; iz++) for (let iy = y0; iy <= y1 && !tut; iy++) for (let ix = x0; ix <= x1; ix++) {
      if (!dolu[ix + nx * iy + katman * iz]) continue;
      if (katki(i, min[0] + (ix + 0.5) * v, min[1] + (iy + 0.5) * v, min[2] + (iz + 0.5) * v) >= enAzKatki) { tut = true; break; }
    }
    if (!tut) indeksler.push(i);
  }
  return { indeksler, canli: canlilar.length, kapsanan, dolu: doluSay, voksel: v, boyut };
}
