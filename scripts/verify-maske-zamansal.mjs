// Uzuv dostu bileşen seçimi + video maskesi zamansal yumuşatma (saf).  node scripts/verify-maske-zamansal.mjs
import assert from 'node:assert/strict';
const { keepMainComponents, keepLargestComponent } = await import('../src/engine/reconstruction/silhouette.ts');
const { createMaskSmoother } = await import('../src/engine/reconstruction/maskeZamansal.ts');

const w = 120, h = 100;
const bos = () => new Float32Array(w * h);
const dikdortgen = (m, x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1; return m; };
const say = (m) => m.reduce((s, v) => s + (v >= 0.5 ? 1 : 0), 0);

// gövde + 6 piksel boşluklu kol + uzak kapı kasası + yakın ama minik benek
const m = bos();
dikdortgen(m, 10, 10, 50, 90);      // gövde 3200
dikdortgen(m, 56, 30, 70, 50);      // kol 280 (boşluk 6 <= 12)
dikdortgen(m, 70, 40, 80, 46);      // el: kola yapışık (aynı bileşen)
dikdortgen(m, 105, 10, 115, 40);    // uzak (boşluk 35) 300 px
dikdortgen(m, 52, 80, 54, 82);      // yakın ama 4 px < %0.2*3200=6.4
const eski = keepLargestComponent(m, w, h);
assert.equal(say(eski), 3200 + 0, 'eski davranış: yalnız en büyük bileşen');
const yeni = keepMainComponents(m, w, h);
assert.equal(say(yeni), 3200 + 280 + 60, 'gövde + kol + el');
assert.equal(yeni[20 * w + 110], 0, 'uzak parça düşer');
assert.equal(yeni[81 * w + 53], 0, 'minik benek düşer');
assert.equal(yeni[40 * w + 60], 1, 'kol kalır');
// tek parça: aynı nesne döner
const tek = dikdortgen(bos(), 10, 10, 50, 90);
assert.equal(keepMainComponents(tek, w, h), tek);
// boş
const b = bos();
assert.equal(keepMainComponents(b, w, h), b);
// zincir: el kola 8 px, kol gövdeye 8 px -> ikisi de kalır
const z = bos();
dikdortgen(z, 10, 10, 50, 90); dikdortgen(z, 58, 30, 70, 50); dikdortgen(z, 78, 30, 90, 50);
assert.equal(say(keepMainComponents(z, w, h)), 3200 + 240 + 240);

// zamansal: titreyen kenar piksel ortalanır
const s = createMaskSmoother(3);
const a = dikdortgen(bos(), 10, 10, 50, 50);
const kenarli = (var_) => { const k = dikdortgen(bos(), 10, 10, 50, 50); if (var_) k[30 * w + 50] = 1; return k; };
s.push(kenarli(true), w, h); s.push(kenarli(false), w, h);
const o = s.push(kenarli(true), w, h);
assert.ok(Math.abs(o[30 * w + 50] - 2 / 3) < 1e-6, 'kenar pikseli 2/3');
assert.equal(o[30 * w + 20], 1);
// dördüncü karede ilk (true) düşer: pencere 3
const o4 = s.push(kenarli(false), w, h);
assert.ok(Math.abs(o4[30 * w + 50] - 1 / 3) < 1e-6);
// kesme: IoU düşük -> geçmiş atılır, ham maske döner
const baska = dikdortgen(bos(), 80, 60, 110, 95);
assert.equal(s.push(baska, w, h), baska);
// boyut değişimi sıfırlar; reset çalışır
assert.equal(s.push(baska, w, h) !== baska, true);
s.reset();
assert.equal(s.push(a, w, h), a);
const k1 = createMaskSmoother(3); const x1 = a; assert.equal(k1.push(x1, w, h), x1);
console.log('verify-maske-zamansal OK');
