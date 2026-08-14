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
import { absRel, alignSim3, ate, delta125, foregroundPointShare, iou, meanMs, medianMs, rmse, rpe } from '../src/engine/vision/metrics.ts';
import { makeSmallSubjectLab, makeSyntheticLab } from '../src/engine/vision/lab.ts';
import { applyForegroundStretch, foregroundMask, smoothDepthSteps } from '../src/depth.ts';

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

// --- 1c. GÜN 2: smoothDepthSteps BİLATERAL yön davranışı (8×8 elle kurulu) ---
// Ortam 0.5; TEK gürültülü piksel 0.53 — |ΔD| = 0.03 ≈ σ_r → yumuşatma komşulara
// YAKLAŞTIRIR. 0.8'lik GERÇEK sıçrama (|ΔD| ≫ σ_r = 0.02) KORUNUR: çerçeve
// kenarları yumuşatma tarafından yenmez.
{
  const W = 8, H = 8;
  const noisy = new Float32Array(W * H).fill(0.5);
  noisy[3 * W + 3] = 0.53; // gürültülü piksel
  noisy[3 * W + 5] = 0.8;  // gerçek kenar
  const before = noisy[3 * W + 3];
  smoothDepthSteps(noisy, W, H);
  const after = noisy[3 * W + 3];
  assert.ok(
    Math.abs(after - 0.5) < Math.abs(before - 0.5),
    `smooth: gürültü komşulara yaklaşır (${Math.abs(after - 0.5).toFixed(4)} < ${Math.abs(before - 0.5).toFixed(4)})`,
  );
  assert.ok(Math.abs(noisy[3 * W + 5] - 0.8) < 1e-6, 'smooth: gerçek sıçrama korunur (σ_r ≪ |ΔD|)');
}

// --- 1d. GÜN 2: foregroundMask + applyForegroundStretch (span açılımı) ---
// Ön plan [0.6, 0.7] bandı (maske smoothstep(0.15, 0.8, ·) ile < 1 — yumuşak
// harman) + arka plan 0.3. Girdi span'ı açılır; üst uç [0.1, 0.95] hedefine
// yaklaşır (maske 1 olsaydı tam 0.95 — harman bıçak kesimi önler). Tek ton
// ön plan dokunulmaz.
{
  const W = 8, H = 8;
  const d = new Float32Array(W * H).fill(0.3);
  d[3 * W + 4] = 0.6;
  d[3 * W + 5] = 0.65;
  d[3 * W + 6] = 0.68;
  d[3 * W + 7] = 0.7;
  const mask = foregroundMask(d, W, H);
  assert.ok(mask[3 * W + 7] > 0.5, 'fg mask: ön plan (0.7) maske eşiğini aşar');
  assert.ok(mask[3 * W + 0] < 1, 'fg mask: arka plan (0.3) tam 1 değil');
  applyForegroundStretch(d, mask, W, H);
  assert.ok(d[3 * W + 7] > 0.92, 'stretch: üst uç [0.1, 0.95] hedefine açılır');
  assert.ok(d[3 * W + 5] > 0.75, 'stretch: alt uç da açılır (aralık genişler)');
  let mn = Infinity, mx = -Infinity;
  for (const v of d) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  assert.ok(mx - mn > 0.6, `stretch: span genişler (${(mx - mn).toFixed(3)} > 0.4 girdi)`);
  const flat = new Float32Array(W * H).fill(0.6);
  applyForegroundStretch(flat, foregroundMask(flat, W, H), W, H);
  assert.ok(Math.abs(flat[0] - 0.6) < 1e-6, 'stretch: tek ton ön plan dokunulmaz (span yok)');
}

// --- 1e. GÜN 2: foregroundPointShare el hesabı ---
const psFg = new Float32Array([0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
assert.equal(foregroundPointShare(psFg), 1, 'pointShare: tümü ön plan → 1');
const psBg = new Float32Array([0, 0, 0, 0.4, 1, 1, 1, 0.4]);
assert.equal(foregroundPointShare(psBg), 0, 'pointShare: BACKDROP_OPACITY (0.4) → 0');
const psMix = new Float32Array([0, 0, 0, 1, 1, 1, 1, 0.4, 2, 2, 2, 0.7000001, 3, 3, 3, 0.69]);
assert.equal(foregroundPointShare(psMix), 0.5, 'pointShare: 1 ön plan; eşik 0.7 (Float32: 0.7000001 dahil, 0.69 hariç)');
assert.ok(Number.isNaN(foregroundPointShare(new Float32Array(0))), 'pointShare boş → NaN');

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

// --- 2b. GÜN 2: küçük özne sahnesi determinizmi + kompakt geometri ---
const s1 = makeSmallSubjectLab();
const s2 = makeSmallSubjectLab(128, 128);
assert.equal(s1.gtDepth.length, s2.gtDepth.length, 'küçük özne: aynı boyut');
let smallFg = 0;
for (let i = 0; i < s1.gtDepth.length; i++) {
  assert.equal(s1.luminance[i], s2.luminance[i], `küçük özne luminance deterministik @${i}`);
  assert.equal(s1.gtDepth[i], s2.gtDepth[i], `küçük özne gtDepth deterministik @${i}`);
  if (s1.gtFg[i] === 1) smallFg++;
}
// Daire r=30 → alan ≈ %17 (±%1): "belirgin küçük özne" hedefi %15-20 içinde.
assert.ok(smallFg > 0.15 * s1.gtDepth.length && smallFg < 0.2 * s1.gtDepth.length, `küçük özne alan %15-20 (${((100 * smallFg) / s1.gtDepth.length).toFixed(1)}%)`);

// --- 3. uçtan uca eval çalışması + şema + kol davranışı ---
const r = spawnSync(process.execPath, ['scripts/eval.mjs'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(r.status, 0, `eval.mjs çıkış kodu 0 (stderr: ${r.stderr})`);
assert.match(r.stdout, /^synthetic-lab [0-9a-f]{7,9}: /, 'tek satır özet');

// D.5 YAPISAL DOĞRULAYICI — TS tipleri çalışma zamanında hiçbir şeyi
// zorlamaz (üretici düz JS'tir), o yüzden şema burada elle denetlenir ve
// ÜRETİLEN TÜM RAPORLAR bu kapıdan geçer (eksik/fazla anahtar = hata).
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
const smoothOn = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report-smoothOn.json'), 'utf8'));
const smoothOff = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report-smoothOff.json'), 'utf8'));
const stretchOn = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report-stretchOn.json'), 'utf8'));
const stretchOff = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report-stretchOff.json'), 'utf8'));
const importanceOn = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report-importanceOn.json'), 'utf8'));
const importanceOff = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report-importanceOff.json'), 'utf8'));
for (const [name, rpt] of [
  ['report.json', report],
  ['report-focusOff.json', focusOff],
  ['report-edgeOn.json', edgeOn],
  ['report-smoothOn.json', smoothOn],
  ['report-smoothOff.json', smoothOff],
  ['report-stretchOn.json', stretchOn],
  ['report-stretchOff.json', stretchOff],
  ['report-importanceOn.json', importanceOn],
  ['report-importanceOff.json', importanceOff],
]) {
  validateReport(rpt, name);
}
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

// --- 4b. GÜN 2 kolları: çalışmalar GERÇEKTEN ölçülebilir fark üretiyor mu ---
// Kıyas bazları: smoothOff (gürültülü, işlemsiz), stretchOff (sıkıştırılmış,
// işlemsiz), importanceOff — her ikili YALNIZCA ilgili kolda ayrışır (D.5 tek
// değişken); en az bir metrik farklı olmalı, aksi halde kol yine ölçmüyordur.
const diff = (r1, r2, metrics) =>
  metrics.some((m) => r1.results.some((x) => x.metric === m) && get(r1, m) !== get(r2, m));
assert.equal(smoothOn.params.depthSmoothing, 1, 'smooth kolu: depthSmoothing uygulandı');
assert.equal(smoothOff.params.depthSmoothing, 0, 'smooth kapalı kol: depthSmoothing 0');
assert.equal(smoothOn.params.foregroundStretch, null, 'smooth kolu: stretch ile ayrışmaz');
assert.ok(diff(smoothOn, smoothOff, ['AbsRel', 'RMSE', 'delta1.25']), 'smooth kolu ölçülebilir fark üretir');
assert.ok(get(smoothOn, 'RMSE') < get(smoothOff, 'RMSE'), 'smooth: gürültü eritme RMSE iyileştirir');
assert.equal(stretchOn.params.foregroundStretch, 1, 'stretch kolu: foregroundStretch uygulandı');
assert.equal(stretchOff.params.foregroundStretch, 0, 'stretch kapalı kol: foregroundStretch 0');
assert.ok(diff(stretchOn, stretchOff, ['AbsRel', 'RMSE', 'delta1.25']), 'stretch kolu ölçülebilir fark üretir');
assert.equal(importanceOn.params.importanceSampling, 1, 'importance kolu: uygulandı');
assert.equal(importanceOff.params.importanceSampling, 0, 'importance kapalı kol: 0');
assert.ok(diff(importanceOn, importanceOff, ['foregroundPointShare']), 'importance kolu ölçülebilir fark üretir');
assert.ok(
  get(importanceOn, 'foregroundPointShare') > get(importanceOff, 'foregroundPointShare'),
  'importance: ön plan payı açıkken yüksek (kompakt özneye yığılma)',
);

// --- 5. harness determinizmi: iki koşu, aynı metrikler (timing hariç) ---
const r2 = spawnSync(process.execPath, ['scripts/eval.mjs'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(r2.status, 0, 'ikinci eval koşusu çıkış kodu 0');
const rerun = JSON.parse(readFileSync(join(ROOT, 'eval-out', 'report.json'), 'utf8'));
for (const metric of ['AbsRel', 'RMSE', 'delta1.25', 'IoU']) {
  assert.equal(get(rerun, metric), get(report, metric), `determinizm: ${metric} iki koşuda aynı`);
}
// GÜN 2 kolları da iki koşuda deterministik (timing hariç — OS/JIT varyansı
// metrik değildir, zamanlama koşuya göre oynamaya izinlidir).
for (const [name, rpt] of [
  ['report-smoothOn.json', smoothOn],
  ['report-smoothOff.json', smoothOff],
  ['report-stretchOn.json', stretchOn],
  ['report-stretchOff.json', stretchOff],
  ['report-importanceOn.json', importanceOn],
  ['report-importanceOff.json', importanceOff],
]) {
  const rr = JSON.parse(readFileSync(join(ROOT, 'eval-out', name), 'utf8'));
  for (const row of rpt.results) {
    if (row.metric === 'medianMs') continue;
    const hit = rr.results.find((x) => x.metric === row.metric && x.split === row.split);
    assert.ok(hit, `${name}: ${row.metric}/${row.split} ikinci koşuda var`);
    assert.equal(hit.value, row.value, `determinizm: ${name} ${row.metric}/${row.split}`);
  }
}

// --- GÜN E (M9): PİKSEL METRİKLERİNDE UZUNLUK EŞİTLİĞİ ---
//
// Eskiden bu dört metrik `pred.length` üzerinde dönüp `gt[i]` okuyordu: diziler
// farklı uzunluktaysa `gt[i]` undefined olur, `undefined > 0` ve
// `undefined >= 0.5` false döner — eksik GT SESSİZCE "geçersiz piksel" ya da
// "arka plan" sayılır ve fonksiyon hata fırlatmadan SAYI üretirdi. `ate`/`rpe`
// bu denetimi zaten yapıyordu; piksel metrikleri yapmıyordu (tutarsızlık).
// Sözleşme: uzunluk eşit değilse NaN — D.5 "sonuç satırında NaN YASAK" kuralı
// gereği rapor doğrulaması patlar, yani hata SESLİ olur.
{
  const short = new Float32Array([1, 2]);
  const long = new Float32Array([1, 2, 3, 4]);
  for (const [name, fn] of [
    ['absRel', absRel],
    ['rmse', rmse],
    ['delta125', delta125],
    ['iou', iou],
  ]) {
    assert.ok(Number.isNaN(fn(short, long)), `${name}: kısa pred / uzun gt NaN dönmeli`);
    assert.ok(Number.isNaN(fn(long, short)), `${name}: uzun pred / kısa gt NaN dönmeli`);
  }
  // Eşit uzunlukta davranış DEĞİŞMEDİ (regresyon nöbetçisi — 1. bölümdeki el
  // hesabı değerleriyle aynı diziler).
  assert.equal(absRel(p, g), 0.5);
  assert.ok(Number.isFinite(rmse(p, g)) && Number.isFinite(delta125(p, g)));
  const mA = new Float32Array([1, 1, 0, 0]);
  const mB = new Float32Array([1, 0, 0, 0]);
  assert.equal(iou(mA, mB), 0.5);
  // Boş kesişim/birleşim hâlâ NaN (eski sözleşme korunur — uzunluk denetimi
  // bunu gölgelememeli).
  const z = new Float32Array([0, 0]);
  assert.ok(Number.isNaN(iou(z, z)));
  console.log('[M9] uzunluk eşitliği: absRel/rmse/delta125/iou farklı uzunlukta NaN döndürüyor ✓');
}

console.log('OK (eval harness: metrics + ATE/RPE + M9 uzunluk denetimi, lab determinism, 9 rapor D.5 şeması, focusBoost + edgeStrength + smooth/stretch/importance kolları, koşular arası determinizm)');