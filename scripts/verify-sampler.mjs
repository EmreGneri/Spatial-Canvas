// sampler.ts sözleşme testi (GPU gerekmez, saf CPU).
// 1:1 kesintisiz grid + geometrik siluet (delik doldurma, gradyan kesme,
// bileşen birleştirme, satır boşluk dolgusu) + kenar dökümü + evrensel kavis
// + iki seviyeli opaklık (Tur 11: 1 ön plan, BACKDROP_OPACITY arka plan —
// ölü texel YOKTUR, fg+bg tek buffer)
// + nesne maskesi AND (arka plan hiçbir geometri kuralıyla diriltilemez)
// + bilinear yeniden örnekleme
// + TUR 10: ince kabuk (thin shell −0.05 Z), maske dilate + tüy
//   (dilateAndFeatherMask)
// + TUR 11: arka plan noktaları gerçek derinlikte BACKDROP_Z_PIN arkada;
//   sampleImageGrid (fotoğraf RGB'si konumlarla aynı grid/remap eşlemesi).
//   node scripts/verify-sampler.mjs
import assert from 'node:assert/strict';
import {
  BACKDROP_OPACITY,
  EDGE_WALL_Z,
  sampleImageGrid,
  sampleVolumePositions,
} from '../src/engine/reconstruction/sampler.ts';
import {
  buildSilhouette,
  dilateAndFeatherMask,
  resampleBilinear,
} from '../src/engine/reconstruction/silhouette.ts';

const N = 384;
const total = N * N;
const W = 64;
const H = 64;
const at = (xyz, i, j) => {
  const o = (j * N + i) * 4;
  return { x: xyz[o], y: xyz[o + 1], z: xyz[o + 2], w: xyz[o + 3] };
};
const wAt = (xyz, i, j) => at(xyz, i, j).w;

// --- 1. 1:1 kesintisiz grid: her texel kendi grid konumunda ---
// 64×64 kaynak → aspect 1 → halfW = 1. u = (i+0.5)/N, v = 1−(j+0.5)/N.
const xyz = sampleVolumePositions(new Float32Array(W * H).fill(0.5), W, H);
assert.equal(xyz.length, total * 4, 'N×4 çıktı (xyz + opaklık)');
for (const [i, j] of [[0, 0], [N - 1, N - 1], [N >> 1, N >> 1], [N - 1, 0], [0, N - 1]]) {
  const p = at(xyz, i, j);
  assert.ok(Math.abs(p.x - ((i + 0.5) / N - 0.5) * 2) < 1e-6, `x grid sürekliliği @(${i},${j})`);
  assert.ok(Math.abs(p.y - (1 - (j + 0.5) / N - 0.5) * 2) < 1e-6, `y grid sürekliliği @(${i},${j})`);
}
// Satır sürekliliği: komşu sütunlar aynı x'i paylaşamaz (1:1 eşleme, sökme yok).
for (let j = 0; j < N; j += 97) {
  for (let i = 0; i < N - 1; i += 97) {
    assert.ok(at(xyz, i + 1, j).x > at(xyz, i, j).x, 'komşu sütun x monoton artmalı');
  }
}

// --- 2. düz depth: tam arka plan → TÜM GRİD ARKA PLAN; tam ön plan → +1 ---
// Tur 11: maske = 0 texel ÖLÜ DEĞİLDİR — gerçek arka plan derinliğinde
// BACKDROP_Z_PIN arkada BACKDROP_OPACITY ile nokta taşır (tek buffer).
// Kadraj (grid) kenarı sınır DEĞİLDİR: çerçeveyi dolduran ön plan hiçbir
// yerde dökülmez (kare prizma duvarı oluşmaz) — köşeler ve kenarlar düz
// kalır, döküm yalnızca gerçek arka plana komşu siluet sınırında çalışır
// (test 6).
const flat0 = sampleVolumePositions(new Float32Array(W * H).fill(0), W, H);
for (let k = 0; k < flat0.length; k += 4) {
  assert.ok(
    Math.abs(flat0[k + 3] - BACKDROP_OPACITY) < 1e-6,
    'düz d=0 → tüm grid arka plan (w = BACKDROP_OPACITY)',
  );
  assert.equal(flat0[k + 2], -1, 'düz d=0 → arka plan z = −1 (sabit arka sınır, kırpıldı)');
}
const flat1 = sampleVolumePositions(new Float32Array(W * H).fill(1), W, H);
assert.equal(at(flat1, N >> 1, N >> 1).z, 1, 'dolu merkez → z = +1 (döküm yok)');
assert.equal(at(flat1, 0, 0).z, 1, 'kadraj köşesi → DÜZ (kenar sınır değil, döküm yok)');
assert.equal(at(flat1, 32, N >> 1).z, 1, 'grid kenarına bitişik → düz kalır (duvar yok)');
// Radyal sönümleme YOK: bbox içi (kafa üstü, köşeler) asla α'dan delinmez.
assert.equal(wAt(flat1, 0, 0), 1, 'köşe → w = 1 (radyal delme yok)');
assert.equal(wAt(flat1, N >> 1, 0), 1, 'üst sınır → w = 1 (radyal delme yok)');
assert.equal(wAt(flat1, N - 1, 0), 1, 'üst-sağ köşe → w = 1 (radyal delme yok)');

// --- 3. üst yarısı yakın (1), alt yarısı uzak (0): y-flip, z yönü, opaklık ---
const depth = new Float32Array(W * H);
for (let row = 0; row < H / 2; row++) depth.fill(1, row * W, (row + 1) * W); // satır 0 = üst
const half = sampleVolumePositions(depth, W, H);
assert.equal(at(half, N >> 1, N >> 2).z, 1, 'üst yarı içi (z = +1)');
const topEdge = at(half, N >> 1, 0).z; // ≈ 1.0: kadraj sınırı döküm sönümlü (kare duvar yok)
assert.ok(topEdge > 0.9 && topEdge <= 1, 'üst kadraj sınırı → kenar sönümlü (prizma duvarı yok)');
assert.equal(at(half, N >> 1, N - 1).z, -1, 'alt satır (uzak) → arka plan z = −1 (d = 0, kırpıldı)');
assert.equal(wAt(half, N >> 1, N >> 2), 1, 'üst yarı → w = 1');
assert.ok(
  Math.abs(wAt(half, N >> 1, N - 1) - BACKDROP_OPACITY) < 1e-6,
  'alt yarı → w = BACKDROP_OPACITY (arka plan)',
);
for (let k = 2; k < half.length; k += 4) {
  assert.ok(Number.isFinite(half[k]), 'NaN/Infinity sızmaz');
  assert.ok(half[k] >= -1 && half[k] <= 1, 'z [-1,+1] sınırlarında');
}

// --- 4. delik doldurma: siluet İÇİNDEKİ koyu bölge α = 0 yapılmaz ---
// Flat 0.6 üzerinde 3×3'lük koyu delik (0.01): morfolojik kapanışla kapanır;
// kapanış pikselleri "filled" köprüsü olduğu için gradyan kesmesi bileşeni
// parçalamaz (0.01 vs 0.6 farkı GRADIENT_BREAK'i aşsa bile).
const holeDepth = new Float32Array(W * H).fill(0.6);
for (let y = 31; y <= 33; y++) {
  for (let x = 31; x <= 33; x++) holeDepth[y * W + x] = 0.01;
}
const hole = sampleVolumePositions(holeDepth, W, H, { importanceSampling: false });
assert.equal(wAt(hole, N >> 1, N >> 1), 1, 'siluet içi delik → w = 1 (kapatıldı)');

// --- 5. bileşen seçimi: ana gövdeden uzak ve bağımsız blok (duvar) atılır ---
// Özne ortada (çerçeveye değmez), sağ kenarda ayrık yüksek-derinlikli duvar:
// Y'de örtüşür ama X'te NEAR_PX'ten uzaktır → katılamaz, elenir.
const wallDepth = new Float32Array(W * H).fill(0.02);
for (let y = 8; y < 48; y++) {
  for (let x = 10; x <= 40; x++) wallDepth[y * W + x] = 0.4;
}
for (let y = 6; y < 58; y++) {
  for (let x = 56; x <= 63; x++) wallDepth[y * W + x] = 0.4;
}
const wall = sampleVolumePositions(wallDepth, W, H, { curvature: 0, importanceSampling: false });
assert.equal(wAt(wall, 152, 170), 1, 'özne → w = 1');
const wallBg = at(wall, 359, 170);
assert.ok(
  Math.abs(wallBg.w - BACKDROP_OPACITY) < 1e-6,
  'sağ kenar duvarı → arka plan noktası (w = BACKDROP_OPACITY, ölü değil)',
);
assert.ok(
  Math.abs(wallBg.z + 0.35) < 1e-6,
  'sağ kenar duvarı → z = (0.4−0.5)·2 − PIN = −0.35 (gerçek derinlik, arka sınır)',
);

// --- 6. kenar dökümü: siluet içi dokunulmaz, sınır bandı arkaya dökülür ---
// Sol yarı ön plan (0.4), sağ yarı arka plan (0.02): içeride döküm yok,
// sınıra yakın ön plan bandı lerp(EDGE_WALL_Z); tam arka plan ÖLÜDÜR (Tur 9:
// 0.5 eşiği sınırda bıçak kesimi yapar — kısmi opaklık bandı yoktur).
const rimDepth = new Float32Array(W * H).fill(0.02);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W / 2; x++) rimDepth[y * W + x] = 0.4;
}
const rim = sampleVolumePositions(rimDepth, W, H, {
  curvature: 0,
  importanceSampling: false,
});
const interior = at(rim, 80, N >> 1); // x ≈ 12.9 → siluet içi
const band = at(rim, 184, N >> 1); // x ≈ 30.3 → sınıra yakın ÖN PLAN (sert w = 1)
const cut = at(rim, N >> 1, N >> 1); // x ≈ 31.6 → sınırın hemen dışı (eşik keser)
const bg = at(rim, 300, N >> 1); // x ≈ 49.7 → arka plan
assert.ok(Math.abs(interior.z + 0.2) < 1e-6, 'siluet içi → döküm yok, z = −0.2');
assert.equal(interior.w, 1, 'siluet içi → w = 1');
assert.equal(band.w, 1, 'sınıra yakın ön plan → SERT w = 1 (ara opaklık yok)');
assert.ok(band.z > EDGE_WALL_Z && band.z < -0.2, 'sınır bandı → kısmen dökülmüş');
assert.ok(
  Math.abs(cut.w - BACKDROP_OPACITY) < 1e-6,
  'sınırın hemen dışı → arka plan noktası (w = BACKDROP_OPACITY)',
);
assert.ok(cut.z >= -1 && cut.z < -0.2, "sınırın hemen dışı → arka plan noktası ön planın ARKASINDA (z < −0.2, derinlik karışımıyla −1'e yaklaşır)");
assert.ok(
  Math.abs(bg.w - BACKDROP_OPACITY) < 1e-6,
  'arka plan → w = BACKDROP_OPACITY (nokta üretilir, ölü değil)',
);
assert.equal(bg.z, -1, 'arka plan → z = −1 (d = 0.02, kırpıldı)');
assert.equal(at(rim, 0, 0).w, 1, 'sol üst köşe (özne) → w = 1');

// --- 7. EVRENSEL kavis: skull prior KALDIRILDI, üst band ekstra bombe almaz ---
// düz 0.6, kavis kapalı: gövde İÇİ ve üst band (eski kafa bölgesi) AYNI z —
// insan varsayımı yoktur, ön plan her yerde aynı yüzey kavisleştirmesini alır.
const flat60 = sampleVolumePositions(new Float32Array(W * H).fill(0.6), W, H, {
  curvature: 0,
  importanceSampling: false,
});
assert.ok(Math.abs(at(flat60, N >> 1, N >> 1).z - 0.2) < 1e-6, 'gövde içi → z = 0.2 (düz)');
assert.ok(Math.abs(at(flat60, N >> 1, 96).z - 0.2) < 1e-6, 'üst band (eski skull alanı) → ekstra bombe YOK');
// Kavis formülü (evrensel): Z = (d−0.5)·range + α·sqrt(max(0,1−R²))·w_fg.
// Merkezde R² = 0, w_fg(0.6) = smoothstep(0.2,0.7,0.6) = 0.896 → katkı 0.0896.
const curved = sampleVolumePositions(new Float32Array(W * H).fill(0.6), W, H, {
  curvature: 0.1,
  importanceSampling: false,
});
assert.ok(Math.abs(at(curved, N >> 1, N >> 1).z - 0.2896) < 1e-6, 'merkez → evrensel kavis katkısı');
assert.ok(Math.abs(at(curved, 0, 0).z - 0.2) < 1e-6, 'köşe (R² ≥ 1) → kavis yok');

// --- 8. çerçeveye değen uzuv korunur; dikey açık hava doldurulmaz ---
// Gövde alt yarıda (çerçeveye değmez), kol ÜST kenara (y = 0) değiyor ve
// gövdeyle aynı sütunlarda (X örtüşmesi, Y'de 11px hava — kapanışın köprü
// kuramayacağı kadar geniş): X'te örtüşüp Y'de NEAR_PX'te olduğu için kol
// gövdeye katılıyor ama aradaki dikey boşluk doldurulmuyor.
const limbDepth = new Float32Array(W * H).fill(0.02);
for (let y = 26; y < H; y++) {
  for (let x = 16; x <= 47; x++) limbDepth[y * W + x] = 0.4; // gövde
}
for (let y = 0; y <= 14; y++) {
  for (let x = 28; x <= 35; x++) limbDepth[y * W + x] = 0.4; // üst kenara değen kol
}
const limbs = sampleVolumePositions(limbDepth, W, H, { curvature: 0, importanceSampling: false });
assert.equal(wAt(limbs, 192, 45), 1, 'üst kenara değen kol → w = 1 (silinmez)');
assert.ok(
  Math.abs(wAt(limbs, 192, 116) - BACKDROP_OPACITY) < 1e-6,
  'kol-gövde arası dikey hava → arka plan noktası (w = BACKDROP_OPACITY, web yok)',
);
assert.equal(wAt(limbs, 192, 200), 1, 'gövde → w = 1');

// --- 9. satır boşluk dolgusu: dar iç boşluk kapanır, geniş açıklık açık kalır ---
// Kafa + kol 10px'lik koyu boşlukla ayrık (Y'de örtüşüyor, X'te NEAR_PX'te →
// bileşen katılır; boşluk ≤ MAX_GAP_FILL → satır dolgusuyla kapanır).
const gapDepth = new Float32Array(W * H).fill(0.02);
for (let y = 4; y <= 27; y++) {
  for (let x = 20; x <= 43; x++) gapDepth[y * W + x] = 0.4; // kafa
}
for (let y = 10; y <= 30; y++) {
  for (let x = 54; x <= 61; x++) gapDepth[y * W + x] = 0.4; // kol
}
const gap = sampleVolumePositions(gapDepth, W, H, { curvature: 0, importanceSampling: false });
assert.equal(wAt(gap, 291, 123), 1, 'koyu kol-baş boşluğu (10px) → dolduruldu');
// C-şekli: iki dikey kol üstten köprüyle bağlı, arada 36px'lik iç açıklık —
// MAX_GAP_FILL (20) aşıldığı için satır dolgusu kapatmaz: depth karşılığı
// olmayan boşluk maske ile doldurulup Z = −1 kanyonuna dönüşmez.
const cDepth = new Float32Array(W * H).fill(0.02);
for (let y = 2; y <= 13; y++) {
  for (let x = 10; x <= 53; x++) cDepth[y * W + x] = 0.4; // üst köprü
}
for (let y = 14; y < H - 1; y++) {
  for (let x = 10; x <= 13; x++) cDepth[y * W + x] = 0.4;
  for (let x = 50; x <= 53; x++) cDepth[y * W + x] = 0.4;
}
const cShape = sampleVolumePositions(cDepth, W, H, { curvature: 0, importanceSampling: false });
assert.ok(
  Math.abs(wAt(cShape, 192, 183) - BACKDROP_OPACITY) < 1e-6,
  '36px iç açıklık → siluet yok (0.02) → arka plan noktası (w = BACKDROP_OPACITY)',
);
assert.equal(wAt(cShape, 192, 20), 1, 'üst köprü → w = 1');
// Geniş açık hava (82px > MAX_GAP_FILL): iki parça arası boşluk ASLA
// perde gibi doldurulmaz (webbing yok).
const wideDepth = new Float32Array(128 * 128).fill(0.02);
for (let y = 20; y <= 100; y++) {
  for (let x = 10; x <= 19; x++) wideDepth[y * 128 + x] = 0.4;
  for (let x = 102; x <= 109; x++) wideDepth[y * 128 + x] = 0.4;
}
const wide = sampleVolumePositions(wideDepth, 128, 128, { curvature: 0, importanceSampling: false });
assert.ok(
  Math.abs(wAt(wide, 175, 181) - BACKDROP_OPACITY) < 1e-6,
  '82px açık hava → arka plan noktası (w = BACKDROP_OPACITY, web yok)',
);
assert.equal(wAt(wide, 44, 181), 1, 'sol parça → w = 1');

// --- 10. kadraj kenarı sınır DEĞİLDİR: çerçeveyi dolduran ön plan DÜZ kalır ---
// düz 0.4 (z tabanı −0.2): maskenin dışı yok → dış kontur yok → hiçbir piksel
// dökülmez; köşe, kenar ve merkez aynı z (prizma duvarı yok, huni yok).
const ext = sampleVolumePositions(new Float32Array(W * H).fill(0.4), W, H, {
  curvature: 0,
  importanceSampling: false,
});
assert.ok(Math.abs(at(ext, 0, 0).z + 0.2) < 1e-6, 'kadraj köşesi → DÜZ (döküm yok)');
assert.ok(Math.abs(at(ext, N >> 1, N >> 1).z + 0.2) < 1e-6, 'iç merkez → dokunulmaz (z = −0.2)');
assert.ok(Math.abs(at(ext, 32, N >> 1).z + 0.2) < 1e-6, 'grid kenarına bitişik → DÜZ (duvar yok)');

// --- 11. derinlik gradyan kesmesi: bitişik ama süreksiz blok gövdeye yapışmaz ---
// Özne 0.4, duvar 0.9 DOĞRUDAN bitişik (maske tek blob): |Δd| = 0.5 > 0.15 →
// sel duvarı özneye bağlamaz; ayrışan bileşen maskede bitişik kaldığı için
// katılım kurallarından da yararlanamaz → duvar elenir, özne bütün kalır.
const gradDepth = new Float32Array(W * H).fill(0.02);
for (let y = 20; y <= 52; y++) {
  for (let x = 16; x <= 43; x++) gradDepth[y * W + x] = 0.4; // özne
}
for (let y = 24; y <= 48; y++) {
  for (let x = 44; x <= 51; x++) gradDepth[y * W + x] = 0.9; // bitişik duvar
}
const grad = sampleVolumePositions(gradDepth, W, H, { curvature: 0, importanceSampling: false });
assert.equal(wAt(grad, 178, 220), 1, 'özne → w = 1 (gradyan kesmesi özneyi korur)');
assert.ok(
  Math.abs(wAt(grad, 285, 220) - BACKDROP_OPACITY) < 1e-6,
  'bitişik duvar → süreksiz temas → elenir, arka plan noktası (w = BACKDROP_OPACITY)',
);

// --- 12. kopuk el/bilek köprüsü: üst çeyrek + yakınlık → zorunlu katılım ---
// El, kafanın sağ üstünde havada: X'te örtüşme yok, Y'de 9px hava (NEAR'ı
// geçer), kütle üst çeyrekte → PROXIMITY_BRIDGE_PX kuralı eli korur; aradaki
// dikey boşluk doldurulmaz (web yok).
const handDepth = new Float32Array(W * H).fill(0.02);
for (let y = 20; y <= 40; y++) {
  for (let x = 16; x <= 43; x++) handDepth[y * W + x] = 0.4; // kafa/gövde
}
for (let y = 0; y <= 10; y++) {
  for (let x = 48; x <= 55; x++) handDepth[y * W + x] = 0.4; // havada el
}
const hand = sampleVolumePositions(handDepth, W, H, { curvature: 0, importanceSampling: false });
assert.equal(wAt(hand, 309, 33), 1, 'havada el → w = 1 (köprü katılımı)');
assert.equal(wAt(hand, 179, 191), 1, 'kafa → w = 1');
assert.ok(
  Math.abs(wAt(hand, 309, 96) - BACKDROP_OPACITY) < 1e-6,
  'el-kafa arası hava → arka plan noktası (w = BACKDROP_OPACITY, web yok)',
);

// --- 13. nesne maskesi AND: maske 0 bölge → siluet yok, maske 1 → ön plan ---
// Depth her yerde 0.6 (ön plan görünür) ama nesne maskesi 41×41'lik bir delik
// içeriyor: delik (genişlik > kapanış yarıçapı) siluetten düşer, halka bütün
// kalır; satır dolgusu 39px'i (MAX_GAP_FILL) aştığı için delik kapanmaz.
const andDepth = new Float32Array(W * H).fill(0.6);
const andMask = new Float32Array(W * H).fill(1);
for (let y = 10; y <= 50; y++) {
  for (let x = 10; x <= 50; x++) andMask[y * W + x] = 0;
}
const masked = sampleVolumePositions(andDepth, W, H, {
  curvature: 0,
  importanceSampling: false,
  foregroundMask: andMask,
});
const maskHole = at(masked, N >> 1, N >> 1);
assert.ok(
  Math.abs(maskHole.w - BACKDROP_OPACITY) < 1e-6,
  'maske 0 bölge → siluet yok, arka plan noktası (w = BACKDROP_OPACITY)',
);
assert.ok(Math.abs(maskHole.z - 0.05) < 1e-6, 'maske 0 bölge → z = (0.6−0.5)·2 − PIN = 0.05');
assert.equal(wAt(masked, 15, 15), 1, 'maske 1 bölge → ön plan (w = 1)');

// --- 14. resampleBilinear: harita çözünürlükler arası taşınır ---
const small = new Float32Array(16);
for (let i = 0; i < 16; i++) small[i] = i; // satır major 4×4: 0..15
const big = resampleBilinear(small, 4, 4, 8, 8);
assert.equal(big.length, 64, 'çıktı boyutu dstW×dstH');
assert.equal(big[0], 0, 'sol üst köşe → kaynak köşe değeri');
assert.equal(big[63], 15, 'sağ alt köşe → kaynak köşe değeri');
// merkez (i=j=4): sx = sy = (4.5/8)·4 − 0.5 = 1.75 → texel (1,1)..(2,2)
// ağırlıklı bilinear: 5·0.25² + 6·0.75·0.25 + 9·0.25·0.75 + 10·0.75² = 8.75
assert.ok(Math.abs(big[4 * 8 + 4] - 8.75) < 1e-6, 'merkez → bilinear interpolasyon');

// --- 15. İKİ SEVİYELİ opaklık (Tur 11): her w ∈ {BACKDROP_OPACITY, 1} — ara
// değer (perde) yoktur; ön plan hâlâ sert binary kararla seçilir, arka plan
// noktaları sabit opaklıkta yaşar. ---
for (let k = 3; k < half.length; k += 4) {
  assert.ok(
    half[k] === 1 || Math.abs(half[k] - BACKDROP_OPACITY) < 1e-6,
    'w iki seviyeli: 1 (ön plan) veya BACKDROP_OPACITY (arka plan) — kısmi opaklık (perde) yok',
  );
}

// --- 16. ARKA PLAN NOKTA ÜRETİMİ (Tur 11): maske = 0 texel ÖLÜ DEĞİLDİR ---
// Üst yarı ön plan, alt yarı arka plan: arka plana düşen HER texel
// z = −1 (d = 0 → PIN kırpılır) ve w = BACKDROP_OPACITY taşır — depth/kavis/
// döküm hesabı arka plan için yapılmaz (düz duvar), ama nokta üretilir:
// tek buffer, siyah boşluk yok.
const halfNo = sampleVolumePositions(depth, W, H, {
  curvature: 0.1,
  importanceSampling: false,
});
let bgCount = 0;
for (let j = 0; j < N; j++) {
  const y = ((j + 0.5) / N) * H - 0.5;
  const bgRow = y >= 31.5; // maske satır sınırı 31.5 (yarım piksel kesimi)
  for (let i = 0; i < N; i++) {
    const o = (j * N + i) * 4;
    if (bgRow) {
      assert.ok(
        Math.abs(halfNo[o + 3] - BACKDROP_OPACITY) < 1e-6,
        `arka plan w = BACKDROP_OPACITY @(${i},${j})`,
      );
      assert.ok(
        halfNo[o + 2] >= -1 && halfNo[o + 2] < -0.2,
        `arka plan z ön planın ARKASINDA (−1 ≤ z < −0.2) @(${i},${j})`,
      );
      bgCount++;
    } else {
      assert.equal(halfNo[o + 3], 1, `ön plan w = 1 @(${i},${j})`);
    }
  }
}
assert.equal(bgCount, (N * N) / 2, 'arka plan texel yarısı arka plan noktası');
// Derin saf arka plan (d = 0.02, sınır karışımından uzak): z TAM −1 tabanında.
const deepRow = at(halfNo, N >> 1, 340); // y ≈ 56.2 → saf arka plan
assert.equal(deepRow.z, -1, 'derin arka plan → z = −1 (d = 0.02 → PIN kırpıldı)');

// --- 17. satır dolgusu/kapanış arka planı DİRİLTEMEZ (Tur 9): son AND ---
// Depth her yerde 0.6 (hepsi depth adayı); fg maskesinde iki blob arasında
// 8px'lik arka plan boşluğu var (≤ MAX_GAP_FILL → kapanış + satır dolgusu
// dolduracaktı). SON AND olmasaydı boşluk perde gibi kapanırdı; Tur 9'da
// boşluk ölü kalır — nesne maskesi güven sınırıdır.
const fillDepth = new Float32Array(W * H).fill(0.6);
const fillMask = new Float32Array(W * H);
for (let y = 8; y <= 55; y++) {
  for (let x = 20; x <= 28; x++) fillMask[y * W + x] = 1;
  for (let x = 37; x <= 45; x++) fillMask[y * W + x] = 1;
}
const fillRescue = sampleVolumePositions(fillDepth, W, H, {
  curvature: 0,
  importanceSampling: false,
  foregroundMask: fillMask,
});
const gapPx = at(fillRescue, 195, 195); // x ≈ 32.1 → bloblar arası 8px boşluk
assert.ok(
  Math.abs(gapPx.w - BACKDROP_OPACITY) < 1e-6,
  'bloblar arası arka plan → arka plan noktası (w = BACKDROP_OPACITY, satır dolgusu diriltemez)',
);
assert.ok(Math.abs(gapPx.z - 0.05) < 1e-6, 'bloblar arası arka plan → z = 0.05 (d = 0.6 − PIN)');
assert.equal(at(fillRescue, 146, 195).w, 1, 'sol blob → w = 1');
assert.equal(at(fillRescue, 249, 195).w, 1, 'sağ blob → w = 1');

// --- 18. isForeground Uint8Array API'si: {0, 1} ve alpha ile birebir ---
const sil = buildSilhouette(holeDepth, W, H, null);
assert.equal(sil.isForeground.length, W * H, 'isForeground boyutu depth ile aynı');
assert.equal(sil.isForeground instanceof Uint8Array, true, 'isForeground → Uint8Array');
for (let i = 0; i < sil.isForeground.length; i++) {
  assert.ok(sil.isForeground[i] === 0 || sil.isForeground[i] === 1, 'isForeground ∈ {0,1}');
  assert.equal(sil.isForeground[i], sil.alpha[i], 'isForeground ≡ alpha (sert binary)');
}
assert.equal(sil.isForeground[33 * W + 33], 1, 'kapanan delik → ön plan (1)');
const silMasked = buildSilhouette(andDepth, W, H, andMask);
assert.equal(silMasked.isForeground[32 * W + 32], 0, 'maske 0 bölge → arka plan (0)');

// --- 19. TAM KADRAJ KORUMASI: dev gövde çerçeveyi doldurunca benek çekirdeği
// çalamaz (Tur 9 regresyonu — bust fotoğrafı: derinlik sürekliliği duvarı
// özneye kaynaştırır, %94 kadraj aday olur, tek dev bileşen dört kenara da
// değer). Eski seçim 1px benekten çekirdek yapıp SAHNENİN TAMAMINI silerdi.
const fullDepth = new Float32Array(W * H).fill(0.6); // tam kadraj ön plan
fullDepth[32 * W + 32] = 0.9; // içeride tek gürültü benek (çerçeveye değmez)
const full = sampleVolumePositions(fullDepth, W, H, {
  curvature: 0,
  importanceSampling: false,
});
assert.equal(wAt(full, N >> 1, N >> 1), 1, 'tam kadraj gövde → merkez w = 1 (dev korunur)');
assert.equal(wAt(full, 0, 0), 1, 'tam kadraj gövde → köşe w = 1 (çerçeveye değen kütle seçilir)');
assert.equal(wAt(full, 359, 359), 1, 'tam kadraj gövde → sağ-alt köşe w = 1');
// Bileşen seçimi hâlâ spekleri elemeli: tam kadraj + UZAKTAKI küçük parça
// (aynı derinlik değilse) gövdeye katılamaz.
const speckDepth = new Float32Array(W * H).fill(0.02);
for (let y = 4; y <= 59; y++) {
  for (let x = 4; x <= 59; x++) speckDepth[y * W + x] = 0.4; // büyük orta blok (çerçeveye değmez)
}
speckDepth[8 * W + 8] = 0.9; // blok İÇİNDE gürültü benek
const speck = sampleVolumePositions(speckDepth, W, H, {
  curvature: 0,
  importanceSampling: false,
});
assert.equal(wAt(speck, N >> 1, N >> 1), 1, 'büyük orta blok → w = 1 (benek çekirdeği çalamaz)');

// --- 20. TEK BUFFER (Tur 11): arka plan noktaları AYNI texture'da yaşar —
// siluet dışı texel'ler ölü DEĞİL: gerçek arka plan derinliğinde, sabit
// BACKDROP_Z_PIN arkada, BACKDROP_OPACITY ile. Ayrı katman/material yoktur. ---
// rim sahnesi: sol yarı ön plan (siluet), sağ yarı gerçek arka plan (0.02).
const single = sampleVolumePositions(rimDepth, W, H, { curvature: 0, importanceSampling: false });
const bgPx = at(single, 300, N >> 1); // sağ yarı (gerçek arka plan)
assert.ok(
  Math.abs(bgPx.w - BACKDROP_OPACITY) < 1e-6,
  'arka plan texel → w = BACKDROP_OPACITY (ölü değil, nokta üretilir)',
);
assert.equal(bgPx.z, -1, 'arka plan texel → z = −1 (d = 0.02, PIN ile kırpıldı)');
assert.equal(at(single, 80, N >> 1).w, 1, 'sol yarı (siluet) → w = 1 (ön plan değişmedi)');
// Tam ön plan (d = 1): arka plan noktası YOKTUR — hepsi w = 1.
const flat1fg = sampleVolumePositions(new Float32Array(W * H).fill(1), W, H, {
  curvature: 0,
  importanceSampling: false,
});
for (let k = 3; k < flat1fg.length; k += 4) {
  assert.equal(flat1fg[k], 1, 'tam ön plan → her texel w = 1 (arka plan yok)');
}
// Z_PIN formülü kırpılmayan derinlikte: duvar (d = 0.4, elenen bileşen) →
// z = (0.4−0.5)·2 − 0.15 = −0.35 (test 5'te detaylı, burada grid hizası).
// Arka plan noktası kendi texel grid konumunda yaşar (1:1 sözleşme bozulmaz).
assert.ok(
  Math.abs(at(single, 300, N >> 1).x - ((300.5 / N) - 0.5) * 2) < 1e-6,
  'arka plan noktası → kendi texel grid konumunda (x)',
);
// Tüm çıktı sınırlı: z her yerde [-1, +1] sözleşmesinde, NaN yok (eski
// tek-boyutlu piramit regresyonu bu katmanla birlikte kalktı).
for (let k = 2; k < single.length; k += 4) {
  assert.ok(Number.isFinite(single[k]), `z sınırlı (NaN yok) @texel ${k / 4}`);
  assert.ok(single[k] >= -1 && single[k] <= 1, `z [-1,+1] sözleşmesi @texel ${k / 4}`);
}

// --- 21. İNCE KABUK (Tur 10): en dış siluet pikselleri ön yüzlerinin en az
// THIN_SHELL_Z (0.05) arkasına düşer; siluet içi dokunulmaz. ---
// rim sahnesi: sınır bandı (x ≈ 30.3, dist ≈ 1.2px) → zFront = −0.2, kabuk
// z ≤ −0.25; siluet içi (x ≈ 12.9, dist ≈ 18.6px) → kabuk uygulanmaz.
const rimShell = sampleVolumePositions(rimDepth, W, H, {
  curvature: 0,
  importanceSampling: false,
});
const bandPx = at(rimShell, 184, N >> 1);
const innerPx = at(rimShell, 80, N >> 1);
assert.ok(
  bandPx.z <= -0.25,
  `sınır bandı → ince kabuk (z = ${bandPx.z.toFixed(4)} ≤ −0.25, kağıt inceliği yok)`,
);
assert.ok(Math.abs(innerPx.z + 0.2) < 1e-6, 'siluet içi → ince kabuk uygulanmaz (z = −0.2)');

// --- 22. MASKE GENİŞLETME + TÜY (Tur 10): RMBG'nin öznenin İÇİNE düşen
// < 0.5 hataları (yüz/el kenarı) güven marjıyla kapanır; uzak arka plan
// yine 0 kalır (perde koruması sürer). ---
const msk = new Float32Array(W * H);
for (let y = 20; y < 44; y++) {
  for (let x = 20; x < 44; x++) msk[y * W + x] = 1;
}
const dil = dilateAndFeatherMask(msk, W, H);
for (let y = 20; y < 44; y++) {
  for (let x = 20; x < 44; x++) {
    assert.ok(dil[y * W + x] > 0.5, `genişletilmiş maske eski ön planı korur @(${x},${y})`);
  }
}
assert.ok(dil[20 * W + 16] > 0.5, '4px dış halka → güvenli bölgeye girer (dilate)');
assert.equal(dil[20 * W + 8], 0, '12px ötesi → maske 0 (uzak arka plan sızmaz)');
let partial = false;
for (let k = 0; k < dil.length; k++) {
  if (dil[k] > 0 && dil[k] < 0.5) {
    partial = true;
    break;
  }
}
assert.ok(partial, 'tüy → eşik altı ara değerler mevcut (sert bıçak kesimi değil)');

// --- 23. sampleImageGrid (Tur 11): fotoğraf RGB'si konumlarla AYNI grid/remap
// eşlemesinde örneklenir — texel (i,j) konumun örneklediği pikselin rengini
// alır (uImageTexture, shader'da aUv'de okunur). ---
// Düz renk fotoğraf: her texel aynı rengi almalı.
const solid = new Float32Array(W * H * 3);
for (let k = 0; k < solid.length; k += 3) {
  solid[k] = 0.2;
  solid[k + 1] = 0.4;
  solid[k + 2] = 0.6;
}
const solidGrid = sampleImageGrid(
  solid,
  W,
  H,
  new Float32Array(W * H).fill(0.5),
  W,
  H,
  { importanceSampling: false },
);
assert.equal(solidGrid.length, N * N * 3, 'çıktı boyutu grid×grid×3');
for (let t = 0; t < N * N; t += 257) {
  const k = t * 3;
  assert.ok(
    Math.abs(solidGrid[k] - 0.2) < 1e-6 &&
      Math.abs(solidGrid[k + 1] - 0.4) < 1e-6 &&
      Math.abs(solidGrid[k + 2] - 0.6) < 1e-6,
    'düz renk → her texel aynı renk (eşleme renk kaydırmaz)',
  );
}
// X-gradyan fotoğraf (kırmızı = x/64): bilinear eşleme doğrusal olmalı.
const gradRgb = new Float32Array(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) gradRgb[(y * W + x) * 3] = x / W;
}
const gradGrid = sampleImageGrid(
  gradRgb,
  W,
  H,
  new Float32Array(W * H).fill(0.5),
  W,
  H,
  { importanceSampling: false },
);
// texel i = 383: x = (383.5/384)·64 − 0.5 = 63.42 → x1 kenara kelepçeli:
// v = 63/64 = 0.984375. Merkez texel i = 192: x = 31.5833… → v = x/64.
assert.ok(
  Math.abs(gradGrid[383 * 3] - 0.984375) < 1e-6,
  'gradyan → kenar texel (x1 kelepçeli bilinear)',
);
assert.ok(
  Math.abs(gradGrid[(N >> 1) * 3] - 31.583333333333336 / 64) < 1e-6,
  'gradyan → merkez texel (x = 31.5833… → v = x/64)',
);

console.log('OK · volume sampler (1:1 grid, siluet: delik/gradyan/duvar/uzuv/boşluk, döküm, evrensel kavis, iki seviyeli opaklık + arka plan noktası (tek buffer), son AND + tam kadraj koruması, resample, TUR 10: ince kabuk + maske dilate/tüy, TUR 11: Z_PIN + sampleImageGrid)');
