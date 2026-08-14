// Sentetik yörünge üreteci sözleşme testi (GPU gerekmez) — Gün 4, render şeridi.
// Emre'nin Gün 5 poz çözücüsü BU dosyanın çıktısına karşı ölçülecek; üreteç
// yanlışsa çözücünün hatası ona yazılır. Bu yüzden burada D.2 sözleşmesinin
// HER maddesi ayrı ayrı denetlenir.
//   node scripts/verify-trajectory.mjs
import assert from 'node:assert/strict';
import {
  DEFAULT_FOV_Y,
  generateOrbitTrajectory,
  generatePointCloudScene,
  projectScene,
  quatToMatrix,
  toFirstKeyframeOrigin,
} from '../src/engine/vision/trajectory.ts';

const norm = (v) => Math.hypot(...v);

// --- 1. D.2 kayıt şeması + birim quaternion ---
{
  const poses = generateOrbitTrajectory({ count: 12 });
  assert.equal(poses.length, 12, 'keyframe sayısı');
  for (const p of poses) {
    for (const k of ['id', 'R', 't', 'timeMs', 'scaleA', 'scaleB', 'fovY']) {
      assert.ok(k in p, `D.2 alanı var: ${k}`);
    }
    assert.equal(p.R.length, 4, 'R quaternion xyzw');
    assert.ok(Math.abs(norm(p.R) - 1) < 1e-6, `quaternion birim (${norm(p.R)})`);
    assert.equal(p.fovY, DEFAULT_FOV_Y, 'D.3 varsayılan fovY (60° dikey)');
    // Sentetik veri metriktir: hizalama KİMLİKTİR, çözücü bunu geri bulmalı.
    assert.equal(p.scaleA, 1, 'scaleA = 1 (metrik doğruluk verisi)');
    assert.equal(p.scaleB, 0, 'scaleB = 0');
  }
  // id'ler 0'dan artan.
  poses.forEach((p, i) => assert.equal(p.id, i, 'id sırası'));
  // timeMs monoton artan.
  for (let i = 1; i < poses.length; i++) {
    assert.ok(poses[i].timeMs > poses[i - 1].timeMs, 'timeMs monoton');
  }
}

// --- 2. R DÖNME MATRİSİDİR: ortonormal + det = +1 (sağ el) ---
{
  const poses = generateOrbitTrajectory({ count: 9 });
  for (const p of poses) {
    const m = quatToMatrix(p.R);
    const col = (i) => [m[i], m[i + 3], m[i + 6]];
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(norm(col(i)) - 1) < 1e-6, `kolon ${i} birim`);
    }
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    assert.ok(Math.abs(dot(col(0), col(1))) < 1e-6, 'kolonlar dik (0,1)');
    assert.ok(Math.abs(dot(col(0), col(2))) < 1e-6, 'kolonlar dik (0,2)');
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
    assert.ok(Math.abs(det - 1) < 1e-6, `det(R) = +1 (sağ el), alınan ${det}`);
  }
}

// --- 3. YÖN SÖZLEŞMESİ: R kamera→dünya, kamera −z'ye bakar ---
// Kameranın dünya bakış yönü = R · (0,0,−1). Hedef orijinse bu yön
// (target − eye)'nin birim hâline EŞİT olmalıdır. Yön ters kurulmuşsa
// (camera_from_world) bu test patlar — D.2'nin en kritik maddesi.
{
  const target = [0, 0, 0];
  const poses = generateOrbitTrajectory({ count: 10, target });
  for (const p of poses) {
    const m = quatToMatrix(p.R);
    const fwd = [-m[2], -m[5], -m[8]]; // R · (0,0,−1)
    const want = [target[0] - p.t[0], target[1] - p.t[1], target[2] - p.t[2]];
    const wl = norm(want);
    for (let i = 0; i < 3; i++) {
      assert.ok(
        Math.abs(fwd[i] - want[i] / wl) < 1e-5,
        `bakış yönü hedefe dönük (kamera→dünya) bileşen ${i}`,
      );
    }
  }
}

// --- 4. yörünge geometrisi: yay + dikey salınım (saf daire DEĞİL) ---
{
  const radius = 2.5;
  const poses = generateOrbitTrajectory({ count: 16, radius, rise: 0.35 });
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poses) {
    const planar = Math.hypot(p.t[0], p.t[2]);
    assert.ok(Math.abs(planar - radius) < 1e-6, `yatay yarıçap sabit (${planar})`);
    minY = Math.min(minY, p.t[1]);
    maxY = Math.max(maxY, p.t[1]);
  }
  assert.ok(maxY - minY > 0.3, `dikey salınım var (${(maxY - minY).toFixed(3)} m) — dejenere düzlem değil`);
  // Determinizm.
  const again = generateOrbitTrajectory({ count: 16, radius, rise: 0.35 });
  assert.deepEqual(again, poses, 'yörünge deterministik');
}

// --- 5. D.2: DÜNYA ORİJİNİ = İLK KEYFRAME ---
{
  const raw = generateOrbitTrajectory({ count: 8 });
  const framed = toFirstKeyframeOrigin(raw);
  assert.ok(Math.abs(norm(framed[0].t)) < 1e-6, 'ilk keyframe t = 0');
  const q0 = framed[0].R;
  assert.ok(
    Math.abs(Math.abs(q0[3]) - 1) < 1e-6 && Math.hypot(q0[0], q0[1], q0[2]) < 1e-6,
    'ilk keyframe R = identity',
  );
  // Yeniden çerçeveleme RİJİTTİR: keyframe'ler arası mesafeler korunmalı.
  for (let i = 1; i < raw.length; i++) {
    const dRaw = Math.hypot(
      raw[i].t[0] - raw[i - 1].t[0],
      raw[i].t[1] - raw[i - 1].t[1],
      raw[i].t[2] - raw[i - 1].t[2],
    );
    const dNew = Math.hypot(
      framed[i].t[0] - framed[i - 1].t[0],
      framed[i].t[1] - framed[i - 1].t[1],
      framed[i].t[2] - framed[i - 1].t[2],
    );
    assert.ok(Math.abs(dRaw - dNew) < 1e-5, `komşu mesafe korunur @${i} (${dRaw} vs ${dNew})`);
  }
  // Boş girdi çökmez.
  assert.deepEqual(toFirstKeyframeOrigin([]), [], 'boş yörünge → boş');
}

// --- 6. sahne + izdüşüm: pinhole doğruluğu ---
{
  const scene = generatePointCloudScene(400);
  assert.equal(scene.length, 1200, 'sahne 3 float/nokta');
  const again = generatePointCloudScene(400);
  assert.deepEqual(Array.from(again), Array.from(scene), 'sahne deterministik');
  // Düzlemsel DEĞİL: üç eksende de yayılım olmalı (essential matrix dejenere olmasın).
  for (let axis = 0; axis < 3; axis++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < scene.length / 3; i++) {
      const v = scene[i * 3 + axis];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    assert.ok(hi - lo > 1, `sahne ${axis}. eksende yayılıyor (${(hi - lo).toFixed(2)})`);
  }

  const poses = toFirstKeyframeOrigin(generateOrbitTrajectory({ count: 6 }));
  const W = 640;
  const H = 360;
  const frames = projectScene(poses, scene, W, H);
  assert.equal(frames.length, poses.length, 'kare başına bir izdüşüm seti');
  let anyVisible = 0;
  for (const f of frames) {
    for (let i = 0; i < f.visible.length; i++) {
      if (!f.visible[i]) continue;
      anyVisible++;
      assert.ok(f.x[i] >= 0 && f.x[i] < W, 'görünür nokta kadraj içinde (x)');
      assert.ok(f.y[i] >= 0 && f.y[i] < H, 'görünür nokta kadraj içinde (y)');
    }
  }
  assert.ok(anyVisible > frames.length * 20, `her karede yeterli gözlem var (${anyVisible} toplam)`);

  // İZDÜŞÜM DOĞRULUĞU: merkeze bakan kamerada, hedef noktası tam ekran
  // merkezine düşer. (0,0,0)'ı sahneye ekleyip test ediyoruz.
  const one = new Float32Array([0, 0, 0]);
  const at = generateOrbitTrajectory({ count: 1, radius: 3, arc: 0, rise: 0 });
  const p = projectScene(at, one, W, H)[0];
  assert.equal(p.visible[0], 1, 'hedef nokta görünür');
  assert.ok(Math.abs(p.x[0] - W / 2) < 1e-3, `hedef ekran merkezinde (x = ${p.x[0]})`);
  assert.ok(Math.abs(p.y[0] - H / 2) < 1e-3, `hedef ekran merkezinde (y = ${p.y[0]})`);

  // KAMERA ARKASI: kameranın gerisindeki nokta NaN + visible = 0 (sessiz
  // yanlış izdüşüm yerine açık işaret — çözücü bunu ayıklayabilsin).
  const behind = new Float32Array([0, 0, 10]); // kamera z = +3, −z'ye bakıyor
  const pb = projectScene(at, behind, W, H)[0];
  assert.equal(pb.visible[0], 0, 'kamera arkası nokta görünmez');
  assert.ok(Number.isNaN(pb.x[0]), 'kamera arkası x = NaN');
}

// --- 7. gürültü: deterministik ve ölçülen büyüklükte ---
{
  const scene = generatePointCloudScene(300);
  const poses = toFirstKeyframeOrigin(generateOrbitTrajectory({ count: 4 }));
  const clean = projectScene(poses, scene, 640, 360, 0);
  const noisy = projectScene(poses, scene, 640, 360, 1.5);
  const noisy2 = projectScene(poses, scene, 640, 360, 1.5);
  let sum = 0;
  let n = 0;
  for (let f = 0; f < clean.length; f++) {
    for (let i = 0; i < clean[f].x.length; i++) {
      if (!clean[f].visible[i] || !noisy[f].visible[i]) continue;
      sum += Math.hypot(noisy[f].x[i] - clean[f].x[i], noisy[f].y[i] - clean[f].y[i]);
      n++;
      assert.equal(noisy[f].x[i], noisy2[f].x[i], 'gürültü deterministik');
    }
  }
  const mean = sum / n;
  console.log(`izdüşüm gürültüsü: σ = 1.5 px istendi, ölçülen ortalama sapma ${mean.toFixed(3)} px (${n} gözlem)`);
  // Rayleigh dağılımı: 2B gauss'un ortalama büyüklüğü σ·√(π/2) ≈ 1.253·σ.
  assert.ok(Math.abs(mean - 1.5 * Math.sqrt(Math.PI / 2)) < 0.25, 'gürültü büyüklüğü Rayleigh beklentisinde');
}

console.log(
  'OK · sentetik yörünge (D.2 şeması, birim quaternion, det(R) = +1, kamera→dünya yön sözleşmesi, ilk-keyframe orijini rijit, pinhole izdüşüm merkez doğrulaması, kamera arkası NaN, deterministik gürültü)',
);
