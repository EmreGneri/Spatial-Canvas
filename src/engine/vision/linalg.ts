/**
 * GÜN 5 (Emre — poz çözücü altyapısı) — küçük, bağımlılıksız lineer cebir
 * çekirdeği. `metrics.ts`'teki `largestEigenvector4` sabit 4×4'e özeldir
 * (Horn Sim(3) hizalaması); essential matrix çözümü hem 9×9'da (8-nokta null
 * uzayı) hem 3×3'te (E'nin SVD'si) özayrışım ister — o yüzden GENEL N×N
 * simetrik Jacobi özçözücü burada, tek yerde yazılır.
 *
 * Yöntem: klasik döngüsel Jacobi döndürmeleri. NxN küçük (9 ve 3) olduğu için
 * performans sorun değil; RANSAC döngüsünde tekrar tekrar çağrılır ama her
 * çağrı birkaç mikrosaniye.
 */

/** Simetrik N×N özayrışımı — özdeğerler ARTAN sırada. Deterministik. */
export function jacobiEigenSymmetric(
  input: number[][],
  maxSweeps = 60,
): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((row) => row.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let offDiag = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) offDiag += a[p][q] * a[p][q];
    }
    if (offDiag < 1e-24) break; // köşegenleşti — erken çıkış

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t =
          (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < n; k++) {
          if (k !== p && k !== q) {
            const akp = a[k][p];
            const akq = a[k][q];
            a[k][p] = c * akp - s * akq;
            a[p][k] = a[k][p];
            a[k][q] = s * akp + c * akq;
            a[q][k] = a[k][q];
          }
        }
        const app = a[p][p];
        const aqq = a[q][q];
        a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        a[p][q] = 0;
        a[q][p] = 0;

        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i][i] - a[j][j]);
  const values = idx.map((i) => a[i][i]);
  const vectors = idx.map((i) => v.map((row) => row[i]));
  return { values, vectors };
}

function mat3Transpose(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

function mat3Mul(a: number[], b: number[]): number[] {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = s;
    }
  }
  return out;
}

function mat3Vec(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function cross3(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export interface Svd3 {
  /** Satır-öncelikli 3×3, ortonormal (det ±1). */
  U: number[];
  /** Tekil değerler, AZALAN sırada. */
  S: [number, number, number];
  /** Satır-öncelikli 3×3, ortonormal (det ±1). */
  V: number[];
}

/**
 * 3×3 SVD: `M = U · diag(S) · Vᵀ`. `MᵀM`'nin özayrışımından kurulur (V,
 * σ² = özdeğer); `U`'nun sütunları `M·Vᵢ/σᵢ` — σ küçükken (rütbe eksikliği,
 * essential matrix'te üçüncü tekil değer TAM SIFIR olmalıdır) bölme yerine
 * çapraz çarpımla ortonormal taban TAMAMLANIR (bölme kararsızlığı yok).
 */
export function svd3(Mrow: number[]): Svd3 {
  const Mt = mat3Transpose(Mrow);
  const MtM = mat3Mul(Mt, Mrow);
  const sym = [
    [MtM[0], MtM[1], MtM[2]],
    [MtM[3], MtM[4], MtM[5]],
    [MtM[6], MtM[7], MtM[8]],
  ];
  const { values, vectors } = jacobiEigenSymmetric(sym); // artan
  // Azalana çevir.
  const order = [2, 1, 0];
  const S: [number, number, number] = order.map((i) => Math.sqrt(Math.max(0, values[i]))) as [
    number,
    number,
    number,
  ];
  const V: [number, number, number][] = order.map((i) => {
    const v = vectors[i];
    return [v[0], v[1], v[2]] as [number, number, number];
  });

  // GÜN 5 — HATA GEÇMİŞİ (tekrar etmesin): üçüncü sütun ÖNCE koşulsuz çapraz
  // çarpımla dolduruluyordu ("σ₃≈0 varsayımıyla"). Essential matrix ranteür
  // ADAYINDA (rütbe-2 zorlamasından ÖNCEKİ, ham 8-nokta çözümünde) üçüncü
  // tekil değer genellikle sıfır DEĞİLDİR — orada `M·V₂/σ₂` ile çapraz çarpım
  // yalnızca YÖNCE eşleşir, İŞARETÇE rastgele olabilir (test: sabit 3×3
  // matriste çapraz çarpım tam TERS işaretli U₂ üretti). `decomposeEssential`
  // t'yi DOĞRUDAN U'nun üçüncü sütunundan alıyor — yanlış işaret orada
  // sessizce yanlış aday üretir. Kural: σᵢ sıfırdan uzaksa HER ZAMAN
  // `M·Vᵢ/σᵢ`; yalnız gerçekten dejenere (σᵢ≈0, bölme kararsız) durumda
  // çapraz çarpıma düşülür.
  // GÜN 5 — HATA GEÇMİŞİ (tekrar etmesin): eşik MUTLAK 1e-9'du. σ₀ büyükken
  // (essential matrix'te tipik ~4) rütbe-2 kısıtlı bir E'nin σ₂'si TAM SIFIR
  // olmayıp ~1e-8 mertebesinde kalabilir (kayan nokta artığı) — bu, mutlak
  // eşiğin ÜSTÜNDE ama `M·V₂/σ₂` bölmesi için YETERSİZ hassasiyette: pay da
  // (M·V₂) aynı mertebede küçük olduğundan bölüm KAYAN NOKTA GÜRÜLTÜSÜNE
  // düşüyor, U'nun üçüncü sütunu sıfıra yakın çıkıyor ve `det(U) ≈ 0` oluyor
  // (ortogonal DEĞİL). Sonuç: essential matrix ayrıştırması sessizce çöküyor
  // (ölçüldü). Eşik artık σ₀'A BAĞIL: mutlak küçüklük değil, DİĞER tekil
  // değerlere göre önemsizlik ölçülür.
  const scale = Math.max(S[0], 1e-12);
  const relTol = scale * 1e-6;
  const U: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) {
    if (S[i] > relTol) {
      const col = mat3Vec(Mrow, V[i]);
      U.push([col[0] / S[i], col[1] / S[i], col[2] / S[i]]);
    } else if (i === 2) {
      U.push(cross3(U[0], U[1]));
    } else {
      U.push(i === 0 ? [1, 0, 0] : [0, 1, 0]);
    }
  }

  const Uflat = [U[0][0], U[1][0], U[2][0], U[0][1], U[1][1], U[2][1], U[0][2], U[1][2], U[2][2]];
  const Vflat = [V[0][0], V[1][0], V[2][0], V[0][1], V[1][1], V[2][1], V[0][2], V[1][2], V[2][2]];
  return { U: Uflat, S, V: Vflat };
}

export function mat3Det(m: number[]): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Satır-öncelikli 3×3 dönme matrisini quaternion'a (x,y,z,w) çevirir —
 *  Shepperd, kararlı dal (trajectory.ts'in ÖZEL `matrixToQuat`'ıyla aynı
 *  yöntem; burası PoseTrackRecord üreten her modülün paylaştığı genel
 *  sürümdür). */
export function matrixToQuat(m: number[]): [number, number, number, number] {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

/** Deterministik sözde-rastgele (mulberry32) — RANSAC örneklemesi
 *  `Math.random` KULLANMAZ (proje kuralı: her koşu aynı sonucu vermeli). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export { mat3Mul, mat3Transpose, mat3Vec, cross3 };
