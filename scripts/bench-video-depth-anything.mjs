// Real, visible-browser VDA-S ONNX graph smoke and timing. No application defaults change.
// node scripts/bench-video-depth-anything.mjs --smoke
import { mkdirSync, writeFileSync } from 'node:fs';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const session = await tarayiciOturumu({ chrome: true, basli: true });
const result = { started: new Date().toISOString(), mode: 'real-onnx-smoke' };
try {
  await session.page.route('**/__vda_bench', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>VDA Small browser benchmark</title><h1>VDA Small: real WebGPU benchmark</h1><pre id="status">Loading…</pre>' }));
  await session.page.goto(session.url('/__vda_bench'));
  session.page.on('console', msg => {
    console.log('[browser]', msg.text());
    if (msg.text().startsWith('VDA_METRIC ')) Object.assign(result, JSON.parse(msg.text().slice(11)));
  });
  Object.assign(result, await session.page.evaluate(async () => {
    const status = text => { document.querySelector('#status').textContent = text; console.log(text); };
    const gpu = navigator.gpu;
    if (!gpu) throw Error('WebGPU unavailable');
    const requestAdapter = gpu.requestAdapter.bind(gpu);
    const adapters = [];
    gpu.requestAdapter = async (...args) => {
      const adapter = await requestAdapter(...args);
      if (adapter) {
        adapters.push({ info: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description, device: adapter.info.device }, features: [...adapter.features] });
        console.log('VDA_METRIC ' + JSON.stringify({ adapters, visibility: document.visibilityState }));
      }
      return adapter;
    };
    const ort = await import('/node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs');
    ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const base = '/models/TheoreticallyTim/theoreticallypose-vda/';
    const loadStart = performance.now();
    status('Creating encoder');
    const encoder = await ort.InferenceSession.create(base + 'vda_vits_encoder_518x910_fp16.onnx', { executionProviders: ['webgpu'] });
    status('Creating true T32 temporal head');
    const head = await ort.InferenceSession.create(base + 'vda_vits_head_T32_37x65_fp16.onnx', { executionProviders: ['webgpu'] });
    const loadMs = performance.now() - loadStart;
    const metadata = { encoderInputs: encoder.inputNames, encoderOutputs: encoder.outputNames, headInputs: head.inputNames, headOutputs: head.outputNames };
    status(JSON.stringify(metadata));
    const input = new Float32Array(3 * 518 * 910);
    for (let i = 0; i < input.length; i++) input[i] = (i % 251) / 125 - 1;
    const start = performance.now();
    const enc = await encoder.run({ [encoder.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 518, 910]) });
    const encoderMs = performance.now() - start;
    console.log('VDA_METRIC ' + JSON.stringify({ encoderMs, metadata, loadMs }));
    status(`Encoder actual inference: ${encoderMs.toFixed(1)} ms`);
    const feeds = {};
    const shapes = [];
    for (let i = 0; i < encoder.outputNames.length; i++) {
      const feature = enc[encoder.outputNames[i]];
      shapes.push({ name: encoder.outputNames[i], dims: feature.dims, type: feature.type });
      const repeated = new Float32Array(32 * feature.data.length);
      for (let j = 0; j < 32; j++) repeated.set(feature.data, j * feature.data.length);
      feeds[head.inputNames[i]] = new ort.Tensor('float32', repeated, [32, 2405, 384]);
    }
    status('Running actual T32 temporal inference (32 repeated warmup frames)');
    const headStart = performance.now();
    const depth = await head.run(feeds);
    const headMs = performance.now() - headStart;
    const output = depth[head.outputNames[0]];
    let min = Infinity, max = -Infinity, finite = 0;
    for (const v of output.data) { if (Number.isFinite(v)) finite++; min = Math.min(min, v); max = Math.max(max, v); }
    const answer = { adapters, visibility: document.visibilityState, loadMs, encoderMs, headMs, metadata, shapes, output: { dims: output.dims, type: output.type, min, max, finite, count: output.data.length } };
    status(JSON.stringify(answer, null, 2));
    for (const t of [...Object.values(enc), ...Object.values(depth), ...Object.values(feeds)]) t.dispose();
    await head.release(); await encoder.release();
    return answer;
  }));
} catch (error) {
  result.error = String(error);
  process.exitCode = 1;
} finally {
  mkdirSync('olcum-out/vda', { recursive: true });
  writeFileSync('olcum-out/vda/smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await session.kapat();
}
