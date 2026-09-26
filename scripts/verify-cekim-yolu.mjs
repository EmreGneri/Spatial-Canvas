// Capture shape (orbit / forward path / mixed) and the along-the-path camera — no GPU.
import assert from 'node:assert/strict';
import { cekimTuru, yolKamerasi, flySiniri, flyStep, YOL_PAY } from '../src/ui/egitimControls.ts';
import { yolKlipKamerasi } from '../src/ui/klipRender.ts';
import { kameraMerkezi } from '../src/engine/reconstruction/egitim3dgs.ts';

const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);
const up = [0, -1, 0]; // COLMAP: y down
const intr = { f: 500, cx: 320, cy: 240, w: 640, h: 480 };
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Camera at C looking along f, level horizon. */
function poz(C, f) {
  const z = norm(f), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
  const R = [...x, ...y, ...z];
  return { ...intr, R, t: [0, 1, 2].map((i) => -(R[i * 3] * C[0] + R[i * 3 + 1] * C[1] + R[i * 3 + 2] * C[2])) };
}
const rng = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5; })();

// ── classifier ─────────────────────────────────────────────────────────────
// St George style: 100° arc of radius 5 around the origin, always facing it.
const orbit = Array.from({ length: 40 }, (_, i) => {
  const a = (-50 + (100 * i) / 39) * Math.PI / 180;
  const C = [5 * Math.sin(a), 0, -5 * Math.cos(a)];
  return poz(C, C.map((v) => -v));
});
assert.equal(cekimTuru(orbit, [0, 0, 0]), 'yorunge', 'arc around a subject');
// Forest style: handheld forward walk, 16 m, bobbing and glancing ±10°.
const walk = Array.from({ length: 40 }, (_, i) => {
  const yaw = rng() * 0.35;
  return poz([rng() * 0.1, rng() * 0.1, (16 * i) / 39], [Math.sin(yaw), rng() * 0.1, Math.cos(yaw)]);
});
const ahead = [0, 0, 20];
assert.equal(cekimTuru(walk, ahead), 'yol', 'forward walk');
assert.equal(cekimTuru([...walk].reverse(), ahead), 'yol', 'walking backwards is still a path');
// Crab walk at 45° to the view: neither.
const diag = Array.from({ length: 30 }, (_, i) => poz([i * 0.3, 0, i * 0.3], [0, 0, 1]));
assert.equal(cekimTuru(diag, ahead), 'karma', 'diagonal dolly');
// Too few cameras or a camera that only turns in place: keep the orbit default.
assert.equal(cekimTuru(walk.slice(0, 2), ahead), 'yorunge', 'two cameras');
assert.equal(cekimTuru(Array.from({ length: 10 }, (_, i) => poz([0, 0, 0], [Math.sin(i / 5), 0, Math.cos(i / 5)])), ahead), 'yorunge', 'pan in place');
// Standing still with ~3 cm fore/aft body sway, subject 2 m ahead: sway is
// aligned with the view, but it is no path to walk.
const sway = Array.from({ length: 40 }, (_, i) => poz([rng() * 0.02, rng() * 0.02, 0.03 * Math.sin(i / 3) + rng() * 0.01], [rng() * 0.05, 0, 1]));
assert.equal(cekimTuru(sway, [0, 0, 2]), 'yorunge', 'standing sway');
// Exactly 3 cameras: a real walk is a path, a sway is not.
assert.equal(cekimTuru([0, 1, 2].map((z) => poz([0, 0, z], [0, 0, 1])), [0, 0, 10]), 'yol', '3-camera walk');
assert.equal(cekimTuru(sway.slice(0, 3), [0, 0, 2]), 'yorunge', '3-camera sway');
// SfM has arbitrary world units and origin: the scene-relative guard must
// keep the same answer after uniformly scaling and translating both inputs.
for (const scale of [0.001, 1000]) {
  const transform = (v) => v.map((x, i) => scale * (x + [3, -7, 11][i]));
  for (const [poses, pivot, expected] of [[sway, [0, 0, 2], 'yorunge'], [walk, ahead, 'yol']]) {
    const moved = poses.map((p) => poz(transform(kameraMerkezi(p)), p.R.slice(6)));
    assert.equal(cekimTuru(moved, transform(pivot)), expected, `scene scale ${scale}`);
  }
}

// ── path camera ────────────────────────────────────────────────────────────
const line = Array.from({ length: 41 }, (_, i) => poz([0, 0, i * 0.25], [0.2 * (i % 2 ? 1 : -1), 0, 1]));
const at = (s) => yolKamerasi(line, up, s);
const zAt = (s) => kameraMerkezi(at(s))[2];
assert.ok(zAt(0) < 1 && zAt(1) > 9, `spans the path (${zAt(0)}..${zAt(1)})`);
near(zAt(0.5), 5, 'arc-length midpoint', 1e-3);
for (let i = 1; i <= 20; i++) assert.ok(zAt(i / 20) > zAt((i - 1) / 20), 'moves forward monotonically');
for (const s of [0, 0.3, 0.77, 1]) {
  const k = at(s);
  // Glancing left/right every frame is smoothed out: it looks along the path.
  assert.ok(k.R[8] > 0.99, `looks along the path at ${s} (${k.R[8]})`);
  near(k.R[0] * up[0] + k.R[1] * up[1] + k.R[2] * up[2], 0, 'level horizon');
  assert.ok(-(k.R[3] * up[0] + k.R[4] * up[1] + k.R[5] * up[2]) > 0, 'upright');
  assert.equal(k.f, intr.f, 'keeps the training intrinsics');
}
// A path that turns right: the view turns with it.
const turn = Array.from({ length: 40 }, (_, i) => {
  const a = (i / 39) * Math.PI / 2;
  return poz([10 - 10 * Math.cos(a), 0, 10 * Math.sin(a)], [Math.sin(a), 0, Math.cos(a)]);
});
assert.ok(yolKamerasi(turn, up, 0.05).R[8] > 0.9 && yolKamerasi(turn, up, 0.95).R[6] > 0.9, 'view follows the bend');

// ── clip along the path ───────────────────────────────────────────────────
const olcek = flySiniri(line.map(kameraMerkezi), [0, 0, 100], 'yol').olcek;
const clipZ = (t, tur = 'yok') => kameraMerkezi(yolKlipKamerasi(line, up, olcek, tur, t))[2];
// Ping-pong: out to the end of the path at t=0.5 and back, eased turnarounds,
// so a looping share video has no seam (frame n == frame 0).
near(clipZ(0), zAt(0), 'clip starts at the start of the path');
near(clipZ(0.5), zAt(1), 'clip reaches the end of the path at t=0.5');
for (let i = 1; i <= 120; i++) assert.ok(clipZ(i / 240) >= clipZ((i - 1) / 240), 'first half walks forward');
for (let i = 0; i <= 240; i++) near(clipZ(i / 240), clipZ(1 - i / 240), 'symmetric out and back', 1e-9);
const P = (t) => yolKlipKamerasi(line, up, olcek, 'yok', t);
const d = (a, b) => Math.hypot(...kameraMerkezi(a).map((v, i) => v - kameraMerkezi(b)[i])) + Math.hypot(...a.R.map((v, i) => v - b.R[i]));
let maxStep = 0;
for (let i = 1; i < 240; i++) maxStep = Math.max(maxStep, d(P(i / 240), P((i - 1) / 240)));
assert.ok(d(P(239 / 240), P(0)) <= maxStep, 'loop seam (last -> first frame) is no bigger than any other step');
assert.ok(d(P(1), P(0)) < 1e-9, 'frame n == frame 0');
for (const tur of ['yana', 'yukari', 'kubbe', 'gurultu']) {
  assert.ok(d(yolKlipKamerasi(line, up, olcek, tur, 1), P(0)) < 1e-9, `${tur}: loop returns to the undeformed opening pose`);
}
for (let i = 0; i < 240; i++) assert.ok(P(i / 240).R[8] > 0.99, 'look stays along the path, also walking back (no spin)');
assert.deepEqual(P(0.3).R, at((1 - Math.cos(2 * Math.PI * 0.3)) / 2).R, 'no deform: exactly the path pose');
// Dome rises and pulls back at its peak, but starts/ends on the path.
const kubbe = kameraMerkezi(yolKlipKamerasi(line, up, olcek, 'kubbe', 0.5));
assert.ok(kubbe[1] < -1, `dome view rises (${kubbe[1]})`);
near(kameraMerkezi(yolKlipKamerasi(line, up, olcek, 'kubbe', 0))[1], kameraMerkezi(at(0))[1], 'dome starts on the path');

// ── fly bound hugs the path ────────────────────────────────────────────────
const cams = line.map(kameraMerkezi);
const yol = flySiniri(cams, [0, 0, 5], 'yol');
near(yol.pay, YOL_PAY * 10, 'margin is a fraction of the path length');
near(yol.olcek, 10 / 4, 'speed scale follows the path length');
const k0 = poz([0, 0, 5], [0, 0, 1]);
const pos = (k) => kameraMerkezi(k);
near(pos(flyStep(k0, { forward: 0, right: 1, vertical: 0 }, 5, yol, up))[0], YOL_PAY * 10, 'sideways: stops at the margin');
// Old fan bound (cameras + pivot 5 ahead) would have let this sideways step through more.
near(pos(flyStep(k0, { forward: 1, right: 0, vertical: 0 }, 2, yol, up))[2], 7, 'forward along the path is free (no pivot taper)');
near(pos(flyStep(poz([0, 0, 9.5], [0, 0, 1]), { forward: 1, right: 0, vertical: 0 }, 5, yol, up))[2], 10 + YOL_PAY * 10, 'end of the path: margin');
// Orbit captures keep the old fan bound bit for bit.
assert.deepEqual(flySiniri(cams, [0, 0, 5]), flySiniri(cams, [0, 0, 5], 'yorunge'));

console.log('capture shape + path camera: OK');
