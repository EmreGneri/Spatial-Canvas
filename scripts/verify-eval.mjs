// GÜN D/1 — eval harness sözleşme testi (GPU yok, saf CPU).
// 1) metriklerin el hesabıyla birebir eşleşmesi, 2) lab sahnesinin
// determinizmi, 3) uçtan uca `npm run eval` çıktısı + report.json şeması
// (D.5) + focusBoost kol davranışı (netlik ipucu sunduğunda tahmin iyileşir).
//   node scripts/verify-eval.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absRel, alignSim3, ate, delta125, iou, meanMs, medianMs, rmse, rpe } from '../src/engine/vision/metrics.ts';
import { makeSyntheticLab } from '../src/engine/vision/lab.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- 1. metriklerin el hesabı ---
const p = new Float32Array([1, 2]);
const g = new Float32Array([2, 4]);
assert.ok(Math.abs(absRel(p, g) - 0.5) < 1e-9, 'AbsRel: |1-2|/2 + |2-4|/4 → 0.5');
assert.ok(Math.abs(rmse(p, g) - Math.sqrt(2.5)) < 1e-9, 'RMSE: sqrt((1+4)/2)');
// δ<1.25: (1,1) → ok; (2.5,2) → max(1.25, 0.8) = 1.25 < 1.25 YANLIŞ → 0.5
const p5 = new Float32Array([2.5, 1]);
const g5 = new Float32Array([2, 1]);
assert.ok(Math.abs(delta125(p5, g5) - 0.5) < 1e-9, 'δ1.25: eşik TAM 1.25 sınırı dahil değil');
const pm = new Float32Array([1, 0, 1, 0]);
const gm = new Float32Array([1, 1, 0, 0]);
assert.ok(Math.abs(iou(pm, gm) - 1 / 3) < 1e-9, 'IoU: 1 kesişim / 3 birleşim');
assert.ok(Number.isNaN(absRel(new Float32Array(4), new Float32Array(4))), 'boş GT → NaN (sessiz 0 değil)');
assert.ok(Number.isNaN(iou(new Float32Array(4), new Float32Array(4))), 'boş union → NaN');
assert.ok(Number.isNaN(meanMs([])), 'boş timing → NaN');
assert.ok(Math.abs(meanMs([1, 2, 3]) - 2) < 1e-9, 'meanMs(1,2,3) = 2');
assert.ok(Number.isNaN(medianMs([])), 'boş medyan → NaN');
assert.ok(Math.abs(medianMs([5, 1, 3]) - 3) < 1e-9, 'medianMs tek sayı → ortadaki (3)');
assert.ok(Math.abs(medianMs([4, 1, 3, 2]) - 2.5) < 1e-9, 'medianMs çift sayı → ortalama (2.5)');
// Medyan aykırı değeri dışlar: ısınma turu ortalamayı şişirirdi.
assert.ok(medianMs([1, 1, 1, 1, 100]) === 1, 'medianMs ısınma aykırısına bağışık');

// --- 1b. ATE (Sim(3) hizalamalı RMSE) ve RPE ---
// (a) Birebir aynı yörünge → 0.
assert.ok(Math.abs(ate([[0, 0, 0], [1, 2, 3]], [[0, 0, 0], [1, 2, 3]])) < 1e-12, 'ATE(aynı) = 0');
// (b) gt'nin BİLİNEN Sim(3) dönüşümü (90° z dönmesi, ölçek 2, öteleme):
//     hizalama bunu tamamen geri almalı → ATE ≈ 0. Hizalamasız fark büyüktü.
const gtPath = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
const estPath = gtPath.map(([x, y, z]) => [2 * -y + 5, 2 * x - 3, 2 * z + 2]);
assert.ok(ate(estPath, gtPath) < 1e-9, `ATE(Sim(3) dönüşümü) ≈ 0 → ${ate(estPath, gtPath)}`);
const fit = alignSim3(estPath, gtPath);
assert.ok(Math.abs(fit.s - 0.5) < 1e-9, `hizalama ölçeği 1/2 bulunmalı → ${fit.s}`);
// (c) EL HESABI artık: est [0,1,2] / gt [0,1.5,2.5] (x ekseni).
//     ce=1, cg=4/3; s = Σg'e'/Σe'² = (4/3 + 7/6)/2 = 1.25; t = 4/3 − 1.25 = 1/12.
//     artıklar [1/12, −1/6, 1/12] → RMSE = sqrt((1/144 + 1/36 + 1/144)/3) = 0.1178511
const estLine = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
const gtLine = [[0, 0, 0], [1.5, 0, 0], [2.5, 0, 0]];
assert.ok(Math.abs(ate(estLine, gtLine) - 0.1178511301977579) < 1e-9, `ATE el hesabı 0.1178511 → ${ate(estLine, gtLine)}`);
// (d) RPE: komşu öteleme farkları [1,1] vs [1.5,1] → sqrt((0.25+0)/2) = 0.3535534
assert.ok(Math.abs(rpe(estLine, gtLine) - Math.sqrt(0.25 / 2)) < 1e-9, `RPE el hesabı 0.3535534 → ${rpe(estLine, gtLine)}`);
// (e) dejenere girdiler NaN (sessiz sayı üretmez)
assert.ok(Number.isNaN(ate([], [])), 'ATE boş → NaN');
assert.ok(Number.isNaN(ate([[0, 0, 0]], [[0, 0, 0], [1, 1, 1]])), 'ATE uzunluk uyuşmazlığı → NaN');
assert.ok(Number.isNaN(rpe([[0, 0, 0]], [[0, 0, 0]])), 'RPE tek öğe → NaN');
// (f) tüm est noktaları aynı (ölçek tanımsız) → çökmez, sonlu sayı döner
assert.ok(Number.isFinite(ate([[1, 1, 1], [1, 1, 1]], [[0, 0, 0], [2, 0, 0]])), 'ATE dejenere ölçek → sonlu');

// --- 2. lab determinizmi ---
const a = makeSyntheticLab();
const b = makeSyntheticLab(128, 128);
assert.equal(a.luminance.length, b.luminance.length, 'aynı boyut');
for (let i = 0; i < a.luminance.length; i++) {
  assert.equal(a.luminance[i], b.luminance[i], `luminance deterministik @${i}`);
  assert.equal(a.gtDepth[i], b.gtDepth[i], `gtDepth deterministik @${i}`);
}
// Sahne kurulumu: sol şerit + sağ düz, GT iki düzey, parlaklık ayrım yapamaz.
const n = a.width * a.height;
const solParlak = a.gtFg.filter((v, i) => i % a.width < a.width / 2);
const sagParlak = a.gtFg.filter((v, i) => i % a.width >= a.width / 2);
assert.equal(solParlak.filter((v) => v === 1).length, n / 2, 'sol yarı ön plan');
assert.equal(sagParlak.filter((v) => v === 0).length, n / 2, 'sağ yarı arka plan');

// --- 3. uçtan uca eval çalışması + şema + kol davranışı ---
const r = spawnSync(process.execPath, ['scripts/eval.mjs'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(r.status, 0, `eval.mjs çıkış kodu 0 (stderr: ${r.stderr})`);
assert.match(r.stdout, /^synthetic-lab [0-9a-f]{7,9}: /, 'tek satır özet');

// D.5 YAPISAL DOĞRULAYICI — TS tipleri çalışma zamanında hiçbir şeyi
// zorlamaz (üretici düz JS'tir), o yüzden şema burada elle denetlenir ve
// ÜRETİLEN ÜÇ RAPORUN HEPSİ bu kapıdan geçer (eksik/fazla anahtar = hata).
const ABLATION_ARMS = [
  'ao',
  'focusBoost',
  'edgeStrength',
  'letterbox_vs_distort',
  'importanceSampling',
  'depthSmoothing',
  'foregroundStretch',
];
const COLUMNS = ['depth', 'seg', 'pose', 'timing'];

function validateReport(rpt, label) {
  for (const key of ['run', 'date', 'commit']) {
    assert.equal(typeof rpt[key], 'string', `${label}: ${key} string`);
    assert.ok(rpt[key].length > 0, `${label}: ${key} boş değil`);
  }
  assert.ok(rpt.params && typeof rpt.params === 'object', `${label}: params nesnesi`);
  const keys = Object.keys(rpt.params).sort();
  assert.deepEqual(keys, [...ABLATION_ARMS].sort(), `${label}: TAM 7 ablasyon kolu, fazlası yok`);
  for (const key of ABLATION_ARMS) {
    const v = rpt.params[key];
    assert.ok(v === null || typeof v === 'number', `${label}: ${key} sayı ya da null`);
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${label}: ${key} sonlu`);
  }
  assert.ok(Array.isArray(rpt.results) && rpt.results.length >= 4, `${label}: ≥4 sonuç satırı`);
  for (const row of rpt.results) {
    assert.equal(typeof row.metric, 'string', `${label}: metric string`);
    assert.ok(COLUMNS.includes(row.column), `${label}: geçerli kolon (${row.column})`);
    assert.equal(typeof row.dataset, 'string', `${label}: dataset string`);
    assert.equal(typeof row.split, 'string', `${label}: split string`);
    // NaN JSON'da null'a döner; null "kol uygulanmadı" anlamını taşıdığı için
    // sonuç satırında YASAK — ölçülemeyen metrik satır olarak yazılmaz.
    assert.equal(typeof row.value, 'number', `${label}: ${row.metric} değeri sayı (null değil)`);
    assert.ok(Number.isFinite(row.value), `${label}: ${row.metric} sonlu`);
  }
}

const report = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report.json'), 'utf8'));
const focusOff = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report-focusOff.json'), 'utf8'));
const edgeOn = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report-edgeOn.json'), 'utf8'));
validateReport(report, 'report.json');
validateReport(focusOff, 'report-focusOff.json');
validateReport(edgeOn, 'report-edgeOn.json');
assert.equal(typeof report.params.focusBoost, 'number', 'şema: params.focusBoost sayı');
for (const key of ['ao', 'letterbox_vs_distort', 'importanceSampling', 'depthSmoothing', 'foregroundStretch']) {
  assert.equal(report.params[key], null, `şema: ${key} uygulanmadı (null)`);
}
const get = (rpt, metric) => {
  const hit = rpt.results.find((x) => x.metric === metric);
  assert.ok(hit, `${rpt.run}: '${metric}' satırı var`);
  return hit.value;
};
assert.ok(
  get(report, 'AbsRel') < get(focusOff, 'AbsRel'),
  `netlik ipucu iyileştirir: AbsRel ${get(report, 'AbsRel')} < ${get(focusOff, 'AbsRel')}`,
);
assert.ok(get(report, 'RMSE') < get(focusOff, 'RMSE'), 'RMSE focus açıkken düşük');
assert.ok(get(report, 'IoU') > get(focusOff, 'IoU'), 'IoU focus açıkken yüksek');

// --- 4. edge kolu GERÇEKTEN ölçülüyor mu (Gün D/1 denetim bulgusu S1) ---
// smoothingRadius = 0 iken low-pass kopya olur ve edgeStrength terimi
// matematiksel olarak sıfırlanırdı: kol inert, rapor sahte. Kıyas bazı
// (focusOff) ile edgeOn YALNIZCA edgeStrength'te ayrışır; en az bir depth
// metriği farklı olmalı — aksi halde kol yine ölçmüyordur.
assert.equal(focusOff.params.edgeStrength, null, 'baz kol: edgeStrength uygulanmadı');
assert.equal(edgeOn.params.edgeStrength, 0.35, 'edge kolu: edgeStrength uygulandı');
assert.equal(focusOff.params.focusBoost, edgeOn.params.focusBoost, 'tek değişken: focusBoost aynı');
const edgeDiffers =
  get(edgeOn, 'AbsRel') !== get(focusOff, 'AbsRel') ||
  get(edgeOn, 'RMSE') !== get(focusOff, 'RMSE') ||
  get(edgeOn, 'delta1.25') !== get(focusOff, 'delta1.25');
assert.ok(edgeDiffers, 'edge kolu ölçülebilir fark üretir (inert kol raporlanmaz)');

// --- 5. harness determinizmi: iki koşu, aynı metrikler (timing hariç) ---
const r2 = spawnSync(process.execPath, ['scripts/eval.mjs'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(r2.status, 0, 'ikinci eval koşusu çıkış kodu 0');
const rerun = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report.json'), 'utf8'));
for (const metric of ['AbsRel', 'RMSE', 'delta1.25', 'IoU']) {
  assert.equal(get(rerun, metric), get(report, metric), `determinizm: ${metric} iki koşuda aynı`);
}

console.log('OK (eval harness: metrics + ATE/RPE, lab determinism, 3 rapor D.5 şeması, focusBoost + edgeStrength kolları, koşular arası determinizm)');