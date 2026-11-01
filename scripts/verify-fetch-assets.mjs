// Yalnız sahte küçük yanıtlar: üretim indirme giriş noktasını içeri aktarmaz.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, readdir, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { downloadAsset, warnUnknownAssets } from './download-asset.mjs';
import { assetEnvironment, assetManifest, MANAGED_ASSET_DIRS } from './asset-manifest.mjs';

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
  assert.match(warnings[0], /9 bytes.*excluded from build/);
  assert.equal(await readFile(unknown, 'utf8'), 'keep this');
  const broken = join(root, 'broken-local-model.onnx');
  await mkdir(join(root, 'missing-target'));
  await symlink(join(root, 'missing-target'), broken, process.platform === 'win32' ? 'junction' : 'file');
  await rm(join(root, 'missing-target'), { recursive: true });
  const brokenWarnings = [];
  await assert.doesNotReject(warnUnknownAssets(root, new Set(['model.onnx', 'local-experiment.onnx']), message => brokenWarnings.push(message)), 'omitted dangling symlink must not fail the build');
  assert.ok((await lstat(broken)).isSymbolicLink());
  assert.ok(brokenWarnings.some(message => message.includes('broken-local-model.onnx')));
  const racing = join(root, 'racing');
  await mkdir(racing);
  const racingFiles = ['one.onnx', 'two.onnx'].map(file => join(racing, file));
  for (const file of racingFiles) await writeFile(file, 'temporary');
  const raceWarnings = [];
  await assert.doesNotReject(warnUnknownAssets(racing, new Set(), message => {
    raceWarnings.push(message);
    if (raceWarnings.length === 1) for (const file of racingFiles) unlinkSync(file);
  }), 'a removed omitted file must not fail the build while logging');
  assert.equal(raceWarnings.length, 2);
  assert.match(raceWarnings[1], /unknown size/);

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
  const { build, createLogger, createServer } = await import('vite');
  const fixture = join(root, 'build-fixture'), publicDir = join(fixture, 'public');
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(fixture, 'entry.js'), 'export const fixture = 1;');
  await writeFile(join(publicDir, 'visible.txt'), 'ordinary public asset');
  await writeFile(join(publicDir, 'collision.txt'), 'old public content');
  await mkdir(join(publicDir, 'fonts'), { recursive: true });
  await writeFile(join(publicDir, 'fonts', 'fixture.woff2'), 'ordinary nested asset');
  const allFlags = { VITE_DAVID_PHOTO: '1', VITE_MOGE2_PHOTO: '1', VITE_FAST_MASK: '1' };
  const allAssets = assetManifest(allFlags);
  const defaults = assetManifest({}).map(asset => asset.path);
  assert.ok(defaults.some(path => /microsoft-david\/[a-f0-9]{40}\/.*int8\.onnx$/.test(path)), 'default int8 DAViD mask must still ship');
  assert.ok(!defaults.some(path => /microsoft-david\/(depth|foreground)-.*\.onnx$/.test(path)), 'fp32 DAViD must require its build flag');
  assert.ok(!defaults.some(path => /moge-2|selfie_.*\.tflite|video-depth-anything/.test(path)), 'optional local models must not leak into the default build');
  assert.equal(assetManifest({ VITE_DAVID_PHOTO: '1' }).length - defaults.length, 2);
  assert.equal(assetManifest({ VITE_MOGE2_PHOTO: '1' }).length - defaults.length, 1);
  assert.equal(assetManifest({ VITE_FAST_MASK: '1' }).length - defaults.length, 2);
  assert.deepEqual(assetManifest(Object.fromEntries(Object.keys(allFlags).map(key => [key, '0']))).map(asset => asset.path), defaults);
  assert.equal(new Set(allAssets.map(asset => asset.path)).size, allAssets.length, 'manifest paths must be unique');
  for (const asset of allAssets) {
    await mkdir(dirname(join(publicDir, asset.path)), { recursive: true });
    await writeFile(join(publicDir, asset.path), `fixture:${asset.path}`);
  }
  const unknowns = ['models/local-experiment.onnx', 'ort/local-experiment.wasm', 'mediapipe-wasm/local-experiment.wasm',
    'models/DepthAnything/video-depth-anything-small-stream-154x266/encoder_fp16.onnx'];
  for (const path of unknowns) {
    await mkdir(dirname(join(publicDir, path)), { recursive: true });
    await writeFile(join(publicDir, path), 'private fixture');
  }
  const originalEnv = Object.fromEntries(Object.keys(allFlags).map(key => [key, process.env[key]]));
  try {
    for (const flags of [{}, { VITE_DAVID_PHOTO: '1' }, { VITE_MOGE2_PHOTO: '1' }, { VITE_FAST_MASK: '1' }, allFlags]) {
      for (const key of Object.keys(allFlags)) { if (flags[key]) process.env[key] = flags[key]; else delete process.env[key]; }
      const logs = [];
      const output = join(fixture, 'dist');
      await build({ configFile: resolve('vite.config.ts'), root: fixture, publicDir, logLevel: 'silent',
        plugins: [{ name: 'fixture-generated-asset', generateBundle() { this.emitFile({ type: 'asset', fileName: 'collision.txt', source: 'generated production content' }); } }],
        customLogger: { ...createLogger(), info: message => logs.push(message) },
        build: { outDir: output, rollupOptions: { input: join(fixture, 'entry.js') } } });
      const expected = assetManifest(flags).map(asset => asset.path).sort();
      const published = [];
      for (const directory of MANAGED_ASSET_DIRS) {
        const entries = await readdir(join(output, directory), { recursive: true, withFileTypes: true });
        for (const entry of entries) if (entry.isFile()) published.push(join(entry.parentPath, entry.name).slice(output.length + 1).replaceAll('\\', '/'));
      }
      assert.deepEqual(published.sort(), expected, 'actual build must publish exactly the active shared manifest');
      for (const path of [...allAssets.map(asset => asset.path), ...unknowns]) {
        const original = await readFile(join(publicDir, path), 'utf8');
        if (expected.includes(path)) assert.equal(await readFile(join(output, path), 'utf8'), original);
        else {
          assert.equal(await stat(join(output, path)).catch(() => null), null, `${path}: omitted asset must never be copied`);
          assert.ok(logs.some(line => line.includes(path.replaceAll('/', process.platform === 'win32' ? '\\' : '/')) && line.includes(`${Buffer.byteLength(original)} bytes`)), `${path}: exclusion log must include path and byte size`);
        }
      }
      assert.equal(await readFile(join(output, 'visible.txt'), 'utf8'), 'ordinary public asset');
      assert.equal(await readFile(join(output, 'collision.txt'), 'utf8'), 'generated production content', 'generated output must win over same-path public assets');
      assert.equal(await readFile(join(output, 'fonts', 'fixture.woff2'), 'utf8'), 'ordinary nested asset');
    }
    for (const key of Object.keys(allFlags)) delete process.env[key];
    await writeFile(join(fixture, '.env'), Object.keys(allFlags).map(key => `${key}=0`).join('\n'));
    await writeFile(join(fixture, '.env.local'), 'VITE_FAST_MASK=1');
    await writeFile(join(fixture, '.env.production'), 'VITE_MOGE2_PHOTO=1\nVITE_DAVID_PHOTO=1\nVITE_FAST_MASK=0');
    await writeFile(join(fixture, '.env.production.local'), 'VITE_FAST_MASK=1');
    assert.deepEqual(assetManifest(assetEnvironment('production', fixture)).map(asset => asset.path), allAssets.map(asset => asset.path), 'fetch must use the same production dotenv flags as Vite');
    await build({ configFile: resolve('vite.config.ts'), root: fixture, publicDir, logLevel: 'silent',
      build: { outDir: join(fixture, 'dist'), rollupOptions: { input: join(fixture, 'entry.js') } } });
    for (const asset of allAssets) assert.ok(await stat(join(fixture, 'dist', asset.path)).catch(() => null), `.env.production must enable ${asset.path}`);
    for (const key of Object.keys(allFlags)) process.env[key] = '0';
    assert.deepEqual(assetManifest(assetEnvironment('production', fixture)).map(asset => asset.path), defaults, 'shell values must override dotenv flags during fetch');
    await build({ configFile: resolve('vite.config.ts'), root: fixture, publicDir, logLevel: 'silent',
      build: { outDir: join(fixture, 'dist'), rollupOptions: { input: join(fixture, 'entry.js') } } });
    for (const asset of allAssets) assert.equal(Boolean(await stat(join(fixture, 'dist', asset.path)).catch(() => null)), defaults.includes(asset.path), 'build shell overrides must match the download manifest');
    await assert.rejects(build({ configFile: resolve('vite.config.ts'), root: fixture, publicDir, logLevel: 'silent',
      build: { outDir: publicDir, rollupOptions: { input: join(fixture, 'entry.js') } } }), /separate directories/);
    assert.equal(await readFile(join(publicDir, unknowns[0]), 'utf8'), 'private fixture', 'unsafe output must be rejected before clearing public assets');
    // The project config also carries the dev sidecar plugin; a unit test must not start Python.
    process.env.SIDECAR_OTOMATIK ??= '0';
    const server = await createServer({ configFile: resolve('vite.config.ts'), root: fixture, publicDir, logLevel: 'silent', server: { port: 0, host: '127.0.0.1' } });
    try {
      await server.listen();
      const address = server.httpServer.address();
      assert.equal(await (await fetch(`http://127.0.0.1:${address.port}/${unknowns[0]}`)).text(), 'private fixture', 'dev server must still serve local models');
    } finally { await server.close(); }
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  console.log('PASS asset downloads: integrity, atomic failure, existing file, unknown preservation, build wiring');
} finally {
  await rm(root, { recursive: true, force: true });
}
