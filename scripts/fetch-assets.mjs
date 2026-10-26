// Fetches the model weights and vendors the onnxruntime-web WASM runtime into
// public/, which is gitignored. `npm run build` runs this first: Vite copies
// public/ verbatim into dist/, so unlisted local assets are preserved with a deployment warning.
//   npm run fetch:assets
import { mkdir, copyFile, stat, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { downloadAsset, warnUnknownAssets } from './download-asset.mjs';

// HF API blobs=true metadatasıyla 2026-10-26'da doğrulandı; yalnız küçük JSON dosyaları hash için okundu.
// depth-anything-v2-small: Apache-2.0, IS-Net: MIT. Ticari olmayan V2-base
// ve RMBG-1.4 listeye geri eklenmez; yerel deneyler yalnız uyarıyla korunur.
const MODEL_REPOS = JSON.parse(await readFile(new URL('./model-assets.json', import.meta.url), 'utf8'));
// İzole test/CI hedefi: FETCH_ASSETS_PUBLIC_DIR=<temporary directory>.
const PUBLIC_DIR = process.env.FETCH_ASSETS_PUBLIC_DIR || 'public';
const modelRoot = join(PUBLIC_DIR, 'models');
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
  dest: join(modelRoot, 'mediapipe/face_landmarker.task'),
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
BIREFNET.dest = join(modelRoot, BIREFNET.repo, BIREFNET.file);

// Deney varsayılan kapalı (?derinlik=moge açar): temiz Vercel build'i modeli yalnız VITE_MOGE2_PHOTO=1 ile indirir.
const MOGE = {
  repo: 'Ruicheng/moge-2-vits-normal-onnx',
  rev: 'e50ffda41565591092adea54c6ac83d6212e1e23',
  file: 'model.onnx', size: 140852051,
};
MOGE.dest = join(modelRoot, MOGE.repo, MOGE.file);
const EXTRA_MODELS = [BIREFNET, ...(process.env.VITE_MOGE2_PHOTO === '1' ? [MOGE] : [])];
// DAViD insan derinliği (?derinlik=david açar; varsayılan kapalı). LİSANS: MIT (microsoft/DAViD
// README + model kartları). HF değil, Microsoft'un Azure statik deposu; dosya adları sürüm
// taşımadığı için boyut kontrolü sabitleme görevi görür (2026-10-24 HEAD: Content-Length).
// Yalnız VITE_DAVID_PHOTO=1 ile iner: 2 × ~428 MB, temiz build'e varsayılan olarak girmez.
const DAVID_URL = 'https://facesyntheticspubwedata.z6.web.core.windows.net/iccv-2025/models/';
const DAVID = [
  { file: 'depth-model-vitb16_384.onnx', size: 449231953 },
  { file: 'foreground-segmentation-model-vitb16_384.onnx', size: 449231719 },
].map((m) => ({ ...m, url: DAVID_URL + m.file, dest: join(modelRoot, 'microsoft-david', m.file) }));
const URL_MODELS = process.env.VITE_DAVID_PHOTO === '1' ? DAVID : [];
// VDA resmî ağırlıktan yerelde üretilir (scripts/export-video-depth-anything.py).
// Build Python/Torch kurmaz ve ölçümde çöken eski topluluk aktarımını dağıtmaz.
// Bu aktarım HİÇBİR YERDE barındırılmıyor (açık karar): temiz Vercel build'inde
// dosyalar yoktur, adım atlanır ve `?videoDerinlik=vda` V2-small'a düşer.
const VDA_DIR = 'DepthAnything/video-depth-anything-small-stream-154x266';
const VDA_FILES = ['encoder_fp16.onnx', 'bootstrap_fp16.onnx', 'stream_fp16.onnx', 'export-manifest.json'];
const VDA_OPTIONAL_FILES = [
  ...VDA_FILES.map(file => `${VDA_DIR}-context16/${file}`),
  'DepthAnything/video-depth-anything-small-offline-154x266/offline32_fp16.onnx',
  'DepthAnything/video-depth-anything-small-offline-154x266/offline-manifest.json',
];

const mb = (n) => (n / 1024 / 1024).toFixed(2).padStart(7) + ' MB';

const exists = (p) => stat(p).then(() => true, () => false);

// A test clip left in public/ would be deployed with the site (personal
// footage, hundreds of MB). Stop before the build can pick it up.
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const strayMedia = (await readdir(PUBLIC_DIR, { recursive: true }).catch(() => []))
  .filter((file) => MEDIA_EXTENSIONS.has(extname(file).toLowerCase()));
if (strayMedia.length) {
  console.error('public/ contains video files that would be deployed with the site:');
  for (const file of strayMedia) console.error(`  public/${file}`);
  console.error('Move them to assets/test-clips/ (gitignored; the dev server serves it at /assets/test-clips/).');
  process.exit(1);
}

// Manifest boyut/hash değerleri hem mevcut dosyaya hem .part indirmeye uygulanır.
for (const { repo, rev, files } of MODEL_REPOS) {
  console.log(`\n${repo}`);
  for (const model of files) {
    const result = await downloadAsset({ ...model,
      dest: join(modelRoot, repo, model.file),
      url: `https://huggingface.co/${repo}/resolve/${rev}/${model.file}`,
    });
    console.log(`${result === 'skip' ? '     skip' : mb(model.size)}  ${model.file}`);
  }
}

await mkdir(join(PUBLIC_DIR, 'ort'), { recursive: true });
for (const file of ORT_FILES) {
  const src = join('node_modules/onnxruntime-web/dist', file);
  await copyFile(src, join(PUBLIC_DIR, 'ort', file));
  console.log(`${mb((await stat(src)).size)}  ort/${file}`);
}

for (const model of [FACE_LANDMARKER, ...EXTRA_MODELS, ...URL_MODELS]) {
  const url = model.url ?? `https://huggingface.co/${model.repo}/resolve/${model.rev}/${model.file}`;
  const result = await downloadAsset({ ...model, url });
  console.log(`${result === 'skip' ? '     skip' : mb(model.size)}  ${model.dest}`);
}

// Optional and local-only: never fails the build. Ships only if present.
console.log(`\n${VDA_DIR} (local export, optional)`);
const vdaPath = (file) => join(modelRoot, VDA_DIR, file);
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

await mkdir(join(PUBLIC_DIR, 'mediapipe-wasm'), { recursive: true });
for (const file of MP_WASM_FILES) {
  const src = join('node_modules/@mediapipe/tasks-vision/wasm', file);
  await copyFile(src, join(PUBLIC_DIR, 'mediapipe-wasm', file));
  console.log(`${mb((await stat(src)).size)}  mediapipe-wasm/${file}`);
}

await warnUnknownAssets(modelRoot, new Set([
  ...MODEL_REPOS.flatMap(({ repo, files }) => files.map(({ file }) => `${repo}/${file}`)),
  'mediapipe/face_landmarker.task',
  `${BIREFNET.repo}/${BIREFNET.file}`,
  `${MOGE.repo}/${MOGE.file}`,
  ...DAVID.map((m) => `microsoft-david/${m.file}`),
  ...VDA_FILES.map(file => `${VDA_DIR}/${file}`),
  ...VDA_OPTIONAL_FILES,
]));
await warnUnknownAssets(join(PUBLIC_DIR, 'ort'), new Set(ORT_FILES));
await warnUnknownAssets(join(PUBLIC_DIR, 'mediapipe-wasm'), new Set(MP_WASM_FILES));
