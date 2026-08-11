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
  POINTS_DEPTH_RANGE,
  createHomeTexture,
  fillPositionsFromDepth,
} from '../src/engine/buffers.ts';
import { BACKDROP_OPACITY, EDGE_WALL_Z } from '../src/engine/reconstruction/sampler.ts';

const half = POINTS_DEPTH_RANGE / 2;
const xyz = (data, i, j) => {
  const o = (j * N + i) * 4;
  return { x: data[o], y: data[o + 1], z: data[o + 2], w: data[o + 3] };
};

// --- 1. düz depth: 0 → TÜM GRİD ARKA PLAN (Tur 11: nokta var), 1 → +half ---
for (const value of [0, 1]) {
  const tex = createHomeTexture();
  fillPositionsFromDepth(tex, new Float32Array(64 * 64).fill(value), 64, 64);
  const data = tex.image.data;
  if (value === 0) {
    // Tur 11: maske = 0 texel ÖLÜ DEĞİLDİR — arka plan noktası üretilir
    // (z = −1: d = 0 → (0−0.5)·2 − PIN → tabana kırpılır; w = BACKDROP_OPACITY).
    for (const [i, j] of [[0, 0], [N - 1, N - 1], [N >> 1, N >> 1]]) {
      assert.equal(xyz(data, i, j).z, -1, 'd=0 → arka plan z = −1 (PIN tabanı)');
      assert.ok(
        Math.abs(xyz(data, i, j).w - BACKDROP_OPACITY) < 1e-6,
        'd=0 → w = BACKDROP_OPACITY (görünür arka plan)',
      );
    }
  } else {
    assert.equal(xyz(data, N >> 1, N >> 1).z, half, 'dolu merkez → z=+1 olmalı');
    for (const [i, j] of [[0, 0], [N - 1, N - 1]]) {
      const z = xyz(data, i, j).z;
      assert.ok(z > 0.98 && z <= 1, 'çerçeve köşesi → kadraj kenar sönümü (prizma duvarı yok)');
    }
  }
}

// --- 2. üst yarısı yakın (1), alt yarısı uzak (0) olan depth ---
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
assert.ok(top.z > 0.98 && top.z <= 1, 'üst kadraj sınırı → kenar sönümlü (prizma duvarı yok)');
assert.equal(topInner.z, half, 'görselin ÜST yarısı içi yakın (z = +1) — y-flip ters');
assert.equal(bottom.z, -1, 'görselin ALT yarısı (arka plan) → z = −1 (d = 0 → PIN tabanı)');

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

console.log('OK · position sözleşmesi (z ortalı, satır 0 = üst, iki seviyeli w, aspect doğru)');
