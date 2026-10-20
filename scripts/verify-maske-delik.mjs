// Maske deliklerini derinlik tutarlılığıyla doldurma (saf).
//   node scripts/verify-maske-delik.mjs
import assert from 'node:assert/strict';
const { delikleriDoldur } = await import('../src/engine/reconstruction/maskeDelik.ts');

const w = 60, h = 60;
const mask = new Float32Array(w * h);
const depth = new Float32Array(w * h);
// Özne: 10..49 kare, derinlik 0.7; dışı uzak 0.1.
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const inside = x >= 10 && x < 50 && y >= 10 && y < 50;
  mask[y * w + x] = inside ? 1 : 0;
  depth[y * w + x] = inside ? 0.7 : 0.1;
}
// A) yanlış delik: özne yüzeyinin devamı (derinlik 0.7), mask 0.
for (let y = 15; y < 22; y++) for (let x = 15; x < 22; x++) mask[y * w + x] = 0;
// B) gerçek boşluk: arkadaki uzak sahne (derinlik 0.1).
for (let y = 30; y < 38; y++) for (let x = 30; x < 38; x++) { mask[y * w + x] = 0; depth[y * w + x] = 0.1; }

const r = delikleriDoldur(mask, depth, w, h);
assert.equal(r.delikler.length, 2);
assert.equal(r.mask[18 * w + 18], 1, 'yanlış delik dolduruldu');
assert.equal(r.mask[33 * w + 33], 0, 'gerçek boşluk korundu');
assert.equal(mask[18 * w + 18], 0, 'girdi değişmedi');
assert.equal(r.mask[2 * w + 2], 0, 'dış arka plan dokunulmadı');

// Sınıra değen arka plan delik değildir.
{
  const m = new Float32Array(w * h).fill(1);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) m[y * w + x] = 0; // köşe
  const rr = delikleriDoldur(m, new Float32Array(w * h).fill(0.5), w, h);
  assert.equal(rr.delikler.length, 0);
  assert.equal(rr.mask[0], 0);
}

// Çok büyük kapalı bölge (özne alanının >%25'i) doldurulmaz.
{
  const m = new Float32Array(w * h);
  const d = new Float32Array(w * h).fill(0.7);
  for (let y = 5; y < 55; y++) for (let x = 5; x < 55; x++) m[y * w + x] = 1; // 2500 px
  for (let y = 15; y < 50; y++) for (let x = 15; x < 50; x++) m[y * w + x] = 0; // 1225 px = %49
  const rr = delikleriDoldur(m, d, w, h);
  assert.equal(rr.mask[30 * w + 30], 0);
}
console.log('verify-maske-delik OK');
