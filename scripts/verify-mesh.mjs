// mesh.ts sözleşme testi (GPU gerekmez, saf CPU) — Gün B: kapalı kabuk.
// Köşe ızgarası + front/back üçgenleme + sınır duvar şeridi; su geçirmezlik
// yönlü kenar sayımıyla doğrulanır (her kenar her iki yönde TAM BİR kez).
// Gün C eklemeleri: dikey hiza (flip regresyonu), DIŞA yönlü sarım, köşe
// normalleri ve kabuk kimliği (shell).
//   node scripts/verify-mesh.mjs
import assert from 'node:assert/strict';
import {
  buildShellMesh,
  MESH_GRID_SIZE,
  MESH_MIN_WALL_Z,
} from '../src/engine/reconstruction/mesh.ts';
import { EDGE_WALL_Z } from '../src/engine/reconstruction/sampler.ts';
import { buildSilhouette } from '../src/engine/reconstruction/silhouette.ts';
import { ANATOMIC_DEPTH_RATIO, computeBodyGeometry } from '../src/engine/reconstruction/sampler.ts';

const N = MESH_GRID_SIZE;
const W = 64;
const H = 64;

// --- 1. boyut güvenliği (sampler stili, sessiz sapma yok) ---
assert.throws(
  () => buildShellMesh(new Float32Array(15), 4, 4),
  RangeError,
  'depth boyut uyumsuz → RangeError',
);
assert.throws(
  () => buildShellMesh(new Float32Array(16), 4, 4, { foregroundMask: new Float32Array(15) }),
  RangeError,
  'fgMask boyut uyumsuz → RangeError',
);
// Uyumlu boyutlar hata üretmez.
buildShellMesh(new Float32Array(16), 4, 4, { gridSize: 8 });

// --- 2. tam arka plan → null (siluet yok → kabuk yok) ---
assert.equal(buildShellMesh(new Float32Array(W * H).fill(0), W, H), null, 'd=0 → null');

// --- 3. düz 0.6 (tam kadraj ön plan): tüm köşeler içeride, z formülü ---
// K = (N+1)² köşe; her köşe F+B = 2K pozisyon. SİLÜET ORANLI z uzamı:
// tam kadraj siluet (64×64) → rx = ry = 0.984375 →
// zSpan = ANATOMIC_DEPTH_RATIO·2·min(rx,ry) = 0.7·2·0.984375 = 1.378125,
// zUnit = 0.6890625. `depthScale` (0.7) DEĞİŞMEDİ — zSpan `range`in YERİNE
// geçer, onun üstüne gelmez. Merkez köşe (u = v = 0.5 → R² = 0, w_fg(0.6) =
// 0.896):
//   z = (0.6−0.5)·1.378125·0.7 + 0.1·0.6890625·1·0.896
//     = 0.09646875 + 0.06174    = 0.15820875
// (kavis depthScale ile ölçeklenmez — Gün B kuralı; verify-sampler ile aynı
// yüzey kuralı, oradaki uzam ölçeği burada da geçerli.)
const flat = buildShellMesh(new Float32Array(W * H).fill(0.6), W, H) ?? assert.fail('flat null');
const S = N + 1;
assert.equal(flat.positions.length, S * S * 2 * 3, 'tüm köşeler içeride (2K pozisyon)');
assert.equal(flat.uvs.length, S * S * 2 * 2, 'uv boyutu 2K×2');
assert.equal(flat.normals.length, flat.positions.length, 'normal boyutu = pozisyon boyutu');
assert.equal(flat.shell.length, flat.positions.length / 3, 'shell köşe başına tek değer');
for (let t = 0; t < flat.indices.length; t++) {
  assert.ok(flat.indices[t] < flat.positions.length / 3, `index aralık içinde @${t}`);
}
// Köşe (0,0): dünya (−1, 1) ve uv (0, 1) — aUv sözleşmesi (v=1 üst,
// satır 0 = üst).
assert.ok(Math.abs(flat.positions[0] + 1) < 1e-6, 'köşe (0,0) x = −1');
assert.ok(Math.abs(flat.positions[1] - 1) < 1e-6, 'köşe (0,0) y = +1');
// Köşe (0,0): R² = 2 ≥ 1 → kavis YOK (verify-sampler test 7 ile aynı kural).
//   z = (0.6−0.5)·1.378125·0.7 = 0.09646875
assert.ok(Math.abs(flat.positions[2] - 0.09646875) < 1e-6, 'köşe (0,0) z = 0.09646875 (R² ≥ 1 → kavis yok)');
assert.ok(Math.abs(flat.uvs[0]) < 1e-6 && Math.abs(flat.uvs[1] - 1) < 1e-6, 'köşe (0,0) uv = (0, 1)');
const center = ((N / 2) * S + N / 2) * 2; // köşe (N/2, N/2) → k = ... → F index 2k
assert.ok(Math.abs(flat.positions[center * 3 + 2] - 0.15820875) < 1e-5, 'merkez köşe z = 0.15820875');
// depthScale=1: (0.6−0.5)·zSpan·1 + kavis = 0.1378125 + 0.06174 = 0.1995525.
const unscaled = buildShellMesh(new Float32Array(W * H).fill(0.6), W, H, { depthScale: 1 }) ?? assert.fail('unscaled null');
assert.ok(
  Math.abs(unscaled.positions[center * 3 + 2] - 0.1995525) < 1e-5,
  'depthScale 1 → ölçeksiz ekstrüzyon matematiği (0.1995525)',
);
// Back köşeleri duvar düzleminde: wallZ = EDGE_WALL_Z·zUnit
// = −0.8·0.6890625 = −0.55125 (z uzamı daraldığında duvar da daralır —
// yoksa kabuk yine kutuya döner).
assert.ok(
  Math.abs(flat.positions[center * 3 + 5] + 0.55125) < 1e-6,
  'back köşe z = EDGE_WALL_Z·zUnit (ölçekli duvar düzlemi)',
);
// z sözleşmesi: tüm köşeler [-1, +1], NaN yok.
for (let t = 2; t < flat.positions.length; t += 3) {
  assert.ok(Number.isFinite(flat.positions[t]), `z sınırlı @${t}`);
  assert.ok(flat.positions[t] >= -1 && flat.positions[t] <= 1, `z [-1,+1] @${t}`);
}
// uv sözleşmesi: [0,1]².
for (let t = 0; t < flat.uvs.length; t++) {
  assert.ok(flat.uvs[t] >= 0 && flat.uvs[t] <= 1, `uv [0,1] @${t}`);
}
// Normal + shell sözleşmesi (Gün C): front normali +z'ye bakar (dışa), back
// tam (0,0,−1); shell front 1 / back 0. Düz yüzeyde front normali tam (0,0,1).
for (let k = 0; k < flat.shell.length; k += 2) {
  assert.equal(flat.shell[k], 1, `front shell = 1 @${k}`);
  assert.equal(flat.shell[k + 1], 0, `back shell = 0 @${k}`);
  const o = k * 3;
  assert.ok(flat.normals[o + 2] > 0, `front normal +z @${k}`);
  assert.ok(Math.abs(flat.normals[o + 5] + 1) < 1e-6, `back normal = −z @${k}`);
}

// --- 4. SU GEÇİRMEZLİK (yönlü kenar sayımı): her kenar her iki yönde TAM
// BİR kez — kapalı, oriyente edilebilir yüzey. Sıfır genişlikli kıvrımlar
// (k=1/k=2 diyagonal) kenar üretmez; bu sahnelerde böyle hücre yoktur. ---
function census(mesh, label) {
  const key = (a, b) => a * 1000000 + b;
  const edgeKey = (a, b) => (a < b ? key(a, b) : key(b, a));
  const dir = new Map();
  const undir = new Map();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t];
    const b = mesh.indices[t + 1];
    const c = mesh.indices[t + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      dir.set(key(p, q), (dir.get(key(p, q)) ?? 0) + 1);
      undir.set(edgeKey(p, q), (undir.get(edgeKey(p, q)) ?? 0) + 1);
    }
  }
  const bad = [];
  for (const [dk, count] of dir) {
    const p = (dk / 1000000) | 0;
    const q = dk % 1000000;
    const rev = dir.get(key(q, p)) ?? 0;
    if (count !== 1 || rev !== 1) bad.push(`${p}→${q} (${count}/${rev})`);
  }
  assert.equal(bad.length, 0, `${label}: yönlü kenar dengesi (${bad.slice(0, 5).join(', ')})`);
  // Her yönsüz kenar tam 2 kez → her yüz kenarını paylaşıyor.
  for (const [uk, count] of undir) {
    assert.equal(count, 2, `${label}: kenar ${uk} 2 yüz tarafından (${count})`);
  }
}
census(flat, 'düz 0.6');

// --- 4b. YÖN (Gün C): ön yüz üçgenleri +z'den bakınca CCW olmalı, yani
// geometrik normalleri DIŞA (+z) bakar. Kapalı ve tutarlı yönlü yüzeyde tek
// üçgenin dışa bakması hepsinin dışa bakması demektir (material FrontSide
// çizer). Eski sarım içe dönüktü: computeVertexNormals normalleri ters
// veriyor, fragment'teki duvar sınıflaması ön yüzü komple duvar sayıyor ve
// fotoğraf dokusu yalnızca görünmeyen arka kapağa biniyordu. ---
function faceNormalZ(mesh, t) {
  const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
  const p = (i) => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
  const [ax, ay] = p(a);
  const [bx, by] = p(b);
  const [cx, cy] = p(c);
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}
// İlk üçgen bir FRONT üçgenidir (üçgenleme sırası: hücre başına önce front).
assert.ok(faceNormalZ(flat, 0) > 0, 'ön yüz sarımı CCW (+z), yani normali DIŞA bakar');
// Arka kapak ters yönde: ilk back üçgeni (front çiftinden sonraki üçgen).
assert.ok(faceNormalZ(flat, 6) < 0, 'arka kapak sarımı ters (normali −z)');

// --- 4c. DİKEY HİZA (Gün C regresyonu): fotoğrafın ÜST yarısı yakın (d=0.9),
// alt yarısı uzak (d=0.2) ise mesh'in ÜST köşeleri de öne çıkmalıdır. Bu test
// eskiden başarısız olurdu: köşe satırı `remap.yOf`/satır koordinatına v
// (alttan üste) veriliyordu, mesh dikey TERS kuruluyor ve doğru yönde boyanan
// fotoğraf dokusu ters geometriye biniyordu. ---
const vertical = new Float32Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) vertical[y * W + x] = y < H / 2 ? 0.9 : 0.2;
}
const vert = buildShellMesh(vertical, W, H, { curvature: 0, importanceSampling: false, gridSize: 32 })
  ?? assert.fail('vertical null');
let topZ = null;
let botZ = null;
let topY = -Infinity;
let botY = Infinity;
for (let k = 0; k < vert.positions.length; k += 6) {
  const x = vert.positions[k];
  const y = vert.positions[k + 1];
  if (Math.abs(x) > 1e-6) continue; // orta sütun
  if (y > topY) { topY = y; topZ = vert.positions[k + 2]; }
  if (y < botY) { botY = y; botZ = vert.positions[k + 2]; }
}
assert.ok(topZ !== null && botZ !== null, 'orta sütunda köşe bulundu');
assert.ok(topZ > botZ, `üst köşe öne çıkar (üst z=${topZ?.toFixed(3)} > alt z=${botZ?.toFixed(3)})`);

// --- 5. yarım düzlem (sol 0.4 / sağ 0.02), remap KAPALI: sınır bandı
// arkaya dökülür, siluet içi dokunulmaz, duvar güvencesi korunur ---
// Köşe sayısı: i ∈ 0..N/2 (N/2+1 sütun — köşe N/2, u=0.5 → xv=31.5, bilinear
// alpha eşiği TAM 0.5 → İÇERİDE) × j ∈ 0..N = S satır.
const halfDepth = new Float32Array(W * H).fill(0.02);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W / 2; x++) halfDepth[y * W + x] = 0.4;
}
const half = buildShellMesh(halfDepth, W, H, { curvature: 0, importanceSampling: false }) ?? assert.fail('half null');
const halfCols = N / 2 + 1;
assert.equal(half.positions.length, halfCols * S * 2 * 3, 'yarım düzlem köşe sayısı (N/2+1 sütun)');
// Köşe konumunu dünya koordinatından bul (sıralı index yalnızca TAM dolu
// ızgarada geçerli; seyrek sahnede 2K sıkıştırılmıştır).
function zAt(mesh, wx, wy) {
  for (let k = 0; k < mesh.positions.length; k += 6) {
    if (Math.abs(mesh.positions[k] - wx) < 1e-6 && Math.abs(mesh.positions[k + 1] - wy) < 1e-6) {
      return mesh.positions[k + 2];
    }
  }
  return undefined;
}
const wx_of = (i) => (i / N - 0.5) * 2;
const wy_of = (j) => (1 - j / N - 0.5) * 2;
// SİLÜET ORANLI uzam: siluet sol yarı → rx = 0.484375, ry = 0.984375 →
// zSpan = 0.7·2·0.484375 = 0.678125, zUnit = 0.3390625. Siluet içi
// (u = 0.375, v ortası): z = (0.4−0.5)·0.678125·0.7 = −0.04746875, döküm yok.
const iIn = (N * 3) / 8;
const jMid = N / 2;
assert.ok(Math.abs(zAt(half, wx_of(iIn), wy_of(jMid)) + 0.04746875) < 1e-5, 'iç köşe z = −0.04746875 (döküm yok)');
// Sınır bandı (u ≈ 0.5⁻): ince kabuk + döküm → arkaya çekilir ama ÖLÇEKLİ
// duvar güvencesinin (minWallZ = MESH_MIN_WALL_Z·zUnit = −0.78·0.3390625
// = −0.26446875) altına inemez.
const zB = zAt(half, wx_of(N / 2 - 1), wy_of(jMid));
assert.ok(typeof zB === 'number' && zB < -0.005, `sınır bandı → arkaya döküldü (z = ${zB?.toFixed(6)})`);
assert.ok(zB >= -0.26446875, `duvar güvencesi: z ≥ −0.26446875 (z = ${zB?.toFixed(6)})`);
census(half, 'yarım düzlem');

// --- 6. maske-aware: fg maske sol yarı → yalnızca sol köşeler + kavis
// formülü remap'siz tamlanır; remap açıkken su geçirmezlik korunur ---
const flat60 = new Float32Array(W * H).fill(0.6);
const fg = new Float32Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W / 2; x++) fg[y * W + x] = 1;
}
// (a) remap KAPALI — köşe ızgarası görüntüyle 1:1 hizalı.
const maskedNoRemap = buildShellMesh(flat60, W, H, { curvature: 0.1, foregroundMask: fg, importanceSampling: false }) ?? assert.fail('masked noremap null');
assert.equal(maskedNoRemap.positions.length, halfCols * S * 2 * 3, 'maske remap\'siz → N/2+1 sütun köşesi');
let maxX = -Infinity;
for (let t = 0; t < maskedNoRemap.positions.length; t += 6) {
  if (maskedNoRemap.positions[t] > maxX) maxX = maskedNoRemap.positions[t];
}
assert.ok(maxX <= 0, `maske 0 bölgede köşe yok (max x = ${maxX.toFixed(4)})`);
// Maskeli siluet de sol yarıdır → zSpan = 0.678125, zUnit = 0.3390625.
// Sol-orta köşe (u = 0.25, v ortası): R² = 0.25 → kavis katsayısı
// √0.75 = 0.8660254.
//   z = (0.6−0.5)·0.678125·0.7 + 0.1·0.3390625·0.8660254·0.896
//     = 0.04746875 + 0.02630985 = 0.0737786
const iQuarter = N / 4;
assert.ok(
  Math.abs(zAt(maskedNoRemap, wx_of(iQuarter), wy_of(jMid)) - 0.0737786) < 1e-4,
  `maskeli köşe z = 0.0737786 (gerçek: ${zAt(maskedNoRemap, wx_of(iQuarter), wy_of(jMid)).toFixed(6)})`,
);
census(maskedNoRemap, 'maske sol yarı (remap kapalı)');
// (b) remap AÇIK — örnekleme yoğunluğu ön plana kayar (parçacık paritesi);
// köşe sayısı farklıdır, su geçirmezlik + z sözleşmesi korunmalı.
const masked = buildShellMesh(flat60, W, H, { curvature: 0.1, foregroundMask: fg }) ?? assert.fail('masked null');
census(masked, 'maske sol yarı (remap açık)');
assert.ok(masked.positions.length / 6 > halfCols * S, `remap açıkken ön plana yoğunlaşma (K = ${masked.positions.length / 6})`);
for (let t = 2; t < masked.positions.length; t += 6) {
  assert.ok(Number.isFinite(masked.positions[t]), `remap z sınırlı @${t}`);
  assert.ok(masked.positions[t] >= -1 && masked.positions[t] <= 1, `remap z [-1,+1] @${t}`);
}
// Normaller birim uzunlukta (fragment normalize etse de sözleşme budur).
for (let k = 0; k < masked.normals.length; k += 3) {
  const len = Math.hypot(masked.normals[k], masked.normals[k + 1], masked.normals[k + 2]);
  assert.ok(Math.abs(len - 1) < 1e-5, `normal birim uzunlukta @${k} (${len})`);
}
// Duvar şeridi var: toplam üçgen > front+back (4·iç hücre).
assert.ok(
  masked.indices.length / 3 > (halfCols - 2) * N * 4 + 500,
  'sınır duvar şeridi üretildi (front+back dışında üçgenler var)',
);

// --- 7. determinizm: aynı girdi → birebir aynı çıktı ---
const again = buildShellMesh(flat60, W, H, { curvature: 0.1, foregroundMask: fg }) ?? assert.fail('determinizm null');
assert.equal(JSON.stringify(again.positions), JSON.stringify(masked.positions), 'deterministik positions');
assert.equal(JSON.stringify(again.uvs), JSON.stringify(masked.uvs), 'deterministik uvs');
assert.equal(JSON.stringify(again.normals), JSON.stringify(masked.normals), 'deterministik normals');
assert.equal(JSON.stringify(again.indices), JSON.stringify(masked.indices), 'deterministik indices');

// --- 8. KADRAJ DEĞİŞMEZLİĞİ (Gün E bulgu 4) — DİKEY kadrajda kabuğun z
// uzamı sampler.ts ile AYNI formülle genişlemeli:
//   zSpan = ANATOMIC_DEPTH_RATIO · 2 · min(rx, ry) / frameShortHalf
// frameShortHalf = min(halfW, halfH) — dünya genişliği (w/h)·halfH'tir, yani
// dikey kadrajda 1'in altına iner ve bölensiz formül özneyi SIĞ çiziyordu
// (mesh.ts:171, sampler.ts:255-257'nin birebir aynası — solid mod parçacık
// yüzeyinden ayrılıyordu). Kare/yatay kadrajda bölen 1'dir → davranış aynen. ---
{
  const PW = 32;
  const PH = 64; // dikey 0.5
  const halfH = 1; // DEFAULT_WORLD_HEIGHT / 2 (grup 3'ün sabitleriyle tutarlı)
  const portraitDepth = new Float32Array(PW * PH).fill(0.6);
  const sil = buildSilhouette(portraitDepth, PW, PH, null);
  const body = computeBodyGeometry(sil.alpha, PW, PH, halfH);
  assert.ok(body, 'dikey siluet boş — senaryo bozuk');
  const fsh = Math.min((PW / PH) * halfH, halfH);
  const zSpanExp = (ANATOMIC_DEPTH_RATIO * 2 * Math.min(body.rx, body.ry)) / fsh;
  const portrait = buildShellMesh(portraitDepth, PW, PH, {
    curvature: 0,
    importanceSampling: false,
    gridSize: 32,
  }) ?? assert.fail('portrait null');
  const zMid = zAt(portrait, 0, 0); // dünya merkezi köşesi (i = j = N/2)
  assert.ok(typeof zMid === 'number', 'merkez köşe bulunamadı — senaryo bozuk');
  // kavis 0 → z = (0.6 − 0.5)·zSpan·depthScale(0.7) → zSpan = z / 0.07
  console.log(`[8] dikey kadraj zSpan: mesh ${(zMid / 0.07).toFixed(4)} vs sampler formülü ${zSpanExp.toFixed(4)} (frameShortHalf ${fsh})`);
  assert.ok(
    Math.abs(zMid - 0.1 * zSpanExp * 0.7) < 1e-4,
    `dikey kadrajda kabuk zSpan sampler'dan sapıyor: mesh ${(zMid / 0.07).toFixed(4)}, beklenen ${zSpanExp.toFixed(4)}`,
  );
}

console.log('OK · kapalı kabuk mesh (köşe ızgarası + front/back + duvar şeridi, su geçirmezlik, DIŞA yönlü sarım, dikey hiza, köşe normalleri + shell, z/uv sözleşmesi, maske + remap hizası, determinizm)');
