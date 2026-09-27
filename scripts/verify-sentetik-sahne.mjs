// Sentetik orman yolu sahnesinin saf kısmı: tohumlu içerik, GT kamera yolu,
// analitik engel uzaklığı. three.js YOK — bkz. src/bench/sentetikSahne.ts.
import assert from 'node:assert/strict';
import {
  PATIKA_YARI_GENISLIK, VARSAYILAN_TOHUM, YOL_UZUNLUK,
  engelUzakligi, sahneTanimi, yolPozu,
} from '../src/bench/sentetikSahne.ts';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b} (eps ${eps})`);

// ── aynı tohum → aynı sahne ─────────────────────────────────────────────
const a = sahneTanimi(VARSAYILAN_TOHUM);
const b = sahneTanimi(VARSAYILAN_TOHUM);
assert.deepEqual(a, b, 'same seed must produce the same scene');
const c = sahneTanimi(VARSAYILAN_TOHUM + 1);
assert.notDeepEqual(a.nesneler, c.nesneler, 'different seeds must differ');

// ── içerik sayıları + patika şeridi boş ──────────────────────────────────
const govdeler = a.nesneler.filter((n) => n.tur === 'govde');
const caliler = a.nesneler.filter((n) => n.tur === 'cali');
assert.equal(govdeler.length, 70, 'trunk count');
assert.equal(caliler.length, 40, 'bush count');
for (const n of [...govdeler, ...caliler]) {
  assert.ok(Math.abs(n.x) >= PATIKA_YARI_GENISLIK, `${n.tur} at x=${n.x} must be outside the path strip`);
}
assert.ok(a.nesneler.some((n) => n.tur === 'zemin'), 'ground plane present');
assert.ok(a.nesneler.some((n) => n.tur === 'fon'), 'backdrop present');

// ── GT kamera yolu ────────────────────────────────────────────────────────
const k0 = yolPozu(0);
const k1 = yolPozu(1);
function merkez(k) {
  const R = k.R, t = k.t;
  // C = -R^T t
  return [0, 1, 2].map((i) => -(R[i] * t[0] + R[3 + i] * t[1] + R[6 + i] * t[2]));
}
near(merkez(k0)[2], 0, 1e-9, 'path starts at z=0');
near(merkez(k1)[2], YOL_UZUNLUK, 1e-9, 'path ends at z=YOL_UZUNLUK');

// R orthonormal, det +1, for every sampled pose along the path.
function det3(R) {
  return R[0] * (R[4] * R[8] - R[5] * R[7])
    - R[1] * (R[3] * R[8] - R[5] * R[6])
    + R[2] * (R[3] * R[7] - R[4] * R[6]);
}
function ortonormalMi(R) {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const dot = R[i * 3] * R[j * 3] + R[i * 3 + 1] * R[j * 3 + 1] + R[i * 3 + 2] * R[j * 3 + 2];
      const beklenen = i === j ? 1 : 0;
      if (Math.abs(dot - beklenen) > 1e-9) return false;
    }
  }
  return true;
}
for (let i = 0; i <= 100; i++) {
  const k = yolPozu(i / 100);
  assert.ok(ortonormalMi(k.R), `R must be orthonormal at t=${i / 100}`);
  near(det3(k.R), 1, 1e-9, `det(R) must be +1 at t=${i / 100}`);
}

// ── kamera merkezi her zaman engellerden uzak ────────────────────────────
for (let i = 0; i <= 200; i++) {
  const k = yolPozu(i / 200);
  const C = merkez(k);
  const d = engelUzakligi(C);
  assert.ok(d > 0.5, `GT camera centre must clear obstacles by > 0.5 at t=${i / 200} (got ${d})`);
}

// ── bilinen bir gövdenin yüzeyi ≈ 0, merkezi negatif ─────────────────────
const govde = govdeler[0];
const yuzey = [govde.x + govde.r, govde.y, govde.z];
const merkezNokta = [govde.x, govde.y, govde.z];
near(engelUzakligi(yuzey), 0, 0.02, 'point on a known trunk surface is ~0');
assert.ok(engelUzakligi(merkezNokta) < 0, 'point at a known trunk centre is negative');

console.log('sentetik sahne (saf): OK');
