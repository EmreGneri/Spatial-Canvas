import assert from 'node:assert/strict';
import {
  KLIP_FPS, derecele, kadrajKamerasi, kameraYolu, kareSayisi, klipBoyutu, klipDeformu, klipKamerasi,
  klipKareleri, klipKodlayici, klipTepeGucu, tonEgrisi, vinyetMaskesi, yayOrtasi, yumusak, zarf,
} from '../src/ui/klipRender.ts';
import { kameraMerkezi, yorunge } from '../src/engine/reconstruction/egitim3dgs.ts';

const yakin = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} != ${b}`);

// ── zaman çizelgesi ───────────────────────────────────────────────────────
assert.equal(kareSayisi(8, 30), 240);
assert.equal(KLIP_FPS, 30);
yakin(yumusak(0), 0); yakin(yumusak(1), 1); yakin(yumusak(0.5), 0.5);
yakin(yumusak(-3), 0); yakin(yumusak(7), 1);
// Ease: slope 0 at both ends, monotonic.
assert.ok(yumusak(0.01) < 0.001 && 1 - yumusak(0.99) < 0.001);
for (let i = 1; i <= 100; i++) assert.ok(yumusak(i / 100) >= yumusak((i - 1) / 100));
// Envelope: 0 at t=0 and t→1 (loop closure), held at 1 in the middle.
yakin(zarf(0), 0);
assert.ok(zarf(1 - 1 / 240) < 1e-3, 'envelope must return to ~0 at the last frame');
yakin(zarf(0.5), 1);
yakin(zarf(0.4), 1);
for (let i = 0; i < 240; i++) {
  const t = i / 240;
  yakin(zarf(t), zarf(1 - t), 1e-12, 'envelope symmetric');
}

// Deform per frame: strength = peak · envelope; noise time = t (period 1).
for (const tur of ['yana', 'yukari', 'kubbe', 'gurultu']) {
  const d0 = klipDeformu(tur, klipTepeGucu(tur, 0), 0);
  assert.equal(d0.strength, 0, `${tur}: frame 0 is the trained state`);
}
assert.deepEqual(klipDeformu('yukari', 0.6, 0.5), { kind: 'bend', strength: 0.6, direction: 'yukari' });
assert.deepEqual(klipDeformu('kubbe', 1, 0.5), { kind: 'dome', strength: 0.6 });
const g = klipDeformu('gurultu', 0.7, 0.5);
assert.equal(g.kind, 'noise'); yakin(g.strength, 0.7); yakin(g.time, 0.5);
// Noise peak defaults to 0.7 and is capped at 0.8 (full strength moves the statue).
yakin(klipTepeGucu('gurultu', 0), 0.7);
yakin(klipTepeGucu('gurultu', 1), 0.8);
yakin(klipTepeGucu('gurultu', -1), -0.8);
yakin(klipTepeGucu('gurultu', 0.5), 0.5);
yakin(klipTepeGucu('kubbe', 0), 1);
yakin(klipTepeGucu('yukari', 0), 0.6);
yakin(klipTepeGucu('yana', -0.3), -0.3);

// Camera path: loops (frame n == frame 0), dome rises ~40° and pulls back 3× at peak.
for (const tur of ['yana', 'yukari', 'kubbe', 'gurultu']) {
  const a = kameraYolu(tur, 0, 0.4), b = kameraYolu(tur, 1, 0.4);
  yakin(a.yaw, 0); yakin(a.pitch, 0); yakin(a.uzaklik, 1);
  yakin(b.yaw, 0, 1e-9); yakin(b.pitch, 0, 1e-9); yakin(b.uzaklik, 1, 1e-9);
  for (let i = 0; i < 240; i++) assert.ok(Math.abs(kameraYolu(tur, i / 240, 0.4).yaw) <= 0.4 + 1e-12);
}
const tepe = kameraYolu('kubbe', 0.5, 0.4);
yakin(tepe.pitch, -0.7); yakin(tepe.uzaklik, 3);
assert.ok(Math.abs(kameraYolu('gurultu', 0.5, 0.4).pitch) < 0.7);

// ── kamera: yay ortası + kadraj ───────────────────────────────────────────
const up = [0, -1, 0];
const pivot = [0, 0, 0];
const home = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 2], f: 500, cx: 480, cy: 270, w: 960, h: 540 };
// Cameras on a 100° arc starting at the home camera (C = (0,0,-2)).
const arc = [];
for (let i = 0; i <= 10; i++) arc.push(kameraMerkezi(yorunge(home, pivot, up, (i / 10) * (100 * Math.PI / 180), 0)));
const orta = yayOrtasi(arc, pivot, up);
yakin(orta.aci, 50 * Math.PI / 180, 1e-9, 'arc middle');
yakin(orta.salinim, 25 * Math.PI / 180, 1e-9, 'swing = half of the half-span');
// Reversed capture order gives the same middle relative to the same reference;
// from the other arc end the middle is the same point, reached the other way.
yakin(yayOrtasi([...arc].reverse(), pivot, up, arc[0]).aci, orta.aci, 1e-9);
yakin(yayOrtasi([...arc].reverse(), pivot, up).aci, -orta.aci, 1e-9);
// Rotating the reference by `aci` lands on the arc middle camera.
const ortaKam = kameraMerkezi(yorunge(home, pivot, up, orta.aci, 0));
arc[5].forEach((v, i) => yakin(ortaKam[i], v, 1e-9, 'middle camera'));

// klipKamerasi: identity step keeps the base camera; distance scales from the pivot.
const k0 = klipKamerasi(home, pivot, up, { yaw: 0, pitch: 0, uzaklik: 1 });
for (let i = 0; i < 9; i++) yakin(k0.R[i], home.R[i]);
const k3 = klipKamerasi(home, pivot, up, { yaw: 0.3, pitch: -0.7, uzaklik: 3 });
yakin(Math.hypot(...kameraMerkezi(k3)), 6, 1e-9, 'pulled back 3×');
// Pitch -0.7 raises the camera above the pivot plane (up = -y).
assert.ok(kameraMerkezi(k3)[1] < -1, 'camera elevated');

assert.deepEqual(klipBoyutu('16:9'), { w: 1920, h: 1080 });
assert.deepEqual(klipBoyutu('9:16'), { w: 1080, h: 1920 });
// Same aspect: pure scale (same view, sharper).
const k169 = kadrajKamerasi(home, 1920, 1080);
yakin(k169.f, 1000); yakin(k169.cx, 960); yakin(k169.cy, 540);
assert.equal(k169.w, 1920); assert.equal(k169.h, 1080);
// 9:16: the short side keeps its field of view (subject same size), the
// principal-point offset scales with it and is re-centred.
const off = { ...home, cx: 490, cy: 260, fy: 510 };
const k916 = kadrajKamerasi(off, 1080, 1920);
yakin(k916.f, 1000); yakin(k916.fy, 1020); yakin(k916.cx, 540 + 20); yakin(k916.cy, 960 - 20);
assert.equal(k916.w, 1080); assert.equal(k916.h, 1920);
assert.deepEqual(k916.R, off.R); assert.deepEqual(k916.t, off.t);

// ── renk derecelendirme + vinyet ──────────────────────────────────────────
// Black stays black (dimmed floaters are never lifted), white stays ~white,
// shadows never lift, curve is monotonic.
yakin(tonEgrisi(0, 0.25), 0); yakin(tonEgrisi(1, 0.25), 1);
for (let i = 1; i <= 255; i++) assert.ok(tonEgrisi(i / 255, 0.25) >= tonEgrisi((i - 1) / 255, 0.25));
for (let i = 0; i <= 64; i++) assert.ok(tonEgrisi(i / 255, 0.25) <= i / 255 + 1e-12, 'shadows never lift');
const w = 64, h = 36;
const maske = vinyetMaskesi(w, h, 0.8);
assert.equal(maske.length, w * h);
const m = (x, y) => maske[y * w + x];
assert.ok(m(32, 18) > 0.999, 'centre untouched');
assert.ok(m(0, 0) < 0.35, 'corners dark');
yakin(m(0, 0), m(w - 1, h - 1), 1e-6); yakin(m(0, 0), m(w - 1, 0), 1e-6); // symmetric
for (let x = 32; x < w; x++) assert.ok(m(x, 18) <= m(x - 1, 18) + 1e-7, 'darkens outward');

const px = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < w * h; i++) px.set([128, 128, 128, 255], i * 4);
px.set([0, 0, 0, 255], (18 * w + 10) * 4);   // a black pixel
px.set([20, 18, 16, 255], (18 * w + 20) * 4); // a dim floater
const dim = px.slice((18 * w + 20) * 4, (18 * w + 20) * 4 + 3);
const d = { kontrast: 0.25, doygunluk: 1.1, sicaklik: 0.04 };
derecele(px, maske, d);
assert.deepEqual([...px.slice((18 * w + 10) * 4, (18 * w + 10) * 4 + 4)], [0, 0, 0, 255], 'black stays black');
for (let c = 0; c < 3; c++) assert.ok(px[(18 * w + 20) * 4 + c] <= dim[c], 'dim floater not lifted');
assert.ok(px[(18 * w + 32) * 4] > px[(18 * w + 32) * 4 + 2], 'warm: red above blue at mid grey');
assert.ok(px[0] < 50, 'corner vignetted');
assert.equal(px[3], 255, 'alpha untouched');

// ── kodlayıcı seçimi ──────────────────────────────────────────────────────
assert.deepEqual(await klipKodlayici(async (c) => c === 'avc' || c === 'vp9'), { kap: 'mp4', codec: 'avc' });
assert.deepEqual(await klipKodlayici(async (c) => c === 'vp9'), { kap: 'webm', codec: 'vp9' });
await assert.rejects(klipKodlayici(async () => false), /kodlayıcı/);

// ── orkestra: sıralı çağrı, iptal ve hata sonrası tam geri yükleme ────────
function sahteOturum(hataKare = -1) {
  const log = [];
  let pending = false;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const guard = async (entry) => {
    if (pending) throw new Error('overlap');
    pending = true; log.push(entry); await tick(); pending = false;
  };
  return {
    log,
    oturum: { deform: (s) => guard(['deform', s]), fade: (on) => guard(['fade', on]) },
    kare: async (i, t) => { if (pending) throw new Error('overlap'); log.push(['kare', i, t]); if (i === hataKare) throw new Error('boom'); },
  };
}
const onceki = { deform: { kind: 'bend', strength: 0.25, direction: 'yana' }, fade: false };
{
  const s = sahteOturum();
  await klipKareleri(s.oturum, 'yukari', 0.6, 10, onceki, s.kare);
  const kareler = s.log.filter((e) => e[0] === 'kare');
  assert.equal(kareler.length, 10);
  assert.deepEqual(kareler.map((e) => e[2]), [...Array(10).keys()].map((i) => i / 10));
  assert.deepEqual(s.log[0], ['fade', true], 'fade on by default in the clip');
  // Every frame is preceded by the deform that matches it (or an unchanged one).
  let son = null;
  for (const e of s.log.slice(1, -2)) {
    if (e[0] === 'deform') son = e[1];
    else assert.deepEqual(son, klipDeformu('yukari', 0.6, e[2]));
  }
  assert.deepEqual(s.log.slice(-2), [['deform', onceki.deform], ['fade', false]], 'restore previous settings');
  // Held peak frames do not re-deform.
  assert.ok(s.log.filter((e) => e[0] === 'deform').length < 10 + 1);
}
{
  const s = sahteOturum(4);
  await assert.rejects(klipKareleri(s.oturum, 'gurultu', 0.7, 10, { deform: onceki.deform, fade: true }, s.kare), /boom/);
  assert.deepEqual(s.log.slice(-2), [['deform', onceki.deform], ['fade', true]], 'restore after error');
}
{
  const s = sahteOturum();
  const ac = new AbortController();
  const kare = async (i, t) => { await s.kare(i, t); if (i === 2) ac.abort(); };
  await assert.rejects(klipKareleri(s.oturum, 'kubbe', 1, 10, onceki, kare, ac.signal), { name: 'AbortError' });
  assert.equal(s.log.filter((e) => e[0] === 'kare').length, 3);
  assert.deepEqual(s.log.slice(-2), [['deform', onceki.deform], ['fade', false]], 'restore after cancel');
}

console.log('verify-klip-render: OK');
