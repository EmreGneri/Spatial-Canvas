// E4.2 (Emre) — NORMAL KALİTESİ: analitik yüzeylerde normal doğruluğu.
//
// İki üretici yol da Gün C'den beri var; bu betik onları ANALİTİK yüzeylerle
// ölçer (planın E4.2 kabulü):
//   - splats.fillGaussiansFromPointCloud: komşu texel z farkından (merkezi
//     fark) normal — küre (üst yarı) ve eğik düzlemle sınanır; beklenen
//     normal yüzeyin analitik gradyanıdır.
//   - mesh.buildShellMesh: z alanı eğiminden köşe normali (ön yüz
//     (−dz/dx, dz/dy, 1), arka kapak (0,0,−1)) — düz ve eğik düzlemle;
//     beklenen normal, positions dizisinin KENDİSİNDEN çapraz çarpımla
//     türetilir (geometrik yüzey normali — z-alanı türevinden bağımsız
//     ikinci bir yol, tesadüfi uyumu önler).
//
// Kabul: ortalama açı hatası < 5°, birim uzunluk ±1e-5, NaN yok.
// GPU gerekmez: node scripts/verify-normals.mjs
import assert from 'node:assert/strict';
// splats.ts uzantısız içe aktarma kullanıyor ('./buffers') — Vite için doğru,
// Node için değil. verify-preset.mjs'teki kalıp: loader ÖNCE kaydedilir, src
// modülleri sonra dinamik import ile yüklenir.
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);

const { createGaussianTextures, fillGaussiansFromPointCloud } = await import(
  '../src/engine/splats.ts'
);
const { buildShellMesh } = await import('../src/engine/reconstruction/mesh.ts');

const angleDeg = (a, b) =>
  (180 / Math.PI) * Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

// ---------------------------------------------------------------------------
// 1. SPLATS — ANALİTİK KÜRE (üst yarı). Beklenen normal = (x, y, z)/R.
//    Test bölgesi |n_z| ≥ 0.6 ile sınırlı: stabilizedNormal eğim tavanı
//    (NORMAL_MIN_NZ = 0.38) ekvatora yakın kırpma yapar — o bölge kasıtlı
//    olarak DIŞINDA bırakılır (tavan görüntü kararı değil, türetme tavanı).
// ---------------------------------------------------------------------------
{
  const g = 64;
  const R = 1.2;
  const home = new Float32Array(g * g * 4);
  // Gerçek home sözleşmesi: grid satırı j artarken dünya y AZALIR.
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const x = (i / (g - 1) - 0.5) * 2;
      const y = -(j / (g - 1) - 0.5) * 2;
      const o = (j * g + i) * 4;
      home[o] = x;
      home[o + 1] = y;
      const r2 = x * x + y * y;
      home[o + 2] = r2 < R * R ? Math.sqrt(R * R - r2) : 0;
      home[o + 3] = 1;
    }
  }
  const tex = createGaussianTextures(g);
  const count = fillGaussiansFromPointCloud(tex, home, null, g);
  assert.equal(count, g * g, 'splat sayısı grid² olmalı');
  const B = tex.b.image.data;
  let sum = 0;
  let n = 0;
  for (let j = 2; j < g - 2; j++) {
    for (let i = 2; i < g - 2; i++) {
      const x = (i / (g - 1) - 0.5) * 2;
      const y = -(j / (g - 1) - 0.5) * 2;
      const r2 = x * x + y * y;
      if (r2 > 0.64 * R * R) continue; // ekvatora yakın — kırpma bölgesi
      const z = Math.sqrt(R * R - r2);
      const o = (j * g + i) * 4;
      const nb = [B[o], B[o + 1], B[o + 2]];
      assert.ok(nb.every(Number.isFinite), `NaN normal @(${i},${j})`);
      const len = Math.hypot(nb[0], nb[1], nb[2]);
      assert.ok(Math.abs(len - 1) < 1e-5, `birim uzunluk @(${i},${j}): ${len}`);
      sum += angleDeg(nb, [x / R, y / R, z / R]);
      n++;
    }
  }
  const mean = sum / n;
  console.log(`[1] splat küre (${n} texel): ortalama açı hatası ${mean.toFixed(3)}° (kabul <5°)`);
  assert.ok(mean < 5, `küre normal açı hatası ${mean.toFixed(3)}° ≥ 5°`);
}

// ---------------------------------------------------------------------------
// 2. SPLATS — EĞİK DÜZLEM: z = 0.4·x + 0.3·y + 0.5. Beklenen normal
//    normalize(−0.4, −0.3, 1) — eğim ~26.6° < 68° (tavan kırpması tetiklenmez).
//    Tüm texeller test bölgesidir.
// ---------------------------------------------------------------------------
{
  const g = 64;
  const A = 0.4;
  const B = 0.3;
  const home = new Float32Array(g * g * 4);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const x = (i / (g - 1) - 0.5) * 2;
      const y = -(j / (g - 1) - 0.5) * 2;
      const o = (j * g + i) * 4;
      home[o] = x;
      home[o + 1] = y;
      home[o + 2] = A * x + B * y + 0.5;
      home[o + 3] = 1;
    }
  }
  const tex = createGaussianTextures(g);
  fillGaussiansFromPointCloud(tex, home, null, g);
  const Buf = tex.b.image.data;
  const exp = [(-A / Math.hypot(A, B, 1)), (-B / Math.hypot(A, B, 1)), 1 / Math.hypot(A, B, 1)];
  let sum = 0;
  let n = 0;
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const o = (j * g + i) * 4;
      const nb = [Buf[o], Buf[o + 1], Buf[o + 2]];
      assert.ok(nb.every(Number.isFinite), `NaN normal @(${i},${j})`);
      const len = Math.hypot(nb[0], nb[1], nb[2]);
      assert.ok(Math.abs(len - 1) < 1e-5, `birim uzunluk @(${i},${j}): ${len}`);
      sum += angleDeg(nb, exp);
      n++;
    }
  }
  const mean = sum / n;
  console.log(`[2] splat eğik düzlem (${n} texel): ortalama açı hatası ${mean.toFixed(3)}° (kabul <5°)`);
  assert.ok(mean < 5, `düzlem normal açı hatası ${mean.toFixed(3)}° ≥ 5°`);
}

// ---------------------------------------------------------------------------
// 3. MESH — DÜZ DÜZLEM (sabit derinlik 0.8): ön yüz normalleri (0,0,1),
//    arka kapak normalleri (0,0,−1). Z alanı düz → eğim sıfır → normal tam
//    eksenel olmalı (duvar kelepçesi tetiklenmemeli: z = 0.3·zSpan·0.7 >
//    MESH_MIN_WALL_Z·zUnit = 0.11·zSpan ✓).
// ---------------------------------------------------------------------------
{
  const w = 96;
  const h = 96;
  const N = 48;
  const depth = new Float32Array(w * h).fill(0.8);
  const mesh = buildShellMesh(depth, w, h, { gridSize: N, importanceSampling: false, curvature: 0 });
  assert.ok(mesh, 'buildShellMesh null döndü (siluet boş?)');
  const S = N + 1;
  let nFront = 0;
  let nBack = 0;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const k = j * S + i; // siluet tam çerçeve → her köşe içeride, sıra birebir
      const o = k * 6;
      const f = [mesh.normals[o], mesh.normals[o + 1], mesh.normals[o + 2]];
      const b = [mesh.normals[o + 3], mesh.normals[o + 4], mesh.normals[o + 5]];
      assert.ok(f.every(Number.isFinite) && b.every(Number.isFinite), `NaN normal @(${i},${j})`);
      assert.ok(Math.abs(Math.hypot(...f) - 1) < 1e-5, `ön yüz birim değil @(${i},${j})`);
      assert.ok(Math.abs(Math.hypot(...b) - 1) < 1e-5, `arka kapak birim değil @(${i},${j})`);
      nFront += angleDeg(f, [0, 0, 1]);
      nBack += angleDeg(b, [0, 0, -1]);
    }
  }
  const mf = nFront / (S * S);
  const mb = nBack / (S * S);
  console.log(`[3] mesh düz düzlem (${S * S} köşe): ön yüz ${mf.toFixed(3)}° · arka kapak ${mb.toFixed(3)}° (kabul <5°)`);
  assert.ok(mf < 5, `düz ön yüz normali ${mf.toFixed(3)}° sapıyor`);
  assert.ok(mb < 5, `arka kapak normali ${mb.toFixed(3)}° sapıyor`);
}

// ---------------------------------------------------------------------------
// 4. MESH — EĞİK DÜZLEM: depth(x) = 0.75 + 0.1·(x/w) → z doğrusal, eğim
//    sabit. Beklenen normal POSITIONS'tan çapraz çarpımla türetilir (mesh'in
//    z-alanı türevinden BAĞIMSIZ ikinci yol). Test bölgesi kadraj içi
//    (i,j ∈ [14, 33]): kenar dökümü (fill) ve duvar kelepçesi oraya
//    ulaşmaz (d1 ≈ 0.245 dünya birimi ≈ 11.8 grid adımı; bölge 14+ adım
//    içeride; z alt sınırı 0.175·zSpan > 0.11·zSpan kelepçesi ✓).
// ---------------------------------------------------------------------------
{
  const w = 96;
  const h = 96;
  const N = 48;
  const depth = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) depth[y * w + x] = 0.75 + 0.1 * (x / w);
  }
  const mesh = buildShellMesh(depth, w, h, { gridSize: N, importanceSampling: false, curvature: 0 });
  assert.ok(mesh, 'buildShellMesh null döndü');
  const S = N + 1;
  // Komşu dünya adımları (grid düzenli — buildShellMesh'in stepX/stepY'si).
  const stepX = 2 / N;
  const stepY = 2 / N;
  const vert = (j, i) => {
    const o = (j * S + i) * 6;
    return [mesh.positions[o], mesh.positions[o + 1], mesh.positions[o + 2]];
  };
  let sum = 0;
  let n = 0;
  let nzNeg = 0;
  for (let j = 14; j <= 33; j++) {
    for (let i = 14; i <= 33; i++) {
      const p0 = vert(j, i);
      const px = vert(j, i + 1);
      const py = vert(j + 1, i); // j artarken dünya y azalır
      const vx = [px[0] - p0[0], px[1] - p0[1], px[2] - p0[2]];
      const vy = [py[0] - p0[0], py[1] - p0[1], py[2] - p0[2]];
      // cross(vx, vy) −z'ye bakar (vy'nin dünya yönü negatif) → +z'ye çevir.
      let gx = vx[1] * vy[2] - vx[2] * vy[1];
      let gy = vx[2] * vy[0] - vx[0] * vy[2];
      let gz = vx[0] * vy[1] - vx[1] * vy[0];
      if (gz < 0) {
        gx = -gx;
        gy = -gy;
        gz = -gz;
      }
      const gl = Math.hypot(gx, gy, gz) || 1;
      const geom = [gx / gl, gy / gl, gz / gl];
      const k = j * S + i;
      const o = k * 6;
      const stored = [mesh.normals[o], mesh.normals[o + 1], mesh.normals[o + 2]];
      assert.ok(stored.every(Number.isFinite), `NaN normal @(${i},${j})`);
      assert.ok(Math.abs(Math.hypot(...stored) - 1) < 1e-5, `birim değil @(${i},${j})`);
      assert.ok(stored[2] > 0, `ön yüz normali +z'ye bakmalı @(${i},${j})`);
      if (stored[2] <= 0) nzNeg++;
      // Analitik işaret: depth x ile artıyor → z artıyor → n_x = −dz/dx < 0.
      assert.ok(stored[0] < 0, `eğik düzlem n_x negatif olmalı @(${i},${j})`);
      sum += angleDeg(stored, geom);
      n++;
    }
  }
  const mean = sum / n;
  console.log(`[4] mesh eğik düzlem (${n} köşe): geometrik normalden ortalama sapma ${mean.toFixed(3)}° (kabul <5°)`);
  assert.ok(mean < 5, `mesh eğik düzlem normal sapması ${mean.toFixed(3)}° ≥ 5°`);
  assert.ok(Math.abs(stepX * 48 - 2) < 1e-9 && Math.abs(stepY * 48 - 2) < 1e-9, 'komşu adım tutarsız');
}

console.log('OK normal kalitesi — analitik küre + eğik düzlem (E4.2)');