// Sentetik orman yolu sahnesinin saf kısmı: tohumlu içerik, GT kamera yolu,
// analitik engel uzaklığı. three.js YOK — bkz. src/bench/sentetikSahne.ts.
import assert from 'node:assert/strict';
import {
  FON_Z, PATIKA_YARI_GENISLIK, VARSAYILAN_TOHUM, YOL_UZUNLUK, ZEMIN_Y,
  engelUzakligi, gtDerinlik, isinKes, sahneTanimi, yolPozu,
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

// ── isinKes: yatay ışın bilinen bir gövdeye → merkez uzaklığı − r ────────
{
  const hedef = govdeler[0];
  // Sahne yoğun (110 nesne, geniş z aralığında): uzun bir yatay ışın başka
  // bir gövde/çalıya çarpabilir. Yüzeyin hemen dışından (küçük boşluk) atmak
  // formülü ("merkez uzaklığı − r") aynı şekilde sınar, çarpışma riski yok.
  const bosluk = 0.1;
  const merkezUzaklik = hedef.r + bosluk;
  const o = [hedef.x - merkezUzaklik, hedef.y, hedef.z];
  const t = isinKes(o, [1, 0, 0]);
  near(t, merkezUzaklik - hedef.r, 1e-6, 'horizontal ray to a known trunk = centre distance - r');
  near(t, bosluk, 1e-6, 'horizontal ray to a known trunk = centre distance - r (gap check)');

  // ölçek değişmezliği: d'nin büyüklüğü sonucu etkilemez (İÇERİDE normalize edilir).
  const t2 = isinKes(o, [7, 0, 0]);
  near(t2, t, 1e-9, 'isinKes is invariant to the magnitude of d');

  // gövdenin İÇİNDEN bakan ışın da yüzeyi (öteki taraftan) bulmalı.
  const tIcten = isinKes([hedef.x, hedef.y, hedef.z], [1, 0, 0]);
  near(tIcten, hedef.r, 1e-6, 'ray from inside a trunk hits its surface at r');
}

// ── isinKes: aşağı bakan ışın zemine ─────────────────────────────────────
{
  const o = [0, -1, 5]; // patika ortası (|x|<PATIKA_YARI_GENISLIK), zeminin üstünde
  const beklenen = ZEMIN_Y - o[1];
  near(isinKes(o, [0, 1, 0]), beklenen, 1e-6, 'downward ray to ground = ZEMIN_Y - o.y');
  // d'nin büyüklüğü (dy) yine sonucu etkilemez.
  near(isinKes(o, [0, 5, 0]), beklenen, 1e-6, 'downward ray to ground is scale-invariant in dy');
  assert.equal(isinKes(o, [0, -1, 0]), Infinity, 'upward ray from above the ground never hits it');
}

// ── isinKes: fon duvarı ve kesişim yokluğu ───────────────────────────────
{
  const o = [0, -1, 0];
  near(isinKes(o, [0, 0, 1]), FON_Z, 1e-6, 'forward ray to the backdrop wall = FON_Z - o.z');
  assert.equal(isinKes(o, [0, 0, -1]), Infinity, 'ray away from every bounded object misses');
}

// ── isinKes: belirlenimcilik ──────────────────────────────────────────────
{
  const o = [0.3, -0.8, 6.1];
  const d = [0.2, 0.05, 1];
  assert.equal(isinKes(o, d), isinKes(o, d), 'isinKes is deterministic for the same inputs');
}

// ── gtDerinlik: birkaç GT pozunda alt satırlar (zemin) sonlu, merkez ≈ FON_Z − Cz ya da daha yakın nesne ──
{
  const w = 64, h = 36;
  for (const t01 of [0, 0.25, 0.5, 0.75, 1]) {
    const k = yolPozu(t01);
    const derinlik = gtDerinlik(k, w, h);
    assert.equal(derinlik.length, w * h, `gtDerinlik length at t=${t01}`);

    // alt satır (zemin) her yerde sonlu olmalı.
    for (let x = 0; x < w; x++) {
      const d = derinlik[(h - 1) * w + x];
      assert.ok(Number.isFinite(d) && d > 0, `bottom row must hit the ground at t=${t01}, x=${x} (got ${d})`);
    }

    // görüntü merkezi: sonlu, ve fon duvarından ötesi (fon en uzak sınır) değil.
    const Cz = -(k.R[2] * k.t[0] + k.R[5] * k.t[1] + k.R[8] * k.t[2]);
    const merkezDerinlik = derinlik[Math.floor(h / 2) * w + Math.floor(w / 2)];
    assert.ok(Number.isFinite(merkezDerinlik), `image centre must be finite at t=${t01}`);
    assert.ok(merkezDerinlik <= (FON_Z - Cz) + 1e-3, `image centre must not exceed the backdrop depth at t=${t01} (got ${merkezDerinlik}, wall ${FON_Z - Cz})`);
  }
}

// ── gtDerinlik: derinlik = ışın uzunluğu × optik eksene açının kosinüsü ──
{
  const k = yolPozu(0.3);
  const w = 16, h = 9;
  const derinlik = gtDerinlik(k, w, h);
  const px = 10, py = 3;
  const olcekX = w / k.w, olcekY = h / k.h;
  const f = k.f * olcekX, fy = (k.fy ?? k.f) * olcekY;
  const cx = k.cx * olcekX, cy = k.cy * olcekY;
  const dcx = (px + 0.5 - cx) / f;
  const dvy = (py + 0.5 - cy) / fy;
  const kameraUzunluk = Math.hypot(dcx, dvy, 1);
  const bx = dcx / kameraUzunluk, by = dvy / kameraUzunluk, bz = 1 / kameraUzunluk;
  const R = k.R;
  const wx = R[0] * bx + R[3] * by + R[6] * bz;
  const wy = R[1] * bx + R[4] * by + R[7] * bz;
  const wz = R[2] * bx + R[5] * by + R[8] * bz;
  const C = merkez(k);
  const isinUzunlugu = isinKes(C, [wx, wy, wz]);
  const beklenenDerinlik = isinUzunlugu * bz; // bz = kosinüs (optik eksen dünyada R'nin 3. satırı)
  near(derinlik[py * w + px], beklenenDerinlik, 1e-6, 'depth = ray length * cos(angle to optical axis)');
}

// ── gtDerinlik: farklı w/h ölçekleme (k.w/k.h'ten farklı) tutarlı ────────
{
  const k = yolPozu(0.5);
  const dTam = gtDerinlik(k); // varsayılan w=k.w, h=k.h
  assert.equal(dTam.length, k.w * k.h, 'default w/h uses the camera resolution');
  const dKucuk = gtDerinlik(k, 32, 18);
  assert.equal(dKucuk.length, 32 * 18, 'gtDerinlik honours an explicit smaller w/h');
}

// ── gtDerinlik: belirlenimcilik ────────────────────────────────────────────
{
  const k = yolPozu(0.6);
  const d1 = gtDerinlik(k, 48, 27);
  const d2 = gtDerinlik(k, 48, 27);
  assert.deepEqual(d1, d2, 'gtDerinlik is deterministic for the same inputs');
}

// ── gtDerinlik: 240×135 hız kontrolü (110 nesne, iyi altında 1 s) ────────
{
  const k = yolPozu(0.5);
  const basla = performance.now();
  const derinlik = gtDerinlik(k, 240, 135);
  const gecen = performance.now() - basla;
  assert.equal(derinlik.length, 240 * 135, '240x135 depth map has the right length');
  assert.ok(gecen < 2000, `240x135 depth map should take well under a second (took ${gecen.toFixed(1)}ms)`);
  console.log(`gtDerinlik 240x135: ${gecen.toFixed(1)}ms`);
}

console.log('sentetik sahne (saf): OK');
