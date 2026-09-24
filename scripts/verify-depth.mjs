// Offline depth-inference smoke test (Node). Proves the vendored model + WASM
// runtime actually run before the browser test — same code path as the app
// (allowRemoteModels=false, localModelPath, numThreads=1).
//   node scripts/verify-depth.mjs
import { env, pipeline, RawImage } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';
env.backends.onnx.wasm.numThreads = 1;

const MODEL = 'onnx-community/depth-anything-v2-small';

const t0 = performance.now();
// Node: cpu = WASM yolu (tarayicidaki 'wasm' adinin Node karsiligi)
const estimator = await pipeline('depth-estimation', MODEL, { device: 'cpu', dtype: 'q8' });
console.log(`model yukleme : ${Math.round(performance.now() - t0)} ms`);

const W = 512;
const H = 512;
const rgba = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const v = 140 + Math.floor(90 * Math.sin(x / 45) + 70 * Math.cos(y / 35));
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
}
for (let y = H - 110; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    rgba[i] = 60;
    rgba[i + 1] = 60;
    rgba[i + 2] = 60;
  }
}
const image = new RawImage(rgba, W, H, 4);

const t1 = performance.now();
const { predicted_depth } = await estimator(image);
console.log(`inference      : ${Math.round(performance.now() - t1)} ms  dims=${predicted_depth.dims}`);

const arr = predicted_depth.data;
let min = Infinity;
let max = -Infinity;
for (const v of arr) {
  if (v < min) min = v;
  if (v > max) max = v;
}
console.log(`depth range    : ${min.toFixed(4)} .. ${max.toFixed(4)} (fark > 0 ise model calisiyor)`);
if (max - min < 1e-6) {
  console.error('FAIL: depth ciktilari duz — model gercek inference yapmadi.');
  process.exit(1);
}
console.log('OK');
