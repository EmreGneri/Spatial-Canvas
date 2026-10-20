// Maske ölçütleri (saf).  node scripts/verify-maske-olcut.mjs
import assert from 'node:assert/strict';
const { jaccard, sinirF, icDelikOrani, ardisikIoU, ikili, davisTolPx, delikKayitlari, gtIzgaraya } = await import('../src/bench/maskeOlcut.ts');

const w = 40, h = 40;
const kare = (x0, y0, x1, y1) => {
  const m = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
  return m;
};
const a = kare(10, 10, 30, 30);
assert.equal(jaccard(a, a), 1);
assert.equal(sinirF(a, a, w, h, 1), 1);
const ayri = kare(32, 32, 38, 38);
assert.equal(jaccard(a, ayri), 0);
assert.equal(sinirF(a, ayri, w, h, 1), 0);
// 1 piksel kayma: F tolerans içinde 1, J < 1
const kay = kare(11, 10, 31, 30);
assert.equal(sinirF(a, kay, w, h, 1), 1);
assert.ok(jaccard(a, kay) < 1);
// boş durumlar
const bos = new Uint8Array(w * h);
assert.equal(jaccard(bos, bos), 1);
assert.equal(sinirF(bos, bos, w, h, 2), 1);
assert.equal(sinirF(a, bos, w, h, 2), 0);
assert.equal(sinirF(bos, a, w, h, 2), 0);
assert.equal(ardisikIoU(a, a), 1);
// halka: 20x20 dolu, ortada 4x4 delik -> 16 / (400-16)
const halka = kare(10, 10, 30, 30);
for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) halka[y * w + x] = 0;
assert.ok(Math.abs(icDelikOrani(halka, w, h) - 16 / 384) < 1e-12);
assert.equal(icDelikOrani(a, w, h), 0);
assert.equal(icDelikOrani(bos, w, h), 0);
// kenara açık "C" boşluk delik sayılmaz
const c = kare(10, 10, 30, 30);
for (let y = 18; y < 22; y++) for (let x = 18; x < 30; x++) c[y * w + x] = 0;
assert.equal(icDelikOrani(c, w, h), 0);
assert.deepEqual([...ikili([0.2, 0.5, 0.9])], [0, 1, 1]);
assert.equal(davisTolPx(854, 480), 8);
// delik kayıtları: 20x20 özne (derinlik 0.8); biri sürekli (0.8), biri uzak (0.2) iki 3x3 delik
{
  const m = new Float32Array(w * h), dp = new Float32Array(w * h).fill(0.1);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) { m[y * w + x] = 1; dp[y * w + x] = 0.8; }
  const delik = (x0, y0, d) => { for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) { m[y * w + x] = 0.1; dp[y * w + x] = d; } };
  delik(13, 13, 0.8); delik(24, 24, 0.2);
  const gt = new Uint8Array(w * h);
  for (let y = 13; y < 16; y++) for (let x = 13; x < 16; x++) gt[y * w + x] = 1; // sürekli delik tam GT içi
  gt[24 * w + 24] = 1; gt[24 * w + 25] = 1; gt[24 * w + 26] = 1; // uzak delikte 3/9
  const r = delikKayitlari(m, dp, w, h, gt);
  assert.equal(r.length, 2); // dış arka plan (sınıra değen) sayılmaz
  const uzak = r.find((k) => k.icMedyan < 0.5), surekli = r.find((k) => k.icMedyan > 0.5);
  assert.equal(surekli.alan, 9);
  assert.ok(surekli.fark < 1e-6 && surekli.doldurulurMu && Math.abs(surekli.gtOrani - 1) < 1e-12);
  assert.ok(Math.abs(uzak.fark - 0.6) < 1e-6 && !uzak.doldurulurMu && Math.abs(uzak.gtOrani - 3 / 9) < 1e-12);
  assert.ok(Math.abs(uzak.olasilikOrt - 0.1) < 1e-6 && uzak.doluluk === 1 && uzak.derinlikStd < 1e-6);
  assert.ok(Math.abs(uzak.alanOrani - 9 / (400 - 18)) < 1e-9);
  // gtIzgaraya: 4x4 -> 2x2, örnekler piksel merkezlerinde (1,1),(3,1),(1,3),(3,3); (2,2) örneklenmez
  const g4 = new Uint8Array(16); g4[1 * 4 + 1] = 1; g4[2 * 4 + 2] = 1;
  assert.deepEqual([...gtIzgaraya(g4, 4, 4, 2, 2)], [1, 0, 0, 0]);
  g4[3 * 4 + 3] = 1;
  assert.deepEqual([...gtIzgaraya(g4, 4, 4, 2, 2)], [1, 0, 0, 1]);
}
console.log('verify-maske-olcut: OK');
