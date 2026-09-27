// Gezinme sınırı ← boş alan ızgarası (gezinme parça 3, görev 4 — bkz.
// docs/plans/2026-09-27-gezinme-3-geometri.md): `bosAlanSiniri` ve
// `flyStep`'in isteğe bağlı `bos` parametresi. Sentetik orman yolu + GT
// derinlik (24 poz, `verify-bos-alan.mjs` ile aynı sahne) üzerinde.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { bosAlanKur, durum } from '../src/engine/reconstruction/bosAlan.ts';
import { kameraMerkezi } from '../src/engine/reconstruction/egitim3dgs.ts';
import {
  flyStep, flyStepBirlesik, flySiniri, bosAlanSiniri,
} from '../src/ui/egitimControls.ts';
import {
  YUKARI, VARSAYILAN_TOHUM, engelUzakligi, gtDerinlik, isinKes, sahneTanimi, yolPozu,
} from '../src/bench/sentetikSahne.ts';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} != ${b} (eps ${eps})`);
const mesafe = (a, b) => Math.hypot(...[0, 1, 2].map((i) => a[i] - b[i]));
const merkez = (k) => kameraMerkezi(k);

// ── sahne + boş alan ızgarası (verify-bos-alan.mjs ile aynı) ────────────
const W = 240, H = 135, VOKSEL = 0.1;
const pozlar = Array.from({ length: 24 }, (_, i) => yolPozu(i / 23));
let t0 = performance.now();
const kareler = pozlar.map((kamera) => ({ derinlik: gtDerinlik(kamera, W, H), kamera }));
const alan = bosAlanKur(kareler, { voksel: VOKSEL, yukari: YUKARI });
const kurMs = performance.now() - t0;

const cams = pozlar.map(kameraMerkezi);
let L = 0;
for (let i = 1; i < cams.length; i++) L += mesafe(cams[i], cams[i - 1]);

// `flySiniri(..., 'yol')`: bugünkü (kamera-hacmi) sınır — karşılaştırma referansı.
const yolSiniriBugun = flySiniri(cams, [0, 0, 1e6], 'yol');

// ── 1. bosAlanSiniri: açıklık ızgarasını bir kez hesaplar, yarıçapı ölçer ─
t0 = performance.now();
const bos = bosAlanSiniri(alan, L, 0.02);
const siniriMs = performance.now() - t0;
assert.equal(bos.alan, alan, 'bosAlanSiniri keeps the grid reference');
near(bos.yaricap, 0.02 * L, 1e-9, 'yaricap = oran * birim (path length)');
assert.equal(bos.aciklik.length, alan.boyut[0] * alan.boyut[1] * alan.boyut[2], 'clearance grid matches voxel count');
// Özel oran.
near(bosAlanSiniri(alan, L, 0.05).yaricap, 0.05 * L, 1e-9, 'custom oran');

const ESIK = bos.yaricap - VOKSEL; // "engelUzakligi(C) ≥ yaricap − voksel"

// ── 2. (a) yana yürüyüş: boş-alan sınırı bugünkü YOL_PAY sınırından geniş ─
// Yol boyunca üç temsili nokta (patikanın kesin uçları hariç: orada birkaç
// GT pozunun görüşü çakışmadığından kanıt zayıf — kasıtlı, gerçek bir
// gezinmede de öyle olurdu). Her noktada iki yön denenir (nesneler patikanın
// iki yanına rastgele dağıldığından); en açık yön raporlanır.
const yanRapor = [];
for (const [etiket, s] of [['start', 0.3], ['middle', 0.5], ['end', 0.8]]) {
  const k = yolPozu(s);
  const C = merkez(k);
  let enIyiBugun = 0, enIyiSerbest = 0;
  for (const yon of [1, -1]) {
    const axes = { forward: 0, right: yon, vertical: 0 };
    const bugun = flyStep(k, axes, 10, yolSiniriBugun, YUKARI);
    const serbest = flyStep(k, axes, 10, yolSiniriBugun, YUKARI, bos);
    assert.deepEqual(flyStepBirlesik(k, axes, 10, yolSiniriBugun, YUKARI), bugun,
      'without free-space data the combined step is the established step');
    const birlesik = flyStepBirlesik(k, axes, 10, yolSiniriBugun, YUKARI, bos);
    const ilerleme = (cam) => yon * k.R.slice(0, 3).reduce(
      (sum, axis, index) => sum + axis * (merkez(cam)[index] - C[index]), 0);
    assert.ok(ilerleme(birlesik) + 1e-9 >= Math.max(
      ilerleme(bugun), ilerleme(serbest)),
    'combined step keeps the farther movement along the requested side direction');
    enIyiBugun = Math.max(enIyiBugun, mesafe(merkez(bugun), C));
    enIyiSerbest = Math.max(enIyiSerbest, mesafe(merkez(serbest), C));
    // Hiçbir yönde GT engel payı ihlal edilmez.
    const e = engelUzakligi(merkez(serbest));
    assert.ok(e >= ESIK - 1e-9, `${etiket} s=${s} yon=${yon}: engelUzakligi ${e.toFixed(3)} < esik ${ESIK.toFixed(3)}`);
  }
  assert.ok(enIyiSerbest > enIyiBugun, `${etiket}: free-space (${enIyiSerbest.toFixed(3)}) must reach further than today's YOL_PAY bound (${enIyiBugun.toFixed(3)})`);
  yanRapor.push({ etiket, s, bugun: enIyiBugun, serbest: enIyiSerbest });
}

// Geniş tarama: patika boyunca hiçbir yana adım GT engelinin payını ihlal etmez.
let enKotuEngel = Infinity;
for (let s = 0.02; s <= 0.98; s += 0.02) {
  const k = yolPozu(s);
  for (const yon of [1, -1]) {
    const serbest = flyStep(k, { forward: 0, right: yon, vertical: 0 }, 10, yolSiniriBugun, YUKARI, bos);
    enKotuEngel = Math.min(enKotuEngel, engelUzakligi(merkez(serbest)));
  }
}
assert.ok(enKotuEngel >= ESIK - 1e-9, `sideways free-space step never lands inside a GT obstacle margin (worst ${enKotuEngel.toFixed(3)} < ${ESIK.toFixed(3)})`);

// ── 3. (b) bir gövdeye doğru yürüyüş: yüzeyin `yaricap` önünde durur ─────
// verify-bos-alan.mjs'teki görüş-hattı seçimiyle aynı: kesişimi bu gövde
// olan ve yolunda başka engel 0.8 m'den yakın olmayan (gövde, GT kamera) çifti.
const sahne = sahneTanimi(VARSAYILAN_TOHUM);
const govdeler = sahne.nesneler.filter((n) => n.tur === 'govde');
const hizliEngel = (p) => {
  let en = 1.6 - p[1]; // ZEMIN_Y
  for (const g of govdeler) {
    const d = Math.hypot(p[0] - g.x, p[2] - g.z) - g.r;
    if (d < en) en = d;
  }
  return en;
};
const govdeUzak = (p, g) => Math.hypot(p[0] - g.x, p[2] - g.z) - g.r;
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const carpraz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Yatay ufuk seviyeli, `f` yönüne bakan kamera (yalnız R/t önemli, geri kalan sahte içsel). */
function bakanKamera(C, f) {
  const z = norm(f);
  const x = norm(carpraz([-YUKARI[0], -YUKARI[1], -YUKARI[2]], z));
  const y = carpraz(z, x);
  const R = [...x, ...y, ...z];
  const t = [0, 1, 2].map((r) => -(R[r * 3] * C[0] + R[r * 3 + 1] * C[1] + R[r * 3 + 2] * C[2]));
  return { R, t, f: 500, cx: 320, cy: 240, w: 640, h: 480 };
}

const yakinGovdeler = govdeler
  .filter((g) => g.r >= 0.15 && g.z >= 4 && g.z <= 14 && Math.abs(g.x) <= 4)
  .sort((a, b) => a.z - b.z || a.x - b.x);
let govdeDurumu = null;
disari: for (const g of yakinGovdeler) {
  for (let i = 1; i < pozlar.length; i++) {
    const C = merkez(pozlar[i]);
    if (C[2] > g.z - 1.5 || C[2] < g.z - 8) continue;
    const hedef = [g.x, C[1], g.z];
    const yon = [hedef[0] - C[0], hedef[1] - C[1], hedef[2] - C[2]];
    const k = pozlar[i];
    const zc = k.R[6] * yon[0] + k.R[7] * yon[1] + k.R[8] * yon[2];
    const xc = k.R[0] * yon[0] + k.R[1] * yon[1] + k.R[2] * yon[2];
    if (zc <= 0 || Math.abs((k.f * xc) / zc) > k.cx * 0.9) continue; // gövde bu karede görünmeli
    const tHit = isinKes(C, yon);
    const uzL = Math.hypot(...yon);
    const P = [0, 1, 2].map((a) => C[a] + (yon[a] / uzL) * tHit);
    if (Math.abs(govdeUzak(P, g)) > 1e-6) continue; // ilk kesişim bu gövde olmalı
    let baskaEn = Infinity;
    for (let s = 0; s <= 1; s += 0.01) {
      const q = [0, 1, 2].map((a) => C[a] + s * (P[a] - C[a]));
      const e = hizliEngel(q);
      if (e < govdeUzak(q, g) - 1e-9) baskaEn = Math.min(baskaEn, e);
    }
    if (baskaEn < 0.8) continue; // koridor açık değil: erken durma beklenir, atla
    govdeDurumu = { g, C, hedef };
    break disari;
  }
}
assert.ok(govdeDurumu, 'a clear-corridor line-of-sight trunk approach exists in the synthetic scene');
{
  const { g, C, hedef } = govdeDurumu;
  const yon = [hedef[0] - C[0], hedef[1] - C[1], hedef[2] - C[2]];
  const k = bakanKamera(C, yon);
  const uzunluk = Math.hypot(...yon);
  const S = flyStep(k, { forward: 1, right: 0, vertical: 0 }, uzunluk + 5, yolSiniriBugun, YUKARI, bos);
  const Cs = merkez(S);
  const bosluk = govdeUzak(Cs, g);
  assert.ok(bosluk >= bos.yaricap - 1e-9, `walking toward the trunk must stop ≥ yaricap from its surface: ${bosluk.toFixed(3)}`);
  assert.ok(bosluk <= bos.yaricap + 0.35, `stop should get reasonably close, not absurdly early: ${bosluk.toFixed(3)}`);
  assert.ok(hizliEngel(Cs) >= bos.yaricap - 1e-9, 'stop point also keeps yaricap from every other GT obstacle');
  assert.ok(mesafe(Cs, C) > 0.5, 'real progress was made toward the trunk before stopping');
  var govdeRapor = { yaricap: bos.yaricap, bosluk };
}

// ── 4. (c) patika boyunca ileri yürüyüş serbest ──────────────────────────
// `flyStep`'in kendi ileri ekseni (kameranın R satır-2'si) boyunca hareket:
// patika hafifçe kıvrıldığından (`yolPozu` meander + yaw), bir sonraki GT
// pozuna TAM ulaşmaz (o küçük fark yön değil, patikanın eğriliğidir) — asıl
// test, istenen adımın boş-alan sınırınca KISALTILMADIĞI (kırpılmadığı).
{
  let adim = 0;
  for (let s = 0.1; s < 0.95; s += 0.1 / 14) {
    const k = yolPozu(s);
    const C = merkez(k);
    const uzunluk = 0.1;
    const next = [0, 1, 2].map((i) => C[i] + uzunluk * k.R[6 + i]);
    const S = merkez(flyStep(k, { forward: 1, right: 0, vertical: 0 }, uzunluk, yolSiniriBugun, YUKARI, bos));
    near(S[0], next[0], 1e-9, `forward step at s=${s.toFixed(3)} (x)`);
    near(S[1], next[1], 1e-9, `forward step at s=${s.toFixed(3)} (y)`);
    near(S[2], next[2], 1e-9, `forward step at s=${s.toFixed(3)} (z)`);
    adim++;
  }
  assert.ok(adim > 90, `enough forward steps checked (${adim})`);
  // Uzun tek ileri adım da serbest.
  const k = yolPozu(0.3);
  const C = merkez(k);
  const S = merkez(flyStep(k, { forward: 1, right: 0, vertical: 0 }, 2, yolSiniriBugun, YUKARI, bos));
  near(mesafe(S, C), 2, 1e-6, 'a long forward step is unobstructed too');
}

// ── 5. (d) `bos` verilmezse flyStep bugünküyle bit-bit aynı ─────────────
{
  const rng = (() => { let s = 0xC0FFEE ^ 0x9e3779b9; return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }; })();
  const rand = (lo, hi) => lo + rng() * (hi - lo);
  const randVec3 = (r) => { const th = rng() * Math.PI * 2, ph = Math.acos(2 * rng() - 1); return [r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)]; };
  const randRot = () => {
    // Rastgele birim kuaterniyon -> R (satır sıralı).
    const u1 = rng(), u2 = rng(), u3 = rng();
    const q = [Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2), Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2), Math.sqrt(u1) * Math.sin(2 * Math.PI * u3), Math.sqrt(u1) * Math.cos(2 * Math.PI * u3)];
    const [x, y, z, w] = q;
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ];
  };
  let denendi = 0;
  for (let i = 0; i < 200; i++) {
    const R = randRot();
    const C = randVec3(rand(0, 5));
    const t = [0, 1, 2].map((r) => -(R[r * 3] * C[0] + R[r * 3 + 1] * C[1] + R[r * 3 + 2] * C[2]));
    const k = { R, t, f: 500, cx: 320, cy: 240, w: 640, h: 480 };
    const axes = { forward: rand(-1, 1), right: rand(-1, 1), vertical: rand(-1, 1) };
    const distance = rand(0.01, 3);
    const up = norm(randVec3(1));
    const kameralar = Array.from({ length: 2 + Math.floor(rng() * 4) }, () => randVec3(rand(1, 10)));
    const pivot = randVec3(rand(1, 10));
    const tur = rng() < 0.5 ? 'yol' : 'yorunge';
    const sinir = flySiniri(kameralar, pivot, tur);

    const bezSinirsiz = flyStep(k, axes, distance, sinir, up);
    const acikcaTanimsiz = flyStep(k, axes, distance, sinir, up, undefined);
    assert.deepEqual(acikcaTanimsiz, bezSinirsiz, `bos omitted vs bos=undefined must be bit-identical (case ${i})`);
    assert.ok(acikcaTanimsiz.t.every((v, j) => Object.is(v, bezSinirsiz.t[j])), `bit-identical t components (case ${i})`);
    denendi++;
  }
  assert.equal(denendi, 200);
}

console.log(
  `bosAlanSiniri: yaricap ${bos.yaricap.toFixed(3)} m (0.02 × path length ${L.toFixed(3)} m)\n`
  + yanRapor.map((r) => `  sideways @ ${r.etiket} (s=${r.s}): today ${r.bugun.toFixed(3)} m vs free-space ${r.serbest.toFixed(3)} m`).join('\n') + '\n'
  + `worst GT clearance over full sideways scan: ${enKotuEngel.toFixed(3)} m (esik ${ESIK.toFixed(3)} m)\n`
  + `trunk approach: stop ${govdeRapor.bosluk.toFixed(3)} m from surface (yaricap ${govdeRapor.yaricap.toFixed(3)} m)\n`
  + `timing: bosAlanKur ${kurMs.toFixed(0)}ms · bosAlanSiniri (aciklik) ${siniriMs.toFixed(0)}ms`,
);
console.log('bos alan gezinme: OK');
