// Serial, paired production runs avoid concurrent GPU inference and preserve every raw result.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const args = process.argv.slice(2);
const opt = (n, d) => args.includes(n) ? args[args.indexOf(n) + 1] : d;
const phase = opt('--phase', 'before'), base = opt('--base-url', 'http://127.0.0.1:4175');
const out = 'docs/benchmarks/photo-raw', fixture = join(tmpdir(), 'spatial-photo-12mp.jpg');
mkdirSync(out, { recursive: true });
const run = options => {
  const result = spawnSync(process.execPath, ['scripts/bench-photo-david.mjs', ...options], { stdio: 'inherit', timeout: 1900000 });
  if (result.status !== 0) throw Error(`Benchmark failed (${result.status}): ${options.join(' ')}`);
};
if (!existsSync(fixture)) run(['--base-url', base, '--make-12mp', '--fixture-out', fixture]);
const buildBytes = readFileSync('dist/index.html');
writeFileSync(`${out}/${phase}-build.json`, JSON.stringify({ phase, base, recordedAt: new Date().toISOString(),
  buildIndexSha256: createHash('sha256').update(buildBytes).digest('hex'),
  fixture12mp: { path: fixture, size: readFileSync(fixture).length, sha256: createHash('sha256').update(readFileSync(fixture)).digest('hex'),
    limitation: 'Upscaled thumbnail, 4000x3000 JPEG: decode/geometry/memory stress only; not real camera texture or EXIF.' },
  thermal: 'Not instrumented; serial alternating cells avoid simultaneous inference. No thermal-equivalence claim.' }, null, 2));
const cells = [[100, 'thumbnail'], [10, '12mp'], [10, 'thumbnail'], [100, '12mp']];
for (let repeat = 1; repeat <= 3; repeat++) {
  for (const [mbps, image] of repeat % 2 ? cells : [...cells].reverse()) {
    const label = `${phase}-${image}-${mbps}-${repeat}`, path = `${out}/${label}.json`;
    if (existsSync(path)) {
      const rows = JSON.parse(readFileSync(path));
      if (rows.length === 2 && rows.every(r => !r.failure && r.report?.status === 'ready')) { console.log(`SKIP completed ${label}`); continue; }
      throw Error(`Incomplete evidence already exists: ${path}. Preserve it and investigate before retry.`);
    }
    console.log(`START ${label} ${new Date().toISOString()}`);
    run(['--base-url', base, '--image', image === '12mp' ? fixture : 'assets/thumbnail.jpg', '--mbps', String(mbps), '--out', out, '--label', label]);
  }
}
if (phase === 'before' && args.includes('--live')) for (let repeat = 1; repeat <= 3; repeat++) {
  const label = `live-thumbnail-100-${repeat}`;
  run(['--base-url', 'https://spatial-canvas-tau.vercel.app', '--mbps', '100', '--out', out, '--label', label]);
}
