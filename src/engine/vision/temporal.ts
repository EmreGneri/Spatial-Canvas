// GÜN 4 — D.6: akış tabanlı zamansal derinlik (D.7 "ASLA KESİLMEZ").
//
// flow.ts SEYREK çalışır (300-500 köşe, piksel başına DEĞİL); derinlik
// haritasını warp etmek YOĞUN (her piksel) akış alanı ister. Bu modülün işi:
// seyrek FlowPoint[] kümesini yoğun alana yaymak ("seyrek → yoğun") ve önceki
// karenin derinlik haritasını bugünkü kareye taşıyıp EMA ile karıştırmak.
//
// YÖN SÖZLEŞMESİ (flow.ts:344 + types.ts): FlowPoint{x,y} ÖNCEKİ karedeki
// pozisyon; {u,v} önceki→şimdiki piksel yer değiştirme: prevLum'daki (x,y)
// currLum'da (x+u, y+v)'ye karşılık gelir. Curr pikseli (X,Y) prev'de
// (X−u, Y−v)'dedir — backward warp, lab.ts panTexture ile aynı yön (tutarlı).
//
// KÜÇÜK-HAREKET VARSAYIMI (gizli varsayım bırakılmaz): akış alanı uzayda
// yumuşak değişir; bir köşenin (x,y)'deki (u,v) değeri (x+u, y+v)'ye yakın
// konumlarda da yaklaşık geçerlidir. Bu yüzden seyrek küme YOĞUN alana
// nearest-neighbor ile yayılır (her piksel en yakın köşenin akışını alır).
//
// TÜM SABİTLER ÖLÇÜMDEN TÜRETİLDİ (2026-08-14; tarama script'leri temp'te):
//   - Yoğunlaştırma: NN seçildi ÖLÇÜMLE — pan akış alanında NN max hata
//     0.058 px, IDW (1/d², yarıçap 20) max 3.2 px (55×). NN deterministik,
//     köşenin kendi konumunda kendi akışı (round-trip garantisi).
//   - alpha = 0.3: 6 karelik salınımlı-kayma + korelasyonlu-gürültü sentetik
//     sahnede medyan RMSE taraması (0.25/0.3/0.4/0.5 → 0.0224/0.0229/0.0241/
//     0.0260): α=0.3 artık-hatayı düşük tutarken warp marjını korur.
//   - fbThreshold = 0.1 px: ileri-geri round-trip eşiği. Ölçülen İYİ dağılım
//     (pan, 320×180): medyan 0.013, p99 0.049, max 0.063 px → 0.1 = max×1.5
//     (flow.ts errorThreshold disiplini).
//   - coverRadius = 28 px: NN güvenilirlik eşiği. Köşe yoğunluğu ~11 px²;
//     28 px ≈ 7 hücre. Fotometrik-uyumsuz 60×60 dama bölgesi çekirdeğinin
//     en yakın köşeye mesafesi 38–56 px → TAMAMEN oklüzyon; normal sahnede
//     piksellerin %88'i güvenilir kapsanır (ölçüm).
// Math.random YOK — her hesaplama deterministik (repo kuralı).

import type { FlowPoint } from './types.ts';

export interface TemporalOptions {
  /** EMA karışım katsayısı (0,1]: depth = (1−α)·warp + α·raw. Ölçümden. */
  alpha?: number;
  /** İleri-geri round-trip eşiği (px). Ölçümden: 0.1. */
  fbThreshold?: number;
  /** NN yoğunlaştırma güvenilirlik yarıçapı (px). Ölçümden: 28. */
  coverRadius?: number;
}

export interface DenseFlow {
  u: Float32Array;
  v: Float32Array;
  /** NN mesafe karesi (px²) — coverage eşiği stabilizeDepth'te kullanılır. */
  d2: Float32Array;
}

/** Kenar kelepçeli bilinear örnekleyici. flow.ts/lab.ts bilinear'larıyla AYNI
 *  sözleşme (taşma en yakın kenar pikseline sabitlenir); bağımsız küçük
 *  yardımcı — paylaşılan modüle çıkarmak bu fazda flow.ts'e dokunuş isterdi. */
function sampleBilinear(
  tex: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const a = tex[y0 * w + x0];
  const b = tex[y0 * w + x1];
  const c = tex[y1 * w + x0];
  const d = tex[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (d - b - c + a) * fx * fy;
}

/**
 * Seyrek akış kümesini YOĞUN alana yayar: her piksel EN YAKIN köşenin (u,v)
 * değerini alır (nearest-neighbor; IDW ölçümde 55× kötü çıktı — belge yukarıda).
 * radius 64 px'lik yerel pencere: NN mesafesi 64 px'i aşabilen piksel (köşe
 * yoğunluğu ~11 px² olduğundan pratikte hiç) u=v=0 kalır ve d2 büyük olur →
 * coverage eşiği onları oklüzyona iter (güvenli varsayılan).
 */
export function densifyFlow(
  flow: FlowPoint[],
  width: number,
  height: number,
): DenseFlow {
  const n = width * height;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const d2 = new Float32Array(n);
  d2.fill(Infinity);
  if (flow.length === 0) return { u, v, d2 };
  const r = 64;
  for (const c of flow) {
    const x0 = Math.max(0, c.x - r);
    const x1 = Math.min(width - 1, c.x + r);
    const y0 = Math.max(0, c.y - r);
    const y1 = Math.min(height - 1, c.y + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = c.x - x;
        const dy = c.y - y;
        const dd = dx * dx + dy * dy;
        const i = y * width + x;
        if (dd < d2[i]) {
          d2[i] = dd;
          u[i] = c.u;
          v[i] = c.v;
        }
      }
    }
  }
  return { u, v, d2 };
}

/**
 * YOĞUN akış alanıyla backward warp: out[Y][X] = bilinear(field,
 * X − u[Y][X], Y − v[Y][X]) — akış yönü gereği öncekiden bugüne taşıma
 * (lab.ts panTexture deseni). Kenar kelepçeli (sarma/wrap YOK: gerçek
 * sahnede kadraj dışından yeni veri GELMEZ).
 */
export function warpField(
  field: Float32Array,
  width: number,
  height: number,
  u: Float32Array,
  v: Float32Array,
): Float32Array {
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      out[i] = sampleBilinear(field, width, height, x - u[i], y - v[i]);
    }
  }
  return out;
}

/** YOĞUN alanlardan ileri-geri tutarlılık maskesi (0 = oklüzyon, 1 = güvenilir).
 *  forwardBackwardOcclusion'ın verimli çekirdeği: çağıran zaten yoğunlaştırmış
 *  alanları geçer — tekrarlanan densifyFlow YOK. stabilizeDepth 3 densify
 *  yapar (fwd, bwd, warp-a priori kullanmaz); FB maskesi ekstra densify
 *  istemez (ölçüm: tek densify ~4.1 ms → 3× ≈ 12 ms, 320×180'de). */
function forwardBackwardOccFromDense(
  fwd: DenseFlow,
  bwd: DenseFlow,
  width: number,
  height: number,
  threshold: number,
): Float32Array {
  const n = width * height;
  const mask = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const px = x - fwd.u[i];
      const py = y - fwd.v[i];
      const bu = sampleBilinear(bwd.u, width, height, px, py);
      const bv = sampleBilinear(bwd.v, width, height, px, py);
      const err = Math.hypot(fwd.u[i] + bu, fwd.v[i] + bv);
      mask[i] = err <= threshold ? 1 : 0;
    }
  }
  return mask;
}

/**
 * İleri-geri tutarlılık oklüzyon maskesi: 0 = oklüzyon (akış güvenilmez),
 * 1 = güvenilir.
 *
 * İleri akış (prev→curr) ve geri akış (curr→prev) ayrı ayrı yoğunlaştırılır.
 * Piksel P'de: ileri akışla gidilen nokta A = P − fwd(P) (prev koordinatı);
 * A'daki geri akış bwd(A) yeniden P'ye dönmeli:
 *
 *   roundTrip(P) = | fwd(P) + bwd(P − fwd(P)) |
 *
 * roundTrip ≤ threshold ise iki yön birbirini doğrular (güvenilir), değilse
 * oklüzyon (o P'de akış yanlış eşleşti, iz kaybı ya da örtme). Eşik ölçülen
 * iyi dağılımdan: pan medyan 0.013 / max 0.063 px → 0.1 (max × 1.5).
 */
export function forwardBackwardOcclusion(
  flowFwd: FlowPoint[],
  flowBwd: FlowPoint[],
  width: number,
  height: number,
  threshold: number,
): Float32Array {
  const fwd = densifyFlow(flowFwd, width, height);
  const bwd = densifyFlow(flowBwd, width, height);
  return forwardBackwardOccFromDense(fwd, bwd, width, height, threshold);
}

/**
 * Akış tabanlı zamansal derinlik kararlılaştırması.
 *
 *   1. İleri/geri akışlar ayrı ayrı yoğunlaştırılır.
 *   2. Oklüzyon maskesi = ileri-geri tutarlılık (forwardBackwardOcclusion)
 *      VE yoğunlaştırma güvenilirliği (NN mesafesi ≤ coverRadius). İkinci
 *      koşul gereklidir — ölçüm: fotometrik-uyumsuz bölgede LK köşeleri
 *      status=0 olur, NN alanı o BOŞ bölgeyi çevre köşeleriyle (yanlış da
 *      olsa) doldurur; FB tek başına bunu yakalayamaz (uyumsuz bölgede
 *      round-trip 0.029 px — medyanla aynı mertebe). coverage bunu kapatır.
 *   3. EMA: depth = (1−α)·w + α·rawCurrDepth, w = warp(prevDepth) eğer
 *      güvenilir, yoksa rawCurrDepth → oklüzyon pikselinde depth = raw aynen
 *      (α=0 etkisi: bozuk warp edilmiş veri kullanılmaz).
 *
 * alpha ölçümünün gerekçesi (yukarıdaki başlık yorumunda): α=0.3, 6 karelik
 * sentetik kamera (salınımlı kayma ≤2.2 px + korelasyonlu model gürültüsü)
 * taramasının optimumu.
 */
export function stabilizeDepth(
  prevDepth: Float32Array,
  rawCurrDepth: Float32Array,
  flowFwd: FlowPoint[],
  flowBwd: FlowPoint[],
  width: number,
  height: number,
  opts?: TemporalOptions,
): { depth: Float32Array; occlusion: Float32Array } {
  const alpha = opts?.alpha ?? 0.3;
  const fbThreshold = opts?.fbThreshold ?? 0.1;
  const coverRadius = opts?.coverRadius ?? 28;

  const fwd = densifyFlow(flowFwd, width, height);
  const bwd = densifyFlow(flowBwd, width, height);
  const fb = forwardBackwardOccFromDense(fwd, bwd, width, height, fbThreshold);

  const n = width * height;
  const occlusion = new Float32Array(n);
  const cover2 = coverRadius * coverRadius;
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const trust = fb[i] === 1 && fwd.d2[i] <= cover2;
    occlusion[i] = trust ? 1 : 0;
    if (trust) {
      const x = i % width;
      const y = (i - x) / width;
      const w = sampleBilinear(prevDepth, width, height, x - fwd.u[i], y - fwd.v[i]);
      depth[i] = (1 - alpha) * w + alpha * rawCurrDepth[i];
    } else {
      depth[i] = rawCurrDepth[i];
    }
  }
  return { depth, occlusion };
}