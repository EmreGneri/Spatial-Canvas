// YÜZ RÖLYEFİ — MediaPipe yüz ağının (478 nokta, göreli z) 3B şeklini derinlik
// haritasına işlemek için saf (DOM'suz) yardımcılar.
//
// Neden: tek görüntü derinlik modelleri yüzü ya neredeyse düz (V2) ya da gövdeden
// kopuk bir raf gibi (DA3 + germe) veriyor; yandan bakınca burun/yanak/alın şekli
// kayboluyor. Yüz ağının z'si x ile AYNI ölçekte (görüntü genişliğine normalize)
// geldiği için yüzün gerçek göreli şeklini taşır. Model derinliğinin YERİ korunur
// (yüzün medyan derinliği), yalnız yüz içindeki ŞEKİL ağdan gelir.
//
// İki adım:
//  1. `yuzRolyefHaritasi`: tam derinlik ızgarasında (w×h) piksel cinsinden rölyef
//     (kameraya doğru +, yüz medyanına göre) ve yumuşak kenarlı ağırlık.
//  2. `yuzRolyefiUygula`: motorun dünya eşlemesiyle piksel → derinlik birimine çevirip
//     derinliğe harmanlar (Engine.setDepth, kırpmadan sonra).

export interface YuzNoktasi {
  x: number;
  y: number;
  z: number;
}

export interface YuzRolyefi {
  /** Yalnız otomatik ayarda ek kazanç fotoğrafın yüz derinliğine göre sınırlanır. */
  otomatikGuc?: number;
  /** Kafa sınırı ölçeklenirken fiziksel saç payı sabit kalır. */
  sacPayi?: number;
  /** Rölyef, derinlik ızgarası PİKSELİ cinsinden; + = kameraya doğru, yüz medyanı 0. */
  rel: Float32Array;
  /** 0..1 harman ağırlığı: yüz ovali içinde 1, kenarda yumuşak sönüm, dışında 0. */
  agirlik: Float32Array;
  /**
   * KAFA ELİPSOİDİ üst sınırı (rel ile aynı birim): oval DIŞINDAKİ alın + saç, kafatası
   * yüzeyinin (saç kalınlığı payıyla) önüne geçemez. Yalnız önde olanı geri iter.
   */
  ust?: Float32Array;
  /** 0..1 üst sınır ağırlığı (oval dışı, elipsoid içi, kenarda sönümlü). */
  ustAgirlik?: Float32Array;
}

/** MediaPipe FACE_LANDMARKS_FACE_OVAL uçları (yuzReferansi.ts ile aynı liste). */
export const YUZ_OVAL: readonly number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

/** Oval DIŞINDAKİ yumuşak geçiş genişliği (ağ → model), yüz genişliğinin oranı. */
export const KENAR_SONUM_ORANI = 0.2;
/** Gauss çekirdeği σ, yüz genişliğinin oranı. */
export const CEKIRDEK_ORANI = 0.04;

// Kafa elipsoidi (anatomik ortalama oranlar; yüz noktalarından ölçeklenir):
/** Kafa yarı genişliği / yanaklar arası yarı genişlik. */
export const KAFA_GENISLIK_ORANI = 1.1;
/** Saç tepesi: alın noktasının (10) yüz yüksekliğinin bu oranı kadar üstü (headDetail ile aynı pay). */
export const SAC_PAYI = 0.35;
/** Kafa yarı derinliği / yarı genişlik (baş boyu ~19 cm, eni ~15 cm → ~1.25). */
export const KAFA_DERINLIK_ORANI = 1.25;
/** Saçın kafatasından önde durabileceği kalınlık, yüz genişliğinin oranı. */
export const SAC_KALINLIK_ORANI = 0.06;
/** Ağın alına oturan noktaları: elipsoidin ön yüzü bunlara hizalanır. */
const ALIN_NOKTALARI = [10, 109, 67, 338, 297, 151, 108, 337];

function icindeMi(px: number, py: number, poly: readonly [number, number][]): boolean {
  let ic = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) ic = !ic;
  }
  return ic;
}

function kenaraUzaklik(px: number, py: number, poly: readonly [number, number][]): number {
  let en = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const ex = ax + t * dx - px;
    const ey = ay + t * dy - py;
    en = Math.min(en, Math.hypot(ex, ey));
  }
  return en;
}

/**
 * Yüz noktalarından tam derinlik ızgarasında rölyef haritası. Noktalar kaynak görüntüye
 * normalize (0..1); derinlik haritası letterbox iç kırpımı olduğu için aynı en-boy oranında
 * ve doğrudan (x·w, y·h) ile eşlenir. 468'den az nokta ya da dejenere oval → null.
 */
export function yuzRolyefHaritasi(
  noktalar: readonly YuzNoktasi[], w: number, h: number, guc = 1, otomatik = true,
): YuzRolyefi | null {
  if (noktalar.length < 468) return null;
  // `guc`: rölyef çarpanı (1 = ağın fiziksel oranı); z'ye uygulanır ki ağ ve elipsoid tutarlı kalsın.
  const pts = noktalar.slice(0, 468).map((n) => ({ x: n.x * w, y: n.y * h, z: n.z * guc }));
  const oval = YUZ_OVAL.map((i) => [pts[i].x, pts[i].y] as [number, number]);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of oval) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const genislik = x1 - x0;
  if (!(genislik > 4) || !(y1 - y0 > 4)) return null;
  const zs = pts.map((p) => p.z).sort((a, b) => a - b);
  const zMed = zs[zs.length >> 1];
  // Geçiş ovalin DIŞINDA: içeride ağın şekli tam korunur (ağırlık 1), dışarıda F boyunca
  // modele devredilir. İçeride sönümleyip modelin eğimine çapalamak baş eğimini ezip alını
  // burnun önüne koyuyordu (ölçüldü 2026-10-12: alın 0,90 > burun 0,73).
  const gecis = Math.max(1, KENAR_SONUM_ORANI * genislik);
  // Yatay satır yerine yüz ekseni: eğik başta da çene-boyun sınırını izle.
  const alin = pts[10], cene = pts[152];
  const dx = cene.x - alin.x, dy = cene.y - alin.y;
  const axis2 = dx * dx + dy * dy;
  if (!(axis2 > 4)) return null;
  const axisT = (x: number, y: number) => ((x - alin.x) * dx + (y - alin.y) * dy) / axis2;
  const jawStart = Math.max(0.55, Math.min(0.85,
    (axisT(pts[172].x, pts[172].y) + axisT(pts[397].x, pts[397].y)) / 2));
  const jawWeight = (x: number, y: number) => {
    const t = Math.max(0, Math.min(1, (1 - axisT(x, y)) / (1 - jawStart)));
    return t * t * (3 - 2 * t);
  };

  const rel = new Float32Array(w * h);
  const agirlik = new Float32Array(w * h);
  const ux0 = Math.max(0, Math.floor(x0 - gecis)), ux1 = Math.min(w - 1, Math.ceil(x1 + gecis));
  const uy0 = Math.max(0, Math.floor(y0 - gecis)), uy1 = Math.min(h - 1, Math.ceil(y1 + gecis));
  // Gauss çekirdekli Nadaraya–Watson: en yakın-k ağırlıklandırması gözde/alında Voronoi
  // lekeleri bırakıyordu (ölçüldü, 2026-10-11). σ ağ aralığı mertebesinde (~%4 yüz genişliği).
  const sigma = Math.max(1, CEKIRDEK_ORANI * genislik);
  const r2max = (3 * sigma) ** 2;
  const inv2s2 = 1 / (2 * sigma * sigma);
  for (let y = uy0; y <= uy1; y++) {
    for (let x = ux0; x <= ux1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const ic = icindeMi(px, py, oval);
      const uzak = ic ? 0 : kenaraUzaklik(px, py, oval);
      if (uzak >= gecis) continue;
      // Oval dışında en yakın noktalar 3σ'dan uzak olabilir: çekirdek kesmesi genişletilir
      // (normalize ağırlık yine en yakın bölgenin değerini verir → ağın doğal devamı).
      const kesme = ic ? r2max : (Math.sqrt(r2max) + uzak) ** 2;
      let sw = 0, sz = 0;
      for (const p of pts) {
        const d2 = (p.x - px) ** 2 + (p.y - py) ** 2;
        if (d2 > kesme) continue;
        const wk = Math.exp(-d2 * inv2s2);
        sw += wk; sz += wk * p.z;
      }
      if (sw <= 0) continue;
      const i = y * w + x;
      // z: küçük = yakın → rölyef + kameraya doğru, piksel cinsinden (z, x ile aynı ölçekte).
      rel[i] = -(sz / sw - zMed) * w;
      const t = 1 - uzak / gecis;
      agirlik[i] = t * t * (3 - 2 * t) * jawWeight(px, py);
    }
  }

  // KAFA ELİPSOİDİ: model oval dışındaki alın/saçı sık sık yüzün ÖNÜNE koyuyor (yakın plan
  // portrede saç tepesi en yakın bölge çıktı; kullanıcı: "alın çok ilerde, anatomik değil").
  const sol = pts[234], sag = pts[454];
  const yuzY = cene.y - alin.y;
  const ax = (KAFA_GENISLIK_ORANI * Math.abs(sag.x - sol.x)) / 2;
  const tepe = alin.y - SAC_PAYI * yuzY;
  const cx = (sol.x + sag.x) / 2, cy = (tepe + cene.y) / 2, by = (cene.y - tepe) / 2;
  const cz = KAFA_DERINLIK_ORANI * ax * guc;
  const q = (x: number, y: number) => 1 - ((x - cx) / ax) ** 2 - ((y - cy) / by) ** 2;
  let off = 0, alinRel = 0, n = 0;
  for (const k of ALIN_NOKTALARI) {
    const p = pts[k], qq = q(p.x, p.y);
    if (qq <= 0) continue;
    off += -(p.z - zMed) * w - cz * Math.sqrt(qq);
    alinRel += -(p.z - zMed) * w;
    n++;
  }
  if (!(ax > 2) || !(by > 2) || !(yuzY > 2) || n === 0) return { rel, agirlik, otomatikGuc: otomatik ? guc : undefined };
  off /= n;
  alinRel /= n;
  // Saç payı fiziksel kalır; yüz gücü 1.5 olunca kafatası sınırı gevşemez.
  const pad = SAC_KALINLIK_ORANI * genislik;
  const ust = new Float32Array(w * h);
  const ustAgirlik = new Float32Array(w * h);
  for (let y = Math.max(0, Math.floor(cy - by)); y <= Math.min(h - 1, Math.ceil(cy + by)); y++) {
    for (let x = Math.max(0, Math.floor(cx - ax)); x <= Math.min(w - 1, Math.ceil(cx + ax)); x++) {
      const qq = q(x + 0.5, y + 0.5);
      if (qq <= 0) continue;
      const i = y * w + x;
      const t = Math.min(1, qq / 0.3); // elipsoid kenarında yumuşak sönüm
      ust[i] = Math.min(cz * Math.sqrt(qq) + off + pad, alinRel + pad);
      ustAgirlik[i] = t * t * (3 - 2 * t) * (1 - agirlik[i]) * jawWeight(x + 0.5, y + 0.5);
    }
  }
  return { rel, agirlik, ust, ustAgirlik, otomatikGuc: otomatik ? guc : undefined, sacPayi: pad };
}

/**
 * Rölyefi derinliğe harmanlar (yerinde değil, yeni dizi döner).
 * `derinlikBirimiPiksel`: 1 derinlik birimi kaç ızgara pikseline karşılık gelir (motorun
 * dünya eşlemesinden: zSpan / dünya-birimi-başına-piksel). Hedef yüzey:
 *   çapa + rel/derinlikBirimiPiksel + yüksek frekans(d),  çapa = oval içi medyan(d − rel/birim)
 * Otomatik güçte yüz içi %10–90 yayılımı fazla kazancı sınırlar; fiziksel ×1 altına inilmez.
 * Yüzün UZAKLIĞI modelden, ŞEKLİ ve EĞİMİ ağdan, ince doku (göz, dudak) modelden; oval dışında
 * geçiş bandı boyunca model devralır.
 */
export function yuzRolyefiUygula(
  depth: Float32Array,
  w: number,
  h: number,
  rolyef: YuzRolyefi,
  derinlikBirimiPiksel: number,
): Float32Array {
  const out = Float32Array.from(depth);
  if (!(derinlikBirimiPiksel > 0)) return out;
  // Çapa SABİT: oval içinde medyan(d − rel/birim). Yüzün genel uzaklığı modelden, şekli ve
  // EĞİMİ (baş öne/arkaya dönüşü) ağdan. Modelin kenar eğimine düzlem oturtmak ağın eğimini
  // eziyordu (alın burnun önüne geçti, ölçüldü 2026-10-12).
  const fark: number[] = [];
  let olcek = 1;
  if ((rolyef.otomatikGuc ?? 1) > 1) {
    const model: number[] = [], ag: number[] = [];
    for (let i=0;i<depth.length;i++) if (rolyef.agirlik[i]>=0.999) {
      model.push(depth[i]); ag.push(rolyef.rel[i]/derinlikBirimiPiksel);
    }
    if (model.length>=16) {
      model.sort((a,b)=>a-b); ag.sort((a,b)=>a-b);
      const lo=Math.floor(model.length*.1), hi=Math.floor(model.length*.9);
      const modelYay=model[hi]-model[lo], agYay=ag[hi]-ag[lo];
      // Ek kazanç zayıf modelle birleşince yanakları geriye çekip yüzü sivriltiyordu.
      // Ağın fiziksel ×1 şekli/eğimi korunur; yalnız üstündeki sanatsal güç kısılır.
      if (agYay>0) olcek=Math.min(1,Math.max(1/rolyef.otomatikGuc!,modelYay/agYay));
    }
  }
  for (let i = 0; i < depth.length; i++) {
    if (rolyef.agirlik[i] >= 0.999) fark.push(depth[i] - rolyef.rel[i] * olcek / derinlikBirimiPiksel);
  }
  if (fark.length < 16) return out;
  fark.sort((a, b) => a - b);
  const c0 = fark[fark.length >> 1];
  const capa = (_x: number, _y: number) => c0;
  const bulanik = kutuBulanik(depth, w, h, 3);
  for (let i = 0; i < depth.length; i++) {
    const a = rolyef.agirlik[i];
    if (!(a > 0)) continue;
    const hedef = capa((i % w) / w, Math.floor(i / w) / h) + rolyef.rel[i] * olcek / derinlikBirimiPiksel + (depth[i] - bulanik[i]);
    if (!Number.isFinite(hedef)) continue;
    out[i] = Math.min(1, Math.max(0, depth[i] + a * (hedef - depth[i])));
  }
  // Kafa elipsoidi üst sınırı: oval dışındaki alın/saç kafatası yüzeyinin önündeyse geri it.
  if (rolyef.ust && rolyef.ustAgirlik) {
    for (let i = 0; i < out.length; i++) {
      const a = rolyef.ustAgirlik[i];
      if (!(a > 0)) continue;
      const pad = rolyef.sacPayi ?? 0;
      const ust = olcek === 1 ? rolyef.ust[i] : (rolyef.ust[i]-pad)*olcek+pad;
      const sinir = capa((i % w) / w, Math.floor(i / w) / h) + ust / derinlikBirimiPiksel;
      if (out[i] > sinir) out[i] = Math.max(0, out[i] - a * (out[i] - sinir));
    }
  }
  return out;
}

function kutuBulanik(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}
