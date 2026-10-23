import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
assert.ok(existsSync(new URL('../src/engine/vision/mogeDepth.ts', import.meta.url)), 'MoGe runtime must exist');
const ort = await import('onnxruntime-web/webgpu');
let version = 0;
const fresh = () => import(`../src/engine/vision/mogeDepth.ts?verify=${++version}`);
const { unpackMogeOutputs, unpackMogeSidecar } = await fresh();
const tensor = (data, dims) => ({ data: Float32Array.from(data), dims });
const output = () => ({ points: tensor([0, 0, 2, 1, 0, 3, 0, 1, 4, 1, 1, 5], [1, 2, 2, 3]), mask: tensor([1, 1, 1, 0], [1, 2, 2]), metric_scale: tensor([2], [1]) });
{
  const raw = output(), result = unpackMogeOutputs(raw, 2, 2);
  assert.ok(result);
  assert.equal(result.metricScale, 2);
  assert.equal(result.points[2], 2, 'raw Z must not be converted before focal/shift recovery');
  raw.points.data[2] = 99;
  assert.equal(result.points[2], 2, 'own copied output before ORT tensor disposal');
  const published = output(); published.scale = published.metric_scale; delete published.metric_scale;
  assert.equal(unpackMogeOutputs(published, 2, 2).metricScale, 2, 'published graph scale alias accepted');
  for (const mutate of [
    o => { o.points.dims = [1, 3, 2, 2]; },
    o => { o.mask.data[1] = NaN; },
    o => { o.mask.data[0] = 2; },
    o => { o.points.data[1] = Infinity; },
    o => { o.metric_scale.data[0] = -1; },
    o => { o.metric_scale.dims = [1, 1]; },
    o => { o.mask.data.fill(0); },
  ]) { const bad = output(); mutate(bad); assert.equal(unpackMogeOutputs(bad, 2, 2), null); }
}
{
  const packed = tensor([0, 1, 0, 1, 0, 0, 1, 1, 2, 3, 4, 5, 1, 1, 1, 0, 2, 2, 2, 2], [1, 5, 2, 2]);
  const result = unpackMogeSidecar(packed, 2, 2);
  assert.deepEqual([...result.points], [...output().points.data]);
  assert.equal(result.backend, 'sidecar');
  packed.data[19] = 3;
  assert.equal(unpackMogeSidecar(packed, 2, 2), null, 'inconsistent repeated scale rejected');
}

const originalWarn = console.warn, warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));
const input = { data: new Float32Array(3 * 518 * 518), dims: [1, 3, 518, 518] };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => '8' }, body: null, arrayBuffer: async () => new ArrayBuffer(8) });
try {
  delete globalThis.navigator.gpu;
  let creates = 0;
  ort.InferenceSession.create = async () => { creates++; throw new Error('unexpected create'); };
  const unavailable = await fresh();
  assert.equal(await unavailable.inferMoge(input), null);
  assert.equal(creates, 0);
  Object.defineProperty(globalThis.navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({}) } });
  const failed = await fresh();
  ort.InferenceSession.create = async () => { creates++; throw new Error('synthetic shader failure'); };
  assert.equal(await failed.inferMoge(input), null);
  assert.equal(await failed.inferMoge(input), null);
  assert.equal(creates, 1, 'GPU failure disables repeated heavy allocations');
  assert.ok(warnings.some(w => w.includes('synthetic shader failure')));
  const runtimeFailure = await fresh();
  let releases = 0;
  ort.InferenceSession.create = async () => ({ run: async () => { throw new Error('runtime shader failure'); }, release: async () => { releases++; } });
  assert.equal(await runtimeFailure.inferMoge(input), null);
  assert.equal(await runtimeFailure.inferMoge(input), null);
  assert.equal(releases, 1, 'a successfully created session is released once after inference failure');
  const working = await fresh();
  let runs = 0, disposed = 0;
  ort.InferenceSession.create = async (_bytes, options) => {
    assert.deepEqual(options.executionProviders, ['webgpu']);
    return { run: async feeds => {
      runs++;
      assert.deepEqual(feeds.image.dims, [1, 3, 518, 518]);
      assert.deepEqual(feeds.num_tokens.dims, []);
      assert.equal(feeds.num_tokens.data[0], 1800n);
      return { points: { data: new Float32Array(518 * 518 * 3).fill(1), dims: [1, 518, 518, 3], dispose: () => disposed++ }, mask: { data: new Float32Array(518 * 518).fill(1), dims: [1, 518, 518], dispose: () => disposed++ }, metric_scale: { data: Float32Array.of(2), dims: [1], dispose: () => disposed++ } };
    } };
  };
  const result = await working.inferMoge(input);
  assert.equal(result.backend, 'webgpu');
  assert.equal(result.metricScale, 2);
  assert.equal(disposed, 3);
  const invalidInput = { data: Float32Array.of(NaN), dims: [1, 3, 518, 518] };
  assert.equal(await working.inferMoge(invalidInput), null);
  assert.equal(runs, 1);
} finally {
  console.warn = originalWarn;
  globalThis.fetch = originalFetch;
  delete globalThis.navigator.gpu;
}
// A separate process gives the existing module-level sidecar preference a fresh
// localhost environment; the real protocol parser is exercised against fake HTTP.
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  globalThis.location = { hostname: 'localhost', search: '' };
  const n = 518*518, data = new Float32Array(n*5).fill(1);
  data.fill(2,n*4);
  globalThis.fetch = async url => {
    if(url.endsWith('/health')) return {ok:true,json:async()=>({ok:true,arkaUc:'DmlExecutionProvider',modeller:['small','da3','mask','moge']})};
    assert.ok(url.includes('model=moge'));
    return {ok:true,status:200,headers:{get:key=>key==='x-dims'?'1,5,518,518':'1'},arrayBuffer:async()=>data.buffer};
  };
  const {inferMoge}=await import('./src/engine/vision/mogeDepth.ts');
  const result=await inferMoge({data:new Float32Array(n*3),dims:[1,3,518,518]});
  assert.equal(result.backend,'sidecar');
  assert.equal(result.metricScale,2);
  assert.equal(result.points.length,n*3);
`], { cwd: new URL('..', import.meta.url), stdio: 'pipe' });
// Sidecar without MoGe (file absent or session failed): never POST moge, which
// would disable the whole sidecar including the DA3 fallback; browser path follows.
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  globalThis.location = { hostname: 'localhost', search: '' };
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(url);
    if(url.endsWith('/health')) return {ok:true,json:async()=>({ok:true,arkaUc:'DmlExecutionProvider',modeller:['small','da3','mask']})};
    throw new Error('unexpected request '+url);
  };
  console.warn = () => {};
  const {inferMoge}=await import('./src/engine/vision/mogeDepth.ts');
  const {localInference}=await import('./src/engine/sidecarClient.ts');
  assert.equal(await inferMoge({data:new Float32Array(518*518*3),dims:[1,3,518,518]}), null);
  assert.ok(!urls.some(u => u.includes('model=moge')), 'unlisted moge is not requested');
  assert.equal(await localInference.available(), true, 'sidecar stays enabled for DA3');
`], { cwd: new URL('..', import.meta.url), stdio: 'pipe' });
console.log('verify-moge-depth OK (fake runtime; no GPU inference)');
