// Otomatik yüzen (floater) temizleme — `yuzenleriBul` saf fonksiyonu.
// PlayCanvas splat-transform `filterFloaters` mantığı: voksel yoğunluğu
// (Beer–Lambert, opaklık ≥ 0.1 → dolu), hiçbir dolu voksele katkı vermeyen
// Gaussian atılır.
import assert from 'node:assert/strict';
import { yuzenBolgesi, yuzenleriBul, yuzenVokseli } from '../src/engine/reconstruction/yuzenTemizleme.ts';

const STRIDE = 16;
const logit = (a) => Math.log(a / (1 - a));
/** g: { p:[x,y,z], s:[sx,sy,sz] (dünya), q:[w,x,y,z], a: alfa } */
function paketle(gs) {
  const d = new Float32Array(gs.length * STRIDE);
  gs.forEach((g, i) => {
    const o = i * STRIDE;
    d.set(g.p, o);
    d.set(g.s.map(Math.log), o + 3);
    d.set(g.q ?? [1, 0, 0, 0], o + 6);
    d[o + 13] = g.a === 0 ? -20 : logit(g.a);
  });
  return d;
}

// Yoğun bir duvar: x = 1 düzleminde, 0.05 aralıklı, opak küçük Gaussian'lar.
const duvar = [];
for (let y = -0.5; y <= 0.5001; y += 0.05) for (let z = -0.5; z <= 0.5001; z += 0.05) {
  duvar.push({ p: [1, y, z], s: [0.02, 0.03, 0.03], a: 0.9 });
}
const sinir = { min: [-1, -1, -1], max: [2, 1, 1] };
const V = 0.05;

// 1. Yalnız, soluk Gaussian (yoğunluk 1−e^−0.05 < 0.1) atılır; duvar kalır.
{
  const gs = [...duvar, { p: [0, 0, 0], s: [0.02, 0.02, 0.02], a: 0.05 }];
  const r = yuzenleriBul(paketle(gs), gs.length, { voksel: V, sinir });
  assert.deepEqual(r.indeksler, [duvar.length], 'only the faint isolated splat is a floater');
  assert.equal(r.canli, gs.length);
  assert.ok(r.dolu > 0, 'the wall makes solid voxels');
}

// 2. Yalnız ama opak Gaussian kendi vokselini doldurur: yüzen sayılmaz
//    (filterFloaters semantiği — görünür tek nokta "boşlukta" değildir).
{
  const gs = [...duvar, { p: [0, 0, 0], s: [0.02, 0.02, 0.02], a: 0.9 }];
  assert.deepEqual(yuzenleriBul(paketle(gs), gs.length, { voksel: V, sinir }).indeksler, []);
}

// 3. Soluk ama duvara değen Gaussian kalır (dolu voksel merkezinde katkı ≥ 1/255).
{
  const gs = [...duvar, { p: [0.95, 0, 0], s: [0.04, 0.04, 0.04], a: 0.05 }];
  assert.deepEqual(yuzenleriBul(paketle(gs), gs.length, { voksel: V, sinir }).indeksler, []);
}

// 4. Anizotropi + dönüş: uzun ekseni duvara doğru olan soluk iğne kalır,
//    aynı iğne z etrafında 90° döndürülünce (uzun eksen y) atılır.
{
  const igne = { p: [0.2, 0, 0], s: [0.4, 0.05, 0.05], a: 0.05 };
  const dik = { ...igne, q: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] };
  const a = [...duvar, igne], b = [...duvar, dik];
  assert.deepEqual(yuzenleriBul(paketle(a), a.length, { voksel: V, sinir }).indeksler, [], 'needle along x reaches the wall');
  assert.deepEqual(yuzenleriBul(paketle(b), b.length, { voksel: V, sinir }).indeksler, [duvar.length], 'rotated needle does not');
  // Normalize edilmemiş dörtlü aynı sonucu vermeli.
  const c = [...duvar, { ...dik, q: [2 * Math.SQRT1_2, 0, 0, 2 * Math.SQRT1_2] }];
  assert.deepEqual(yuzenleriBul(paketle(c), c.length, { voksel: V, sinir }).indeksler, [duvar.length], 'quaternion is normalized');
}

// 5. Sınır dışı merkez: kanıt yok → tutulur. Ölü (logit −20) splat raporlanmaz.
{
  const gs = [...duvar, { p: [5, 0, 0], s: [0.02, 0.02, 0.02], a: 0.05 }, { p: [0, 0.3, 0], s: [0.02, 0.02, 0.02], a: 0 }];
  const r = yuzenleriBul(paketle(gs), gs.length, { voksel: V, sinir });
  assert.deepEqual(r.indeksler, [], 'outside-bounds and already-dead splats are never reported');
  assert.equal(r.canli, duvar.length + 1, 'dead splats are not live');
  assert.equal(r.kapsanan, duvar.length, 'outside-bounds splats are not covered');
}

// 6. Varsayılan sınır (yüzdelik) ve bellek tavanı: voksel büyütülür, sonuç aynı.
{
  const gs = [...duvar, { p: [0, 0, 0], s: [0.02, 0.02, 0.02], a: 0.05 }];
  const r = yuzenleriBul(paketle(gs), gs.length, { voksel: V });
  assert.deepEqual(r.indeksler, [duvar.length], 'default robust bounds still cover the floater');
  const kaba = yuzenleriBul(paketle(gs), gs.length, { voksel: V, sinir, maksVoksel: 2000 });
  assert.ok(kaba.voksel > V && kaba.boyut[0] * kaba.boyut[1] * kaba.boyut[2] <= 2000, 'voxel grows to respect the cap');
  assert.deepEqual(kaba.indeksler, [duvar.length]);
}

// 7. Girdi doğrulaması.
assert.throws(() => yuzenleriBul(new Float32Array(16), 1, { voksel: 0 }), RangeError);
assert.throws(() => yuzenleriBul(new Float32Array(16), 2, { voksel: 0.1 }), RangeError);
assert.deepEqual(yuzenleriBul(new Float32Array(0), 0, { voksel: 0.1 }).indeksler, []);

// 8. Ölçeksiz voksel: kameradan noktalara medyan uzaklığın kesri; sahne
//    ölçeğiyle doğrusal ölçeklenir (monoküler SfM metrik değil).
{
  const kam = [[0, 0, 0], [1, 0, 0]];
  const nok = [[0, 0, 4], [1, 0, 4], [0, 0, 6]];
  const v1 = yuzenVokseli(kam, nok, 0.01);
  const v2 = yuzenVokseli(kam.map((p) => p.map((x) => 3 * x)), nok.map((p) => p.map((x) => 3 * x)), 0.01);
  assert.ok(Math.abs(v2 - 3 * v1) < 1e-9 && v1 > 0, 'voxel scales with the scene');
  // Bölge: kamera AABB'si ± medyan sahne derinliği (ızgara arka plana şişmez).
  const b = yuzenBolgesi(kam, nok, 0.01);
  const D = yuzenVokseli(kam, nok, 1);
  assert.ok(Math.abs(b.voksel - v1) < 1e-12);
  assert.deepEqual(b.sinir.min, [0 - D, -D, -D]);
  assert.deepEqual(b.sinir.max, [1 + D, D, D]);
}

console.log('verify-yuzen-temizleme: OK');
