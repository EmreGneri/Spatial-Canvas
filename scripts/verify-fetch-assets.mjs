// Yalnız sahte küçük yanıtlar: üretim indirme giriş noktasını içeri aktarmaz.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadAsset, warnUnknownAssets } from './download-asset.mjs';

const root = await mkdtemp(join(tmpdir(), 'verify-assets-'));
const good = Buffer.from('verified fixture');
const dest = join(root, 'model.onnx');
const model = { url: 'https://fixture.invalid/model', dest, size: good.length,
  sha256: createHash('sha256').update(good).digest('hex') };
let calls = 0;
const fetchGood = async () => { calls++; return new Response(good); };
try {
  await writeFile(dest, good);
  assert.equal(await downloadAsset(model, fetchGood), 'skip');
  assert.equal(calls, 0, 'correct existing asset must not fetch');

  await writeFile(dest, Buffer.alloc(good.length, 1));
  await writeFile(`${dest}.part`, 'stale interrupted attempt');
  assert.equal(await downloadAsset(model, fetchGood), 'download');
  assert.deepEqual(await readFile(dest), good);

  const old = Buffer.from('old invalid file');
  await writeFile(dest, old);
  await assert.rejects(downloadAsset(model, async () => new Response(Buffer.alloc(good.length))), /integrity mismatch/);
  assert.deepEqual(await readFile(dest), old, 'hash failure must preserve existing target');
  assert.equal(await stat(`${dest}.part`).catch(() => null), null);

  await assert.rejects(downloadAsset(model, async () => new Response(good.subarray(0, 3))), /integrity mismatch/);
  await assert.rejects(downloadAsset(model, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(good.subarray(0, 3)); controller.error(new Error('connection interrupted')); },
  }))), /connection interrupted/);
  await assert.rejects(downloadAsset(model, async () => new Response(Buffer.alloc(good.length + 1))), /exceeds expected/);
  await assert.rejects(downloadAsset(model, async () => new Response('', { status: 503 })), /503/);
  assert.deepEqual(await readFile(dest), old);
  assert.equal(await stat(`${dest}.part`).catch(() => null), null);

  const unknown = join(root, 'local-experiment.onnx');
  await writeFile(unknown, 'keep this');
  const warnings = [];
  await warnUnknownAssets(root, new Set(['model.onnx']), message => warnings.push(message));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /local-experiment.onnx/);
  assert.equal(await readFile(unknown, 'utf8'), 'keep this');

  const manifest = JSON.parse(await readFile(new URL('./model-assets.json', import.meta.url), 'utf8'));
  for (const repo of manifest) {
    assert.match(repo.rev, /^[a-f0-9]{40}$/);
    for (const file of repo.files) {
      assert.ok(file.size > 0);
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
    }
  }
  const script = await readFile(new URL('./fetch-assets.mjs', import.meta.url), 'utf8');
  assert.ok(!script.includes('/resolve/main/'));
  assert.ok(script.includes('FETCH_ASSETS_PUBLIC_DIR'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['fetch:assets'], 'node scripts/fetch-assets.mjs');
  assert.ok(pkg.scripts.build.startsWith('npm run fetch:assets && '));
  assert.equal(vercel.buildCommand, 'npm run build');
  console.log('PASS asset downloads: integrity, atomic failure, existing file, unknown preservation, build wiring');
} finally {
  await rm(root, { recursive: true, force: true });
}
