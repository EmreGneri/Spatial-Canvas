// Fetches the depth model weights and vendors the onnxruntime-web WASM runtime
// into public/, which is gitignored. Run after a fresh clone/install:
//   npm run fetch:assets
import { mkdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Her tüketici kendi modelini ister; ikisi de aynı dtype eşlemesini kullanır:
// wasm → q8 (model_quantized.onnx), webgpu → fp16 (model_fp16.onnx).
// Bir modeli büyütürken BURAYI da güncelle — kod yeni ağırlığı ister, script
// eskisini indirirse istek 404'e düşer, Vite index.html döndürür ve hata
// "Unexpected token '<'" olarak görünür (gerçek sebebi gizler).
const MODEL_REPOS = [
  {
    // src/depth.ts — depth estimation
    repo: 'onnx-community/depth-anything-v2-base',
    files: [
      'config.json',
      'preprocessor_config.json',
      'onnx/model_quantized.onnx', // WASM path   (~98 MB)
      'onnx/model_fp16.onnx',      // WebGPU path (~186 MB)
    ],
  },
  {
    // src/engine/reconstruction/segmentation.ts — nesne/arka plan ayırma
    repo: 'briaai/RMBG-1.4',
    files: [
      'config.json',
      'preprocessor_config.json',
      'onnx/model_quantized.onnx', // WASM path   (~42 MB)
      'onnx/model_fp16.onnx',      // WebGPU path (~84 MB)
    ],
  },
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

// Var olan dosya atlanır: indirme yarıda kesilirse komutu tekrar çalıştırmak
// kaldığı yerden devam eder.
for (const { repo, files } of MODEL_REPOS) {
  console.log(`\n${repo}`);
  for (const file of files) {
    const dest = join('public/models', repo, file);
    if (await exists(dest)) { console.log(`     skip  ${file}`); continue; }
    await mkdir(dirname(dest), { recursive: true });
    const res = await fetch(`https://huggingface.co/${repo}/resolve/main/${file}`);
    if (!res.ok) throw new Error(`${repo}/${file}: ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    console.log(`${mb(buf.length)}  ${file}`);
  }
}

await mkdir('public/ort', { recursive: true });
for (const file of ORT_FILES) {
  const src = join('node_modules/onnxruntime-web/dist', file);
  await copyFile(src, join('public/ort', file));
  console.log(`${mb((await stat(src)).size)}  ort/${file}`);
}
