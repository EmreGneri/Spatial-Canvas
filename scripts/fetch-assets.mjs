// Fetches the model weights and vendors the onnxruntime-web WASM runtime into
// public/, which is gitignored. `npm run build` runs this first: Vite copies
// public/ verbatim into dist/, so public/ must hold exactly what may ship.
//   npm run fetch:assets
import { mkdir, writeFile, copyFile, stat, readdir, rm, rmdir } from 'node:fs/promises';
import { dirname, extname, join, relative, sep } from 'node:path';

// Her tüketici kendi modelini ister; ikisi de aynı dtype eşlemesini kullanır:
// wasm → q8 (model_quantized.onnx), webgpu → fp16 (model_fp16.onnx).
// Bir modeli büyütürken BURAYI da güncelle — kod yeni ağırlığı ister, script
// eskisini indirirse istek 404'e düşer, Vite index.html döndürür ve hata
// "Unexpected token '<'" olarak görünür (gerçek sebebi gizler).
const MODEL_REPOS = [
  // TİCARİ LİSANS NOTU (2026-09-24): `depth-anything-v2-BASE` listeden
  // ÇIKARILDI — lisansı CC-BY-NC-4.0, yani ticari kullanıma kapalı.
  // Fotoğraf yolu da artık `-small` (Apache-2.0) kullanıyor; iki tüketici
  // (fotoğraf + canlı video) tek modelde birleşti, indirme de yarıya indi.
  // Ölçülen bedel: rölyef −%5…7, ince detay −%16…20, buna karşılık ×1.5-2.3 hız.
  {
    // src/engine/vision/liveDepth.ts — CANLI video derinliği (tempo öncelikli
    // küçük model). Liste eksikti: canlı yol taşındığında bu satır da
    // eklenmeliydi, yoksa temiz bir clone'da istek 404'e düşer.
    repo: 'onnx-community/depth-anything-v2-small',
    files: [
      'config.json',
      'preprocessor_config.json',
      'onnx/model_quantized.onnx', // WASM path
      'onnx/model_fp16.onnx',      // WebGPU path
    ],
  },
  {
    // src/engine/vision/detect.ts — nesne tespiti (COCO sınıfları: insan,
    // araba, köpek, bisiklet...). Tracker HUD etiketleri bundan gelir.
    repo: 'Xenova/yolos-tiny',
    files: [
      'config.json',
      'preprocessor_config.json',
      'onnx/model_quantized.onnx',
      'onnx/model_fp16.onnx',
    ],
  },
  {
    // src/engine/reconstruction/segmentation.ts — nesne/arka plan ayırma
    //
    // TİCARİ LİSANS: `briaai/RMBG-1.4` BURADAN ÇIKARILDI (2026-09-24). Model
    // kartı "non-commercial use" diyor; abonelikli üründe ağırlığı servis
    // etmek dağıtımdır. Yerine MIT lisanslı aynı aile (IS-Net) geldi.
    // Geri koymak isteyen önce BRIA ile ticari anlaşma yapmalıdır.
    repo: 'imgly/isnet-general-onnx',
    files: [
      'config.json',
      'preprocessor_config.json',
      'onnx/model_fp16.onnx', // WebGPU yolu (~88 MB) — kuantize sürümü yok
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

// A test clip left in public/ would be deployed with the site (personal
// footage, hundreds of MB). Stop before the build can pick it up.
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const strayMedia = (await readdir('public', { recursive: true }).catch(() => []))
  .filter((file) => MEDIA_EXTENSIONS.has(extname(file).toLowerCase()));
if (strayMedia.length) {
  console.error('public/ contains video files that would be deployed with the site:');
  for (const file of strayMedia) console.error(`  public/${file}`);
  console.error('Move them to assets/test-clips/ (gitignored; the dev server serves it at /assets/test-clips/).');
  process.exit(1);
}

/**
 * Deletes every file under `dir` that is not in `keep` (paths relative to
 * `dir`), then any directory left empty. Weights dropped from the lists above
 * otherwise stay on disk and keep shipping, e.g. the non-commercial
 * RMBG-1.4 and depth-anything-v2-base.
 */
async function mirror(dir, keep) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const path = join(entry.parentPath, entry.name);
    const rel = relative(dir, path).split(sep).join('/');
    if (keep.has(rel)) continue;
    await rm(path, { force: true });
    console.log(`  removed  ${dir}/${rel} (not in the fetch list)`);
  }
  // Deepest first, so a parent becomes empty before it is tried.
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(e.parentPath, e.name));
  for (const path of dirs.sort((a, b) => b.length - a.length)) {
    await rmdir(path).catch(() => {}); // only succeeds when empty
  }
}

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

await mirror('public/models', new Set(MODEL_REPOS.flatMap(({ repo, files }) => files.map((f) => `${repo}/${f}`))));
await mirror('public/ort', new Set(ORT_FILES));
