/**
 * GÜN 6 (Emre — veri/CV şeridi) — ÖLÇEK HİZALAMA + KEYFRAME ZİNCİRİ.
 *
 * Plan: "Triangüle seyrek noktalarla d_metric ≈ a·d_pred + b en küçük
 * kareler; keyframe seçimi (parallaks + takip kalitesi eşiği). Bitti
 * sayılır: 30 sn'lik gerçek klipten 8-15 keyframe + tutarlı ölçekli pozlar
 * çıkıyor."
 *
 * ── ÜÇGENLEME ────────────────────────────────────────────────────────────
 * Gün 5'in `triangulateDepths`'i (kamera1=kimlik göreceli çerçeve) burada
 * MUTLAK D.2 `PoseTrackRecord` çiftine genelleştirilir: iki mutlak poz
 * arasındaki göreceli `(Rrel, trel)` kurulur (aynı türetme `chainPoseTrack`
 * ile — `X_camB = Rrel·X_camA + trel`), üçgenlenen derinlik kamera A'nın
 * dünya pozuyla dünya noktasına çevrilir.
 *
 * ── ÖLÇEK HİZALAMA (D.2) ────────────────────────────────────────────────
 * `d_metric ≈ scaleA·d_pred + scaleB`. `d_metric`: üçgelenen seyrek derinlik
 * (pose zincirinin KENDİ, keyfî ama TUTARLI ölçeğinde — essential matrix
 * `t`'yi yalnızca yön verdiği için Gün 5'in zinciri metrik değildir, ama
 * zincir boyunca İÇSEL TUTARLIDIR). `d_pred`: yoğun derinlik modelinin AYNI
 * piksellerdeki tahmini (`depth.ts`, kendi keyfî normalizasyonuyla). Bu
 * fonksiyon d_pred'i GERÇEK veri OLARAK almaz — çağıran (üretimde: gerçek
 * `estimateDepth` çıktısı, bu modülün testinde: sentetik bozulmuş derinlik)
 * sağlar; burası yalnızca en küçük kareler çözücüsüdür.
 *
 * ── KEYFRAME SEÇİMİ (D.8: hedef 8-20) ──────────────────────────────────
 * Referans son seçilen keyframe'dir; parallaks (medyan piksel yer değişimi)
 * eşiği AŞILINCA ya da izlenen nokta sayısı eşiğin ALTINA düşünce yeni
 * keyframe konur ve referans ona kayar. Son kare her zaman keyframe'dir
 * (D.8: sahne kapsamı son kareyi de içermeli).
 */

import type { PointMatch } from './pose.ts';
import { pixelToRay, triangulateDepths, type CameraIntrinsicsSimple } from './pose.ts';
import { mat3Mul, mat3Transpose, mat3Vec } from './linalg.ts';
import type { PoseTrackRecord } from './types.ts';
import { quatToMatrix } from './trajectory.ts';

export interface TriangulatedPoint {
  /** Dünya konumu (pose zincirinin kendi tutarlı ölçeğinde). */
  point: [number, number, number];
  /** Kamera A'dan derinlik (kamera ekseni boyunca, pozitif). */
  depthA: number;
  /** Kamera B'den derinlik. */
  depthB: number;
}

/**
 * İki MUTLAK D.2 pozu + bir piksel eşleşmesinden dünya noktası üçgenler.
 * Cheirality başarısızsa (nokta her iki kameranın da önünde değilse) `null`.
 */
export function triangulateWorldPoint(
  poseA: PoseTrackRecord,
  poseB: PoseTrackRecord,
  match: PointMatch,
  K: CameraIntrinsicsSimple,
): TriangulatedPoint | null {
  const RA = quatToMatrix(poseA.R);
  const RB = quatToMatrix(poseB.R);
  // chainPoseTrack ile AYNI türetme: X_camB = Rrel·X_camA + trel.
  const Rrel = mat3Mul(mat3Transpose(RB), RA);
  const dT: [number, number, number] = [
    poseA.t[0] - poseB.t[0],
    poseA.t[1] - poseB.t[1],
    poseA.t[2] - poseB.t[2],
  ];
  const trel = mat3Vec(mat3Transpose(RB), dT);

  const v1 = pixelToRay(match.x1, match.y1, K);
  const v2 = pixelToRay(match.x2, match.y2, K);
  const { s1, s2 } = triangulateDepths(Rrel, trel, v1, v2);
  if (!(s1 > 0) || !(s2 > 0)) return null;

  // X_camA = s1·v1 (kamera A'nın kendi çerçevesi) → dünyaya: RA·X_camA + tA.
  const XcamA: [number, number, number] = [s1 * v1[0], s1 * v1[1], s1 * v1[2]];
  const Xw = mat3Vec(RA, XcamA);
  return { point: [Xw[0] + poseA.t[0], Xw[1] + poseA.t[1], Xw[2] + poseA.t[2]], depthA: s1, depthB: s2 };
}

export interface ScaleFit {
  scaleA: number;
  scaleB: number;
  /** Uydurma artığının RMS'i (d_metric biriminde) — hizalama kalitesi. */
  rmse: number;
  /** Uydurmaya giren nokta sayısı (aykırı ayıklamadan SONRA). */
  inliers: number;
  /** Aykırı sayılıp atılan nokta sayısı. */
  rejected: number;
}

/** Medyan (kopya üzerinde sıralar — girdi bozulmaz). */
function median(values: number[]): number {
  const s = values.slice().sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * MAD (medyan mutlak sapma) tabanlı aykırı maskesi. Ortalama/std DEĞİL:
 * ortalama ve std'nin kendisi aykırılardan bozulur, MAD bozulmaz (kırılma
 * noktası %50). `k = 3.5` ≈ normal dağılımda 3.5σ.
 *
 * MAD ≈ 0 ise (değerlerin yarısından fazlası birebir aynı) filtre KAPANIR —
 * aksi halde medyandan farklı her nokta atılır ve uydurma çöker.
 */
function madMask(values: number[], k: number): boolean[] {
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  if (!(mad > 1e-12)) return values.map(() => true);
  const limit = k * 1.4826 * mad; // 1.4826: MAD → σ tutarlılık çarpanı
  return values.map((v) => Math.abs(v - med) <= limit);
}

/** Kapalı form OLS (normal denklemler). Varyans yoksa null. */
function ols(pairs: Array<{ dPred: number; dMetric: number }>): { a: number; b: number } | null {
  const n = pairs.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const { dPred, dMetric } of pairs) {
    sx += dPred;
    sy += dMetric;
    sxx += dPred * dPred;
    sxy += dPred * dMetric;
  }
  const denom = n * sxx - sx * sx;
  if (!(Math.abs(denom) > 1e-9)) return null; // d_pred'de varyans yok
  const a = (n * sxy - sx * sy) / denom;
  return { a, b: (sy - a * sx) / n };
}

/** Aykırı ayıklamanın agresifliği (MAD katı). */
const SCALE_MAD_K = 3.5;

/**
 * `d_metric ≈ scaleA·d_pred + scaleB` — **DAYANIKLI (robust)** uydurma.
 *
 * ── NEDEN DÜZ EN KÜÇÜK KARELER YETMİYOR (ölçüldü) ───────────────────────
 * `d_metric` ÜÇGENLEMEDEN gelir ve hatası ağır kuyrukludur: ışınlar
 * neredeyse paralel olduğunda (küçük parallaks, epipole yakın nokta)
 * üçgenlenen derinlik binlere fırlar. Düz OLS'te tek bir böyle nokta bütün
 * uydurmayı çeker — kareler hatayı ödüllendirir.
 *
 * Gerçek klipte iki koşuda da bu görüldü (2026-08-14 / 2026-08-16):
 *   a = −15.98, b =  52.84, rmse =  52.71   (eğim NEGATİF — anlamsız)
 *   a = +62.54, b = 561.99, rmse = 531.45   (rmse, |a|'nın 8.5 katı)
 * İkisinde de uydurma veriyi açıklamıyordu ama fonksiyon "başarılı" dönüyordu.
 *
 * ── ÇÖZÜM ───────────────────────────────────────────────────────────────
 * İki aşamalı, DETERMİNİSTİK (RANSAC yok — rastgelelik yok, tekrarlanabilir):
 *   1. `d_metric` üzerinde MAD maskesi → üçgenleme patlamaları atılır.
 *   2. Kalanla OLS → artıklar üzerinde ikinci MAD maskesi → yeniden OLS.
 * `rmse` ve `inliers/rejected` KALAN noktalar üzerinden raporlanır; çağıran
 * kaç noktanın atıldığını görebilir (sessiz temizlik yok).
 *
 * Temiz veride (aykırısız) her iki maske de her şeyi tutar → sonuç düz
 * OLS ile BİREBİR aynıdır; mevcut sentetik testler aynen geçer.
 */
export function fitScaleAlignment(pairs: Array<{ dPred: number; dMetric: number }>): ScaleFit | null {
  // Sonlu olmayan girdiler sessizce uydurmayı zehirler.
  const clean = pairs.filter(
    (p) => Number.isFinite(p.dPred) && Number.isFinite(p.dMetric),
  );
  if (clean.length < 2) return null;

  // 1. AŞAMA — d_metric aykırıları (üçgenleme patlamaları).
  const mask1 = madMask(clean.map((p) => p.dMetric), SCALE_MAD_K);
  let use = clean.filter((_, i) => mask1[i]);
  if (use.length < 2) use = clean; // maske her şeyi yediyse ham veriye dön

  let fit = ols(use);
  if (!fit) return null;

  // 2. AŞAMA — artık aykırıları (doğruya uymayan noktalar).
  const resid = use.map((p) => p.dMetric - (fit!.a * p.dPred + fit!.b));
  const mask2 = madMask(resid, SCALE_MAD_K);
  const use2 = use.filter((_, i) => mask2[i]);
  if (use2.length >= 2) {
    const refit = ols(use2);
    if (refit) {
      fit = refit;
      use = use2;
    }
  }

  let sq = 0;
  for (const { dPred, dMetric } of use) {
    const r = dMetric - (fit.a * dPred + fit.b);
    sq += r * r;
  }
  return {
    scaleA: fit.a,
    scaleB: fit.b,
    rmse: Math.sqrt(sq / use.length),
    inliers: use.length,
    rejected: clean.length - use.length,
  };
}

/**
 * Bir keyframe çiftinin TÜM (RANSAC içerdeki) eşleşmelerini üçgenleyip
 * `d_pred` ile hizalar. `getPredictedDepth(x,y)` çağıranın yoğun derinlik
 * haritasından (kamera A'daki, piksel koordinatında) örnek okur — bu modül
 * derinlik modelinden BAĞIMSIZDIR (D.5 "harness bağımsızlığı" kuralının
 * aynısı: burada model yükü YOK).
 */
export function alignKeyframeScale(
  poseA: PoseTrackRecord,
  poseB: PoseTrackRecord,
  matches: PointMatch[],
  K: CameraIntrinsicsSimple,
  getPredictedDepth: (x: number, y: number) => number,
): ScaleFit | null {
  const pairs: Array<{ dPred: number; dMetric: number }> = [];
  for (const m of matches) {
    const tri = triangulateWorldPoint(poseA, poseB, m, K);
    if (!tri) continue;
    const dPred = getPredictedDepth(m.x1, m.y1);
    if (!(dPred > 0)) continue;
    pairs.push({ dPred, dMetric: tri.depthA });
  }
  return fitScaleAlignment(pairs);
}

export interface KeyframeSelectionOptions {
  /** Referans keyframe'e göre medyan piksel yer değişimi eşiği. */
  minParallaxPx?: number;
  /** Bu sayının ALTINA düşen izlenen nokta sayısı zorunlu keyframe koydurur
   *  (izleme kopmadan önce — D.8'in "8-20 keyframe" hedefinin alt sınırı). */
  minTrackedCount?: number;
}

const KEYFRAME_DEFAULTS: Required<KeyframeSelectionOptions> = { minParallaxPx: 20, minTrackedCount: 40 };

/**
 * GÜN 6'NIN TESLİMİ: akış tabanlı keyframe seçimi. `buildMatchesAgainst(ref,
 * cand)` çağıranın eşleştirme kaynağıdır (üretimde: `flow.ts` izi + ara
 * kareler üzerinden birikimli akış; bu modülün testinde: sentetik index
 * eşleşmesi) — bu fonksiyon eşleşme KAYNAĞINA kayıtsızdır.
 *
 * Referans, HER yeni keyframe seçildiğinde günceLLENİR (ona kayar) — bu,
 * parallaksın keyframe'ler arası her zaman "sıfırdan" birikmesini sağlar
 * (referans güncellenmeseydi parallaks asla düşmez, ilk eşikten sonra HER
 * kare keyframe olurdu).
 */
export function selectKeyframes(
  frameCount: number,
  buildMatchesAgainst: (refIdx: number, candIdx: number) => PointMatch[],
  opts: KeyframeSelectionOptions = {},
): number[] {
  const o = { ...KEYFRAME_DEFAULTS, ...opts };
  if (frameCount <= 0) return [];
  if (frameCount === 1) return [0];
  const keyframes = [0];
  let ref = 0;
  for (let i = 1; i < frameCount; i++) {
    const m = buildMatchesAgainst(ref, i);
    const disps = m.map((p) => Math.hypot(p.x2 - p.x1, p.y2 - p.y1)).sort((a, b) => a - b);
    const medianParallax = disps.length ? disps[Math.floor(disps.length / 2)] : 0;
    if (medianParallax >= o.minParallaxPx || m.length < o.minTrackedCount) {
      keyframes.push(i);
      ref = i;
    }
  }
  // D.8 hedef kapsamı son kareyi de içerir — eşik son karede tetiklenmemiş
  // olabilir (video "erken" bitebilir), sessizce dışarıda bırakılmaz.
  if (keyframes[keyframes.length - 1] !== frameCount - 1) keyframes.push(frameCount - 1);
  return keyframes;
}
