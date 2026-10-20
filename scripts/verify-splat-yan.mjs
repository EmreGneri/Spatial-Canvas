// Splat yan görünüm kapsaması (saf CPU, GPU gerekmez).
//
// Sorun (kullanıcı, 2026-10-11): Splat modunda yandan bakınca yüzün yanı, burun kenarı,
// saç gibi DİK ama SÜREKLİ yüzeylerde aralar açılıyordu. Sebep: splat yarıçapı ön
// görünümdeki ızgara adımının yarısı, eğimi ~68°'de kesiliyor; gerçek yüzey aralığı ise
// adım·√(1+eğim²). Bu test:
//   1. dik, sürekli bir tümsekte yan görünüm (70°) kapsamasını,
//   2. ön görünümün değişmediğini (kapsama + ortalama izdüşüm alanı),
//   3. süreksizlikte (havada duran levha) ön plan ile arka arasına PERDE gerilmediğini
// ölçer. Splat'lar shader ile aynı geometride rasterize edilir: normal etrafında yassı
// disk, yarıçap 2σ (SPLAT_CUTOFF), yassılık ihmal.
//   node scripts/verify-splat-yan.mjs
import assert from 'node:assert/strict';
const { splatGeometrisiTuret } = await import('../src/engine/splatGeometri.ts');

const G = 128;
const CUTOFF = 2; // splatMaterial: Gauss 2σ'da kesilir

// Sahne: z=0 düzleminde yarıçapı 0.6 olan yarım küre tümsek (kenarda dik ama sürekli)
// + sağ üstte havada levha (z=0.5) — kenarı gerçek süreksizlik.
function sahne(x, y) {
  const levha = x > 0.45 && x < 0.85 && y > 0.45 && y < 0.85;
  if (levha) return 0.5;
  const r2 = (x * x + y * y) / 0.36;
  return r2 < 1 ? 0.6 * Math.sqrt(1 - r2) : 0;
}
const home = new Float32Array(G * G * 4);
for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
  const x = ((i + 0.5) / G - 0.5) * 2, y = (0.5 - (j + 0.5) / G) * 2, o = (j * G + i) * 4;
  home[o] = x; home[o + 1] = y; home[o + 2] = sahne(x, y); home[o + 3] = 1;
}
const A = new Float32Array(G * G * 4), B = new Float32Array(G * G * 4);
splatGeometrisiTuret(home, G, A, B);

const R = 400; // raster çözünürlüğü
function rasterize(phiDeg, kaynak) {
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const proj = (x, y, z) => [x * cp - z * sp, y]; // y ekseni etrafında dönmüş ortografik
  const img = new Uint8Array(R * R);
  const px = ([u, v]) => [((u + 1.3) / 2.6) * R, ((1.3 - v) / 2.6) * R];
  const doldur = (poly) => {
    let y0 = Infinity, y1 = -Infinity;
    for (const [, y] of poly) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(R - 1, Math.ceil(y1)); y++) {
      const xs = [];
      for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
        const [xa, ya] = poly[m], [xb, yb] = poly[k];
        if ((ya > y + 0.5) !== (yb > y + 0.5)) xs.push(xa + ((y + 0.5 - ya) * (xb - xa)) / (yb - ya));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2)
        for (let x = Math.max(0, Math.ceil(xs[q] - 0.5)); x <= Math.min(R - 1, Math.floor(xs[q + 1] - 0.5)); x++) img[y * R + x] = 1;
    }
  };
  let alan = 0;
  for (let k = 0; k < G * G; k++) {
    const o = k * 4;
    const c = [A[o], A[o + 1], A[o + 2]];
    if (kaynak === 'splat') {
      const n = [B[o], B[o + 1], B[o + 2]], s = B[o + 3] * CUTOFF;
      const up = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let t1 = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
      const l = Math.hypot(...t1); t1 = t1.map((v) => v / l);
      const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
      const poly = [];
      for (let a = 0; a < 16; a++) {
        const ca = Math.cos((a / 16) * 2 * Math.PI) * s, sa = Math.sin((a / 16) * 2 * Math.PI) * s;
        poly.push(px(proj(c[0] + ca * t1[0] + sa * t2[0], c[1] + ca * t1[1] + sa * t2[1], c[2] + ca * t1[2] + sa * t2[2])));
      }
      doldur(poly);
      // izdüşüm alanı (shoelace) → bulanıklık göstergesi
      let s2 = 0;
      for (let q = 0, m = poly.length - 1; q < poly.length; m = q++) s2 += poly[m][0] * poly[q][1] - poly[q][0] * poly[m][1];
      alan += Math.abs(s2) / 2;
    }
  }
  return { img, ortAlan: alan / (G * G) };
}
// Gerçek yüzey: 6× yoğun örneklenmiş sahnenin izdüşümü (1 px genişletilmiş).
function gercek(phiDeg) {
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const img = new Uint8Array(R * R), N = G * 6;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = ((i + 0.5) / N - 0.5) * 2, y = (0.5 - (j + 0.5) / N) * 2, z = sahne(x, y);
    const u = x * cp - z * sp;
    const X = Math.floor(((u + 1.3) / 2.6) * R), Y = Math.floor(((1.3 - y) / 2.6) * R);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = X + dx, yy = Y + dy;
      if (xx >= 0 && yy >= 0 && xx < R && yy < R) img[yy * R + xx] = 1;
    }
  }
  return img;
}
function olc(phi) {
  const T = gercek(phi), S = rasterize(phi, 'splat');
  let t = 0, kap = 0, tasma = 0;
  // perde: gerçek yüzeyin 3 px dışına taşan kapsama
  const genis = new Uint8Array(R * R);
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) if (T[y * R + x])
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < R && yy < R) genis[yy * R + xx] = 1;
    }
  for (let i = 0; i < R * R; i++) {
    if (T[i]) { t++; if (S.img[i]) kap++; }
    if (S.img[i] && !genis[i]) tasma++;
  }
  return { kapsama: kap / t, perde: tasma / t, ortAlan: S.ortAlan };
}
const on = olc(0), yan = olc(70);
console.log(`ön  : kapsama ${(on.kapsama * 100).toFixed(2)}%  perde ${(on.perde * 100).toFixed(2)}%  ort. izdüşüm ${on.ortAlan.toFixed(2)} px²`);
console.log(`yan : kapsama ${(yan.kapsama * 100).toFixed(2)}%  perde ${(yan.perde * 100).toFixed(2)}%`);
const ESIK_YAN = 0.96; // eski hal %90,1 veriyordu (bu test onu yakalar)
assert.ok(on.kapsama > 0.99, 'ön görünüm delik yok');
assert.ok(yan.kapsama > ESIK_YAN, `yan görünüm kapsaması ${(yan.kapsama * 100).toFixed(2)}% (eşik ${ESIK_YAN * 100}%)`);
assert.ok(yan.perde < 0.02, 'süreksizlikte perde yok');
console.log('verify-splat-yan OK');
