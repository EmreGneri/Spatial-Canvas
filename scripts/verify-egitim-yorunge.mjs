// 3DGS eğitim görüntüleyicisinin yörünge kamerası — GPU YOK.
// Değişmez: pivot etrafında katı dönüşte pivotun KAMERA koordinatı sabit
// kalır (ekranda aynı yerde durur), pivota uzaklık korunur, R ortonormal kalır.
import assert from 'node:assert/strict';
import { yorunge, kameraMerkezi, medyanNokta, kameraOlcekle, bakisMerkezi } from '../src/engine/reconstruction/egitim3dgs.ts';

const yakin = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);
const kam = (R, P) => [0, 1, 2].map((i) => R[i * 3] * P[0] + R[i * 3 + 1] * P[1] + R[i * 3 + 2] * P[2]);

// C = (1, -2, -5), R = I (kamera +z'ye bakar) → t = −R·C
const k0 = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [-1, 2, 5], f: 500, cx: 320, cy: 240, w: 640, h: 480 };
const P = [0.3, 0.1, 0.7];
const up = [0, -1, 0];

const C0 = kameraMerkezi(k0);
[1, -2, -5].forEach((v, i) => yakin(C0[i], v, 'kamera merkezi -R^T t'));

const pivotKam = (k) => kam(k.R, P).map((v, i) => v + k.t[i]);
const once = pivotKam(k0);
const mesafe = (k) => Math.hypot(...kameraMerkezi(k).map((v, i) => v - P[i]));

let k = k0;
for (const [yaw, pitch] of [[0.4, 0], [0, 0.3], [-1.1, -0.2], [2.5, 0.6]]) {
  k = yorunge(k, P, up, yaw, pitch);
  const sonra = pivotKam(k);
  once.forEach((v, i) => yakin(sonra[i], v, `pivot ekranda sabit (yaw ${yaw}, pitch ${pitch})`));
  yakin(mesafe(k), mesafe(k0), 'pivota uzaklik korunur');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const d = k.R[i * 3] * k.R[j * 3] + k.R[i * 3 + 1] * k.R[j * 3 + 1] + k.R[i * 3 + 2] * k.R[j * 3 + 2];
    yakin(d, i === j ? 1 : 0, 'R ortonormal');
  }
}
console.log('[1] yorunge: pivot sabit, uzaklik korunur, R ortonormal ✓');

const yarim = yorunge(k0, P, up, 0, 0, 0.5);
yakin(mesafe(yarim), mesafe(k0) / 2, 'yakinlas 0.5 uzakligi yariya indirir');
console.log('[2] yakinlasma ✓');

// Yaw yukari ekseni etrafında: kameranın yukari eksenine göre yüksekliği değişmez.
const yuk = (kk) => { const c = kameraMerkezi(kk); return -(c[1] - P[1]); };
yakin(yuk(yorunge(k0, P, up, 1.3, 0)), yuk(k0), 'saf yaw yuksekligi korur');
console.log('[3] saf yaw yukseklik korur ✓');

const m = medyanNokta([[0, 0, 0], [1, 1, 1], [2, 2, 2], [1e6, -1e6, 1e6]]);
assert.deepEqual(m, [2, 1, 2], 'medyan aykiri noktaya dayanikli');
const o = kameraOlcekle(k0, 2);
assert.equal(o.w, 1280); assert.equal(o.f, 1000); assert.equal(o.cx, 640);
console.log('[4] medyan + olcekleme ✓');

// Bakis merkezi: 100 derecelik yayda (video gibi) Q noktasina bakan kameralar.
const Q = [2, -1, 7];
const yay = [];
for (let i = 0; i < 12; i++) {
  const a = (-50 + (100 * i) / 11) * (Math.PI / 180);
  const C = [Q[0] + 6 * Math.sin(a), Q[1], Q[2] - 6 * Math.cos(a)];
  const z = [Q[0] - C[0], Q[1] - C[1], Q[2] - C[2]].map((v) => v / 6); // bakis
  const x = [Math.cos(a), 0, Math.sin(a)];                               // sag
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]; // asagi
  const R = [...x, ...y, ...z];
  yay.push({ R, t: kam(R, C).map((v) => -v) });
}
const pv = bakisMerkezi(yay, [99, 99, 99]);
Q.forEach((v, i) => yakin(pv[i], v, 'yay kameralari bakis noktasini bulur', 1e-6));
const paralel = [0, 1, 2, 3].map((i) => ({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [-i, 0, 0] }));
assert.deepEqual(bakisMerkezi(paralel, [9, 8, 7]), [9, 8, 7], 'paralel eksenler yedege duser');
console.log('[5] bakis merkezi: yayda hedef bulunur, paralelde yedek ✓');
console.log('OK egitim yorunge kamerasi');
