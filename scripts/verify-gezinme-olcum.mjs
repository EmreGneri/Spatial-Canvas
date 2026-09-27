// Probe poses, today's fly bound and image metrics for navigability measurement — no GPU.
import assert from 'node:assert/strict';
import {
  BOLGELER, MESAFELER, olcumBirimi, tabanKamera, sondaPozlari, bugunkuSinir,
  psnr, ssim, keskinlik, kaplama, kullanilabilirMesafe,
} from '../src/engine/reconstruction/gezinmeOlcum.ts';
import { flySiniri } from '../src/ui/egitimControls.ts';
import { kameraMerkezi } from '../src/engine/reconstruction/egitim3dgs.ts';

const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);
const inRange = (v, lo, hi, msg) => assert.ok(v >= lo && v <= hi, `${msg}: ${v} not in [${lo}, ${hi}]`);
const up = [0, -1, 0]; // COLMAP: y down
const intr = { f: 500, cx: 320, cy: 240, w: 640, h: 480 };
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Camera at C looking along f, level horizon (same helper as verify-cekim-yolu.mjs). */
function poz(C, f) {
  const z = norm(f), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
  const R = [...x, ...y, ...z];
  return { ...intr, R, t: [0, 1, 2].map((i) => -(R[i * 3] * C[0] + R[i * 3 + 1] * C[1] + R[i * 3 + 2] * C[2])) };
}

// ── olcumBirimi + tabanKamera + sondaPozlari on a straight forward walk ─────
const L = 16;
const walk = Array.from({ length: 40 }, (_, i) => poz([0, 0, (L * i) / 39], [0, 0, 1]));
const centers = walk.map(kameraMerkezi);
const pivotUzak = [0, 0, 1000]; // unused by the 'yol' branch, but required by the signature

near(olcumBirimi(centers, pivotUzak, 'yol'), L, 'olcumBirimi(yol) is the walked path length');

const sondalar = sondaPozlari(walk, up, pivotUzak, 'yol');
const beklenen = 3 * (1 + 7 + 7 + 4 + 4); // 3 bolge x (1 merkez + 7 sag + 7 sol + 4 ileri + 4 yukari)
assert.equal(sondalar.length, beklenen, `probe count (${sondalar.length} != ${beklenen})`);
assert.equal(new Set(sondalar.map((s) => s.id)).size, sondalar.length, 'probe ids are unique');

const merkezSondalar = sondalar.filter((s) => s.id.endsWith('_merkez_0.00'));
assert.equal(merkezSondalar.length, 3, 'exactly one centre probe per region');
for (const m of merkezSondalar) assert.equal(m.yon, 'sag', 'centre probe is tagged yon: sag');

const ortaSag010 = sondalar.find((s) => s.id === 'orta_sag_0.10');
assert.ok(ortaSag010, 'orta_sag_0.10 exists');
const tabanOrta = tabanKamera(walk, up, 'yol', BOLGELER.orta);
const diff = kameraMerkezi(ortaSag010.kamera).map((v, i) => v - kameraMerkezi(tabanOrta)[i]);
near(Math.hypot(...diff), 0.1 * L, 'orta_sag_0.10 is offset by exactly 0.1*L');
near(diff[1], 0, 'offset has no y component (level walk)');
near(diff[2], 0, 'offset has no z component (level walk)');
assert.deepEqual(ortaSag010.kamera.R, tabanOrta.R, 'orta_sag_0.10 keeps the base R unchanged');

// ── bugunkuSinir on the same straight walk ──────────────────────────────────
const yolSinir = flySiniri(centers, pivotUzak, 'yol');
const birimYol = olcumBirimi(centers, pivotUzak, 'yol');
const sagSinir = bugunkuSinir(tabanOrta, 'sag', yolSinir, up, birimYol);
inRange(sagSinir, 0.055, 0.065, "bugunkuSinir(yol, 'sag')");

// ── olcumBirimi on an orbit: median camera-pivot distance ───────────────────
const pivot0 = [0, 0, 0];
const orbitCenters = [[5, 0, 0], [3, 0, 0], [10, 0, 0]];
near(olcumBirimi(orbitCenters, pivot0, 'yorunge'), 5, 'olcumBirimi(yorunge) is the median camera-pivot distance');

// ── psnr ─────────────────────────────────────────────────────────────────
{
  const n = 4; // pixels
  const a = new Uint8ClampedArray(n * 4);
  const b = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    a[p * 4 + 0] = 100; a[p * 4 + 1] = 150; a[p * 4 + 2] = 200; a[p * 4 + 3] = 255;
    b[p * 4 + 0] = 110; b[p * 4 + 1] = 160; b[p * 4 + 2] = 210; b[p * 4 + 3] = 0; // alpha ignored, diff 10 per channel -> MSE 100
  }
  near(psnr(a, b), 28.13, 'psnr at MSE 100', 0.01);
  assert.equal(psnr(a, a), Infinity, 'psnr of identical input is Infinity');
}

// ── ssim ─────────────────────────────────────────────────────────────────
{
  const w = 16, h = 16;
  const rng = (() => { let s = 11; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) % 256; })();
  const noiseA = new Uint8ClampedArray(w * h * 4);
  const noiseB = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    for (let c = 0; c < 3; c++) { noiseA[p * 4 + c] = rng(); noiseB[p * 4 + c] = rng(); }
    noiseA[p * 4 + 3] = noiseB[p * 4 + 3] = 255;
  }
  assert.equal(ssim(noiseA, noiseA, w, h), 1, 'ssim of identical input is 1');
  assert.ok(ssim(noiseA, noiseB, w, h) < 0.5, 'ssim of independent noise is < 0.5');
}

// ── keskinlik ───────────────────────────────────────────────────────────
{
  const w = 8, h = 8;
  const flat = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) { flat[p * 4] = flat[p * 4 + 1] = flat[p * 4 + 2] = 128; flat[p * 4 + 3] = 255; }
  const board = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = ((x + y) % 2) ? 255 : 0;
    const p = y * w + x;
    board[p * 4] = board[p * 4 + 1] = board[p * 4 + 2] = v; board[p * 4 + 3] = 255;
  }
  assert.equal(keskinlik(flat, w, h), 0, 'keskinlik of a flat image is 0');
  assert.ok(keskinlik(board, w, h) > keskinlik(flat, w, h), 'keskinlik of a checkerboard is higher than flat');
}

// ── kaplama ────────────────────────────────────────────────────────────
{
  const n = 4;
  const mk = (rgb) => { const a = new Uint8ClampedArray(n * 4); for (let p = 0; p < n; p++) { a[p*4]=rgb[0]; a[p*4+1]=rgb[1]; a[p*4+2]=rgb[2]; a[p*4+3]=255; } return a; };
  near(kaplama(mk([50, 50, 50]), mk([50, 50, 50])), 1, 'kaplama: T=0 (opaque) -> coverage 1');
  near(kaplama(mk([0, 0, 0]), mk([255, 255, 255])), 0, 'kaplama: T=1 (empty) -> coverage 0');
  {
    const siyah = new Uint8ClampedArray(n * 4), beyaz = new Uint8ClampedArray(n * 4);
    for (let p = 0; p < n; p++) {
      const opaque = p < n / 2;
      const s = opaque ? 50 : 0, b = opaque ? 50 : 255;
      siyah[p*4]=siyah[p*4+1]=siyah[p*4+2]=s; siyah[p*4+3]=255;
      beyaz[p*4]=beyaz[p*4+1]=beyaz[p*4+2]=b; beyaz[p*4+3]=255;
    }
    near(kaplama(siyah, beyaz), 0.5, 'kaplama: half opaque / half empty -> 0.5');
  }
}

// ── kullanilabilirMesafe ─────────────────────────────────────────────────
near(kullanilabilirMesafe([
  { d: 0, iyi: true }, { d: 0.02, iyi: true }, { d: 0.04, iyi: false }, { d: 0.06, iyi: true },
]), 0.02, 'kullanilabilirMesafe: stops at the gap');
near(kullanilabilirMesafe([{ d: 0, iyi: false }, { d: 0.02, iyi: true }]), 0, 'kullanilabilirMesafe: none good');
near(kullanilabilirMesafe([
  { d: 0, iyi: true }, { d: 0.02, iyi: true }, { d: 0.04, iyi: true },
]), 0.04, 'kullanilabilirMesafe: all good');

console.log('gezinme olcum: OK');
