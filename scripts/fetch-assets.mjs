// Fetches the depth model weights and vendors the onnxruntime-web WASM runtime
// into public/, which is gitignored. Run after a fresh clone/install:
//   npm run fetch:assets
import { mkdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MODEL_REPO = 'onnx-community/depth-anything-v2-small';
const MODEL_FILES = [
  'config.json',
  'preprocessor_config.json',
  'onnx/model_quantized.onnx', // WASM path  (~26 MB)
  'onnx/model_fp16.onnx',      // WebGPU path (~47 MB)
];
// asyncify = the build transformers.js requests on the WASM path,
// jsep = the WebGPU path. The plain and jspi builds go unused.
const ORT_FILES = [
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
];

const mb = (n) => (n / 1024 / 1024).toFixed(2).padStart(7) + ' MB';

const exists = (p) => stat(p).then(() => true, () => false);

for (const file of MODEL_FILES) {
  const dest = join('public/models', MODEL_REPO, file);
  if (await exists(dest)) { console.log(`skip ${file}`); continue; }
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(`https://huggingface.co/${MODEL_REPO}/resolve/main/${file}`);
  if (!res.ok) throw new Error(`${file}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`${mb(buf.length)}  ${file}`);
}

await mkdir('public/ort', { recursive: true });
for (const file of ORT_FILES) {
  const src = join('node_modules/onnxruntime-web/dist', file);
  await copyFile(src, join('public/ort', file));
  console.log(`${mb((await stat(src)).size)}  ort/${file}`);
}
