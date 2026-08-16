// Yörünge/frustum overlay sözleşme testi (GPU gerekmez) — Gün 5, render şeridi.
//
// Bu testin varlık sebebi: D.2 kaydı KAMERA→DÜNYA'dır. Overlay yanlışlıkla
// tersini (camera_from_world) alırsa frustum'lar orijine göre AYNALANIR —
// sahnede "kameralar dışa bakıyor" diye görünür ama hiçbir sayı patlamaz.
// Burada frustum'un gerçekten hedefe baktığı geometrik olarak denetlenir.
//   node scripts/verify-overlay.mjs
import assert from 'node:assert/strict';
import { frustumCorners } from '../src/shaders/trajectoryOverlay.ts';
import {
  generateOrbitTrajectory,
  toFirstKeyframeOrigin,
} from '../src/engine/vision/trajectory.ts';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => { const n = norm(v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const TARGET = [0, 0, 0];
const ASPECT = 16 / 9;

// --- 1. tepe = kameranın DÜNYA konumu (t) ---
{
  const poses = generateOrbitTrajectory({ count: 8, target: TARGET });
  for (const p of poses) {
    const { apex } = frustumCorners(p, ASPECT);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(apex[i] - p.t[i]) < 1e-9, `frustum tepesi = t bileşen ${i}`);
    }
  }
}

// --- 2. YÖN: frustum ekseni hedefe DOĞRU bakar (aynalanmamış) ---
// Taban merkezinin tepeden farkı = bakış yönü. Kayıt kamera→dünya olduğu için
// bu yön (target − t)'nin birim hâline eşit olmalı. Overlay tersini alsaydı
// işaret dönerdi ve bu test patlardı.
{
  const poses = generateOrbitTrajectory({ count: 10, target: TARGET });
  for (const p of poses) {
    const { apex, base } = frustumCorners(p, ASPECT);
    const c = [0, 1, 2].map((k) => base.reduce((s, b) => s + b[k], 0) / 4);
    const axis = unit(sub(c, apex));
    const want = unit(sub(TARGET, p.t));
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(axis[i] - want[i]) < 1e-6, `frustum ekseni hedefe dönük, bileşen ${i}`);
    }
    // Ek güvence: hedef, tepeden bakıldığında ÖNDE (pozitif izdüşüm).
    assert.ok(dot(sub(TARGET, apex), axis) > 0, 'hedef frustum önünde');
  }
}

// --- 3. ÖLÇÜ: taban yarı-yükseklik = tan(fovY/2)·derinlik, genişlik = ·aspect ---
{
  const [p] = generateOrbitTrajectory({ count: 1, arc: 0, rise: 0, target: TARGET });
  const depth = 0.35; // frustumCorners varsayılanı
  const { apex, base } = frustumCorners(p, ASPECT, depth);
  const c = [0, 1, 2].map((k) => base.reduce((s, b) => s + b[k], 0) / 4);
  // Tepe → taban merkezi mesafesi tam `depth` olmalı.
  assert.ok(Math.abs(norm(sub(c, apex)) - depth) < 1e-9, 'taban merkezi tam `depth` uzakta');
  const halfH = Math.tan(p.fovY / 2) * depth;
  const halfW = halfH * ASPECT;
  // base[0]=(-w,-h) base[1]=(+w,-h) base[2]=(+w,+h) base[3]=(-w,+h)
  const wEdge = norm(sub(base[1], base[0])) / 2;
  const hEdge = norm(sub(base[2], base[1])) / 2;
  assert.ok(Math.abs(wEdge - halfW) < 1e-9, `yarı genişlik = tan(fovY/2)·d·aspect (${wEdge} vs ${halfW})`);
  assert.ok(Math.abs(hEdge - halfH) < 1e-9, `yarı yükseklik = tan(fovY/2)·d (${hEdge} vs ${halfH})`);
  // Dikdörtgen: köşegenler eşit, kenarlar dik.
  assert.ok(
    Math.abs(norm(sub(base[2], base[0])) - norm(sub(base[3], base[1]))) < 1e-9,
    'taban dikdörtgen (köşegenler eşit)',
  );
  assert.ok(Math.abs(dot(sub(base[1], base[0]), sub(base[2], base[1]))) < 1e-9, 'taban kenarları dik');
}

// --- 4. RİJİTLİK: frustum kameranın dönmesiyle birlikte döner, deforme olmaz ---
// Tüm pozlarda taban kenar uzunlukları AYNI olmalı (yalnızca konum/yönelim
// değişir). Ölçek ya da dönme yanlış uygulanırsa burada kayar.
{
  const poses = toFirstKeyframeOrigin(generateOrbitTrajectory({ count: 12, target: TARGET }));
  let w0 = null;
  let h0 = null;
  for (const p of poses) {
    const { base } = frustumCorners(p, ASPECT);
    const w = norm(sub(base[1], base[0]));
    const h = norm(sub(base[2], base[1]));
    if (w0 === null) { w0 = w; h0 = h; }
    assert.ok(Math.abs(w - w0) < 1e-9, `taban genişliği tüm keyframe'lerde sabit (${w} vs ${w0})`);
    assert.ok(Math.abs(h - h0) < 1e-9, `taban yüksekliği sabit (${h} vs ${h0})`);
  }
}

// --- 5. YUKARI YÖNÜ: frustum'un +y kenarı dünya yukarısına bakmalı ---
// Yörünge yatay düzlemde ve worldUp = +y olduğu için, taban üst kenarının
// orta noktası alt kenarınkinden DAHA YÜKSEKTE olmalı. Taban köşe sırası
// (dolayısıyla sarım) bozulursa bu patlar.
{
  const poses = generateOrbitTrajectory({ count: 8, rise: 0, target: TARGET });
  for (const p of poses) {
    const { base } = frustumCorners(p, ASPECT);
    const bottomY = (base[0][1] + base[1][1]) / 2;
    const topY = (base[2][1] + base[3][1]) / 2;
    assert.ok(topY > bottomY, `frustum üst kenarı daha yüksekte (${topY} > ${bottomY})`);
  }
}

// --- 6. DEJENERE GİRDİ: sıfır fovY ve boş liste çökmez ---
{
  const [p] = generateOrbitTrajectory({ count: 1, arc: 0, rise: 0 });
  const zero = frustumCorners({ ...p, fovY: 0 }, ASPECT);
  for (const b of zero.base) {
    for (const v of b) assert.ok(Number.isFinite(v), 'fovY = 0 → sonlu köşe (NaN yok)');
  }
  // fovY = 0 → taban tek noktaya çöker, tepeden `depth` uzakta.
  assert.ok(Math.abs(norm(sub(zero.base[0], zero.base[2]))) < 1e-12, 'fovY = 0 → taban noktaya çöker');
}

// --- 7. SAĞ EL / EL DEĞİŞTİRME: taban çerçevesi ayna DEĞİL ---
// right × up, bakış yönünün TERSİ (backward) olmalı — kamera −z'ye baktığı
// için. Ayna bir dönüşüm (det = −1) bu çarpımın işaretini çevirir.
{
  const poses = generateOrbitTrajectory({ count: 6, target: TARGET });
  for (const p of poses) {
    const { apex, base } = frustumCorners(p, ASPECT);
    const right = unit(sub(base[1], base[0]));
    const up = unit(sub(base[2], base[1]));
    const c = [0, 1, 2].map((k) => base.reduce((s, b) => s + b[k], 0) / 4);
    const forward = unit(sub(c, apex));
    const rxu = cross(right, up);
    // right × up = -forward (backward)
    assert.ok(dot(rxu, forward) < -0.999, `sağ el çerçevesi korunur (dot = ${dot(rxu, forward)})`);
  }
}

console.log(
  'OK · yörünge/frustum overlay (tepe = t, eksen hedefe dönük [kamera→dünya, aynalanmamış], tan(fovY/2) ölçüsü, rijitlik, yukarı yönü, dejenere fovY, sağ el çerçevesi)',
);
