// DAViD mask bytes prefetch (audit item 13): bytes only, one download, plan + network gates, isolated failure (fake fetch; no GPU).
//   node scripts/verify-david-prefetch.mjs
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Each case in its own process: davidDepth/sidecarClient keep module state and read `location` at import.
const kos = (ad, kod, hostname = 'example.com') => {
  try { execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    globalThis.location = { hostname: ${JSON.stringify(hostname)}, origin: 'https://' + ${JSON.stringify(hostname)}, search: '' };
    console.warn = () => {};
    const ort = await import('onnxruntime-web/webgpu');
    const S = 512, n = S * S, model = [], oncelik = [];
    let olusan = 0, hata = 0;
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith('/health')) return { ok: true, json: async () => ({ ok: true, arkaUc: 'DmlExecutionProvider', modeller: globalThis.yardimciModelleri ?? [] }) };
      model.push(url); oncelik.push(init.priority);
      if (hata > 0) { hata--; throw new Error('offline fixture'); }
      return { ok: true, status: 200, headers: { get: () => '8' }, body: null, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    const baglanti = c => Object.defineProperty(globalThis.navigator, 'connection', { value: c, configurable: true });
    ort.InferenceSession.create = async () => { olusan++; return { inputNames: ['input'], outputNames: ['output'],
      run: async () => ({ output: { data: new Float32Array(n).fill(0.25), dims: [1, 1, S, S], dispose() {} } }) }; };
    const araclar = { gpuSirasinaGir: f => f(), onceRetry: f => { let c = null; return () => c ??= f().catch(e => { c = null; throw e; }); }, webgpuKullanilabilir: async () => true };
    const rgba = new Uint8ClampedArray(4 * n);
    ${kod}
  `], { cwd: new URL('..', import.meta.url), stdio: 'pipe' }); }
  catch (e) { console.error(`  ✗ ${ad}\n${e.stderr}`); process.exit(1); }
  console.log(`  ✓ ${ad}`);
};

kos('prefetch + later use: one low-priority download, no session before use, later photos reuse', `
  baglanti({ saveData: false, effectiveType: '4g' });
  const d = await import('./src/engine/vision/davidDepth.ts');
  await Promise.all([d.preloadDavidMaskBytes({ tarayici: true }, araclar), d.preloadDavidMaskBytes({ tarayici: true }, araclar)]);
  assert.equal(model.length, 1, 'concurrent prefetches share one download');
  assert.deepEqual(oncelik, ['low'], 'prefetch is low priority');
  assert.equal(olusan, 0, 'prefetch never creates an ORT session');
  assert.equal((await d.inferDavidMaske(rgba, araclar, { tarayici: true })).arkaUc, 'webgpu');
  assert.equal(model.length, 1, 'inference reuses the prefetched bytes');
  await d.preloadDavidMaskBytes({ tarayici: true }, araclar);
  assert.equal(model.length, 1, 'session exists: a second photo downloads nothing');
  assert.equal(olusan, 1);
`);

kos('no prefetch on Save-Data or slow networks; the final path still downloads on use', `
  const d = await import('./src/engine/vision/davidDepth.ts');
  for (const c of [{ saveData: true, effectiveType: '4g' }, { effectiveType: 'slow-2g' }, { effectiveType: '2g' }, { effectiveType: '3g' }]) {
    baglanti(c);
    await d.preloadDavidMaskBytes({ tarayici: true }, araclar);
  }
  assert.deepEqual(model, []);
  assert.equal((await d.inferDavidMaske(rgba, araclar, { tarayici: true })).arkaUc, 'webgpu');
  assert.equal(model.length, 1);
`);

kos('no prefetch: plan says sidecar/none, WebGPU missing', `
  const d = await import('./src/engine/vision/davidDepth.ts');
  await d.preloadDavidMaskBytes({ tarayici: false }, araclar);
  await d.preloadDavidMaskBytes({ tarayici: true }, { ...araclar, webgpuKullanilabilir: async () => false });
  assert.deepEqual(model, []);
`);

kos('no prefetch: sidecar lists david-mask (browser path not reached)', `
  globalThis.yardimciModelleri = ['small', 'david-mask'];
  const d = await import('./src/engine/vision/davidDepth.ts');
  await d.preloadDavidMaskBytes({ tarayici: true }, araclar);
  assert.deepEqual(model, []);
`, 'localhost');

kos('depth.ts gate: user-disabled, sidecar, or no mask coming => nothing downloaded', `
  globalThis.yardimciModelleri = ['small', 'david-mask'];
  const { davidMaskesiniOnceIndir } = await import('./src/depth.ts');
  await davidMaskesiniOnceIndir(undefined, true);
  await davidMaskesiniOnceIndir('otomatik', true);
  await davidMaskesiniOnceIndir('david', false);
  assert.deepEqual(model, []);
`, 'localhost');

kos('prefetch failure does not break the final path', `
  hata = 2; // deployment asset and HF fallback both fail once
  const d = await import('./src/engine/vision/davidDepth.ts');
  await assert.rejects(d.preloadDavidMaskBytes({ tarayici: true }, araclar));
  const r = await d.inferDavidMaske(rgba, araclar, { tarayici: true });
  assert.equal(r?.arkaUc, 'webgpu', 'final path downloads again and runs');
  assert.equal(model.length, 3);
`);

kos('cache hit: prefetch + use read Cache Storage once, no network', `
  const { DAVID_MASK_REMOTE } = await import('./src/engine/vision/davidMaskAsset.ts');
  let okunan = 0;
  globalThis.caches = { open: async () => ({ match: async url => url === DAVID_MASK_REMOTE ? { arrayBuffer: async () => { okunan++; return new ArrayBuffer(8); } } : undefined, put: async () => {} }) };
  const d = await import('./src/engine/vision/davidDepth.ts');
  await d.preloadDavidMaskBytes({ tarayici: true }, araclar);
  assert.equal((await d.inferDavidMaske(rgba, araclar, { tarayici: true })).arkaUc, 'webgpu');
  assert.deepEqual(model, []);
  assert.equal(okunan, 1);
`);
kos('discarded source releases completed bytes; stale release does not clear a later source', `
  const d = await import('./src/engine/vision/davidDepth.ts');
  const old = {}, next = {};
  await d.preloadDavidMaskBytes({ tarayici: true }, araclar, old);
  const releaseOld = old.release;
  old.released = true; old.release?.();
  await d.preloadDavidMaskBytes({ tarayici: true }, araclar, next);
  assert.equal(model.length, 2, 'unused completed bytes must not stay memoized after source finishes');
  releaseOld?.();
  assert.equal((await d.inferDavidMaske(rgba, araclar, { tarayici: true })).arkaUc, 'webgpu');
  assert.equal(model.length, 2, 'an old source cannot discard a newer source download');
  next.released = true; next.release?.();
`);

kos('concurrent rejected and accepted sources keep one download and one session', `
  const d = await import('./src/engine/vision/davidDepth.ts');
  const rejected = {}, accepted = {};
  await Promise.all([d.preloadDavidMaskBytes({ tarayici: true }, araclar, rejected), d.preloadDavidMaskBytes({ tarayici: true }, araclar, accepted)]);
  rejected.released = true; rejected.release?.();
  await Promise.all([d.inferDavidMaske(rgba, araclar, { tarayici: true }), d.inferDavidMaske(rgba, araclar, { tarayici: true })]);
  accepted.released = true; accepted.release?.();
  assert.equal(model.length, 1, 'discarding one source must preserve another source lease');
  assert.equal(olusan, 1);
`);

kos('pending download completes without abort; a concurrent accepted source reuses it', `
  const d = await import('./src/engine/vision/davidDepth.ts');
  const rejected = {}, accepted = {};
  const originalFetch = fetch;
  let complete, opened;
  const started = new Promise(resolve => { opened = resolve; });
  const gate = new Promise(resolve => { complete = resolve; });
  globalThis.fetch = async (...args) => { const response = await originalFetch(...args); opened(); await gate; return response; };
  const first = d.preloadDavidMaskBytes({ tarayici: true }, araclar, rejected);
  await started;
  rejected.released = true; rejected.release?.();
  const second = d.preloadDavidMaskBytes({ tarayici: true }, araclar, accepted);
  complete(); await Promise.all([first, second]);
  assert.equal((await d.inferDavidMaske(rgba, araclar, { tarayici: true })).arkaUc, 'webgpu');
  accepted.released = true; accepted.release?.();
  assert.equal(model.length, 1);
  assert.equal(olusan, 1);
`);

kos('source released during capability check never starts an unused download', `
  const d = await import('./src/engine/vision/davidDepth.ts');
  const lease = {};
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const pending = d.preloadDavidMaskBytes({ tarayici: true }, { webgpuKullanilabilir: () => gate }, lease);
  lease.released = true;
  finish(true); await pending;
  assert.equal(model.length, 0);
`);

// Exercise the real photo orchestration: source completion/error owns cleanup, not the model consumer.
{
  const source = await readFile(new URL('../src/depth.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function estimateDepth(');
  const end = source.indexOf('\n/** DAViD ön plan maskesi', start);
  const code = stripTypeScriptTypes(source.slice(start, end).replace('export async', 'async'));
  const leases = [];
  let releases = 0;
  const bindings = {
    currentPhotoMeasurement: () => null, loadDepthModel: async () => ({}), sidecarEstimators: new WeakSet(),
    tarayiciCihazi: 'webgpu', depthDevice: 'webgpu', MODEL_INPUT_SIZE: 518,
    loadTransformers: async () => ({ RawImage: { fromCanvas: async () => ({}) } }),
    toCanvas: x => x, scaleCanvasTo: x => x,
    DETAIL_STRENGTH_DEFAULT: 0, FOREGROUND_STRETCH_DEFAULT: false, SOBEL_RELIEF_DEFAULT: 0, DEPTH_SMOOTHING_DEFAULT: false,
    runPhotoModel: async () => ({ predicted_depth: { data: new Float32Array(4), dims: [1, 2, 2] }, photoModel: 'v2-small' }),
    normalizeDepth: data => Float32Array.from(data), limitDepthSlope: data => data,
    davidMaskesiniOnceIndir: async (_selection, _expected, lease) => { leases.push(lease); lease.release = () => { releases++; }; },
    applyDavidMask: async () => null,
  };
  const estimate = new Function(...Object.keys(bindings), `${code}; return estimateDepth;`)(...Object.values(bindings));
  await estimate({}, { aspect: 'distort', prepareSubjectMask: async () => undefined });
  assert.equal(releases, 1, 'rejected mask must release its source lease');
  assert.equal(leases[0].released, true);
  const error = new Error('source changed during mask preparation');
  await assert.rejects(estimate({}, { aspect: 'distort', prepareSubjectMask: async () => { throw error; } }), e => e === error);
  assert.equal(releases, 2, 'source cancellation/error must release its own lease');
  assert.equal(leases[1].released, true);
  assert.notEqual(leases[0], leases[1], 'each photo owns a separate lease');
  console.log('  ✓ estimateDepth releases its source lease after rejected mask and preparation error');
}
console.log('OK DAViD mask prefetch: single download, Save-Data/slow-network and plan gates, isolated failure, cache hit, source leases');
