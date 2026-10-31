// DAViD mask bytes prefetch (audit item 13): bytes only, one download, plan + network gates, isolated failure (fake fetch; no GPU).
//   node scripts/verify-david-prefetch.mjs
import { execFileSync } from 'node:child_process';

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
console.log('OK DAViD mask prefetch: single download, Save-Data/slow-network and plan gates, isolated failure, cache hit');
