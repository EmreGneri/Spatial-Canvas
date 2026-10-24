// Real fixed-binding WebGPU inference: run after other GPU benchmarks have finished.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';
const result = { started: new Date().toISOString(), mode: 'vda-gpu-resident' };
const context = process.argv.includes('--context16') ? 16 : 32;
const fixtureDir = `.bench-tmp/vda-fixtures-context${context}`;
mkdirSync(fixtureDir, { recursive: true });
for (const name of ['pixels0', 'pixels1', 'depth0', 'depth1']) {
  const source = `public/models/DepthAnything/video-depth-anything-small-stream-154x266${context === 16 ? '-context16' : ''}/parity-${name}.bin`;
  if (existsSync(source)) copyFileSync(source, `${fixtureDir}/parity-${name}.bin`);
  if (!existsSync(`${fixtureDir}/parity-${name}.bin`)) throw Error(`Missing context${context} parity fixture; run the VDA exporter before this benchmark`);
}
const session = await tarayiciOturumu({ chrome: true, basli: true });
try {
  await session.page.route('**/__vda_fixture/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!['pixels0', 'pixels1', 'depth0', 'depth1'].includes(name)) return route.abort();
    return route.fulfill({ contentType: 'application/octet-stream', body: readFileSync(`${fixtureDir}/parity-${name}.bin`) });
  });
  await session.page.route('**/__vda_gpu', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>VDA GPU cache benchmark</h1><pre>Running real ONNX inference</pre>' }));
  await session.page.goto(session.url('/__vda_gpu'));
  session.page.on('console', msg => console.log('[browser]', msg.text()));
  Object.assign(result, await session.page.evaluate(async ({ context, compare }) => {
    const ort = await import('/node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs');
    const { openVdaGpuStream } = await import('/src/engine/vision/vdaGpu.ts');
    const { createVdaStream } = await import('/src/engine/vision/videoDepthAnything.ts');
    ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/'; ort.env.wasm.numThreads = 1;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('shader-f16') ? ['shader-f16'] : [] });
    ort.env.webgpu.device = device;
    const base = `/models/DepthAnything/video-depth-anything-small-stream-154x266${context === 16 ? '-context16' : ''}/`;
    const load = async name => new Float32Array(await (await fetch('/__vda_fixture/' + name)).arrayBuffer());
    const pixels = [await load('pixels0'), await load('pixels1')], reference = [await load('depth0'), await load('depth1')];
    const legacyOutputs = [], legacySessions = [];
    if (compare && context === 32) {
      const runners = {};
      for (const name of ['encoder', 'bootstrap', 'stream']) {
        const legacy = await ort.InferenceSession.create(base + name + '_fp16.onnx', { executionProviders: ['webgpu'] });
        legacySessions.push(legacy);
        runners[name] = async feeds => {
          const input = Object.fromEntries(Object.entries(feeds).map(([name, t]) => [name, new ort.Tensor('float32', t.data, t.dims)]));
          const output = await legacy.run(input);
          const result = Object.fromEntries(Object.entries(output).map(([name, t]) => [name, { dims: t.dims, data: new Float32Array(t.data) }]));
          [...Object.values(input), ...Object.values(output)].forEach(t => t.dispose());
          return result;
        };
      }
      const legacy = createVdaStream(runners);
      for (let index = 0; index < 48; index++) legacyOutputs.push(await legacy.infer(pixels[index % 2]));
      for (const session of legacySessions) await session.release();
      console.log('48-frame legacy reference ready');
    }
    const modes = [];
    for (const capture of [false, true]) {
      let stream;
      const row = { capture, timings: [], parity: [] };
      try {
        stream = await openVdaGpuStream(ort, base, capture, task => task(), context);
        row.sequenceMaxAbsolute = 0;
        for (let index = 0; index < (compare ? 48 : 12); index++) {
          const start = performance.now(), output = await stream.infer(pixels[index % 2]);
          row.timings.push(performance.now() - start);
          if (index < 2) {
            let maxAbsolute = 0, squared = 0;
            for (let i = 0; i < output.length; i++) { const delta = output[i] - reference[index][i]; maxAbsolute = Math.max(maxAbsolute, Math.abs(delta)); squared += delta * delta; }
            const rmse = Math.sqrt(squared / output.length); row.parity.push({ maxAbsolute, rmse });
            if (rmse > 0.08) throw Error('GPU cache depth differs from parity fixture');
          }
          if (legacyOutputs[index]) {
            for (let i = 0; i < output.length; i++) row.sequenceMaxAbsolute = Math.max(row.sequenceMaxAbsolute, Math.abs(output[i] - legacyOutputs[index][i]));
            if (row.sequenceMaxAbsolute > 0.001) throw Error(`GPU cache differs from legacy after frame ${index}: ${row.sequenceMaxAbsolute}`);
          }
        }
        const warm = row.timings.slice(3).sort((a, b) => a - b);
        row.meanMs = warm.reduce((a, b) => a + b) / warm.length; row.hz = 1000 / row.meanMs; row.p95Ms = warm[Math.ceil(warm.length * .95) - 1];
        stream.reset(); await stream.infer(pixels[0]);
        if (stream.frames() !== 1) throw Error('GPU reset failed');
      } catch (error) { row.error = String(error); }
      finally { await stream?.dispose(); }
      modes.push(row); console.log(JSON.stringify(row));
    }
    const actual = (await ort.env.webgpu.device).adapterInfo ?? ort.env.webgpu.adapter?.info ?? adapter.info;
    return { context, comparedFrames: legacyOutputs.length, adapter: { vendor: actual.vendor, architecture: actual.architecture, device: actual.device, description: actual.description }, modes };
  }, { context, compare: process.argv.includes('--compare') }));
  if (result.modes.some(mode => mode.error)) process.exitCode = 1;
} catch (error) { result.error = String(error); process.exitCode = 1; }
finally {
  mkdirSync('olcum-out/vda', { recursive: true });
  writeFileSync(`olcum-out/vda/gpu-resident${process.argv.includes('--context16') ? '-context16' : ''}${process.argv.includes('--compare') ? '-sequence' : ''}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2)); await session.kapat();
}
