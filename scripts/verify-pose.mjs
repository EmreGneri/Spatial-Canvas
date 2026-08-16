// GÜN 5 (Emre) — poz çözücü doğruluk testi. Zeynep'in sentetik yörünge
// üretecine (D.6b, `trajectory.ts`) karşı ölçer: essential matrix + RANSAC +
// R,t ayrıştırma + cheirality zincirlenip D.2 PoseTrackRecord üretiyor mu,
// ROTASYON hatası D.7'nin ölçütünü (< 1-2°) geçiyor mu.
//
// Model YÜKLEMEZ, GPU gerekmez: saf CPU, deterministik.
//   node scripts/verify-pose.mjs
import assert from 'node:assert/strict';
import {
  generateOrbitTrajectory,
  generatePointCloudScene,
  projectScene,
  quatToMatrix,
  toFirstKeyframeOrigin,
} from '../src/engine/vision/trajectory.ts';
import { chainPoseTrack, decomposeEssential, ransacEssential, recoverPose } from '../src/engine/vision/pose.ts';
import { mat3Mul, mat3Transpose, matrixToQuat, mulberry32 } from '../src/engine/vision/linalg.ts';

const W = 640;
const H = 480;

function quatAngleDeg(a, b) {
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

/**
 * `recoverPose`/`decomposeEssential`'ın döndürdüğü R, İKİLİ GÖRECELİ dönmedir
 * (`X_camB = R·X_camA + t`, yani `Rrel = RBᵀ·RA`). `toFirstKeyframeOrigin`
 * çıktısının `p.R`'si ise MUTLAK pozdur (`R0ᵀ·R1` yönünde, D.2 dünya-orijini
 * çerçevesi) — 2 karede sayısal olarak `Rrel`'in TERSİDİR. Bu ikisini
 * DOĞRUDAN karşılaştırmak yanlış yön karşılaştırmasıdır (bir tur bu yüzden
 * 80° "hata" gösterdi — kod değil, test hedefi yanlıştı). Doğru karşılaştırma
 * hedefi HAM `raw[i].R`/`raw[i+1].R`'den doğrudan kurulur.
 */
function trueRelativeRotation(rawA, rawB) {
  return matrixToQuat(mat3Mul(mat3Transpose(quatToMatrix(rawB.R)), quatToMatrix(rawA.R)));
}

/** İki projeksiyon çerçevesinden indeks-eşleşmeli (senteziğe özgü) korespondans. */
function buildMatches(frameA, frameB) {
  const out = [];
  for (let i = 0; i < frameA.visible.length; i++) {
    if (!frameA.visible[i] || !frameB.visible[i]) continue;
    out.push({ x1: frameA.x[i], y1: frameA.y[i], x2: frameB.x[i], y2: frameB.y[i] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. TEK ÇİFT — recoverPose izole doğruluk (gürültüsüz, RANSAC yok denecek kadar temiz).
// ---------------------------------------------------------------------------
{
  // İZDÜŞÜM için HAM pozlar (sahneyle AYNI dünya çerçevesi — generatePointCloudScene
  // origin merkezlidir, toFirstKeyframeOrigin bu çerçeveyi bozar).
  const raw = generateOrbitTrajectory({ count: 2, arc: (40 * Math.PI) / 180 });
  const scene = generatePointCloudScene(600, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0);
  const matches = buildMatches(frames[0], frames[1]);
  console.log(`[1] tek çift eşleşme sayısı: ${matches.length}`);
  assert.ok(matches.length >= 30, 'yeterli eşleşme yok — senaryo bozuk');

  const rec = recoverPose(matches, { width: W, height: H, fovY: raw[0].fovY });
  assert.ok(rec, 'recoverPose null döndü');
  console.log(`[1] içerdekiler: ${rec.inlierCount}/${matches.length} · cheirality oyu: ${rec.cheiralityVotes}`);
  assert.ok(rec.inlierCount >= matches.length * 0.9, 'gürültüsüz sahnede içerdeki oranı düşük');

  const qTrue = trueRelativeRotation(raw[0], raw[1]);
  const err = quatAngleDeg(matrixToQuat(rec.R), qTrue);
  console.log(`[1] izole rotasyon hatası (gürültüsüz): ${err.toFixed(5)}°`);
  assert.ok(err < 0.01, `izole recoverPose gürültüsüz sahnede tam eşleşmeli: ${err.toFixed(5)}°`);
}

// ---------------------------------------------------------------------------
// 2. ZİNCİR — çok-keyframe, KÜÇÜK piksel gürültüsüyle (gerçekçi RANSAC koşulu).
// ---------------------------------------------------------------------------
{
  const raw = generateOrbitTrajectory({ count: 12, arc: (120 * Math.PI) / 180, rise: 0.35 });
  const gtPoses = toFirstKeyframeOrigin(raw);
  const scene = generatePointCloudScene(600, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0.4, 0x9e0);
  const frameMatches = [];
  for (let i = 0; i < frames.length - 1; i++) frameMatches.push(buildMatches(frames[i], frames[i + 1]));
  const counts = frameMatches.map((m) => m.length);
  console.log(`[2] çift başına eşleşme: min ${Math.min(...counts)} · max ${Math.max(...counts)}`);
  assert.ok(Math.min(...counts) >= 30, 'bazı çiftlerde eşleşme çok az — senaryo bozuk');

  const K = { width: W, height: H, fovY: raw[0].fovY };
  const times = raw.map((p) => p.timeMs);
  const est = chainPoseTrack(frameMatches, K, times, { pixelThreshold: 1.5, iterations: 300, seed: 0xc0ffee });
  assert.equal(est.length, gtPoses.length, 'PoseTrackRecord uzunluğu');

  const errors = est.map((p, i) => quatAngleDeg(p.R, gtPoses[i].R));
  errors.forEach((e, i) => console.log(`[2] keyframe ${i} MUTLAK (biriken) hata: ${e.toFixed(3)}°`));
  const maxAbsErr = Math.max(...errors.slice(1));
  console.log(`[2] mutlak hata — maks ${maxAbsErr.toFixed(3)}° (D.8: loop closure YOK, zincir boyunca sürüklenme BİRİKİR — beklenen davranış, gate edilmez)`);
  // acos(x)'in x→1'de türevi ıraksadığı için dot çarpımdaki kayan nokta
  // artığı (≈1e-16) derece cinsinden ≈1e-6°'ye büyür — bu numerik gürültüdür,
  // gerçek hata değil; eşik onu (bolca payla) yutacak kadar gevşek.
  assert.ok(errors[0] < 1e-3, `ilk keyframe identity olmalı (D.2 dünya orijini): ${errors[0]}`);

  // D.7'nin ölçütü ("sentetikte rotasyon hatası < 1-2°") ADIM-BAŞINADIR, biriken
  // zincire değil — D.8 zaten sürüklenmenin birikeceğini açıkça bildiriyor
  // (loop closure yok). Adım hatası: ardışık keyframe'lerin TAHMİN EDİLEN
  // göreceli dönmesini gerçek göreceli dönmeyle karşılaştırır (zincirin
  // önceki adımlardaki hatasından ETKİLENMEZ — her adım kendi içinde ölçülür).
  const stepErrors = [];
  for (let i = 1; i < est.length; i++) {
    const qEstA = est[i - 1].R;
    const qEstB = est[i].R;
    const qGtA = gtPoses[i - 1].R;
    const qGtB = gtPoses[i].R;
    // göreceli dönme quat'ı: conj(A) ∘ B (matris karşılığı Aᵀ·B)
    const relQuat = (a, b) => {
      const ac = [-a[0], -a[1], -a[2], a[3]];
      const [ax, ay, az, aw] = ac;
      const [bx, by, bz, bw] = b;
      return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
      ];
    };
    const relEst = relQuat(qEstA, qEstB);
    const relGt = relQuat(qGtA, qGtB);
    stepErrors.push(quatAngleDeg(relEst, relGt));
  }
  stepErrors.forEach((e, i) => console.log(`[2] adım ${i}→${i + 1} GÖRECELİ hata: ${e.toFixed(3)}°`));
  const maxStepErr = Math.max(...stepErrors);
  const medianStepErr = stepErrors.slice().sort((a, b) => a - b)[Math.floor(stepErrors.length / 2)];
  console.log(`[2] adım hatası — medyan ${medianStepErr.toFixed(3)}° · maks ${maxStepErr.toFixed(3)}°`);
  // D.7: "sentetikte rotasyon hatası < 1-2°" — adım başına.
  assert.ok(maxStepErr < 2, `adım rotasyon hatası D.7 eşiğini aşıyor: ${maxStepErr.toFixed(3)}° ≥ 2°`);
}

// ---------------------------------------------------------------------------
// 3. RANSAC — kaba aykırı değerlerle bozulmuş eşleşmelerde essential matrix
//    hâlâ doğru mu? (plan RANSAC'ı açıkça istiyor — bu blok onu sınar.)
// ---------------------------------------------------------------------------
{
  const raw = generateOrbitTrajectory({ count: 2, arc: (40 * Math.PI) / 180 });
  const scene = generatePointCloudScene(600, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0.3, 0x9e0);
  const matches = buildMatches(frames[0], frames[1]);

  const rnd = mulberry32(0xbadbad);
  const corrupted = matches.map((m) => ({ ...m }));
  const outlierFrac = 0.3;
  const outlierCount = Math.floor(corrupted.length * outlierFrac);
  for (let k = 0; k < outlierCount; k++) {
    const i = Math.floor(rnd() * corrupted.length);
    corrupted[i] = { ...corrupted[i], x2: rnd() * W, y2: rnd() * H }; // rastgele yanlış eşleşme
  }
  console.log(`[3] ${corrupted.length} eşleşme, ${outlierCount} kaba aykırı (%${(100 * outlierFrac).toFixed(0)})`);

  const rec = recoverPose(corrupted, { width: W, height: H, fovY: raw[0].fovY }, { iterations: 500, pixelThreshold: 1.5, seed: 0xc0ffee });
  assert.ok(rec, 'RANSAC aykırı değerlerle null döndü');
  console.log(`[3] içerdekiler: ${rec.inlierCount}/${corrupted.length} (beklenen ~${corrupted.length - outlierCount})`);
  // İçerdeki sayısı gerçek inlier sayısına yakın olmalı (aykırıların çoğu
  // elenmeli) — rastgele aykırı üretimi tesadüfen gerçek epipolar çizgiye
  // yakın düşebilir (kabul edilir eşik: gerçek inlier sayısının %95'i).
  const expectedInliers = corrupted.length - outlierCount;
  assert.ok(
    rec.inlierCount >= expectedInliers * 0.95,
    `RANSAC beklenenden az içerdeki buldu: ${rec.inlierCount} (beklenen ~${expectedInliers})`,
  );

  const qTrue = trueRelativeRotation(raw[0], raw[1]);
  const err = quatAngleDeg(matrixToQuat(rec.R), qTrue);
  console.log(`[3] aykırı-dayanıklı rotasyon hatası: ${err.toFixed(3)}°`);
  assert.ok(err < 2, `RANSAC sonrası rotasyon hatası D.7 eşiğini aşıyor: ${err.toFixed(3)}°`);
}

// ---------------------------------------------------------------------------
// 4. DEJENERE — eşleşme yoksa (ör. donmuş kare) zincir KOPMAMALI, bir önceki
//    poz tekrarlanmalı (fillOnFailure varsayılanı).
// ---------------------------------------------------------------------------
{
  const raw = generateOrbitTrajectory({ count: 4, arc: (60 * Math.PI) / 180 });
  const scene = generatePointCloudScene(200, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0);
  const frameMatches = [buildMatches(frames[0], frames[1]), [], buildMatches(frames[2], frames[3])]; // ortadaki boş
  const K = { width: W, height: H, fovY: raw[0].fovY };
  const times = raw.map((p) => p.timeMs);
  const est = chainPoseTrack(frameMatches, K, times);
  assert.equal(est.length, 4, 'boş çiftte bile zincir uzunluğu korunmalı');
  console.log('[4] dejenere (boş eşleşme) çiftte zincir kopmadı, uzunluk korundu ✓');
}

// ---------------------------------------------------------------------------
// 5. DETERMİNİZM — aynı girdi iki koşuda birebir aynı poz zinciri.
// ---------------------------------------------------------------------------
{
  const raw = generateOrbitTrajectory({ count: 8, arc: (100 * Math.PI) / 180 });
  const scene = generatePointCloudScene(400, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0.4, 0x9e0);
  const frameMatches = [];
  for (let i = 0; i < frames.length - 1; i++) frameMatches.push(buildMatches(frames[i], frames[i + 1]));
  const K = { width: W, height: H, fovY: raw[0].fovY };
  const times = raw.map((p) => p.timeMs);
  const a = chainPoseTrack(frameMatches, K, times);
  const b = chainPoseTrack(frameMatches, K, times);
  let same = a.length === b.length;
  for (let i = 0; i < a.length && same; i++) {
    for (let k = 0; k < 4; k++) if (a[i].R[k] !== b[i].R[k]) same = false;
    for (let k = 0; k < 3; k++) if (a[i].t[k] !== b[i].t[k]) same = false;
  }
  console.log(`[5] determinizm: ${same ? 'birebir' : 'FARKLI'}`);
  assert.ok(same, 'chainPoseTrack determinist değil');
}

// ---------------------------------------------------------------------------
// 6. decomposeEssential — 4 adayın TAMAMI geçerli dönme mi (det ≈ +1, ortonormal)?
// ---------------------------------------------------------------------------
{
  const raw = generateOrbitTrajectory({ count: 2, arc: (50 * Math.PI) / 180 });
  const scene = generatePointCloudScene(300, 1, 0x51ce4e);
  const frames = projectScene(raw, scene, W, H, 0);
  const matches = buildMatches(frames[0], frames[1]);
  const rec = recoverPose(matches, { width: W, height: H, fovY: raw[0].fovY });
  assert.ok(rec, 'recoverPose null');
  const ransac = ransacEssential(matches, { width: W, height: H, fovY: raw[0].fovY }, { seed: 0xc0ffee });
  assert.ok(ransac, 'ransacEssential null');
  const candidates = decomposeEssential(ransac.E);
  assert.equal(candidates.length, 4, 'dört aday');
  for (const [i, cand] of candidates.entries()) {
    const R = cand.R;
    const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    assert.ok(Math.abs(det - 1) < 1e-6, `aday ${i}: det(R) = ${det.toFixed(6)} (beklenen +1)`);
    const tn = Math.hypot(...cand.t);
    assert.ok(Math.abs(tn - 1) < 1e-6, `aday ${i}: |t| = ${tn.toFixed(6)} (beklenen 1)`);
  }
  console.log('[6] 4 aday da geçerli dönme (det=+1) ve birim öteleme ✓');
}

// ---------------------------------------------------------------------------
// 7. SIFIR BAZ HATTI (saf dönme) — cheirality oyu 0 olan aday POZ DEĞİLDİR:
//    recoverPose null döndürmeli. Eskiden candidates[0] (geometrik olarak
//    geçersiz R,t) sessizce zincire bağlanıyordu (pose.ts:340-356); video
//    yolunun donmuş/durağan kareleri bu yoldan çöp poz üretiyordu.
// ---------------------------------------------------------------------------
{
  const FOV = (60 * Math.PI) / 180;
  const yaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)]; // y ekseni etrafında
  const rawRot = [
    { id: 0, R: [0, 0, 0, 1], t: [0, 0, 0], timeMs: 0, scaleA: 1, scaleB: 0, fovY: FOV },
    { id: 1, R: yaw(0.7), t: [0, 0, 0], timeMs: 33, scaleA: 1, scaleB: 0, fovY: FOV },
  ];
  const scene = generatePointCloudScene(600, 1, 0x51ce4e);
  const frames = projectScene(rawRot, scene, W, H, 0);
  const matches = buildMatches(frames[0], frames[1]);
  const K = { width: W, height: H, fovY: FOV };
  const rec = recoverPose(matches, K);
  console.log(
    `[7] sıfır baz hattı: ${matches.length} eşleşme · recoverPose ${rec ? `DÖNDÜ (cheirality oyu ${rec.cheiralityVotes}/${matches.length})` : 'null ✓'}`,
  );
  assert.ok(matches.length >= 30, 'yeterli eşleşme yok — senaryo bozuk');
  assert.ok(rec === null, 'sıfır baz hattında (saf dönme) recoverPose çöp poz döndürmemeli — null olmalı');
}

console.log('OK poz çözücü — essential matrix + RANSAC + ayrıştırma + cheirality (Gün 5)');
