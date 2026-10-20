// DA3Mono ön/son işleme. Model dosyası varsa (DA3_MONO_ONNX=<yol>) gerçek bir
// fotoğrafta uçtan uca polariteyi de doğrular; yoksa yalnız saf kısım koşar.
//   node scripts/verify-da3-mono.mjs
import assert from 'node:assert/strict';
const { da3Preprocess, da3ToDisparity, da3Plausible } = await import('../src/engine/vision/da3Mono.ts');

// Preprocess: ImageNet normalizasyonu, CHW.
{
  const rgba = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255]); // 2 piksel
  const o = da3Preprocess(rgba, 2, 1);
  assert.equal(o.length, 6);
  assert.ok(Math.abs(o[0] - (1 - 0.485) / 0.229) < 1e-5, 'kırmızı kanal piksel 0');
  assert.ok(Math.abs(o[3] - (0 - 0.485) / 0.229) < 1e-5 || Math.abs(o[3] - (1 - 0.456) / 0.224) < 1e-5);
}

// Polarite: DA3 derinliğinde yakın = küçük; disparitede yakın = BÜYÜK.
{
  const depth = Float32Array.from([0.5, 1, 2, 4, 8]);
  const dis = da3ToDisparity(depth);
  for (let i = 1; i < dis.length; i++) assert.ok(dis[i] < dis[i - 1], 'uzaklaştıkça disparite düşer');
}

// Ölçek bağımsızlığı: derinliği ×7 -> disparite sadece ×1/7 (aynı şekil).
{
  const depth = Float32Array.from({ length: 200 }, (_, i) => 0.3 + (i / 199) * 2);
  const a = da3ToDisparity(depth);
  const b = da3ToDisparity(depth.map((v) => v * 7));
  const ra = a[0] / a[199], rb = b[0] / b[199];
  assert.ok(Math.abs(ra - rb) < 1e-3, 'ölçek değişince oran sabit');
}

// Yakın kuyruk saf 1/d'den daha yumuşak (ağır kuyruk bastırılır).
{
  const depth = Float32Array.from({ length: 1000 }, (_, i) => 0.3 + (i / 999) * 2.2);
  depth[0] = 0.05; // tek yakın piksel
  const shifted = da3ToDisparity(depth);
  const pure = depth.map((d) => 1 / Math.max(d, 1e-3));
  const range = (x) => Math.max(...x) / Math.min(...x);
  assert.ok(range(shifted) < range(pure) / 2, 'kayma kuyruğu kısaltır');
}

// shiftK = 0: saf ters derinlik (SfM afin hizalaması için) — 1/d ile birebir.
{
  const depth = Float32Array.from([0.5, 1, 2, 4, 8]);
  const dis = da3ToDisparity(depth, null, 0);
  for (let i = 0; i < depth.length; i++) assert.ok(Math.abs(dis[i] - 1 / depth[i]) < 1e-6, 'saf 1/d');
}

// Gökyüzü en uzak seviyeye sabitlenir (uç değer yok).
{
  const depth = Float32Array.from([1, 2, 3, 500]);
  const sky = Float32Array.from([0, 0, 0, 1]);
  const dis = da3ToDisparity(depth, sky);
  assert.equal(dis[3], Math.min(dis[0], dis[1], dis[2]));
}

// Makullük: NaN, sabit, tamamen gökyüzü reddedilir.
{
  assert.ok(da3Plausible(Float32Array.from([0.5, 1, 2])));
  assert.ok(!da3Plausible(Float32Array.from([0.5, NaN, 2])));
  assert.ok(!da3Plausible(Float32Array.from([1, 1, 1, 1])));
  assert.ok(!da3Plausible(Float32Array.from([-1, 1, 2])));
  assert.ok(!da3Plausible(Float32Array.from([1, 2, 3]), Float32Array.from([1, 1, 1])));
}

// İsteğe bağlı: gerçek model, gerçek fotoğraf.
if (process.env.DA3_MONO_ONNX) {
  const ort = await import('onnxruntime-node');
  const sharp = (await import('sharp')).default;
  const s = await ort.InferenceSession.create(process.env.DA3_MONO_ONNX, { executionProviders: ['cpu'] });
  const W = 518, H = 518;
  const { data } = await sharp('assets/özüm.jpg').removeAlpha().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const ext = new Float32Array(16); [0, 5, 10, 15].forEach((i) => (ext[i] = 1));
  const o = await s.run({
    image: new ort.Tensor('float32', da3Preprocess(data, W, H, 3), [1, 1, 3, H, W]),
    extrinsics_in: new ort.Tensor('float32', ext, [1, 1, 4, 4]),
    intrinsics_in: new ort.Tensor('float32', Float32Array.from([W, 0, W / 2, 0, W, H / 2, 0, 0, 1]), [1, 1, 3, 3]),
  });
  assert.ok(da3Plausible(o.depth.data, o.sky.data), 'gerçek çıktı makul');
  const dis = da3ToDisparity(o.depth.data, o.sky.data);
  // özüm.jpg (518x518'e esnetilmiş): öne uzanan kol alt-solda en yakın; sol üst kapı aralığı uzak.
  const mean = (x0, x1, y0, y1) => { let t = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t += dis[y * W + x]; n++; } return t / n; };
  assert.ok(mean(40, 200, 430, 510) > mean(10, 75, 25, 100), 'yakın kol > uzak arka plan (polarite doğru)');
  console.log('gerçek model: polarite doğrulandı');
}
console.log('verify-da3-mono OK');
