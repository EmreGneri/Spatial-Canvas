/**
 * GÜN 5 (Emre — veri/CV şeridi) — POZ ÇÖZÜCÜ.
 *
 * Plan (Gün 0 sözleşmesi): "Essential matrix (normalize 8-nokta) + RANSAC +
 * R,t ayrıştırma + cheirality kontrolü. `verify-pose.mjs`: Zeynep'in
 * ürettiği sentetik yörünge üzerinde bilinen poza karşı hata. Bitti sayılır:
 * sentetikte rotasyon hatası < 1-2°."
 *
 * Girdi `trajectory.ts`'in ürettiği nokta eşleşmeleridir (gerçek boru
 * hattında `flow.ts`'in izlediği köşeler olur — bu modül eşleşme KAYNAĞINA
 * kayıtsızdır, yalnızca `{x1,y1,x2,y2}` piksel çiftleri ister).
 *
 * ── SÖZLEŞME (ARCHITECTURE.md · D.2) ────────────────────────────────────
 * Üretilen `PoseTrackRecord[]` KAMERA→DÜNYA yönündedir, dünya orijini ilk
 * keyframe'dir (identity). Essential matrix decomposition'ın kendisi bunun
 * TERSİNİ (kamera1→kamera2 GÖRECELİ hareketi) verir; `chainPoseTrack` bu
 * göreceli zinciri D.2 mutlak çerçevesine çevirir (aşağıda `chainPoseTrack`
 * docstring'inde türetme var).
 *
 * ── ÖLÇEK (Gün 6'ya bırakılan) ───────────────────────────────────────────
 * Essential matrix `t`'yi yalnızca YÖN olarak verir (|t|=1, SVD'nin üçüncü
 * tekil vektörü) — tek kameradan mutlak ölçek çıkmaz. Bu yüzden D.7 başarı
 * ölçütü yalnızca ROTASYONDUR; öteleme büyüklüğü (`scaleA/scaleB`) Gün 6'nın
 * işidir, burada dokunulmaz (kayıt `scaleA=1, scaleB=0` bırakılır — Gün 6
 * doldurana kadar "kimlik" varsayımı, sessiz yanlış sayı değil).
 */

import { cross3, jacobiEigenSymmetric, mat3Mul, mat3Transpose, mat3Vec, matrixToQuat, mulberry32, svd3 } from './linalg.ts';
import type { PoseKaynak, PoseResult, PoseTrackRecord } from './types.ts';

export interface PointMatch {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CameraIntrinsicsSimple {
  width: number;
  height: number;
  /** Dikey görüş açısı (radyan) — D.3 varsayılanı 60°. */
  fovY: number;
}

/** trajectory.ts'in `projectScene` iziniyle BİREBİR aynı pinhole model:
 *  fy = (h/2)/tan(fovY/2), fx=fy (kare piksel), cx=w/2, cy=h/2. */
function focalLength(K: CameraIntrinsicsSimple): number {
  return K.height / 2 / Math.tan(K.fovY / 2);
}

/** Piksel → kamera-normalize ışın (xn, yn, -1). `projectScene`'in
 *  `px = w/2 + f·Xc/(-Zc)`, `py = h/2 - f·Yc/(-Zc)` izdüşümünün TERSİDİR. */
export function pixelToRay(px: number, py: number, K: CameraIntrinsicsSimple): [number, number, number] {
  const f = focalLength(K);
  return [(px - K.width / 2) / f, -(py - K.height / 2) / f, -1];
}

/**
 * Hartley izotropik normalizasyonu: ağırlık merkezini orijine taşır, ortalama
 * mesafeyi √2 yapar. Sayısal koşullandırma için gerekli (Hartley & Zisserman,
 * "In Defense of the Eight-Point Algorithm") — normalize edilmemiş piksel
 * ölçeğinde 8-nokta sayısal olarak kararsızdır.
 */
/**
 * GÜN 5 — HATA GEÇMİŞİ (tekrar etmesin, KÖK NEDEN). Hartley normalizasyonu ve
 * 8-nokta satır kurulumu STANDART (x,y,1) izdüşümsel-düzlem sözleşmesini
 * kullanır (T'nin alt satırı [0,0,1] — bu doğru, dokunulmaz). Ama bu projenin
 * kamera ışını z=-1'dir (`pixelToRay`, kamera −z'ye bakar): gerçek homojen
 * ışın (xn,yn,-1)'dir, (xn,yn,1) DEĞİL. Satırlar örtük biçimde (xn,yn,1)
 * kullandığından çıkan E, TEK bileşenin (z) işareti ters bir sözleşmeye
 * aittir — genel (düzlemsel olmayan) dönme+ötelemede bu basit bir ölçek/genel
 * işaret çevirmesine İNDİRGENMEZ (yalnızca z ters, x/y aynı kalır), yani çıkan
 * E gerçek essential matrix'in KENDİSİ olmuyordu.
 *
 * Ölçüldü (2026-08-14): saf yatay (Y-ekseni) dönmede z-işareti fark
 * etmiyormuş gibi görünüyordu (rotasyon hatası ~0°) — bu ÇÜRÜTÜCÜ kanıt
 * sanılmıştı, hâlbuki dejenere özel bir durumdu (dikey öteleme sıfır). Gerçek
 * (düzlemsel olmayan, dikey bileşenli) 12-keyframe yörüngede aynı kod
 * adım başına 2-3° hataya düşüyordu — z-işareti orada telafi olmuyordu.
 *
 * Düzeltme KAPALI FORMDA: satır açılımından türetilir — (xn,yn,1) ve
 * (xn,yn,-1) sözleşmeli E'ler arasında YALNIZCA üçüncü SATIR ve üçüncü
 * SÜTUNUN köşe-dışı dört girdisi (row-major indeks 2,5,6,7) işaret
 * değiştirir, kalan beşi (0,1,3,4,8) AYNI kalır. Doğrulandı: düzeltilmiş E,
 * yörünge verisinden BAĞIMSIZ kurulan Etrue = [t]ₓR ile ×1e-6 hassasiyette
 * eşleşti (bkz. `eightPointEssential`'ın döndürdüğü satır).
 */
function fixHomogeneousZSign(E: number[]): number[] {
  return [E[0], E[1], -E[2], E[3], E[4], -E[5], -E[6], -E[7], E[8]];
}

function hartleyNormalize(pts: [number, number][]): { T: number[]; normalized: [number, number][] } {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let meanDist = 0;
  for (const [x, y] of pts) meanDist += Math.hypot(x - cx, y - cy);
  meanDist /= pts.length;
  const s = meanDist > 1e-12 ? Math.SQRT2 / meanDist : 1;
  const T = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  const normalized: [number, number][] = pts.map(([x, y]) => [s * (x - cx), s * (y - cy)]);
  return { T, normalized };
}

/**
 * Normalize 8-nokta algoritması: verilen kamera-ışını çiftlerinden (≥8)
 * essential matrix E çözer. Adımlar: (1) Hartley normalizasyonu (2B, xn/yn
 * üzerinde — ışının z=-1 bileşeni sabit olduğu için ölçek/öteleme yalnızca
 * xn,yn'i etkiler), (2) doğrusal 9 bilinmeyenli sistem `Aê=0`'ın en küçük
 * özdeğerli özvektörü (`jacobiEigenSymmetric(AᵀA)`), (3) rütbe-2 zorlaması
 * (SVD, tekil değerler ortalanıp üçüncü sıfırlanır — E'nin KALİBRELİ
 * sözleşmesi: ilk iki tekil değer TEORİDE eşittir), (4) Hartley
 * normalizasyonunun geri alınması.
 */
export function eightPointEssential(rays: Array<[[number, number, number], [number, number, number]]>): number[] | null {
  if (rays.length < 8) return null;
  const pts1: [number, number][] = rays.map(([r1]) => [r1[0] / -r1[2], r1[1] / -r1[2]]);
  const pts2: [number, number][] = rays.map(([, r2]) => [r2[0] / -r2[2], r2[1] / -r2[2]]);
  const n1 = hartleyNormalize(pts1);
  const n2 = hartleyNormalize(pts2);

  const A: number[][] = rays.map((_, i) => {
    const [x1, y1] = n1.normalized[i];
    const [x2, y2] = n2.normalized[i];
    return [x2 * x1, x2 * y1, x2, y2 * x1, y2 * y1, y2, x1, y1, 1];
  });
  // AᵀA (9×9) — en küçük özdeğerin özvektörü null uzayı yaklaşıklığıdır.
  const AtA: number[][] = Array.from({ length: 9 }, () => new Array(9).fill(0));
  for (const row of A) {
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) AtA[i][j] += row[i] * row[j];
    }
  }
  const { vectors } = jacobiEigenSymmetric(AtA);
  const eRaw = vectors[0]; // en küçük özdeğer (jacobiEigenSymmetric ARTAN sıralar)

  // GÜN 5 — HATA GEÇMİŞİ (tekrar etmesin): rütbe-2/EŞİT-TEKİL-DEĞER
  // (essential matrix'e özgü σ₁=σ₂) kısıtlaması ÖNCE Hartley uzayında
  // uygulanıp SONRA denormalize ediliyordu. Hartley T'si benzerlik
  // dönüşümüdür (ötelemeli) — homojen 3×3 olarak ORTOGONAL DEĞİLDİR (2×2
  // doğrusal kısım ölçekli-birim olsa da, öteleme satırı/sütunu tam
  // ortogonalliği bozar). Tekil DEĞERLER yalnızca ORTOGONAL dönüşümler
  // altında korunur; "σ₁=σ₂" kısıtı Hartley uzayında uygulanıp denormalize
  // edilince GERÇEK kalibre uzayda artık σ₁≠σ₂ oluyordu — essential matrix
  // yapısı bozuk çıkıyordu (ölçüldü: rütbe-2 doğru ama σ₀/σ₁ oranı ~1.065,
  // sonuçta ayrıştırılan R'ler gerçek göreceli dönmeden 66-80° sapıyordu).
  // Rütbe/tekil-değer kısıtı yalnızca GERÇEK kalibre (denormalize edilmiş)
  // uzayda anlamlıdır — bu yüzden sıra: ÖNCE denormalize, SONRA kısıtla.
  const Eraw = mat3Mul(mat3Mul(mat3Transpose(n2.T), eRaw), n1.T);
  const svd = svd3(Eraw);
  const sigma = (svd.S[0] + svd.S[1]) / 2;
  const Ediag = [sigma, 0, 0, 0, sigma, 0, 0, 0, 0];
  const E = mat3Mul(mat3Mul(svd.U, Ediag), mat3Transpose(svd.V));
  return fixHomogeneousZSign(E);
}

/** x2ᵀ·E·x1 Sampson mesafesi (kamera-normalize ışın uzayında, KARESİ). */
function sampsonDistanceSq(E: number[], r1: [number, number, number], r2: [number, number, number]): number {
  // GÜN 5: E artık (xn,yn,-1) sözleşmesinde (bkz. `fixHomogeneousZSign`) —
  // buradaki x1,x2 AYNI sözleşmeyi kullanmalı, yoksa Sampson mesafesi E ile
  // tutarsız bir homojen temsille hesaplanır.
  const x1: [number, number, number] = [r1[0] / -r1[2], r1[1] / -r1[2], -1];
  const x2: [number, number, number] = [r2[0] / -r2[2], r2[1] / -r2[2], -1];
  const Ex1 = mat3Vec(E, x1);
  const Etx2 = mat3Vec(mat3Transpose(E), x2);
  const num = x2[0] * Ex1[0] + x2[1] * Ex1[1] + x2[2] * Ex1[2];
  const denom = Ex1[0] * Ex1[0] + Ex1[1] * Ex1[1] + Etx2[0] * Etx2[0] + Etx2[1] * Etx2[1];
  if (denom < 1e-18) return Infinity;
  return (num * num) / denom;
}

export interface RansacOptions {
  iterations?: number;
  /** Aykırı eşiği — PİKSEL (içeride odak uzunluğuyla normalize-uzaya çevrilir). */
  pixelThreshold?: number;
  /** Deterministik örnekleme tohumu (Math.random YOK — proje kuralı). */
  seed?: number;
}

const RANSAC_DEFAULTS: Required<RansacOptions> = { iterations: 500, pixelThreshold: 1.5, seed: 0xc0ffee };

/**
 * RANSAC + normalize 8-nokta: rastgele 8'li örneklerden E aday üretir, TÜM
 * eşleşmelere karşı Sampson mesafesiyle içerdekileri sayar, en çok içerdekili
 * adayı tutar; son E, o adayın TÜM içerdekileriyle yeniden çözülür (tek
 * örnekten daha az gürültülü).
 */
export function ransacEssential(
  matches: PointMatch[],
  K: CameraIntrinsicsSimple,
  opts: RansacOptions = {},
): { E: number[]; inlierMask: Uint8Array } | null {
  const o = { ...RANSAC_DEFAULTS, ...opts };
  if (matches.length < 8) return null;
  const rays: Array<[[number, number, number], [number, number, number]]> = matches.map((m) => [
    pixelToRay(m.x1, m.y1, K),
    pixelToRay(m.x2, m.y2, K),
  ]);
  const f = focalLength(K);
  const threshSq = (o.pixelThreshold / f) ** 2;
  const rnd = mulberry32(o.seed);
  const n = matches.length;

  let bestMask: Uint8Array | null = null;
  let bestCount = -1;

  for (let iter = 0; iter < o.iterations; iter++) {
    // Fisher–Yates kısmi karıştırma: tekrarsız 8 indeks.
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let k = 0; k < 8; k++) {
      const j = k + Math.floor(rnd() * (n - k));
      [idx[k], idx[j]] = [idx[j], idx[k]];
    }
    const sample = idx.slice(0, 8).map((i) => rays[i]);
    const E = eightPointEssential(sample);
    if (!E) continue;

    const mask = new Uint8Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const d = sampsonDistanceSq(E, rays[i][0], rays[i][1]);
      if (d < threshSq) {
        mask[i] = 1;
        count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestMask = mask;
    }
  }

  if (!bestMask || bestCount < 8) return null;

  const inlierRays = rays.filter((_, i) => bestMask![i] === 1);
  const refined = eightPointEssential(inlierRays) ?? eightPointEssential(rays.filter((_, i) => bestMask![i] === 1).slice(0, 8));
  if (!refined) return null;
  return { E: refined, inlierMask: bestMask };
}

export interface PoseCandidate {
  /** Satır-öncelikli 3×3. `X_cam2 = R · X_cam1 + t`. */
  R: number[];
  t: [number, number, number];
}

/**
 * E'nin 4 (R,t) adayına ayrıştırılması (Hartley & Zisserman §9.6.2).
 * `det(U)`/`det(V)` işareti düzeltilir ki iki R adayı da GEÇERLİ dönme
 * olsun (det=+1) — düzeltilmezse yarı yarıya "yansıma" (det=-1) çıkar ve
 * cheirality testi hiçbir adayı seçemez.
 */
export function decomposeEssential(E: number[]): PoseCandidate[] {
  const svd = svd3(E);
  let U = svd.U.slice();
  let V = svd.V.slice();
  const detU = U[0] * (U[4] * U[8] - U[5] * U[7]) - U[1] * (U[3] * U[8] - U[5] * U[6]) + U[2] * (U[3] * U[7] - U[4] * U[6]);
  const detV = V[0] * (V[4] * V[8] - V[5] * V[7]) - V[1] * (V[3] * V[8] - V[5] * V[6]) + V[2] * (V[3] * V[7] - V[4] * V[6]);
  if (detU < 0) for (let i = 0; i < 9; i += 3) U[2 + i] *= -1; // üçüncü sütun negatif
  if (detV < 0) for (let i = 0; i < 9; i += 3) V[2 + i] *= -1;

  // GÜN 5 — HATA GEÇMİŞİ (tekrar etmesin): burada eskiden `U·W·Vᵀ`'nin
  // TERSİNİ alan bir "düzeltme" vardı — o dönemde E hâlâ yanlış homojen
  // sözleşmeyle (bkz. `fixHomogeneousZSign`) tahmin ediliyordu ve ters-alma
  // yalnızca BAZI geometrilerde (saf yatay dönme) tesadüfen telafi ediyordu,
  // genel (dikey bileşenli) hareketlerde YENİ bir hataya yol açıyordu. Kök
  // neden (homojen z işareti) `eightPointEssential`'da düzeltildikten sonra
  // standart ders kitabı formülü (Hartley & Zisserman §9.6.2) DOĞRUDAN
  // doğru sonucu veriyor — burada TERS ALINMAZ.
  const W = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  const Wt = [0, 1, 0, -1, 0, 0, 0, 0, 1];
  const Ra = mat3Mul(mat3Mul(U, W), mat3Transpose(V));
  const Rb = mat3Mul(mat3Mul(U, Wt), mat3Transpose(V));
  const t: [number, number, number] = [U[2], U[5], U[8]]; // U'nun üçüncü sütunu
  const tNeg: [number, number, number] = [-t[0], -t[1], -t[2]];

  return [
    { R: Ra, t },
    { R: Ra, t: tNeg },
    { R: Rb, t },
    { R: Rb, t: tNeg },
  ];
}

/**
 * İki ışının orta-nokta üçgenlemesi: `s1·v1` (kamera1 çerçevesi) ile
 * `R·(s1·v1)+t = s2·v2` (kamera2 çerçevesi) arasındaki en küçük kareler
 * çözümü. `s1,s2 > 0` HER İKİ kamera önünde olmak demektir (ışın z=-1
 * biçiminde: `X = s·(xn,yn,-1)`, z-bileşeni `-s` — kamera önü `z<0` ⟺ `s>0`).
 */
export function triangulateDepths(
  R: number[],
  t: [number, number, number],
  v1: [number, number, number],
  v2: [number, number, number],
): { s1: number; s2: number } {
  const Rv1 = mat3Vec(R, v1);
  // A·[s1,s2]ᵀ = -t,  A = [Rv1 | -v2]  (3×2) → en küçük kareler (2×2 normal denklem).
  const a11 = Rv1[0] * Rv1[0] + Rv1[1] * Rv1[1] + Rv1[2] * Rv1[2];
  const a12 = -(Rv1[0] * v2[0] + Rv1[1] * v2[1] + Rv1[2] * v2[2]);
  const a22 = v2[0] * v2[0] + v2[1] * v2[1] + v2[2] * v2[2];
  const b1 = -(Rv1[0] * t[0] + Rv1[1] * t[1] + Rv1[2] * t[2]);
  const b2 = v2[0] * t[0] + v2[1] * t[1] + v2[2] * t[2];
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return { s1: -1, s2: -1 }; // dejenere → geçersiz sayılır
  const s1 = (b1 * a22 - a12 * b2) / det;
  const s2 = (a11 * b2 - a12 * b1) / det;
  return { s1, s2 };
}

/** RANSAC → essential → 4 aday → cheirality oylamasıyla TEK (R,t) seçimi.
 *  E1.2 sözleşmesi: başarıda `PoseResult` (kaynak 'essential', dejenere false),
 *  başarısızlıkta (yetersiz eşleşme / cheirality 0) NULL — F2 davranışı korunur. */
export function recoverPose(
  matches: PointMatch[],
  K: CameraIntrinsicsSimple,
  opts: RansacOptions = {},
): PoseResult | null {
  const ransac = ransacEssential(matches, K, opts);
  if (!ransac) return null;
  const { E, inlierMask } = ransac;
  const candidates = decomposeEssential(E);

  const inlierRays: Array<[[number, number, number], [number, number, number]]> = [];
  for (let i = 0; i < matches.length; i++) {
    if (inlierMask[i]) inlierRays.push([pixelToRay(matches[i].x1, matches[i].y1, K), pixelToRay(matches[i].x2, matches[i].y2, K)]);
  }

  let best = candidates[0];
  let bestVotes = -1;
  for (const cand of candidates) {
    let votes = 0;
    for (const [v1, v2] of inlierRays) {
      const { s1, s2 } = triangulateDepths(cand.R, cand.t, v1, v2);
      if (s1 > 0 && s2 > 0) votes++;
    }
    if (votes > bestVotes) {
      bestVotes = votes;
      best = cand;
    }
  }

  let inlierCount = 0;
  for (let i = 0; i < inlierMask.length; i++) inlierCount += inlierMask[i];
  // Cheirality oyu 0 = dört adayın HİÇBİRİ geometrik olarak geçerli değil
  // (dejenere hareket: saf dönme / sıfır baz hattı / düzlemsel sahne) —
  // candidates[0]'ı "kötünün iyisi" diye zincire bağlamak çöp poz yayar
  // (video yolunun donmuş kareleri bu yoldan bozuk poz üretiyordu).
  // Çağıran (chainPoseTrack.fillOnFailure) null'u dürüstçe işler.
  if (bestVotes <= 0) return null;
  return {
    R: new Float32Array(best.R),
    t: new Float32Array(best.t),
    kaynak: 'essential',
    dejenere: false,
    inlierSayisi: inlierCount,
    inlierOrani: matches.length > 0 ? inlierCount / matches.length : 0,
    cheiralityVotes: bestVotes,
    inlierMask,
  };
}

export interface ChainOptions extends RansacOptions {
  /** Poz kazanılamazsa (yetersiz eşleşme/cheirality) önceki poz TEKRARLANIR
   *  mı (true, zincir kopmasın) yoksa atlanır mı (false, o keyframe eksik
   *  kalır). Varsayılan: tekrar (zincir bütünlüğü, sessiz veri kaybı değil —
   *  `PoseTrackRecord` her zaman `count` kadar döner). */
  fillOnFailure?: boolean;
}

/**
 * GÜN 5'İN TESLİMİ: ardışık keyframe çiftlerinin eşleşmelerinden D.2
 * `PoseTrackRecord[]` zinciri kurar.
 *
 * `frameMatches[i]` keyframe `i` → keyframe `i+1` eşleşmeleridir (uzunluk
 * `count-1`). İlk keyframe D.2 gereği IDENTITY'dir (dünya orijini). Sonraki
 * her poz, göreceli `(R_rel, t_rel)`'in ZİNCİRLENMESİYLE kurulur:
 *
 *   X_world (aynı fiziksel nokta) = R_A·X_camA + t_A = R_B·X_camB + t_B
 *   X_camB  = R_rel·X_camA + t_rel                          (essential matrix'in verdiği)
 *   ⇒ R_A = R_B·R_rel  ⇒  R_B = R_A·R_relᵀ
 *   ⇒ t_A = R_B·t_rel + t_B  ⇒  t_B = t_A − R_B·t_rel
 *
 * `t_rel` yalnızca YÖN'dür (|t_rel|=1) — zincirlenen `t` gerçek ölçekte
 * DEĞİLDİR (Gün 6'nın işi). `scaleA=1, scaleB=0` bırakılır: Gün 6 dolduana
 * kadar "kimlik" varsayımı, D.2'nin kayıt biçimini bozmadan.
 */
export function chainPoseTrack(
  frameMatches: PointMatch[][],
  K: CameraIntrinsicsSimple,
  frameTimesMs: number[],
  opts: ChainOptions = {},
): PoseTrackRecord[] {
  const count = frameMatches.length + 1;
  if (frameTimesMs.length !== count) {
    throw new RangeError(`chainPoseTrack: frameTimesMs uzunluğu ${frameTimesMs.length}, beklenen ${count}`);
  }
  const fillOnFailure = opts.fillOnFailure ?? true;

  const out: PoseTrackRecord[] = [
    {
      id: 0,
      R: [0, 0, 0, 1],
      t: [0, 0, 0],
      timeMs: frameTimesMs[0],
      scaleA: 1,
      scaleB: 0,
      fovY: K.fovY,
      kaynak: 'essential', // E1.2: identity taban — naif 'essential' (D6'da rafine)
      dejenere: false,
    },
  ];

  let RA = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // 3×3 satır-öncelikli, birim
  let tA: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < frameMatches.length; i++) {
    const rec = recoverPose(frameMatches[i], K, opts);
    if (!rec) {
      // E1.2 kaynak etiketi: <8 eşleşme = 'basarisiz' (dejenere DEĞİL);
      // eşleşme var ama poz çözülemedi = cheirality 0 = 'donme-fallback' (dejenere).
      const kaynak: PoseKaynak = frameMatches[i].length < 8 ? 'basarisiz' : 'donme-fallback';
      if (!fillOnFailure) continue;
      // Zincir kopmasın: önceki pozu tekrarla (dürüst — id/timeMs ilerler,
      // R/t ilerlemez; verify-pose.mjs bu karede rotasyon hatasını da rapor
      // eder, gizlenmez).
      out.push({
        id: i + 1,
        R: matrixToQuat(RA),
        t: tA,
        timeMs: frameTimesMs[i + 1],
        scaleA: 1,
        scaleB: 0,
        fovY: K.fovY,
        kaynak,
        dejenere: kaynak === 'donme-fallback',
      });
      continue;
    }
    const Rrel = Array.from(rec.R);
    const trel: [number, number, number] = [rec.t[0], rec.t[1], rec.t[2]];
    const RB = mat3Mul(RA, mat3Transpose(Rrel));
    const RBtrel = mat3Vec(RB, trel);
    const tB: [number, number, number] = [tA[0] - RBtrel[0], tA[1] - RBtrel[1], tA[2] - RBtrel[2]];
    out.push({
      id: i + 1,
      R: matrixToQuat(RB),
      t: tB,
      timeMs: frameTimesMs[i + 1],
      scaleA: 1,
      scaleB: 0,
      fovY: K.fovY,
      kaynak: 'essential',
      dejenere: false,
    });
    RA = RB;
    tA = tB;
  }

  return out;
}

export { cross3 };
