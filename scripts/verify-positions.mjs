// positionTexture sözleşmesinin regresyon kontrolü (GPU gerekmez).
// ARCHITECTURE.md'deki kurallar burada kırılırsa test patlar:
//   1. z ortalıdır: d=1 → +1 (iç bölge); çerçeve sınırı kenar dökümüyle oval
//      sönümle sığlaşır (kutu yok); d=0 → ARKA PLAN noktası (Tur 11: ölü
//      texel YOK — gerçek derinlikte BACKDROP_Z_PIN arkada, w = BACKDROP_OPACITY)
//   2. satır 0 = görselin üstü = dünyada y > 0
//   3. w = iki seviyeli opaklık (Tur 11): arka plan → BACKDROP_OPACITY,
//      ön plan → 1
//   node scripts/verify-positions.mjs
import assert from 'node:assert/strict';
import {
  POSITION_TEXTURE_SIZE as N,
  createHomeTexture,
  createImageColorTexture,
  fillImageColorTexture,
  fillPositionsFromDepth,
} from '../src/engine/buffers.ts';
import { BACKDROP_OPACITY, EDGE_WALL_Z } from '../src/engine/reconstruction/sampler.ts';

const xyz = (data, i, j) => {
  const o = (j * N + i) * 4;
  return { x: data[o], y: data[o + 1], z: data[o + 2], w: data[o + 3] };
};

// --- 1. düz depth: 0 → TÜM GRİD ARKA PLAN (Tur 11: nokta var),
// 1 → silüet oranlı ön plan z'si (artık +1'e kırpılmaz) ---
for (const value of [0, 1]) {
  const tex = createHomeTexture();
  fillPositionsFromDepth(tex, new Float32Array(64 * 64).fill(value), 64, 64);
  const data = tex.image.data;
  if (value === 0) {
    // Tur 11: maske = 0 texel ÖLÜ DEĞİLDİR — arka plan noktası üretilir
    // (z = −1: body yok → z = (0−0.5)·range − PIN → tabana kırpılır;
    // w = BACKDROP_OPACITY).
    for (const [i, j] of [[0, 0], [N - 1, N - 1], [N >> 1, N >> 1]]) {
      assert.equal(xyz(data, i, j).z, -1, 'd=0 → arka plan z = −1 (PIN tabanı)');
      assert.ok(
        Math.abs(xyz(data, i, j).w - BACKDROP_OPACITY) < 1e-6,
        'd=0 → w = BACKDROP_OPACITY (görünür arka plan)',
      );
    }
  } else {
    // SİLÜET ORANLI z uzamı (tam kadraj siluet, 64×64 → rx = ry = 0.984375):
    // zSpan = ANATOMIC_DEPTH_RATIO·2·min(rx,ry) = 0.7·2·0.984375 = 1.378125,
    // zUnit = 0.6890625. Merkez (R² = 1.3562e−5 → sqrt(1−R²) = 0.99999322,
    // w_fg(1) = 1): z = 0.5·1.378125 + 0.1·0.6890625·0.99999322
    //                = 0.6890625 + 0.06890578 = 0.75796828.
    // Eski sabit range = 2 burada +1'e KIRPIYORDU; artık kırpma yok.
    const z = xyz(data, N >> 1, N >> 1).z;
    assert.ok(Math.abs(z - 0.757968283) < 1e-4, `dolu merkez → z = 0.75796828 (silüet oranlı uzam, gerçek ${z.toFixed(6)})`);
    // Çerçeve köşesi: R² ≈ 1.9896 ≥ 1 → kavis YOK; kadraj kenarı sınır değil
    // (kutu duvarı yok — düz yüzey) → z = 0.5·zSpan = 0.6890625.
    for (const [i, j] of [[0, 0], [N - 1, N - 1]]) {
      assert.ok(Math.abs(xyz(data, i, j).z - 0.6890625) < 1e-6, 'çerçeve köşesi → z = 0.6890625 (kavis yok, kutu yok)');
    }
  }
}

// --- 2. üst yarısı yakın (1), alt yarısı uzak (0) olan depth ---
// SİLÜET ORANLI uzam: siluet yalnızca ÜST yarı → rx = 0.984375, ry = 0.484375
// → zSpan = 0.7·2·0.484375 = 0.678125, zUnit = 0.3390625.
//   üst yarı içi (192, 96): 2u−1 = 0.00260417, 2v−1 = 0.49739583 →
//     R² = 0.24740936 → sqrt(1−R²) = 0.86752558, w_fg(1) = 1 →
//     z = 0.5·0.678125 + 0.1·0.3390625·0.86752558 = 0.36847684
//   üst kadraj sınırı (192, 0): 2v−1 = 0.99739583 → R² = 0.99480525 →
//     sqrt = 0.07207462 → z = 0.3390625 + 0.00244381 = 0.34150629
//     (kenar sönümü YOK — düz formül, kadraj kenarı sınır değil)
// Alt yarı ARKA PLAN dalıdır ve ÖLÇEKLENMEZ (duvar sözleşmesi):
// z = (0−0.5)·range − PIN = −1.15 → tabana kırpılır (−1; w = BACKDROP_OPACITY).
const W = 64;
const H = 64;
const depth = new Float32Array(W * H);
for (let row = 0; row < H / 2; row++) depth.fill(1, row * W, (row + 1) * W); // satır 0 = üst

const tex = createHomeTexture();
fillPositionsFromDepth(tex, depth, W, H);
const data = tex.image.data;

const top = xyz(data, N >> 1, 0);
const topInner = xyz(data, N >> 1, N >> 2);
const bottom = xyz(data, N >> 1, N - 1);
assert.ok(top.y > 0, 'grid satırı 0 dünyada üstte (y > 0) olmalı');
assert.ok(bottom.y < 0, 'son grid satırı dünyada altta (y < 0) olmalı');
assert.ok(Math.abs(top.z - 0.341506285) < 1e-4, `üst kadraj sınırı → düz formül + küçük kavis (z = ${top.z.toFixed(6)}, prizma duvarı yok)`);
assert.ok(Math.abs(topInner.z - 0.368476843) < 1e-4, `görselin ÜST yarısı → z = 0.36847684 (silüet oranlı uzam, gerçek ${topInner.z.toFixed(6)}) — y-flip ters`);
assert.ok(
  Math.abs(bottom.z + 1) < 1e-6,
  'görselin ALT yarısı (arka plan) → z = −1 (d = 0 → (0−0.5)·range − PIN → tabana kırpılır)',
);

// --- 3. w = iki seviyeli opaklık (Tur 11): arka plan → BACKDROP_OPACITY ---
const wAt = (d, i, j) => d[(j * N + i) * 4 + 3];
assert.equal(wAt(data, N >> 1, N >> 2), 1, 'üst (yakın) → w = 1 (tam opak)');
assert.ok(
  Math.abs(wAt(data, N >> 1, N - 1) - BACKDROP_OPACITY) < 1e-6,
  'alt (uzak) → w = BACKDROP_OPACITY (yarı saydam arka plan)',
);
// yumuşak ara geçiş: siluet eşiği (0.02) altındaki düz ton görünmez DEĞİLDİR —
// arka plan noktası taşır (Tur 11: ölü texel yok)
const fadeTex = createHomeTexture();
const fadeDepth = new Float32Array(W * H).fill(0.01); // arka plan tonu → arka plan noktası
fillPositionsFromDepth(fadeTex, fadeDepth, W, H);
assert.ok(
  Math.abs(wAt(fadeTex.image.data, N >> 1, N >> 1) - BACKDROP_OPACITY) < 1e-6,
  'siluet dışı → w = BACKDROP_OPACITY',
);

// --- 4. en-boy oranı x genişliğine yansır ---
const wide = createHomeTexture();
fillPositionsFromDepth(wide, new Float32Array(160 * 80), 160, 80); // 2:1
// halfW = aspect · (WORLD_HEIGHT/2) = 2; son sütun u = 1 − 0.5/N → x = 2 − 2/N
const rightmost = xyz(wide.image.data, N - 1, 0).x;
assert.ok(Math.abs(rightmost - (2 - 2 / N)) < 1e-5, '2:1 kaynakta yarı genişlik ≈ 2 olmalı');

// --- 5. RENK GRID'İ ALPHA = bakılı oklüzyon (Gün C sözleşmesi) ---
// Kabartmanın dibi (etrafı daha yakın) kararır, uzak düz alan 255 kalır;
// RGB kanalları fotoğrafı taşımaya devam eder (AO onları BOYAMAZ).
{
  const iw = 64;
  const ih = 64;
  const d = new Float32Array(iw * ih).fill(0.4);
  const lo = iw / 2 - 8;
  const hi = iw / 2 + 8;
  for (let y = lo; y < hi; y++) {
    for (let x = lo; x < hi; x++) d[y * iw + x] = 0.9;
  }
  const rgb = new Float32Array(iw * ih * 3).fill(0.5);
  const colorTex = createImageColorTexture();
  fillImageColorTexture(colorTex, rgb, iw, ih, d, iw, ih, { importanceSampling: false });
  const px = colorTex.image.data;
  const alphaAt = (u, v) => px[(Math.round(v * (N - 1)) * N + Math.round(u * (N - 1))) * 4 + 3];
  const rgbAt = (u, v) => px[(Math.round(v * (N - 1)) * N + Math.round(u * (N - 1))) * 4];
  assert.equal(alphaAt(0.02, 0.02), 255, 'uzak düz alan → AO nötr (alpha 255)');
  assert.ok(
    alphaAt(lo / iw - 0.01, 0.5) < 240,
    `kabartma dibi → alpha kararır (${alphaAt(lo / iw - 0.01, 0.5)})`,
  );
  assert.equal(rgbAt(0.5, 0.5), 128, 'AO yazımı RGB kanallarını bozmaz (0.5 → 128)');
}

// --- REGRESSION (photo flatness): default options must not warp the subject.
// The importance remap bent the SAMPLING coordinate while world xy stayed on
// the uniform grid, so the high-importance subject was magnified in x/y
// (~1.8x on a 16:9 bust) but not in z: the bust read wide and flat in every
// render mode. Scene: 518x291 (1919x1079 letterboxed), centered waist-up bust
// (torso 34% of width, head + torso down to the bottom edge), brick-pattern
// background, clean subject mask. Truth = the mask's own world bbox.
{
  const W2 = 518;
  const H2 = 291;
  const depth2 = new Float32Array(W2 * H2);
  const mask2 = new Float32Array(W2 * H2);
  const cx2 = W2 / 2;
  const headR = 0.11 * H2;
  const headCy = 0.53 * H2;
  const tHalf = (0.34 * W2) / 2;
  let mx0 = W2;
  let mx1 = -1;
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      const i = y * W2 + x;
      const inHead = (x - cx2) ** 2 + (y - headCy) ** 2 < headR ** 2;
      const inTorso = y > headCy + headR * 0.8 && Math.abs(x - cx2) < tHalf;
      depth2[i] = 0.2 + 0.05 * (((x >> 3) + (y >> 3)) & 1);
      if (inHead || inTorso) {
        mask2[i] = 1;
        const dx = (x - cx2) / (inTorso ? tHalf : headR);
        depth2[i] = 0.55 + 0.35 * Math.sqrt(Math.max(0, 1 - dx * dx));
        mx0 = Math.min(mx0, x);
        mx1 = Math.max(mx1, x);
      }
    }
  }
  const out2 = (() => {
    const t = createHomeTexture();
    fillPositionsFromDepth(t, depth2, W2, H2, { foregroundMask: mask2 });
    return t.image.data;
  })();
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let k = 0; k < out2.length / 4; k++) {
    if (out2[k * 4 + 3] < 1) continue;
    x0 = Math.min(x0, out2[k * 4]);
    x1 = Math.max(x1, out2[k * 4]);
    z0 = Math.min(z0, out2[k * 4 + 2]);
    z1 = Math.max(z1, out2[k * 4 + 2]);
  }
  const trueX = ((mx1 + 1 - mx0) / W2) * 2 * (W2 / H2);
  const spanX = x1 - x0;
  const zx = (z1 - z0) / spanX;
  assert.ok(
    Math.abs(spanX - trueX) / trueX < 0.05,
    `photo bust world width matches its silhouette (${spanX.toFixed(3)} vs ${trueX.toFixed(3)})`,
  );
  assert.ok(zx > 0.35, `photo bust is not flat: z/x = ${zx.toFixed(3)} (> 0.35)`);
}

console.log('OK · position sözleşmesi (z ortalı, satır 0 = üst, iki seviyeli w, aspect doğru) + renk grid alpha = AO');
