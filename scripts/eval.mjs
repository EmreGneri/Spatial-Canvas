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
import { applyForegroundStretch, foregroundMask, heightMapFromLuminance, resetLuminanceState, smoothDepthSteps } from '../src/depth.ts';
import { absRel, delta125, foregroundPointShare, iou, medianMs, rmse } from '../src/engine/vision/metrics.ts';
import { makeSmallSubjectLab, makeSyntheticLab } from '../src/engine/vision/lab.ts';
import { sampleVolumePositions } from '../src/engine/reconstruction/sampler.ts';

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

// ---------------------------------------------------------------------------
// GÜN 2 — fotoğraf yolu saf fonksiyonlarının (smoothDepthSteps /
// foregroundMask + applyForegroundStretch) ve önem örneklemesinin yalıtılmış
// kol ölçümleri. Çalışmalar in-place olduğundan HER çalışma TAZE bir GT
// kopyası üzerinde yapılır. ON/OFF yalnızca ilgili işlemde ayrışır
// (tek değişken — D.5), girdi hazırlığı ortaktır.

/** Lab GT derinliğine deterministik yapısal gürültü: her 4. pikselde ±0.03. */
function noiseLabGt(lab) {
  const g = new Float32Array(lab.gtDepth);
  for (let i = 0; i < g.length; i++) {
    const r = i % 4;
    if (r === 0) g[i] += 0.03;
    else if (r === 2) g[i] -= 0.03;
  }
  return g;
}

/** Ön plan bandını (x < mid) [0.6, 0.7] aralığına sıkıştırır — orijinal
 *  0.85 sabit yerine; arka plan (0.3) dokunulmaz. */
function compressFgBand(lab) {
  const g = new Float32Array(lab.gtDepth);
  const mid = Math.floor(lab.width / 2);
  for (let y = 0; y < lab.height; y++) {
    for (let x = 0; x < mid; x++) {
      g[y * lab.width + x] = 0.6 + 0.1 * (x / mid);
    }
  }
  return g;
}

/** İşlemin medyan süresi (D.5: 1 ısınma + TIMED_RUNS tekrar). `fn` her
 *  çağrıda taze girdi üretir (in-place fonksiyon girdiyi değiştirir). */
function medianMsOf(fn) {
  for (let i = 0; i < WARMUP_RUNS; i++) fn();
  const samples = [];
  for (let i = 0; i < TIMED_RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return medianMs(samples);
}

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

  // --- GÜN 2: depth yumuşatma (bilateral) — smoothOn/Off ---
  const smoothNoisy = noiseLabGt(lab);
  const smoothOnMs = medianMsOf(() => smoothDepthSteps(Float32Array.from(smoothNoisy), lab.width, lab.height));
  // smoothDepthSteps IN-PLACE çalışır (dönüş void) — veri kopya üzerinde.
  const smoothOnData = new Float32Array(smoothNoisy);
  smoothDepthSteps(smoothOnData, lab.width, lab.height);
  // smoothOff: işlem UYGULANMAZ — medianMs 0 ("işlem yok"; on/off yalnızca
  // smoothing'de ayrışır).
  const smoothOffData = new Float32Array(smoothNoisy);

  // --- GÜN 2: ön plan gerilmesi — stretchOn/Off ---
  const stretchBase = compressFgBand(lab);
  const stretchOnMs = medianMsOf(() => {
    const g = Float32Array.from(stretchBase);
    applyForegroundStretch(g, foregroundMask(g, lab.width, lab.height), lab.width, lab.height);
  });
  const stretchOnData = Float32Array.from(stretchBase);
  applyForegroundStretch(stretchOnData, foregroundMask(stretchOnData, lab.width, lab.height), lab.width, lab.height);
  const stretchOffData = new Float32Array(stretchBase);

  // --- GÜN 2: önem örneklemesi (küçük özne sahnesi) — importanceOn/Off ---
  const smallLab = makeSmallSubjectLab();
  const imp = (on, split, gridSize) => {
    let positions = new Float32Array(0);
    const ms = medianMsOf(() => {
      positions = sampleVolumePositions(smallLab.gtDepth, smallLab.width, smallLab.height, {
        importanceSampling: on,
        gridSize,
      });
    });
    const share = foregroundPointShare(positions);
    return {
      share,
      rows: [
        { metric: 'foregroundPointShare', value: share, dataset: 'synthetic-small-subject', split, column: 'seg' },
        { metric: 'medianMs', value: ms, dataset: 'synthetic-small-subject', split, column: 'timing' },
      ],
    };
  };
  const impOn64 = imp(true, 'g64', 64);
  const impOn32 = imp(true, 'g32', 32);
  const impOff64 = imp(false, 'g64', 64);
  const impOff32 = imp(false, 'g32', 32);

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
  {
      run: 'day2-smoothOn',
      date,
      commit,
      params: arms({ depthSmoothing: 1 }),
      results: depthRows(smoothOnData, smoothOnMs, 'smoothOn'),
    },
    {
      run: 'day2-smoothOff',
      date,
      commit,
      params: arms({ depthSmoothing: 0 }),
      results: depthRows(smoothOffData, 0, 'smoothOff'),
    },
    {
      run: 'day2-stretchOn',
      date,
      commit,
      params: arms({ foregroundStretch: 1 }),
      results: depthRows(stretchOnData, stretchOnMs, 'stretchOn'),
    },
    {
      run: 'day2-stretchOff',
      date,
      commit,
      params: arms({ foregroundStretch: 0 }),
      results: depthRows(stretchOffData, 0, 'stretchOff'),
    },
    {
      run: 'day2-importanceOn',
      date,
      commit,
      params: arms({ importanceSampling: 1 }),
      results: [...impOn64.rows, ...impOn32.rows],
    },
    {
      run: 'day2-importanceOff',
      date,
      commit,
      params: arms({ importanceSampling: 0 }),
      results: [...impOff64.rows, ...impOff32.rows],
    },
  ];

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(reports[0], null, 2));
  writeFileSync(join(OUT_DIR, 'report-focusOff.json'), JSON.stringify(reports[1], null, 2));
  writeFileSync(join(OUT_DIR, 'report-edgeOn.json'), JSON.stringify(reports[2], null, 2));
  writeFileSync(join(OUT_DIR, 'report-smoothOn.json'), JSON.stringify(reports[3], null, 2));
  writeFileSync(join(OUT_DIR, 'report-smoothOff.json'), JSON.stringify(reports[4], null, 2));
  writeFileSync(join(OUT_DIR, 'report-stretchOn.json'), JSON.stringify(reports[5], null, 2));
  writeFileSync(join(OUT_DIR, 'report-stretchOff.json'), JSON.stringify(reports[6], null, 2));
  writeFileSync(join(OUT_DIR, 'report-importanceOn.json'), JSON.stringify(reports[7], null, 2));
  writeFileSync(join(OUT_DIR, 'report-importanceOff.json'), JSON.stringify(reports[8], null, 2));

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
      ` · timing ${fmt(row(reports[0], 'medianMs'), 2)} ms (medyan, ${TIMED_RUNS} tekrar)` +
      ` · smooth AbsRel ${fmt(row(reports[3], 'AbsRel'), 3)}→${fmt(row(reports[4], 'AbsRel'), 3)}` +
      ` · stretch AbsRel ${fmt(row(reports[5], 'AbsRel'), 3)}→${fmt(row(reports[6], 'AbsRel'), 3)}` +
      ` · fgShare ${fmt(row(reports[7], 'foregroundPointShare'), 3)}→${fmt(row(reports[8], 'foregroundPointShare'), 3)} (on→off, g64)`,
  );
}

try {
  main();
} catch (err) {
  // "ASLA KESİLMEZ": satır her koşulda basılır; çıkış kodu hatayı bildirir.
  // Stack stderr'e (stdout'un tek satır sözü bozulmaz) — hata kaynağı ayrışır.
  console.log(`synthetic-lab eval HATA: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error) console.error(err.stack);
  process.exitCode = 1;
}
