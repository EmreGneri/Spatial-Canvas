// GÜN D/1 — eval harness (Node/CPU). Sentetik lab sahnesinde video depth
// boru hattının çekirdeği (heightMapFromLuminance) ablasyon kollarıyla
// ölçülür; D.5 şemasında eval-out/report.json üretilir; tek satır özet basar.
//   node scripts/eval.mjs  (veya npm run eval)
// Sözleşme (ARCHITECTURE.md → Gün D): eval harness ASLA KESİLMEZ — bu dosya
// hiçbir koşulda sessizce ölmez; hata olsa bile tek satır basar (çıkış kodu
// yine hatayı bildirir).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heightMapFromLuminance, resetLuminanceState } from '../src/depth.ts';
import { absRel, delta125, iou, medianMs, rmse } from '../src/engine/vision/metrics.ts';
import { makeSyntheticLab } from '../src/engine/vision/lab.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'eval-out');

/** Zamanlama örneklemesi: ısınma + tekrar sayısı (D.5 timing kolonu). */
const WARMUP_RUNS = 1;
const TIMED_RUNS = 20;

function gitCommit() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

/**
 * Bir kolu çalıştırır ve zamanlar. Çıktı (data/seg) SON çalışmadan gelir;
 * zamanlama ısınma turundan SONRAKİ TIMED_RUNS örneğin MEDYANIDIR — tek örnek
 * JIT derlemesini ölçüyordu (ilk çağrı sonrakilerin ~3 katı).
 */
function runPipeline(lum, width, height, opts) {
  for (let i = 0; i < WARMUP_RUNS; i++) {
    resetLuminanceState();
    heightMapFromLuminance(new Float32Array(lum), width, height, opts);
  }
  const samples = [];
  let data = null;
  for (let i = 0; i < TIMED_RUNS; i++) {
    resetLuminanceState();
    const input = new Float32Array(lum);
    const t0 = performance.now();
    const out = heightMapFromLuminance(input, width, height, opts);
    samples.push(performance.now() - t0);
    data = out.data;
  }
  const seg = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) seg[i] = data[i] >= 0.5 ? 1 : 0;
  return { data, ms: medianMs(samples), seg };
}

// Yalıtılmış kol çalışmaları — tek kol değişir, diğerleri sabit (karışma yok).
// smoothingRadius = 1 TÜM kollarda ORTAKTIR: 0 iken low-pass kopya olur,
// işaretli detay terimi (edgeStrength · (data − low)) matematiksel olarak
// sıfırlanır ve edge kolu ölçülemez hale gelirdi (Gün D/1 denetim bulgusu).
const BASE_OPTS = { edgeStrength: 0, centerBoost: 0, smoothingRadius: 1 };
const FOCUS_ON = { ...BASE_OPTS, focusStrength: 0.55 };
const FOCUS_OFF = { ...BASE_OPTS, focusStrength: 0 };
const EDGE_ON = { ...BASE_OPTS, focusStrength: 0, edgeStrength: 0.35 };

/** D.5 ablasyon kolları — uygulanmayan kol null (asılsız sayı üretilmez). */
function arms(overrides) {
  return {
    ao: null,
    focusBoost: null,
    edgeStrength: null,
    letterbox_vs_distort: null,
    importanceSampling: null,
    depthSmoothing: null,
    foregroundStretch: null,
    ...overrides,
  };
}

function main() {
  const lab = makeSyntheticLab();
  const dataset = 'synthetic-lab';
  const commit = gitCommit();
  const date = new Date().toISOString();

  const focusOn = runPipeline(lab.luminance, lab.width, lab.height, FOCUS_ON);
  const focusOff = runPipeline(lab.luminance, lab.width, lab.height, FOCUS_OFF);
  const edgeOn = runPipeline(lab.luminance, lab.width, lab.height, EDGE_ON);

  const depthRows = (d, ms, split) => [
    { metric: 'AbsRel', value: absRel(d, lab.gtDepth), dataset, split, column: 'depth' },
    { metric: 'RMSE', value: rmse(d, lab.gtDepth), dataset, split, column: 'depth' },
    { metric: 'delta1.25', value: delta125(d, lab.gtDepth), dataset, split, column: 'depth' },
    { metric: 'medianMs', value: ms, dataset, split, column: 'timing' },
  ];

  const reports = [
    {
      run: 'day1-synthetic-focusOn',
      date,
      commit,
      params: arms({ focusBoost: 0.55 }),
      results: [
        ...depthRows(focusOn.data, focusOn.ms, 'focusOn'),
        { metric: 'IoU', value: iou(focusOn.seg, lab.gtFg), dataset, split: 'focusOn', column: 'seg' },
      ],
    },
    {
      run: 'day1-synthetic-focusOff',
      date,
      commit,
      params: arms({ focusBoost: 0 }),
      results: [
        ...depthRows(focusOff.data, focusOff.ms, 'focusOff'),
        { metric: 'IoU', value: iou(focusOff.seg, lab.gtFg), dataset, split: 'focusOff', column: 'seg' },
      ],
    },
    {
      run: 'day1-synthetic-edgeOn',
      date,
      commit,
      // Kıyas bazı focusOff: iki çalışma YALNIZCA edgeStrength'te ayrışır.
      params: arms({ focusBoost: 0, edgeStrength: 0.35 }),
      results: [
        ...depthRows(edgeOn.data, edgeOn.ms, 'edgeOn'),
        { metric: 'IoU', value: iou(edgeOn.seg, lab.gtFg), dataset, split: 'edgeOn', column: 'seg' },
      ],
    },
  ];

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(reports[0], null, 2));
  writeFileSync(join(OUT_DIR, 'report-focusOff.json'), JSON.stringify(reports[1], null, 2));
  writeFileSync(join(OUT_DIR, 'report-edgeOn.json'), JSON.stringify(reports[2], null, 2));

  // Güvenli arama: eksik metrik özeti ÇÖKERTMEZ ("n/a" basılır) — harness'ın
  // tek satır basma sözü metrik listesinden bağımsızdır.
  const row = (r, metric) => {
    const hit = r.results.find((x) => x.metric === metric);
    return hit ? hit.value : NaN;
  };
  const fmt = (v, digits) => (Number.isFinite(v) ? v.toFixed(digits) : 'n/a');
  console.log(
    `${dataset} ${commit}: depth AbsRel ${fmt(row(reports[0], 'AbsRel'), 3)} (focusOn)` +
      ` / ${fmt(row(reports[1], 'AbsRel'), 3)} (focusOff)` +
      ` · RMSE ${fmt(row(reports[0], 'RMSE'), 3)} / ${fmt(row(reports[1], 'RMSE'), 3)}` +
      ` · IoU ${fmt(row(reports[0], 'IoU'), 3)} / ${fmt(row(reports[1], 'IoU'), 3)}` +
      ` · edge AbsRel ${fmt(row(reports[2], 'AbsRel'), 3)} IoU ${fmt(row(reports[2], 'IoU'), 3)}` +
      ` · timing ${fmt(row(reports[0], 'medianMs'), 2)} ms (medyan, ${TIMED_RUNS} tekrar)`,
  );
}

try {
  main();
} catch (err) {
  // "ASLA KESİLMEZ": satır her koşulda basılır; çıkış kodu hatayı bildirir.
  console.log(`synthetic-lab eval HATA: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
