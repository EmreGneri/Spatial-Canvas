// One deployment/download manifest. Paths are relative to public/; optional flags affect both consumers.
import { readFileSync } from 'node:fs';
import { posix as path } from 'node:path';
import { loadEnv } from 'vite';
const { join } = path;
const MODEL_REPOS = JSON.parse(readFileSync(new URL('./model-assets.json', import.meta.url), 'utf8'));
const DAVID_MASK_INT8 = JSON.parse(readFileSync(new URL('../src/engine/vision/david-mask-asset.json', import.meta.url), 'utf8'));
export const MANAGED_ASSET_DIRS = ['models', 'ort', 'mediapipe-wasm'];

/** Use Vite's dotenv precedence and shell overrides for the download entry point too. */
export function assetEnvironment(mode = 'production', envDir = process.cwd()) {
  return loadEnv(mode, envDir, 'VITE_');
}

export function assetManifest(env = process.env) {
  const modelRoot = 'models';
  // asyncify = the build transformers.js requests on the WASM path,
  // jsep = the WebGPU path. The plain and jspi builds go unused.
  const ORT_FILES = [
    'ort-wasm-simd-threaded.asyncify.wasm',
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.jsep.mjs',
  ];

  // MediaPipe tasks-vision çalışma zamanı: tarayıcı SIMD'li ya da SIMD'siz
  // (nosimd) derlemeden birini yükler. Canlı video kişi maskesi Worker'ı (personMaskWorker.ts)
  // importScripts kullanamadığı için modül derlemesini yükler.
  const MP_WASM_FILES = [
    'vision_wasm_internal.js',
    'vision_wasm_internal.wasm',
    'vision_wasm_nosimd_internal.js',
    'vision_wasm_nosimd_internal.wasm',
    'vision_wasm_module_internal.js',
    'vision_wasm_module_internal.wasm',
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
  const EXTRA_MODELS = [BIREFNET, { ...DAVID_MASK_INT8, dest: join(modelRoot, DAVID_MASK_INT8.dest) },
    ...(env.VITE_MOGE2_PHOTO === '1' ? [MOGE] : [])];
  // DAViD insan derinliği (?derinlik=david açar; varsayılan kapalı). LİSANS: MIT (microsoft/DAViD
  // README + model kartları). HF değil, Microsoft'un Azure statik deposu; dosya adları sürüm
  // taşımadığı için boyut kontrolü sabitleme görevi görür (2026-10-24 HEAD: Content-Length).
  // Yalnız VITE_DAVID_PHOTO=1 ile iner: 2 × ~428 MB, temiz build'e varsayılan olarak girmez.
  const DAVID_URL = 'https://facesyntheticspubwedata.z6.web.core.windows.net/iccv-2025/models/';
  const DAVID = [
    { file: 'depth-model-vitb16_384.onnx', size: 449231953 },
    { file: 'foreground-segmentation-model-vitb16_384.onnx', size: 449231719 },
  ].map((m) => ({ ...m, url: DAVID_URL + m.file, dest: join(modelRoot, 'microsoft-david', m.file) }));
  const URL_MODELS = env.VITE_DAVID_PHOTO === '1' ? DAVID : [];
  // Live video fast person mask (docs/benchmarks/video-fast-mask.md): selfie is the default while
  // separation is on; ?hizliMaske=multiclass is published only with VITE_FAST_MASK=1.
  // LİSANS: Apache-2.0 — model kartları "Model Card MediaPipe Selfie Segmentation" ve "Model Card
  // Multiclass Segmentation", ikisi de "LICENSED UNDER Apache License, Version 2.0". Sürümlü URL (1).
  const [SELFIE_MASK, MULTICLASS_MASK] = [
    { url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
      dest: join(modelRoot, 'mediapipe/selfie_segmenter.tflite'), size: 249537,
      sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b' },
    { url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',
      dest: join(modelRoot, 'mediapipe/selfie_multiclass_256x256.tflite'), size: 16371837,
      sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0' },
  ];

  return [
    ...MODEL_REPOS.flatMap(({ repo, rev, files }) => files.map(model => ({ ...model,
      path: join(modelRoot, repo, model.file), url: `https://huggingface.co/${repo}/resolve/${rev}/${model.file}`,
    }))),
    ...[FACE_LANDMARKER, SELFIE_MASK, ...EXTRA_MODELS, ...URL_MODELS, ...(env.VITE_FAST_MASK === '1' ? [MULTICLASS_MASK] : [])].map(model => ({
      ...model, path: model.dest, url: model.url ?? `https://huggingface.co/${model.repo}/resolve/${model.rev}/${model.file}`,
    })),
    ...ORT_FILES.map(file => ({ path: `ort/${file}`, source: `node_modules/onnxruntime-web/dist/${file}` })),
    ...MP_WASM_FILES.map(file => ({ path: `mediapipe-wasm/${file}`, source: `node_modules/@mediapipe/tasks-vision/wasm/${file}` })),
  ];
}
