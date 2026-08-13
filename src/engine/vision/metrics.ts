// GÜN D/1 — metrikler. Saf CPU, GPU yok. Eval harness (npm run eval) ve
// verify-eval.mjs bunları kullanır; D.5 kolonları: depth | seg | pose | timing.
// Her fonksiyon GT geçersiz (0 / NaN) bölgeleri atlar — sesli hata yerine
// maskeli hesap (sessiz sapma yok: maskeli hesap kasıtlı ve raporlanır).

/** Sıralı abs relatif hata. GT = 0 olan pikseller hesaplama dışı. */
export function absRel(pred: Float32Array, gt: Float32Array): number {
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < pred.length; i++) {
    const g = gt[i];
    if (!(g > 0)) continue;
    sum += Math.abs(pred[i] - g) / g;
    cnt++;
  }
  if (cnt === 0) return NaN;
  return sum / cnt;
}

/** Kök ortalama kare hatası (metre cinsinden). GT = 0 bölgeleri atlanır. */
export function rmse(pred: Float32Array, gt: Float32Array): number {
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < pred.length; i++) {
    const g = gt[i];
    if (!(g > 0)) continue;
    const d = pred[i] - g;
    sum += d * d;
    cnt++;
  }
  if (cnt === 0) return NaN;
  return Math.sqrt(sum / cnt);
}

/** δ < 1.25 oranı — tahminin GT'nin 1.25 katı içinde kaldığı piksel oranı. */
export function delta125(pred: Float32Array, gt: Float32Array): number {
  let ok = 0;
  let cnt = 0;
  for (let i = 0; i < pred.length; i++) {
    const g = gt[i];
    if (!(g > 0)) continue;
    if (Math.max(pred[i] / g, g / pred[i]) < 1.25) ok++;
    cnt++;
  }
  if (cnt === 0) return NaN;
  return ok / cnt;
}

/** İkili maskeler üzerinde IoU (seg). Her iki maskede 0 olan bölgeler etkisiz. */
export function iou(predMask: Float32Array, gtMask: Float32Array, threshold = 0.5): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < predMask.length; i++) {
    const p = predMask[i] >= threshold ? 1 : 0;
    const g = gtMask[i] >= threshold ? 1 : 0;
    inter += p & g;
    union += p | g;
  }
  if (union === 0) return NaN;
  return inter / union;
}

/**
 * ATE — Absolute Trajectory Error (translation / pose KONUMU; yönelim DEĞİL).
 *
 * Literatür tanımı: iki yörünge önce hizalanır, sonra artık konum hatalarının
 * RMSE'si alınır. Monoküler yörünge ölçek belirsiz olduğu için hizalama
 * **Sim(3)**'tür (ölçek + dönme + öteleme) — Horn'un birim quaternion kapalı
 * form çözümü (`alignSim3`). Hizalamasız ham fark, keyfi dünya çerçevesini
 * hata sayardı.
 *
 * Not (D.5): dönme hatası ayrı bir metriktir, burada ölçülmez.
 */
export function ate(estimated: Array<[number, number, number]>, gt: Array<[number, number, number]>): number {
  if (estimated.length !== gt.length || estimated.length === 0) return NaN;
  const fit = alignSim3(estimated, gt);
  if (!fit) return NaN;
  let sum = 0;
  for (let i = 0; i < estimated.length; i++) {
    const p = applySim3(fit, estimated[i]);
    const dx = p[0] - gt[i][0];
    const dy = p[1] - gt[i][1];
    const dz = p[2] - gt[i][2];
    sum += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(sum / estimated.length);
}

/** Sim(3) hizalama sonucu: `gt ≈ s · R · est + t`. */
export interface Sim3Fit {
  /** Ölçek (monoküler belirsizlik). */
  s: number;
  /** Dönme matrisi, satır-öncelikli 3×3. */
  R: [number, number, number, number, number, number, number, number, number];
  /** Öteleme. */
  t: [number, number, number];
}

/** Bir noktayı hizalamadan geçirir: `s · R · p + t`. */
export function applySim3(fit: Sim3Fit, p: [number, number, number]): [number, number, number] {
  const { s, R, t } = fit;
  return [
    s * (R[0] * p[0] + R[1] * p[1] + R[2] * p[2]) + t[0],
    s * (R[3] * p[0] + R[4] * p[1] + R[5] * p[2]) + t[1],
    s * (R[6] * p[0] + R[7] * p[1] + R[8] * p[2]) + t[2],
  ];
}

/**
 * Horn (1987) kapalı form mutlak yönelim: `gt ≈ s·R·est + t` en küçük kareler.
 * Dönme, kovaryanstan kurulan 4×4 simetrik N matrisinin en büyük özvektörü
 * (birim quaternion) olarak çözülür — Jacobi döndürmeleriyle, deterministik.
 * Ölçek Σ g'·(R e') / Σ‖e'‖² (artığı minimize eden yön). Dejenere durumda
 * (tüm `estimated` noktaları aynı) ölçek tanımsızdır: 1 alınır — artık ölçekten
 * bağımsızdır, sonuç yine doğrudur.
 */
export function alignSim3(
  estimated: Array<[number, number, number]>,
  gt: Array<[number, number, number]>,
): Sim3Fit | null {
  const n = estimated.length;
  if (n === 0 || n !== gt.length) return null;
  const ce: [number, number, number] = [0, 0, 0];
  const cg: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      ce[k] += estimated[i][k];
      cg[k] += gt[i][k];
    }
  }
  for (let k = 0; k < 3; k++) {
    ce[k] /= n;
    cg[k] /= n;
  }
  // S = Σ e' g'ᵀ (3×3 kovaryans) ve Σ‖e'‖².
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let normE = 0;
  for (let i = 0; i < n; i++) {
    const ex = estimated[i][0] - ce[0];
    const ey = estimated[i][1] - ce[1];
    const ez = estimated[i][2] - ce[2];
    const gx = gt[i][0] - cg[0];
    const gy = gt[i][1] - cg[1];
    const gz = gt[i][2] - cg[2];
    S[0] += ex * gx; S[1] += ex * gy; S[2] += ex * gz;
    S[3] += ey * gx; S[4] += ey * gy; S[5] += ey * gz;
    S[6] += ez * gx; S[7] += ez * gy; S[8] += ez * gz;
    normE += ex * ex + ey * ey + ez * ez;
  }
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = S;
  // Horn'un N matrisi (simetrik, 4×4) — sıra (w, x, y, z).
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const q = largestEigenvector4(N);
  const [qw, qx, qy, qz] = q;
  const R: Sim3Fit['R'] = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ];
  let num = 0;
  for (let i = 0; i < n; i++) {
    const ex = estimated[i][0] - ce[0];
    const ey = estimated[i][1] - ce[1];
    const ez = estimated[i][2] - ce[2];
    const rx = R[0] * ex + R[1] * ey + R[2] * ez;
    const ry = R[3] * ex + R[4] * ey + R[5] * ez;
    const rz = R[6] * ex + R[7] * ey + R[8] * ez;
    num += (gt[i][0] - cg[0]) * rx + (gt[i][1] - cg[1]) * ry + (gt[i][2] - cg[2]) * rz;
  }
  const s = normE > 1e-12 ? num / normE : 1;
  const rce: [number, number, number] = [
    R[0] * ce[0] + R[1] * ce[1] + R[2] * ce[2],
    R[3] * ce[0] + R[4] * ce[1] + R[5] * ce[2],
    R[6] * ce[0] + R[7] * ce[1] + R[8] * ce[2],
  ];
  return { s, R, t: [cg[0] - s * rce[0], cg[1] - s * rce[1], cg[2] - s * rce[2]] };
}

/** Simetrik 4×4'ün en büyük özdeğerine ait özvektörü (cyclic Jacobi). */
function largestEigenvector4(input: number[][]): [number, number, number, number] {
  const a = input.map((row) => row.slice());
  // V = birim; Jacobi döndürmeleri hem a'yı köşegenleştirir hem V'yi biriktirir.
  const v = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let k = 1; k < 4; k++) if (a[k][k] > a[best][best]) best = k;
  const q: [number, number, number, number] = [v[0][best], v[1][best], v[2][best], v[3][best]];
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  // İşaret serbestliği: w ≥ 0 seçilir (aynı dönme, tek temsil → deterministik).
  const sign = q[0] < 0 ? -1 : 1;
  return [(sign * q[0]) / len, (sign * q[1]) / len, (sign * q[2]) / len, (sign * q[3]) / len];
}

/**
 * RPE — Relative Pose Error (translation): komşu keyframe çiftleri arasındaki
 * ÖTELEME farkının RMSE'si. Hizalama gerekmez (göreli büyüklük), yönelim
 * bileşeni burada ölçülmez.
 */
export function rpe(estimated: Array<[number, number, number]>, gt: Array<[number, number, number]>): number {
  if (estimated.length !== gt.length || estimated.length < 2) return NaN;
  let sum = 0;
  let cnt = 0;
  for (let i = 1; i < estimated.length; i++) {
    const ex = estimated[i][0] - estimated[i - 1][0];
    const ey = estimated[i][1] - estimated[i - 1][1];
    const ez = estimated[i][2] - estimated[i - 1][2];
    const gx = gt[i][0] - gt[i - 1][0];
    const gy = gt[i][1] - gt[i - 1][1];
    const gz = gt[i][2] - gt[i - 1][2];
    const dx = ex - gx;
    const dy = ey - gy;
    const dz = ez - gz;
    sum += dx * dx + dy * dy + dz * dz;
    cnt++;
  }
  return Math.sqrt(sum / cnt);
}

/** kare başına ortalama süre (ms) — column: 'timing'. */
export function meanMs(samples: number[]): number {
  if (samples.length === 0) return NaN;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/**
 * kare başına MEDYAN süre (ms) — column: 'timing'. Raporlanan zamanlama budur:
 * ortalama, JIT ısınmasının ve tek seferlik GC duraklamalarının kuyruğunu
 * içeri taşır (Gün D/1 ölçümü: ilk çağrı sonrakilerin ~3 katı). Medyan bu
 * aykırı değerlerden etkilenmez.
 */
export function medianMs(samples: number[]): number {
  if (samples.length === 0) return NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}