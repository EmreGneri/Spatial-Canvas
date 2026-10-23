// Visible Chrome, true official VDA temporal-cache ONNX. Must follow CPU export parity.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';
const session = await tarayiciOturumu({ chrome: true, basli: true });
const result = { started: new Date().toISOString(), mode: 'official-hidden-state-stream' };
try {
  session.page.on('console', msg => {
    console.log('[browser]', msg.text());
    if (msg.text().startsWith('VDA_METRIC ')) Object.assign(result, JSON.parse(msg.text().slice(11)));
  });
  await session.page.route('**/__vda_stream', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>VDA Small streaming benchmark</title><h1>VDA Small: official temporal-cache inference</h1><pre id="status">Loading…</pre>' }));
  await session.page.goto(session.url('/__vda_stream'));
  Object.assign(result, await session.page.evaluate(async () => {
    const report = data => { console.log('VDA_METRIC ' + JSON.stringify(data)); document.querySelector('#status').textContent = JSON.stringify(data, null, 2); };
    const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (...args) => {
      const adapter = await request(...args);
      if (adapter) report({ adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description, device: adapter.info.device }, features: [...adapter.features], visibility: document.visibilityState });
      return adapter;
    };
    const ort = await import('/node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs');
    const { createVdaHistory, advanceVdaHistory, selectVdaHistory, packVdaCache } = await import('/src/engine/vision/videoDepthAnything.ts');
    ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const base = '/models/DepthAnything/video-depth-anything-small-stream-154x266/';
    const loadStart = performance.now();
    const encoder = await ort.InferenceSession.create(base + 'encoder_fp16.onnx', { executionProviders: ['webgpu'] });
    const bootstrap = await ort.InferenceSession.create(base + 'bootstrap_fp16.onnx', { executionProviders: ['webgpu'] });
    const stream = await ort.InferenceSession.create(base + 'stream_fp16.onnx', { executionProviders: ['webgpu'] });
    report({ loadMs: performance.now() - loadStart, graphMetadata: { encoder: encoder.inputNames, bootstrap: bootstrap.inputNames, stream: stream.inputNames, outputs: stream.outputNames } });
    const loadArray = async name => new Float32Array(await (await fetch(base + `parity-${name}.bin`)).arrayBuffer());
    const pixels = [await loadArray('pixels0'), await loadArray('pixels1')];
    const references = [await loadArray('depth0'), await loadArray('depth1')];
    const history = createVdaHistory();
    const timings = [];
    const parity = [];
    for (let index = 0; index < 7; index++) {
      const started = performance.now();
      const input = new ort.Tensor('float32', pixels[index % 2], [1, 3, 154, 266]);
      const features = await encoder.run({ pixels: input });
      const encoded = performance.now();
      const feeds = { ...features };
      const added = [];
      const head = index === 0 ? bootstrap : stream;
      if (index > 0) {
        const previous = selectVdaHistory(history);
        for (let i = 0; i < 8; i++) {
          const shape = previous[0][i].dims;
          const packed = packVdaCache(previous.map(frame => frame[i].data), shape[0], shape[2]);
          const tensor = new ort.Tensor('float32', packed, [shape[0], 31, shape[2]]);
          feeds[`cache${i}`] = tensor; added.push(tensor);
        }
      }
      const output = await head.run(feeds);
      const finished = performance.now();
      const depth = output.depth.data;
      if (!depth.every(Number.isFinite)) throw Error('Non-finite browser depth');
      if (index < 2) {
        let maxAbsolute = 0, squared = 0;
        for (let i = 0; i < depth.length; i++) { const delta = depth[i] - references[index][i]; maxAbsolute = Math.max(maxAbsolute, Math.abs(delta)); squared += delta * delta; }
        parity.push({ index, maxAbsolute, rmse: Math.sqrt(squared / depth.length) });
      }
      advanceVdaHistory(history, head.outputNames.slice(1).map(name => ({ dims: [...output[name].dims], data: new Float32Array(output[name].data) })));
      timings.push({ index, encoderMs: encoded - started, headMs: finished - encoded, totalMs: finished - started });
      report({ timings, parity, outputShape: output.depth.dims, cacheShapes: history.frames.at(-1).map(x => x.dims) });
      input.dispose();
      for (const tensor of [...Object.values(features), ...Object.values(output), ...added]) tensor.dispose();
    }
    await encoder.release(); await bootstrap.release(); await stream.release();
    return { timings, parity, success: true };
  }));
} catch (error) { result.error = String(error); process.exitCode = 1; }
finally {
  mkdirSync('olcum-out/vda', { recursive: true });
  writeFileSync('olcum-out/vda/stream-smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await session.kapat();
}
