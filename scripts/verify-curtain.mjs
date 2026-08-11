// Tur 9+10+11 görsel doğrulama: GERÇEK büst fotoğrafında perde/çanak YOK mu ve
// arka plan noktaları TEK buffer üzerinde siluet deliğini dolduruyor mu?
//
// Gerçek uygulama yolunun birebir kopyası (Node): fotoğraf → letterbox(1024²,
// kare kaynakta saf resize) → RMBG mask → DİLATE + TÜY (Tur 10: segmentation.ts
// ile aynı post-process) → letterbox(518²) → depth → normalize (0..1, 1 =
// yakın) → maske resampleBilinear(518²) → sampleVolumePositions +
// sampleImageGrid (foregroundMask ile). "nesne ayırma AÇIK" yoludur.
//
// Kanıtlananlar:
//   1. maske özneyi gerçekten ayırıyor (boş değil, tüm kare değil)
//   2. İKİ SEVİYELİ opaklık: w ∈ {1, BACKDROP_OPACITY} — ara değer (perde)
//      bandı yok, ölü texel YOK
//   3. maske < 0.5 bölgesindeki HER texel arka plan noktası taşır (w =
//      BACKDROP_OPACITY, z = gerçek derinlik − BACKDROP_Z_PIN): özne arkası
//      zifiri siyah değil, yumuşak duvar devamıdır (tek buffer, ayrı katman
//      yok)
//   4. üretilen ÖN PLAN noktalarının TAMAMI maske bbox'ının içinde (özne
//      dışına taşan ön plan noktası yok = perde yok; kenar dökümü yalnızca
//      öznenin kendi sınırında)
//   5. hizalama: nokta bulutu kütle merkezi ≈ maske merkezi (y-flip/letterbox
//      uyumsuzluğu burada patlar)
//   6. sampleImageGrid (Tur 11): fotoğraf RGB'si konumlarla AYNI eşlemede
//      grid'e taşınır — seçili texel'ler ham görselden bilinear okumayla
//      birebir eşleşir (renk hizası yanlışsa özne rengi kayar)
//
// Bilgi amaçlı: "nesne ayırma KAPALI" (maskesiz) varyantı da çalıştırılır —
// siluetin özne dışına taşan nokta sayısı raporlanır, iddia edilmez (duvar
// sızıntısının maskesiz yolu bilinen davranıştır; buton oradadır).
//   node scripts/verify-curtain.mjs [fotoğraf yolu]
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  AutoImageProcessor,
  env,
  pipeline,
  RawImage,
  SegformerForSemanticSegmentation,
} from '@huggingface/transformers';
import {
  BACKDROP_OPACITY,
  sampleImageGrid,
  sampleVolumePositions,
} from '../src/engine/reconstruction/sampler.ts';
import { dilateAndFeatherMask, resampleBilinear } from '../src/engine/reconstruction/silhouette.ts';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';
env.backends.onnx.wasm.numThreads = 1;

// Varsayılan görsel proje içinde durur ve yol import.meta.url'den çözülür:
// script hangi dizinden çağrılırsa çağrılsın aynı dosyayı bulur, ve makineye
// özel mutlak yol (eskiden bir geliştiricinin masaüstü) repoda kalmaz.
const DEFAULT_IMG = fileURLToPath(new URL('../assets/thumbnail.jpg', import.meta.url));
const IMG = process.argv[2] ?? DEFAULT_IMG;
const N = 384; // parçacık grid'i
const DEPTH_SIZE = 518; // depth-anything-v2 eğitim boyutu (depth.ts)
const MASK_SIZE = 1024; // RMBG eğitim boyutu (segmentation.ts)
const MASK_SIZE_HALF = MASK_SIZE / 2;

import { existsSync } from 'node:fs';
if (!existsSync(IMG)) {
  console.log(
    `atlandı: görsel yok (${IMG})\n` +
      '  · assets/thumbnail.jpg ekleyin (özne + arka planı olan gerçek bir büst fotoğrafı), ya da\n' +
      '  · node scripts/verify-curtain.mjs <fotoğraf yolu>',
  );
  process.exit(0);
}

/** sampler.ts sampleBilinear ile birebir (kaynak → hedef eşleme kapısı). */
function bilinear(map, w, h, x, y) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0));
  const ty = Math.min(1, Math.max(0, y - y0));
  const top = map[y0 * w + x0] * (1 - tx) + map[y0 * w + x1] * tx;
  const bot = map[y1 * w + x0] * (1 - tx) + map[y1 * w + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

/** sampleImageGrid'ün sampleBilinearRgb'si ile birebir (3 kanal RGB). */
function bilinearRgb(rgb, w, h, x, y) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0));
  const ty = Math.min(1, Math.max(0, y - y0));
  const out = new Float32Array(3);
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  for (let c = 0; c < 3; c++) {
    out[c] =
      rgb[(y0 * w + x0) * 3 + c] * w00 +
      rgb[(y0 * w + x1) * 3 + c] * w10 +
      rgb[(y1 * w + x0) * 3 + c] * w01 +
      rgb[(y1 * w + x1) * 3 + c] * w11;
  }
  return out;
}

/** depth.ts normalizeDepth ile birebir (min-max + %1 histogram kırpımı). */
function normalizeDepth(data, pct) {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of data) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const span = mx - mn || 1;
  let lo = mn;
  let hi = mx;
  if (pct > 0) {
    const bins = new Float64Array(256);
    for (const v of data) {
      bins[Math.min(255, Math.max(0, Math.floor(((v - mn) / span) * 256)))]++;
    }
    const limit = (data.length * pct) / 100;
    let acc = 0;
    for (let i = 0; i < 256 && acc < limit; i++) {
      acc += bins[i];
      lo = mn + (i / 256) * span;
    }
    acc = 0;
    for (let i = 255; i >= 0 && acc < limit; i--) {
      acc += bins[i];
      hi = mn + ((i + 1) / 256) * span;
    }
  }
  const s = hi - lo || 1;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.min(1, Math.max(0, (data[i] - lo) / s));
  return out;
}

const image = await RawImage.read(IMG);
assert.equal(image.width, image.height, 'letterbox eşdeğerliği için kare kaynak gerekir');
console.log(`görsel        : ${IMG} (${image.width}×${image.height})`);
const imgW = image.width;
const imgH = image.height;

// --- 1. RMBG mask (segmentation.ts yolu: letterbox 1024² → _call({input})) ---
const segModel = await SegformerForSemanticSegmentation.from_pretrained('briaai/RMBG-1.4', {
  device: 'cpu',
  dtype: 'q8',
});
const segProc = await AutoImageProcessor.from_pretrained('briaai/RMBG-1.4');
const segIn = await image.resize(MASK_SIZE, MASK_SIZE);
const t1 = performance.now();
const processed = await segProc(segIn);
const segRes = await segModel._call({ input: processed.pixel_values });
// TUR 10: segmentation.ts ile birebir — RMBG çıktısı sert kesilmez, dilate
// (4px) + tüy (2px) uygulanır: yüz/el kenarı delikleri güven marjıyla kapanır.
const mask = dilateAndFeatherMask(segRes.output.data, MASK_SIZE, MASK_SIZE);
assert.equal(mask.length, MASK_SIZE * MASK_SIZE, 'maske 1024²');
console.log(`rmbg          : ${Math.round(performance.now() - t1)} ms`);
let fgCount = 0;
for (const v of mask) if (v >= 0.5) fgCount++;
const fgRatio = fgCount / mask.length;
assert.ok(fgRatio > 0.02 && fgRatio < 0.98, `maske özneyi ayırıyor (ön plan %${(fgRatio * 100).toFixed(1)} — boş veya tüm kare değil)`);
console.log(`maske         : ön plan %${(fgRatio * 100).toFixed(1)} (${fgCount}/${mask.length})`);

// --- 2. depth (depth.ts yolu: letterbox 518² → pipeline → normalize) ---
const estimator = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-base', {
  device: 'cpu',
  dtype: 'q8',
});
const depthIn = await image.resize(DEPTH_SIZE, DEPTH_SIZE);
const t2 = performance.now();
const { predicted_depth } = await estimator(depthIn);
console.log(`depth         : ${Math.round(performance.now() - t2)} ms`);
assert.deepEqual(predicted_depth.dims.slice(-2), [DEPTH_SIZE, DEPTH_SIZE], 'depth 518²');
const depth = normalizeDepth(predicted_depth.data, 1);

// --- 3. maske → depth boyutu (Engine.setDepth'in resample'ı) ---
const maskD = resampleBilinear(mask, MASK_SIZE, MASK_SIZE, DEPTH_SIZE, DEPTH_SIZE);

// --- 4. sampler: maskeli yol (uygulamada "nesne ayırma AÇIK") ---
const t3 = performance.now();
const xyz = sampleVolumePositions(depth, DEPTH_SIZE, DEPTH_SIZE, {
  foregroundMask: maskD,
  importanceSampling: false,
});
console.log(`sampler       : ${Math.round(performance.now() - t3)} ms`);

// maske bbox + kütle merkezi (dünya koordinatı, 2×2 kare)
let mMinX = Infinity;
let mMaxX = -Infinity;
let mMinY = Infinity;
let mMaxY = -Infinity;
let msx = 0;
let msy = 0;
let msw = 0;
for (let j = 0; j < MASK_SIZE; j++) {
  for (let i = 0; i < MASK_SIZE; i++) {
    if (mask[j * MASK_SIZE + i] < 0.5) continue;
    const wx = (i / MASK_SIZE - 0.5) * 2;
    const wy = (1 - (j + 0.5) / MASK_SIZE - 0.5) * 2;
    if (wx < mMinX) mMinX = wx;
    if (wx > mMaxX) mMaxX = wx;
    if (wy < mMinY) mMinY = wy;
    if (wy > mMaxY) mMaxY = wy;
    msx += wx;
    msy += wy;
    msw++;
  }
}
const mCx = msx / msw;
const mCy = msy / msw;
console.log(
  `maske bbox    : x [${mMinX.toFixed(3)}, ${mMaxX.toFixed(3)}] y [${mMinY.toFixed(3)}, ${mMaxY.toFixed(3)}]`,
);

// --- 5. texel texel denetim (Tur 11 tek buffer): w ∈ {1, BACKDROP_OPACITY},
// ölü texel YOK. Ön plan (w=1) noktası her zaman maskenin BINARY ayak izi
// içinde; maske dışı texel arka plan noktasıdır (w = BACKDROP_OPACITY, z =
// gerçek derinlik − PIN). Kapı: bilinear(1{fg≥0.5}) — sampler sert binary
// alpha üzerinden karar verir (fg maskesinin yumuşak resample değeri
// üzerinden değil), bu yüzden oracle da binary ayak izidir.
let live = 0;
let bgTexels = 0;
let outside = 0;
let zMin = Infinity;
let zMax = -Infinity;
let zSum = 0;
let farBg = 0;
let px = 0;
let py = 0;
const MARGIN = 2 / DEPTH_SIZE * 2; // 2 piksel tolerans (dünya)
const binMask = new Float32Array(maskD.length);
for (let i = 0; i < maskD.length; i++) binMask[i] = maskD[i] >= 0.5 ? 1 : 0;
for (let j = 0; j < N; j++) {
  const y = ((j + 0.5) / N) * DEPTH_SIZE - 0.5;
  for (let i = 0; i < N; i++) {
    const x = ((i + 0.5) / N) * DEPTH_SIZE - 0.5;
    const o = (j * N + i) * 4;
    const w = xyz[o + 3];
    const z = xyz[o + 2];
    const footprint = bilinear(binMask, DEPTH_SIZE, DEPTH_SIZE, x, y) >= 0.5;
    assert.ok(
      w === 1 || Math.abs(w - BACKDROP_OPACITY) < 1e-6,
      `İKİ SEVİYELİ: w ∈ {1, BACKDROP_OPACITY} @(${i},${j}) (alınan ${w})`,
    );
    if (w === 1) {
      assert.ok(footprint, `perde yok: maske ayak izi dışında ÖN PLAN noktası @(${i},${j})`);
    } else {
      // Tur 11: maske dışı texel ÖLÜ DEĞİL — arka plan noktası. z, gerçek
      // derinlikten (d − 0.5)·2 − BACKDROP_Z_PIN; sınır bandında sampler'ın
      // yumuşak maske kararı binary ayak izinden 1-2 texel sapabilir, bu
      // yüzden bg yönü yalnızca sözleşme (w, z) açısından denetlenir — asıl
      // perde iddiası tek yönlüdür: ön plan noktası ayak izi dışına çıkamaz.
      assert.ok(
        Number.isFinite(z) && z >= -1 && z <= 1,
        `bg: z [-1,+1] @(${i},${j}) (alınan ${z})`,
      );
      bgTexels++;
      if (z <= -0.9) farBg++;
      continue;
    }
    live++;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
    zSum += z;
    const wx = (x / DEPTH_SIZE) * 2 - 1;
    const wy = (1 - ((y + 0.5) / DEPTH_SIZE)) * 2 - 1;
    px += wx;
    py += wy;
    if (
      wx < mMinX - MARGIN ||
      wx > mMaxX + MARGIN ||
      wy < mMinY - MARGIN ||
      wy > mMaxY + MARGIN
    ) {
      outside++;
    }
  }
}
const lx = px / live;
const ly = py / live;
const off = Math.hypot(lx - mCx, ly - mCy);
console.log(
  `noktalar      : ${live} ön plan / ${bgTexels} arka plan (toplam ${N * N}), z [${zMin.toFixed(2)}, ${zMax.toFixed(2)}]`,
);
console.log(`arka plan     : ${farBg} texel z ≤ −0.9 (uzak duvar → PIN tabanına sabitlenmiş)`);
console.log(`kütle merkezi : nokta (${lx.toFixed(3)}, ${ly.toFixed(3)}) vs maske (${mCx.toFixed(3)}, ${mCy.toFixed(3)}) → Δ ${off.toFixed(3)}`);

assert.ok(live > N * N * 0.01, 'özne gerçekten render ediliyor (canlı nokta var)');
assert.equal(outside, 0, `maske bbox dışında ÖN PLAN noktası YOK — ${outside} nokta taştı`);
assert.ok(off < 0.3, `hizalama: nokta bulutu maske ile çakışıyor (Δ ${off.toFixed(3)} < 0.3)`);
assert.ok(bgTexels > N * N * 0.05, `arka plan noktaları gerçekten üretildi (${bgTexels} texel)`);

// --- 6. sampleImageGrid (Tur 11): fotoğraf RGB'si konumlarla AYNI eşlemede
// grid'e taşınır. Seçili texel'lerde grid değerini, kaynak görselden
// bilinearRgb ile bağımsız hesaplanan beklenen değerle karşılaştır.
const rgb = new Float32Array(imgW * imgH * 3);
for (let k = 0; k < rgb.length; k++) rgb[k] = image.data[k] / 255;
const colorGrid = sampleImageGrid(
  rgb,
  imgW,
  imgH,
  depth,
  DEPTH_SIZE,
  DEPTH_SIZE,
  { importanceSampling: false },
);
assert.equal(colorGrid.length, N * N * 3, 'renk grid boyutu N×N×3');
for (const [ti, tj] of [[100, 100], [300, 50], [N >> 1, N >> 1], [10, 370]]) {
  const u = (ti + 0.5) / N;
  const t = (tj + 0.5) / N;
  const ex = u * imgW - 0.5;
  const ey = t * imgH - 0.5;
  const expected = bilinearRgb(rgb, imgW, imgH, ex, ey);
  const o = (tj * N + ti) * 3;
  for (let c = 0; c < 3; c++) {
    assert.ok(
      Math.abs(colorGrid[o + c] - expected[c]) < 1e-6,
      `renk hizası: texel (${ti},${tj}) kanal ${c} → beklenen ${expected[c].toFixed(4)}, alınan ${colorGrid[o + c].toFixed(4)}`,
    );
  }
}
console.log('renk grid     : 4 texel bağımsız bilinear okumayla birebir eşleşti (renk hizası tam)');

// --- 7. bilgi amaçlı: maskesiz yol ("nesne ayırma KAPALI") ---
const xyzNo = sampleVolumePositions(depth, DEPTH_SIZE, DEPTH_SIZE, { importanceSampling: false });
let noLive = 0;
let noOutside = 0;
for (let j = 0; j < N; j++) {
  const y = ((j + 0.5) / N) * DEPTH_SIZE - 0.5;
  for (let i = 0; i < N; i++) {
    const o = (j * N + i) * 4;
    if (xyzNo[o + 3] < 0.5) continue;
    noLive++;
    const wx = (((i + 0.5) / N) * DEPTH_SIZE - 0.5) / DEPTH_SIZE * 2 - 1;
    const wy = (1 - ((y + 0.5) / DEPTH_SIZE)) * 2 - 1;
    if (
      wx < mMinX - MARGIN ||
      wx > mMaxX + MARGIN ||
      wy < mMinY - MARGIN ||
      wy > mMaxY + MARGIN
    ) {
      noOutside++;
    }
  }
}
console.log(
  `bilgi (maske KAPALI): ${noLive} canlı, özne bbox'ı dışına taşan ${noOutside} nokta (beklenen davranış: buton oradadır)`,
);

console.log("OK · perde/çanak YOK — ön plan maske bbox'ında, arka plan noktaları TEK buffer üzerinde yaşıyor (Tur 11: ölü texel yok, PIN sabitlemesi + fotoğraf rengi aynı eşlemede)");
