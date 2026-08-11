// RMBG-1.4 (nesne/arka plan ayırma) offline smoke test (Node). Vendored
// model + WASM runtime'ı gerçekten çalıştırdığını tarayıcıdan ÖNCE kanıtlar
// (allowRemoteModels=false, localModelPath, numThreads=1 — uygulamayla aynı
// yol). ONNX giriş adı 'input' olduğu için transformers.js'nin pixel_values
// sözleşmesiyle beslenemez; model._call({ input }) ile doğrudan çalıştırılır
// (src/engine/reconstruction/segmentation.ts ile aynı çağrı).
//   node scripts/verify-seg.mjs
import assert from 'node:assert/strict';
import { env, SegformerForSemanticSegmentation, AutoImageProcessor, RawImage } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';
env.backends.onnx.wasm.numThreads = 1;

const MODEL = 'briaai/RMBG-1.4';

const t0 = performance.now();
const model = await SegformerForSemanticSegmentation.from_pretrained(MODEL, {
  device: 'cpu',
  dtype: 'q8',
});
const processor = await AutoImageProcessor.from_pretrained(MODEL);
console.log(`model yukleme : ${Math.round(performance.now() - t0)} ms`);

const W = 256;
const H = 256;
const rgba = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const inBlob = Math.abs(x - W / 2) < 60 && Math.abs(y - H / 2) < 80;
    const v = inBlob ? 200 : 40; // ortada parlak blob, çevre koyu arka plan
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
}
const image = new RawImage(rgba, W, H, 4);

const t1 = performance.now();
const inputs = await processor(image);
assert.deepEqual(inputs.pixel_values.dims, [1, 3, 1024, 1024], 'işlemci 1024² kareye büyütür');
const result = await model._call({ input: inputs.pixel_values });
console.log(
  `inference      : ${Math.round(performance.now() - t1)} ms  output=${Object.keys(result).join(',')}`,
);

const out = result.output;
assert.deepEqual(out.dims, [1, 1, 1024, 1024], 'çıktı [1,1,H,W] tek kanallı maske');
const data = out.data;
let mn = Infinity;
let mx = -Infinity;
for (const v of data) {
  if (v < mn) mn = v;
  if (v > mx) mx = v;
}
assert.ok(mn >= 0 && mx <= 1, `çıktı 0..1 olasılık (sigmoide) — range ${mn.toFixed(4)}..${mx.toFixed(4)}`);
assert.ok(mx - mn > 0.1, 'maske düz değil (gerçek ön plan ayrımı var)');
const Wout = 1024;
const blob = data[((1024 >> 1) * Wout + Wout / 2) | 0];
const corner = data[3];
assert.ok(blob > corner, `merkez blob ön plan (${blob.toFixed(3)}), köşe arka plan (${corner.toFixed(3)})`);
console.log('OK');
