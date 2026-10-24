// Fetches the model weights and vendors the onnxruntime-web WASM runtime into
// public/, which is gitignored. `npm run build` runs this first: Vite copies
// public/ verbatim into dist/, so public/ must hold exactly what may ship.
//   npm run fetch:assets
import { mkdir, writeFile, copyFile, stat, readdir, readFile, rm, rmdir } from 'node:fs/promises';
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

// MediaPipe tasks-vision çalışma zamanı: tarayıcı SIMD'li ya da SIMD'siz
// (nosimd) derlemeden birini yükler; module_internal kullanılmaz.
const MP_WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

// src/engine/vision/yuzTespit.ts — yüz landmark modeli. HF deposu değil, Google
// deposu; `latest` değil sürümlü URL (1) sabitlenir.
// LİSANS: Apache-2.0 — model kartları "Model Card MediaPipe Face Mesh V2" ve
// "BlazeFace short range", ikisi de "LICENSED UNDER Apache License, Version 2.0".
const FACE_LANDMARKER = {
  url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  dest: 'public/models/mediapipe/face_landmarker.task',
  size: 3758596,
};

// src/engine/reconstruction/segmentation.ts — tarayıcı BiRefNet_lite (WebGPU,
// yalnız fotoğraf). Stok export Chrome WebGPU'da çalışmaz; bu graf düzeltilmiş
// hali. Revizyon SABİT (main değil): graf yeniden yüklenirse boyut kontrolü
// yakalar. LİSANS: MIT (model kartı; ayrı LICENSE dosyası yok). DIS5K eğitim
// verisi uyarısı THIRD_PARTY_NOTICES'te. sha256 4059896039dfccb0…cf5f4.
const BIREFNET = {
  repo: 'jiabins0303/birefnet-lite-1024-webgpu',
  rev: '1ad01cef0f4101a285c5a3e0bd7f15597d93403f',
  file: 'onnx/model_fp16.onnx',
  size: 114834127,
};
BIREFNET.dest = join('public/models', BIREFNET.repo, BIREFNET.file);

// Deney varsayılan kapalı (?derinlik=moge açar): temiz Vercel build'i modeli yalnız VITE_MOGE2_PHOTO=1 ile indirir.
const MOGE = {
  repo: 'Ruicheng/moge-2-vits-normal-onnx',
  rev: 'e50ffda41565591092adea54c6ac83d6212e1e23',
  file: 'model.onnx', size: 140852051,
};
MOGE.dest = join('public/models', MOGE.repo, MOGE.file);
const EXTRA_MODELS = [BIREFNET, ...(process.env.VITE_MOGE2_PHOTO === '1' ? [MOGE] : [])];
// DAViD insan derinliği (?derinlik=david açar; varsayılan kapalı). LİSANS: MIT (microsoft/DAViD
// README + model kartları). HF değil, Microsoft'un Azure statik deposu; dosya adları sürüm
// taşımadığı için boyut kontrolü sabitleme görevi görür (2026-10-24 HEAD: Content-Length).
// Yalnız VITE_DAVID_PHOTO=1 ile iner: 2 × ~428 MB, temiz build'e varsayılan olarak girmez.
const DAVID_URL = 'https://facesyntheticspubwedata.z6.web.core.windows.net/iccv-2025/models/';
const DAVID = [
  { file: 'depth-model-vitb16_384.onnx', size: 449231953 },
  { file: 'foreground-segmentation-model-vitb16_384.onnx', size: 449231719 },
].map((m) => ({ ...m, url: DAVID_URL + m.file, dest: join('public/models/microsoft-david', m.file) }));
const URL_MODELS = process.env.VITE_DAVID_PHOTO === '1' ? DAVID : [];
// VDA resmî ağırlıktan yerelde üretilir (scripts/export-video-depth-anything.py).
// Build Python/Torch kurmaz ve ölçümde çöken eski topluluk aktarımını dağıtmaz.
// Bu aktarım HİÇBİR YERDE barındırılmıyor (açık karar): temiz Vercel build'inde
// dosyalar yoktur, adım atlanır ve `?videoDerinlik=vda` V2-small'a düşer.
const VDA_DIR = 'DepthAnything/video-depth-anything-small-stream-154x266';
const VDA_FILES = ['encoder_fp16.onnx', 'bootstrap_fp16.onnx', 'stream_fp16.onnx', 'export-manifest.json'];

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

// Boyut eşleşmezse (yarım kalmış indirme) yeniden indirilir.
console.log('\nmediapipe/face_landmarker');
if ((await stat(FACE_LANDMARKER.dest).catch(() => null))?.size === FACE_LANDMARKER.size) {
  console.log('     skip  face_landmarker.task');
} else {
  await mkdir(dirname(FACE_LANDMARKER.dest), { recursive: true });
  const res = await fetch(FACE_LANDMARKER.url);
  if (!res.ok) throw new Error(`face_landmarker.task: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== FACE_LANDMARKER.size) throw new Error(`face_landmarker.task: beklenen ${FACE_LANDMARKER.size} bayt, gelen ${buf.length}`);
  await writeFile(FACE_LANDMARKER.dest, buf);
  console.log(`${mb(buf.length)}  face_landmarker.task`);
}

for (const model of EXTRA_MODELS) {
  console.log(`\n${model.repo}`);
  if ((await stat(model.dest).catch(() => null))?.size === model.size) {
    console.log(`     skip  ${model.file}`);
    continue;
  }
  await mkdir(dirname(model.dest), { recursive: true });
  const res = await fetch(`https://huggingface.co/${model.repo}/resolve/${model.rev}/${model.file}`);
  if (!res.ok) throw new Error(`${model.repo}/${model.file}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== model.size) throw new Error(`${model.file}: beklenen ${model.size} bayt, gelen ${buf.length}`);
  await writeFile(model.dest, buf);
  console.log(`${mb(buf.length)}  ${model.file}`);
}

for (const model of URL_MODELS) {
  console.log(`\nmicrosoft-david/${model.file}`);
  if ((await stat(model.dest).catch(() => null))?.size === model.size) { console.log(`     skip  ${model.file}`); continue; }
  await mkdir(dirname(model.dest), { recursive: true });
  const res = await fetch(model.url);
  if (!res.ok) throw new Error(`${model.file}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== model.size) throw new Error(`${model.file}: beklenen ${model.size} bayt, gelen ${buf.length}`);
  await writeFile(model.dest, buf);
  console.log(`${mb(buf.length)}  ${model.file}`);
}

// Optional and local-only: never fails the build. Ships only if present.
console.log(`\n${VDA_DIR} (local export, optional)`);
const vdaPath = (file) => join('public/models', VDA_DIR, file);
const vdaMissing = [];
for (const file of VDA_FILES) if (!await exists(vdaPath(file))) vdaMissing.push(file);
if (vdaMissing.length) {
  console.log(`     skip  missing ${vdaMissing.join(', ')}; ?videoDerinlik=vda will fall back to V2-small.`);
  console.log('           Produce: python scripts/export-video-depth-anything.py --source <Video-Depth-Anything checkout>'
    + ` --checkpoint <video_depth_anything_vits.pth> --output public/models/${VDA_DIR}`);
} else {
  const manifest = JSON.parse(await readFile(vdaPath('export-manifest.json'), 'utf8'));
  for (const file of VDA_FILES.filter((f) => f.endsWith('.onnx'))) {
    const size = (await stat(vdaPath(file))).size;
    const expected = manifest.files?.[file]?.bytes;
    console.log(size === expected ? `${mb(size)}  ${file}` : `  WARNING  ${file}: ${size} bytes, manifest says ${expected}`);
  }
}

await mkdir('public/mediapipe-wasm', { recursive: true });
for (const file of MP_WASM_FILES) {
  const src = join('node_modules/@mediapipe/tasks-vision/wasm', file);
  await copyFile(src, join('public/mediapipe-wasm', file));
  console.log(`${mb((await stat(src)).size)}  mediapipe-wasm/${file}`);
}

await mirror('public/models', new Set([
  ...MODEL_REPOS.flatMap(({ repo, files }) => files.map((f) => `${repo}/${f}`)),
  'mediapipe/face_landmarker.task',
  `${BIREFNET.repo}/${BIREFNET.file}`,
  `${MOGE.repo}/${MOGE.file}`,
  ...DAVID.map((m) => `microsoft-david/${m.file}`),
  ...VDA_FILES.map(file => `${VDA_DIR}/${file}`),
]));
await mirror('public/ort', new Set(ORT_FILES));
await mirror('public/mediapipe-wasm', new Set(MP_WASM_FILES));
