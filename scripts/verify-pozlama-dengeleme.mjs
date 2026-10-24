// Pozlama/beyaz dengesi ön geçişi — saf çekirdek sözleşmesi.
//   node scripts/verify-pozlama-dengeleme.mjs
import assert from 'node:assert/strict';
import { gozlemleriTopla, kazancHizaliPsnr, kazancUygula, pozlamaKazanclari } from '../src/engine/reconstruction/pozlamaDengeleme.ts';

// Deterministik rastgele (mulberry32)
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** nKare kare, nNokta nokta; kare i'nin gerçek kazancı kazanc[i]; oran kadar gözlem
 *  örtülme (rastgele renk) aykırısı. */
function sahne(kazanc, nNokta, aykiriOran, seed = 1) {
  const r = rng(seed);
  const gozlemler = [];
  for (let p = 0; p < nNokta; p++) {
    const albedo = [0.1 + 0.6 * r(), 0.1 + 0.6 * r(), 0.1 + 0.6 * r()];
    const obs = [];
    for (let k = 0; k < kazanc.length; k++) {
      if (r() < 0.25) continue; // nokta bu karede görünmüyor
      const rgb = r() < aykiriOran
        ? [r(), r(), r()]
        : albedo.map((a, c) => Math.min(1, a * kazanc[k][c]));
      obs.push({ kare: k, rgb });
    }
    gozlemler.push(obs);
  }
  return gozlemler;
}

const geoOrt = (k, c) => Math.exp(k.reduce((s, g) => s + Math.log(g[c]), 0) / k.length);

// [1] bilinen kazançlar geri bulunur: düzeltme_i ≈ geoOrt / kazanc_i (%3 içinde),
//     %20 örtülme aykırısına rağmen.
{
  const kazanc = [[1, 1, 1], [1.3, 1.2, 1.1], [0.8, 0.9, 1.0], [1.1, 1.0, 0.85], [0.95, 1.05, 1.0]];
  const d = pozlamaKazanclari(sahne(kazanc, 600, 0.2), kazanc.length);
  for (let k = 0; k < kazanc.length; k++) for (let c = 0; c < 3; c++) {
    const beklenen = geoOrt(kazanc, c) / kazanc[k][c];
    assert.ok(Math.abs(d.kazanc[k][c] / beklenen - 1) < 0.03,
      `kare ${k} kanal ${c}: ${d.kazanc[k][c].toFixed(3)} ≠ ${beklenen.toFixed(3)}`);
  }
  assert.deepEqual(d.olculen, [true, true, true, true, true]);
  console.log('[1] bilinen kazanç geri bulundu');
}

// [2] pozlama SABİTSE düzeltme ~1 (%1 içinde): içerik değişimi pozlama sanılmaz.
{
  const kazanc = Array.from({ length: 6 }, () => [1, 1, 1]);
  const d = pozlamaKazanclari(sahne(kazanc, 600, 0.2, 7), kazanc.length);
  for (const g of d.kazanc) for (const v of g) assert.ok(Math.abs(v - 1) < 0.01, `sabit pozlamada düzeltme ${v}`);
  console.log('[2] sabit pozlama → düzeltme ~1');
}

// [3] az gözlemli kare ölçülmez, düzeltmesi 1; ortalamaya da katılmaz.
{
  const kazanc = [[1, 1, 1], [1.2, 1.2, 1.2], [1, 1, 1]];
  const g = sahne(kazanc, 400, 0, 3).map((obs) => obs.filter((o) => o.kare !== 2)); // kare 2 hiç yok
  g[0].push({ kare: 2, rgb: [0.5, 0.5, 0.5] }, { kare: 0, rgb: [0.5, 0.5, 0.5] });
  const d = pozlamaKazanclari(g, 3);
  assert.equal(d.olculen[2], false);
  assert.deepEqual(d.kazanc[2], [1, 1, 1]);
  assert.ok(Math.abs(d.kazanc[0][0] / d.kazanc[1][0] - 1.2) < 0.02, 'ölçülen karelerin oranı korunmalı');
  console.log('[3] az gözlemli kare düzeltilmiyor');
}

// [4] düzeltme kelepçelenir (aşırı kazanç bir hata işaretidir, uygulanmaz).
{
  const kazanc = [[1, 1, 1], [4, 4, 4]];
  const d = pozlamaKazanclari(sahne(kazanc.map((k) => k.map((v) => v / 4)), 400, 0, 5), 2);
  for (const g of d.kazanc) for (const v of g) assert.ok(v >= 0.66 && v <= 1.51, `kelepçe dışı ${v}`);
  console.log('[4] kelepçe');
}

// [5] kazancUygula: -1 nöbetçisi korunur, 1'de kırpılır, kanal başına çarpar.
{
  const rgb = new Float32Array([0.5, 0.5, 0.5, -1, -1, -1, 0.9, 0.2, 0.4]);
  kazancUygula(rgb, [1.2, 1.0, 0.5]);
  assert.deepEqual(Array.from(rgb).map((v) => +v.toFixed(4)), [0.6, 0.5, 0.25, -1, -1, -1, 1, 0.2, 0.2]);
  console.log('[5] kazancUygula');
}

// [6] gozlemleriTopla: iğne deliği izdüşümü (R satır-öncelikli, y aşağı), arkadaki ve
//     kare dışındaki noktalar atlanır; renk kare.sampleColor'dan gelir.
{
  const cagri = [];
  const kare = (renk) => ({ fw: 100, fh: 100, sampleColor: (x, y) => { cagri.push([x, y]); return renk; } });
  const kareler = [kare([0.2, 0.3, 0.4]), kare([0.4, 0.6, 0.8])];
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const kameralar = [
    { imgIdx: 0, R: I, t: [0, 0, 0], f: 100 },
    { imgIdx: 1, R: I, t: [-0.1, 0, 0], f: 100, cx: 50, cy: 50 },
  ];
  const noktalar = [[0, 0, 1], [0, 0, -1], [10, 0, 1]];
  const g = gozlemleriTopla(kareler, kameralar, noktalar);
  assert.equal(g.length, 1, 'yalnız görünür nokta gözlem üretmeli');
  assert.deepEqual(g[0].map((o) => o.kare), [0, 1]);
  assert.deepEqual(cagri, [[50, 50], [40, 50]]);
  // haric: o kare hiç gözlem vermez (ölçüm için ayrılan kareler)
  const h = gozlemleriTopla(kareler, kameralar, noktalar, new Set([1]));
  assert.equal(h.length, 0, 'tek gözlemli nokta atılmalı');
  console.log('[6] gozlemleriTopla');
}

// [7] kazancHizaliPsnr: tahmin gerçeğin kanal başına sabit katıysa hizalı PSNR sonsuz
//     (ölçüm: ayrılan karenin kendi pozlaması tahmine karşı sayılmasın).
{
  const n = 64, g = new Uint8ClampedArray(n * 4), t = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) { g[i * 4 + c] = 40 + i * 2 + c * 10; t[i * 4 + c] = Math.round(g[i * 4 + c] * 0.8); } g[i * 4 + 3] = t[i * 4 + 3] = 255; }
  assert.ok(kazancHizaliPsnr(t, g) > 45, `hizalı PSNR ${kazancHizaliPsnr(t, g)}`);
  console.log('[7] kazancHizaliPsnr');
}

console.log('verify-pozlama-dengeleme: OK');
