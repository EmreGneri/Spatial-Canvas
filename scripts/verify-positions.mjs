// positionTexture sözleşmesinin regresyon kontrolü (GPU gerekmez).
// ARCHITECTURE.md'deki üç kural burada kırılırsa test patlar:
//   1. z ortalıdır: d=0 → -1, d=1 → +1
//   2. satır 0 = görselin üstü = dünyada y > 0
//   3. w (Gün 3 GPGPU seed'i) doldurma sırasında korunur
//   node scripts/verify-positions.mjs
import assert from 'node:assert/strict';
import {
  POSITION_TEXTURE_SIZE as N,
  POINTS_DEPTH_RANGE,
  createHomeTexture,
  fillPositionsFromDepth,
} from '../src/engine/buffers.ts';

const half = POINTS_DEPTH_RANGE / 2;
const xyz = (data, i, j) => {
  const o = (j * N + i) * 4;
  return { x: data[o], y: data[o + 1], z: data[o + 2], w: data[o + 3] };
};

// --- 1. düz depth: 0 → -half, 1 → +half ---
for (const [value, expected] of [[0, -half], [1, half]]) {
  const tex = createHomeTexture();
  fillPositionsFromDepth(tex, new Float32Array(64 * 64).fill(value), 64, 64);
  const data = tex.image.data;
  for (const [i, j] of [[0, 0], [N - 1, N - 1], [N >> 1, N >> 1]]) {
    assert.equal(xyz(data, i, j).z, expected, `d=${value} → z=${expected} olmalı`);
  }
}

// --- 2. üst yarısı yakın (1), alt yarısı uzak (0) olan depth ---
const W = 64;
const H = 64;
const depth = new Float32Array(W * H);
for (let row = 0; row < H / 2; row++) depth.fill(1, row * W, (row + 1) * W); // satır 0 = üst

const tex = createHomeTexture();
const seedsBefore = Array.from(tex.image.data).filter((_, k) => k % 4 === 3);
fillPositionsFromDepth(tex, depth, W, H);
const data = tex.image.data;

const top = xyz(data, N >> 1, 0);
const bottom = xyz(data, N >> 1, N - 1);
assert.ok(top.y > 0, 'grid satırı 0 dünyada üstte (y > 0) olmalı');
assert.ok(bottom.y < 0, 'son grid satırı dünyada altta (y < 0) olmalı');
assert.equal(top.z, half, 'görselin ÜST yarısı yakın (z = +1) olmalı — y-flip ters');
assert.equal(bottom.z, -half, 'görselin ALT yarısı uzak (z = -1) olmalı — y-flip ters');

// --- 3. seed korunur ---
const seedsAfter = Array.from(data).filter((_, k) => k % 4 === 3);
assert.deepEqual(seedsAfter, seedsBefore, 'w (seed) doldurma sırasında ezilmemeli');

// --- 4. en-boy oranı x genişliğine yansır ---
const wide = createHomeTexture();
fillPositionsFromDepth(wide, new Float32Array(160 * 80), 160, 80); // 2:1
// halfW = aspect · (WORLD_HEIGHT/2) = 2; son sütun u = 1 − 0.5/N → x = 2 − 2/N
const rightmost = xyz(wide.image.data, N - 1, 0).x;
assert.ok(Math.abs(rightmost - (2 - 2 / N)) < 1e-5, '2:1 kaynakta yarı genişlik ≈ 2 olmalı');

console.log('OK · position sözleşmesi (z ortalı, satır 0 = üst, seed korunur, aspect doğru)');
