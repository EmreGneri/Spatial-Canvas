/**
 * GÜN 7 (Emre — veri/CV şeridi) — FÜZYON + ENTEGRASYON.
 *
 * Plan: "Keyframe bulutlarını dünya çerçevesinde birleştir → GaussianBuffer'ı
 * doldur → keyframeIndex yaz. ATE ölçümü (sentetik yörüngede). Bitti sayılır:
 * tek video → orbit edilebilir tek 3D sahne."
 *
 * ── NEDİR ────────────────────────────────────────────────────────────────
 * Gün 5'in poz zinciri (essential matrix, ölçek belirsiz — `t` yön bilir,
 * uzunluk bilmez) + Gün 6'nın ölçek hizalaması (`d_metric ≈ a·d_pred + b`,
 * üçgenlemeden gelen tutarlı metrik derinliğe model çıktısını doğrular) +
 * yoğun derinlik haritası (mevcut `depth.ts`). Bu modül ÜÇÜNÜ birden
 * GaussianBuffer'a (D.1) taşır: her keyframe'in ölçek-hizalı dünya bulutu
 * TEK dünya çerçevesinde birleşir ve `Engine.setGaussians` kapısından
 * (Engine.ts) splat moduna girer.
 *
 * ── YÖN SÖZLEŞMESİ ───────────────────────────────────────────────────────
 * Girdi pozlar D.2 `PoseTrackRecord` (kamera→dünya; `p_world = R·p_cam + t`),
 * dünya orijini ilk keyframe (D.2: `toFirstKeyframeOrigin`). Splat dünya
 * konumu: pikselden ışın (`pixelToRay`, z=-1 — trajectory/pose ile AYNI
 * pinhole), ölçek-hizalı derinlik s ile çarpılır, poza göre dünyaya taşınır.
 *
 * ── ÖLÇEK HİZALAMASI ────────────────────────────────────────────────────
 * Tüm keyframe çiftlerinin eşleşmeleri TEK havuza üçgenlenir
 * (`triangulateWorldPoint` → d_metric), aynı pikseldeki model çıktısı
 * (`getDepthAt` → d_pred) ile `fitScaleAlignment` çözülür — tek çiftte
 * az veri varken tüm çiftlerin ortak en küçük karesi daha gürbüzdür.
 * `scale: null` = hizalama yok (d_pred'de varyans yok) — dürüst kayıt;
 * splat'lar d_pred'in KENDİ ölçeğinde üretilir, çağıran sonucu buna göre
 * yorumlar (sessiz yanlış sayı ÜRETİLMEZ).
 *
 * ── DETERMİNİZM ──────────────────────────────────────────────────────────
 * Math.random YOK. Rastgelelik gereken hiçbir yol burada yok; gürültü
 * (testlerde) çağıranın deterministik kaynağındandır (mulberry32).
 */

import type { GaussianBufferData } from '../../shaders/splatFixture.ts';
import { createGaussianBufferData } from '../../shaders/splatFixture.ts';
import type { PoseTrackRecord } from './types.ts';
import type { PointMatch, CameraIntrinsicsSimple } from './pose.ts';
import { pixelToRay } from './pose.ts';
import type { ScaleFit } from './scale.ts';
import { fitScaleAlignment, triangulateWorldPoint } from './scale.ts';
import { quatToMatrix } from './trajectory.ts';

/** İki keyframe arasındaki nokta eşleşmeleri (üretimde: flow.ts izi). */
export interface KeyframeMatch {
  /** Kaynak keyframe indeksi (pose dizisinden). */
  a: number;
  /** Hedef keyframe indeksi. */
  b: number;
  matches: PointMatch[];
}

/** Tek splat'ın kaynağı: hangi keyframe'in hangi pikseli. */
export interface SplatPixel {
  keyIdx: number;
  x: number;
  y: number;
}

export interface FusionInput {
  /** Dünya çerçevesinde pozlar (ilk keyframe orijinli — D.2). */
  poses: PoseTrackRecord[];
  /** Splat'a dönüşecek piksel seti. Çağıran örnekleme stratejisini seçer. */
  splatPixels: SplatPixel[];
  /** Üçgenleme eşleşmeleri (ölçek hizalaması için). Boşsa ölçek yoktur. */
  matches: KeyframeMatch[];
  /** Yoğun derinlik modeli çıktısı: d_pred(keyIdx, x, y). ≤0/NaN → atla. */
  getDepthAt: (keyIdx: number, x: number, y: number) => number;
  /** Renk kaynağı: [r,g,b] (0..1). null → o piksel splat OLMAZ. */
  getColorAt: (keyIdx: number, x: number, y: number) => [number, number, number] | null;
  K: CameraIntrinsicsSimple;
  /** Splat yarıçapı: piksel boyutu × bu çarpan × örnekleme adımı.
   *  Örnekleme adımı çağıranda; b.w komşu splat'a değecek kadar büyük olur. */
  sampleStep?: number;
}

export interface FusionResult {
  /** D.1 + D.4 dolu buffer (a: xyz+opak, b: normal+ölçek, c: rgb+AO,
   *  keyframeIndex: kaynak keyframe). */
  data: GaussianBufferData;
  /** Bulunan ölçek hizalaması (null = d_pred kendi ölçeğinde üretildi). */
  scale: ScaleFit | null;
}

/**
 * GÜN 7'NİN ÇEKİRDEĞİ: seyrek piksel setini ölçek-hizalı dünya bulutuna
 * çevirip GaussianBuffer'ı doldurur.
 *
 * Her splat için:
 *   1. d = getDepthAt → s = scaleA·d + scaleB (ölçek yoksa d'nin kendisi).
 *      s ≤ 0 ya da sonlu değilse piksel ATILIR (kamera arkası — cheirality).
 *   2. X_world = R·(s·v) + t — v = pixelToRay (pinhole, z=-1).
 *   3. normal = R·v (birim, DÜNYA çerçevesinde görüş yönü) — nokta bulutu
 *      düzensizdir, komşu farkı geçerli bir yüzey normali VERMEZ (köprünün
 *      grid tabanlı normali burada kullanılamaz; splat yüzeye değil kameraya
 *      dönük çizilir — rasterizer'ın veri yolu, gerçek normal füzyon
 *      olgunlaşınca gelir). splatMaterial B.xyz'i DÜNYA normali sayar,
 *      bu yüzden v poza göre döndürülür.
 *   4. ölçek = s·pikselDünyaBoyutu·sampleStep — komşu splat'a değer (delik
 *      bırakmaz, üst üste binme sıralama kapısının işi).
 *   5. renk = getColorAt; opaklık = 1, AO = 1 (nokta bulutu oklüzyonsuz).
 * keyframeIndex (D.4): splat'ın kaynak keyframe'i — timeline filtresi CPU'da
 * okur (GPU'ya gitmez, splats.ts dokunulmadı).
 */
export function fuseKeyframes(input: FusionInput): FusionResult {
  const { poses, splatPixels, matches, getDepthAt, getColorAt, K } = input;
  const sampleStep = input.sampleStep ?? 1;

  // ── Ölçek hizalaması: TÜM çiftlerin üçgenleme havuzu → tek en küçük kare ──
  const pairs: Array<{ dPred: number; dMetric: number }> = [];
  for (const km of matches) {
    const pa = poses[km.a];
    const pb = poses[km.b];
    if (!pa || !pb) continue; // bozuk girdi — sessiz sayı üretme, atla
    for (const m of km.matches) {
      const tri = triangulateWorldPoint(pa, pb, m, K);
      if (!tri) continue;
      const dPred = getDepthAt(km.a, m.x1, m.y1);
      if (!(dPred > 0)) continue;
      pairs.push({ dPred, dMetric: tri.depthA });
    }
  }
  const scale = fitScaleAlignment(pairs);

  // ── Splat üretimi ──────────────────────────────────────────────────────
  const pxWorld = (2 * Math.tan(K.fovY / 2)) / K.height; // 1 piksel dünya boyutu
  const out: GaussianBufferData = createGaussianBufferData(splatPixels.length);
  let n = 0;
  for (const sp of splatPixels) {
    const pose = poses[sp.keyIdx];
    if (!pose) continue;
    const d = getDepthAt(sp.keyIdx, sp.x, sp.y);
    if (!(d > 0)) continue;
    const s = scale ? scale.scaleA * d + scale.scaleB : d;
    if (!(s > 0) || !Number.isFinite(s)) continue;
    const col = getColorAt(sp.keyIdx, sp.x, sp.y);
    if (!col) continue;

    const v = pixelToRay(sp.x, sp.y, K);
    const vl = Math.hypot(v[0], v[1], v[2]) || 1;
    const R = quatToMatrix(pose.R);
    const o = n * 4;
    // X_world = R·(s·v) + t
    out.a[o] = R[0] * s * v[0] + R[1] * s * v[1] + R[2] * s * v[2] + pose.t[0];
    out.a[o + 1] = R[3] * s * v[0] + R[4] * s * v[1] + R[5] * s * v[2] + pose.t[1];
    out.a[o + 2] = R[6] * s * v[0] + R[7] * s * v[1] + R[8] * s * v[2] + pose.t[2];
    out.a[o + 3] = 1; // nokta bulutu: tam görünür
    // normal = dünyaya taşınmış görüş yönü R·v (birim). Splat B.xyz'i DÜNYA
    // normali sayar (splatMaterial: vNormalW, basisFromNormal, uLightDir) —
    // çıplak v yalnızca keyframe 0'da (identity R) dünya çerçevesidir;
    // rotasyonlu keyframe'lerde elips ekseni/ışık yönü çarpılıyordu.
    // Nokta bulutu düzensizdir, komşu farkı geçerli bir yüzey normali vermez;
    // splat yüzeye değil kameraya dönük çizilir (rasterizer'ın veri yolu,
    // gerçek normal füzyon olgunlaşınca gelir). R ortonormal → |R·v| = |v|.
    out.b[o] = (R[0] * v[0] + R[1] * v[1] + R[2] * v[2]) / vl;
    out.b[o + 1] = (R[3] * v[0] + R[4] * v[1] + R[5] * v[2]) / vl;
    out.b[o + 2] = (R[6] * v[0] + R[7] * v[1] + R[8] * v[2]) / vl;
    out.b[o + 3] = s * pxWorld * sampleStep;
    out.c[o] = col[0];
    out.c[o + 1] = col[1];
    out.c[o + 2] = col[2];
    out.c[o + 3] = 1; // AO nötr
    out.keyframeIndex[n] = sp.keyIdx;
    n++;
  }
  out.count = n;
  return { data: out, scale };
}

// ────────────────────────────────────────────────────────────────────────────
// VIDEO KÖPRÜSÜ. İmza, video yolunun çağırdığı TEK giriştir: yoğun
// derinlik/renk haritaları + flow eşleşmeleri verilir, grid örneklemesi
// burada yapılır. CANLI UCU: videoPipe.ts (Gün 7 kablosu) — captureKeyframes
// + buildFusionScene → App `video → 3B` butonu. Sentetik doğrulama:
// verify-fusion.mjs grup 3-5; canlı uç: verify-videopipe.mjs.
// ────────────────────────────────────────────────────────────────────────────
export interface VideoFusionInput {
  /** Dünya çerçevesinde pozlar (ilk keyframe orijinli). */
  poses: PoseTrackRecord[];
  /** Keyframe başına yoğun d_pred haritaları (w×h). */
  depth: Float32Array[];
  /** Keyframe başına renk haritaları (w×h×3, 0..1). */
  rgb: Float32Array[];
  /** Ardışık keyframe eşleşmeleri (üretimde: flow.ts izi). */
  matches: KeyframeMatch[];
  width: number;
  height: number;
  /** Dikey görüş açısı (radyan) — D.3. */
  fovY: number;
  /** Piksel alt örnekleme adımı: splat yoğunluğu = w·h / step². */
  sampleStep?: number;
}

export function fuseVideoFrames(input: VideoFusionInput): FusionResult {
  const { poses, depth, rgb, matches, width, height, fovY } = input;
  const sampleStep = input.sampleStep ?? 2;
  const splatPixels: SplatPixel[] = [];
  for (let k = 0; k < poses.length; k++) {
    const d = depth[k];
    if (!d || d.length !== width * height) continue;
    for (let y = 0; y < height; y += sampleStep) {
      for (let x = 0; x < width; x += sampleStep) {
        splatPixels.push({ keyIdx: k, x, y });
      }
    }
  }
  return fuseKeyframes({
    poses,
    splatPixels,
    matches,
    getDepthAt: (k, x, y) => (depth[k] ? depth[k][y * width + x] : -1),
    getColorAt: (k, x, y) => {
      const img = rgb[k];
      if (!img) return null;
      const i = (y * width + x) * 3;
      return [img[i], img[i + 1], img[i + 2]];
    },
    K: { width, height, fovY },
    sampleStep,
  });
}
