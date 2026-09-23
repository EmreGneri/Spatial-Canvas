// E1 — .ply dışa aktarımı sözleşme testi. GPU YOK, model YÜKLEMEZ.
// Üretilen dosya geri okunur ve HER dönüşüm tersine çevrilerek doğrulanır:
// görüntüleyici tarafında ne yapılacaksa (sigmoid, exp, SH) burada da yapılır.
import assert from 'node:assert/strict';
import { gaussiansToPly } from '../src/engine/export.ts';

const SH_C0 = 0.28209479177387814;
const FLATTEN = 0.1;

// Bilinen sahne: üç splat, üç farklı normal (biri tam ters — tekil dal).
const count = 3;
const a = new Float32Array([
  1, 2, 3, 0.8,
  -4, 5, -6, 0.25,
  0, 0, 0, 1,
]);
const b = new Float32Array([
  0, 0, 1, 0.05,      // normal +z
  1, 0, 0, 0.2,       // normal +x
  0, 0, -1, 0.01,     // normal -z (flip sonrası +z)
]);
const c = new Float32Array([
  1, 0, 0, 1,
  0.5, 0.5, 0.5, 1,
  0, 0.25, 1, 1,
]);

const blob = gaussiansToPly({ a, b, c, count, flatten: FLATTEN });
const buf = Buffer.from(await blob.arrayBuffer());

// --- 1. başlık ---
const metin = buf.toString('latin1');
const son = metin.indexOf('end_header\n') + 'end_header\n'.length;
const baslik = metin.slice(0, son);
assert.ok(baslik.startsWith('ply\nformat binary_little_endian 1.0\n'), 'ikili ply başlığı');
assert.ok(baslik.includes(`element vertex ${count}\n`), 'vertex sayısı');
for (const alan of ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2',
  'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']) {
  assert.ok(baslik.includes(`property float ${alan}\n`), `alan eksik: ${alan}`);
}
const FIELDS = 17;
assert.equal(buf.length - son, count * FIELDS * 4, 'gövde uzunluğu = n × 17 × 4 bayt');
console.log(`[1] başlık + gövde uzunluğu ✓ (${count} splat, ${buf.length} bayt)`);

// --- 2. değerleri geri oku ---
// DataView: gerçek ply okuyucuları da sıralı okur, hizalama beklemez
// (başlık uzunluğu 4'ün katı olmak zorunda değildir).
const dv = new DataView(buf.buffer, buf.byteOffset + son, count * FIELDS * 4);
const v = { length: count * FIELDS };
for (let i = 0; i < count * FIELDS; i++) v[i] = dv.getFloat32(i * 4, true);
const oku = (i) => {
  const o = i * FIELDS;
  return {
    pos: [v[o], v[o + 1], v[o + 2]],
    nrm: [v[o + 3], v[o + 4], v[o + 5]],
    fdc: [v[o + 6], v[o + 7], v[o + 8]],
    opacity: v[o + 9],
    scale: [v[o + 10], v[o + 11], v[o + 12]],
    rot: [v[o + 13], v[o + 14], v[o + 15], v[o + 16]],
  };
};
const yakin = (x, y, e, ad) => assert.ok(Math.abs(x - y) < e, `${ad}: ${x} ≠ ${y}`);

// Eksen çevirimi: X etrafında 180° → (x, -y, -z)
for (let i = 0; i < count; i++) {
  const r = oku(i);
  yakin(r.pos[0], a[i * 4], 1e-6, `[${i}] x`);
  yakin(r.pos[1], -a[i * 4 + 1], 1e-6, `[${i}] y ters`);
  yakin(r.pos[2], -a[i * 4 + 2], 1e-6, `[${i}] z ters`);
}
console.log('[2] eksen çevirimi (x, −y, −z) ✓');

// Opaklık: görüntüleyici sigmoid uygular → kaynağa dönmeli
for (let i = 0; i < count; i++) {
  const geri = 1 / (1 + Math.exp(-oku(i).opacity));
  yakin(geri, a[i * 4 + 3], 1e-5, `[${i}] opaklık round-trip`);
}
console.log('[3] opaklık logit → sigmoid round-trip ✓');

// Ölçek: exp → (s, s, s·ε)
for (let i = 0; i < count; i++) {
  const r = oku(i);
  const s = b[i * 4 + 3];
  yakin(Math.exp(r.scale[0]), s, 1e-6, `[${i}] scale_0`);
  yakin(Math.exp(r.scale[1]), s, 1e-6, `[${i}] scale_1`);
  yakin(Math.exp(r.scale[2]), s * FLATTEN, 1e-7, `[${i}] scale_2 (yassı eksen)`);
}
console.log('[4] ölçek log → exp, normal ekseni ε kadar yassı ✓');

// Renk: c = 0.5 + SH_C0·f_dc
for (let i = 0; i < count; i++) {
  const r = oku(i);
  for (let k = 0; k < 3; k++) {
    yakin(0.5 + SH_C0 * r.fdc[k], c[i * 4 + k], 1e-6, `[${i}] renk kanal ${k}`);
  }
}
console.log('[5] renk SH DC round-trip ✓');

// Quaternion: +z eksenini ÇEVRİLMİŞ normale götürmeli, ve birim olmalı
const donder = ([w, x, y, z], [vx, vy, vz]) => {
  // q * v * q⁻¹ (açık form)
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
};
for (let i = 0; i < count; i++) {
  const r = oku(i);
  const norm = Math.hypot(...r.rot);
  yakin(norm, 1, 1e-6, `[${i}] quaternion birim`);
  const donen = donder(r.rot, [0, 0, 1]);
  for (let k = 0; k < 3; k++) {
    yakin(donen[k], r.nrm[k], 1e-5, `[${i}] +z → normal, bileşen ${k}`);
  }
}
console.log('[6] quaternion birim + (0,0,1)\'i normale götürüyor ✓ (ters normal dalı dahil)');

// --- 3. determinizm ---
const tekrar = Buffer.from(await gaussiansToPly({ a, b, c, count, flatten: FLATTEN }).arrayBuffer());
assert.ok(buf.equals(tekrar), 'iki koşu birebir aynı dosya');
console.log('[7] determinizm ✓');

console.log('OK .ply dışa aktarımı (E1)');
