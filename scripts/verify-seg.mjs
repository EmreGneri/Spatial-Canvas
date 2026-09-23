// Nesne/arka plan ayırma offline smoke test (Node). Vendored ONNX modelini
// GERÇEKTEN çalıştırdığını tarayıcıdan ÖNCE kanıtlar — uygulamayla aynı yol:
// aynı model dosyası, aynı normalizasyon, aynı giriş/çıkış adları.
//
// MODEL DEĞİŞTİ (2026-09-24, ticari lisans): eski `briaai/RMBG-1.4`
// "non-commercial" lisanslıydı ve abonelikli üründe kullanılamaz. Yerine
// `imgly/isnet-general-onnx` (MIT) geldi; aynı IS-Net ailesi, aynı ONNX
// arayüzü. Bu script artık ÜRÜNDE KULLANILAN modeli doğrular — indirilmeyen
// bir modeli test etmek yanlış güven verirdi.
//   node scripts/verify-seg.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as ort from 'onnxruntime-web';

const MODEL_PATH = './public/models/imgly/isnet-general-onnx/onnx/model_fp16.onnx';
const SIZE = 1024;
// segmentation.ts ile AYNI sabitler (preprocessor_config.json'dan).
const NORM_MEAN = 128;
const NORM_STD = 256;

if (!existsSync(MODEL_PATH)) {
  console.error(`model yok: ${MODEL_PATH}\n  npm run fetch:assets ile indirilir`);
  process.exit(1);
}

ort.env.wasm.numThreads = 1;

const t0 = performance.now();
const session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ['wasm'] });
console.log(`model yukleme : ${Math.round(performance.now() - t0)} ms`);

assert.deepEqual(session.inputNames, ['input'], 'ONNX giris adi input');
assert.deepEqual(session.outputNames, ['output'], 'ONNX cikis adi output');
console.log('[1] giris/cikis adlari sozlesmede (input/output) ✓');

// Sentetik sahne: ortada parlak blob, cevre koyu arka plan.
const n = SIZE * SIZE;
const tensor = new Float32Array(3 * n);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x;
    const inBlob = Math.abs(x - SIZE / 2) < 240 && Math.abs(y - SIZE / 2) < 320;
    const v = inBlob ? 200 : 40;
    const norm = (v - NORM_MEAN) / NORM_STD;
    tensor[i] = norm;
    tensor[n + i] = norm;
    tensor[2 * n + i] = norm;
  }
}

const t1 = performance.now();
const result = await session.run({
  input: new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]),
});
console.log(`inference     : ${Math.round(performance.now() - t1)} ms`);

const out = result.output;
assert.deepEqual([...out.dims], [1, 1, SIZE, SIZE], 'cikti [1,1,H,W] tek kanalli maske');
const data = out.data;
let mn = Infinity;
let mx = -Infinity;
for (const v of data) {
  if (v < mn) mn = v;
  if (v > mx) mx = v;
}
assert.ok(mn >= 0 && mx <= 1, `cikti 0..1 olasilik — aralik ${mn.toFixed(4)}..${mx.toFixed(4)}`);
assert.ok(mx - mn > 0.1, 'maske duz degil (gercek on plan ayrimi var)');
console.log(`[2] cikti sekli + 0..1 araligi ✓ (${mn.toFixed(3)}..${mx.toFixed(3)})`);

// Blob ICI ortalamasi, DISI ortalamasindan belirgin yuksek olmali: model
// gercekten onu plani buluyor mu, yoksa gurultu mu uretiyor.
let icTop = 0;
let icN = 0;
let disTop = 0;
let disN = 0;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const inBlob = Math.abs(x - SIZE / 2) < 240 && Math.abs(y - SIZE / 2) < 320;
    const v = data[y * SIZE + x];
    if (inBlob) { icTop += v; icN++; } else { disTop += v; disN++; }
  }
}
const ic = icTop / icN;
const dis = disTop / disN;
assert.ok(ic > dis + 0.2, `blob ici (${ic.toFixed(3)}) disindan (${dis.toFixed(3)}) belirgin yuksek olmali`);
console.log(`[3] on plan ayrimi ✓ (ic ${ic.toFixed(3)} · dis ${dis.toFixed(3)})`);

console.log('OK nesne ayirma (imgly/isnet-general-onnx · MIT)');
