import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const clipPath = resolve(ROOT, process.argv[2] ?? 'public/nyc.mp4');
const spatialPath = resolve(ROOT, process.argv[3] ?? 'docs/benchmarks/e4-spatial-nyc.json');
const brushPath = process.argv[4] ? resolve(ROOT, process.argv[4]) : null;
const outputPath = resolve(ROOT, 'eval-out/e4-comparison.md');

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function loadRun(path, clipHash) {
  const run = JSON.parse(readFileSync(path, 'utf8'));
  if (run.clipSha256?.toLowerCase() !== clipHash) {
    throw new Error(`${path}: clip SHA-256 does not match ${clipPath}`);
  }
  for (const field of ['engine', 'setupSteps', 'durationMs', 'splats', 'heldOutPsnrDb']) {
    if (!(field in run)) throw new Error(`${path}: missing ${field}`);
  }
  if (!Array.isArray(run.setupSteps)) throw new Error(`${path}: setupSteps must be an array`);
  return run;
}

const clipHash = await hashFile(clipPath);
const spatial = loadRun(spatialPath, clipHash);
const brush = brushPath ? loadRun(brushPath, clipHash) : null;
const sameFrames = !!(brush && spatial.frameSetSha256 &&
  spatial.frameSetSha256 === brush.frameSetSha256);
const fmt = (value, unit = '') => value == null ? 'ölçülmedi' : `${value}${unit}`;

const lines = [
  '# E4 · Aynı klip karşılaştırması',
  '',
  `Klip: \`${basename(clipPath)}\` · SHA-256 \`${clipHash}\``,
  '',
  '| Ölçüt | Spatial Canvas | Brush |',
  '|---|---:|---:|',
  `| Kurulum adımı (gerçekte yapılan) | ${spatial.setupSteps.length} | ${brush ? brush.setupSteps.length : 'ölçülmedi'} |`,
  `| Yakalama + işleme (ms) | ${fmt(spatial.durationMs)} | ${fmt(brush?.durationMs)} |`,
  `| Splat sayısı | ${fmt(spatial.splats)} | ${fmt(brush?.splats)} |`,
  `| Ayrılmış kare PSNR (dB) | ${sameFrames ? fmt(spatial.heldOutPsnrDb) : 'karşılaştırılamaz'} | ${sameFrames ? fmt(brush?.heldOutPsnrDb) : 'karşılaştırılamaz'} |`,
  '',
  sameFrames
    ? 'Kare kümesi SHA-256 eşleşiyor; aynı görüntülerle çalışıldı.'
    : 'Kare kümesi SHA-256 eşleşmedi veya ölçülmedi. Süre ve kalite için doğrudan üstünlük iddiası kurulamaz.',
  '',
  `Spatial kaynak: \`${spatialPath}\`. ${brushPath ? `Brush kaynak: \`${brushPath}\`.` : 'Brush koşusu henüz sağlanmadı.'}`,
  '',
];
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, lines.join('\n'));
console.log(lines.join('\n'));
console.log(`Report: ${outputPath}`);
