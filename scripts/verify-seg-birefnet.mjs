/**
 * TARAYICI BiRefNet (WebGPU) — fotoğraf yolu sözleşmesi.
 *
 * Fotoğraf maskesi sırası: yardımcı BiRefNet → tarayıcı BiRefNet → IS-Net.
 * Tarayıcı BiRefNet'in HER hatası (WebGPU yok, kurulum/shader hatası, OOM,
 * beklenmeyen şekil) `null` döner ve oturum boyunca kapanır — çağıran IS-Net'e
 * düşer, fotoğraf akışı kırılmaz. Makul olmayan maske (boş / tüm kare / NaN)
 * yalnız O kare için IS-Net'e düşer.
 *
 * Gerçek model burada ÇALIŞMAZ (Node'da WebGPU yok); ORT oturumu sahtedir.
 * Gerçek ölçüm: scripts/olc-maske.mjs --birefnet (docs/benchmarks/maske-olcumu.md).
 *
 *   node scripts/verify-seg-birefnet.mjs
 */
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => '8' },
  body: null,
  arrayBuffer: async () => new ArrayBuffer(8),
});
// Uyarılar beklenen davranış; çıktıyı kirletmesin ama sayılsın.
const uyarilar = [];
console.warn = (...a) => uyarilar.push(a.map(String).join(' '));

const ort = await import('onnxruntime-web/webgpu');
const N = 1024 * 1024;
const DIMS = [1, 1, 1024, 1024];

let sayac = 0;
const taze = () => import(`../src/engine/reconstruction/segmentation.ts?verify-seg-birefnet=${++sayac}`);
const gpuVar = (var_) => {
  if (var_) Object.defineProperty(globalThis.navigator, 'gpu', { value: {}, configurable: true });
  else delete globalThis.navigator.gpu;
};
const girdi = { data: new Float32Array(3 * N), dims: [1, 3, 1024, 1024] };
/** Ortada bir kare ön plan (logit +4), çevresi arka plan (−4). */
function makulLogit() {
  const d = new Float32Array(N).fill(-4);
  for (let y = 300; y < 700; y++) d.fill(4, y * 1024 + 300, y * 1024 + 700);
  return d;
}

// [1] sigmoid + makullük (saf)
{
  const { birefnetOlasilik } = await taze();
  const p = birefnetOlasilik(makulLogit());
  assert.ok(p, 'makul maske kabul edilmeli');
  assert.ok(Math.abs(p[500 * 1024 + 500] - 1 / (1 + Math.exp(-4))) < 1e-6, 'ön plan = sigmoid(logit)');
  assert.ok(p[0] < 0.02, 'arka plan ~0');
  assert.equal(birefnetOlasilik(new Float32Array(N).fill(-10)), null, 'boş maske reddedilmeli');
  assert.equal(birefnetOlasilik(new Float32Array(N).fill(10)), null, 'tüm kare maske reddedilmeli');
  const nan = makulLogit(); nan[7] = NaN;
  assert.equal(birefnetOlasilik(nan), null, 'NaN içeren çıktı reddedilmeli');
  console.log('[1] sigmoid + makullük kontrolü ✓');
}

// [2] WebGPU yoksa model hiç indirilmez/kurulmaz
{
  gpuVar(false);
  let creates = 0;
  ort.InferenceSession.create = async () => { creates++; return {}; };
  const { tarayiciBirefnet } = await taze();
  assert.equal(await tarayiciBirefnet(girdi), null);
  assert.equal(creates, 0, 'WebGPU yokken oturum kurulmamalı');
  console.log('[2] WebGPU yok → null, kurulum yok ✓');
}

// [3] kurulum hatası → null ve oturum boyunca kapalı (115 MB tekrar inmez)
{
  gpuVar(true);
  let creates = 0;
  ort.InferenceSession.create = async () => { creates++; throw new Error('storage buffer sınırı aşıldı'); };
  const { tarayiciBirefnet } = await taze();
  assert.equal(await tarayiciBirefnet(girdi), null, 'kurulum hatası null dönmeli (fırlatmamalı)');
  assert.equal(await tarayiciBirefnet(girdi), null);
  assert.equal(creates, 1, 'hata sonrası yeniden kurulum denenmemeli');
  assert.ok(uyarilar.some((u) => u.includes('storage buffer')), 'hata loglanmalı');
  console.log('[3] kurulum hatası → null, oturum boyunca kapalı, loglandı ✓');
}

// [4] makul çıktı → olasılık; makul olmayan → yalnız o kare null, kapanmaz
{
  gpuVar(true);
  let creates = 0;
  let runs = 0;
  let siradaki = makulLogit();
  ort.InferenceSession.create = async () => {
    creates++;
    return {
      run: async (feeds) => {
        runs++;
        assert.deepEqual(Object.keys(feeds), ['input_image'], 'girdi adı input_image');
        return { output_image: { dims: DIMS, data: siradaki } };
      },
      release: async () => {},
    };
  };
  const { tarayiciBirefnet } = await taze();
  const p = await tarayiciBirefnet(girdi);
  assert.ok(p instanceof Float32Array && p.length === N, 'makul çıktı olasılık döner');
  siradaki = new Float32Array(N).fill(-10);
  assert.equal(await tarayiciBirefnet(girdi), null, 'boş maske → null');
  siradaki = makulLogit();
  assert.ok(await tarayiciBirefnet(girdi), 'makul olmayan kare sonrası model kapanmamalı');
  assert.equal(creates, 1, 'oturum bir kez kurulur');
  assert.equal(runs, 3);
  console.log('[4] makul → olasılık; boş maske yalnız o kareyi IS-Net\'e düşürür ✓');
}

// [5] beklenmeyen çıktı şekli / çalıştırma hatası → null ve kapalı
{
  gpuVar(true);
  let runs = 0;
  let released = 0;
  ort.InferenceSession.create = async () => ({
    run: async () => { runs++; return { output_image: { dims: [1, 1, 512, 512], data: new Float32Array(512 * 512) } }; },
    release: async () => { released++; },
  });
  const { tarayiciBirefnet } = await taze();
  assert.equal(await tarayiciBirefnet(girdi), null);
  assert.equal(await tarayiciBirefnet(girdi), null);
  assert.equal(runs, 1, 'hata sonrası tekrar çalıştırılmamalı');
  assert.equal(released, 1, 'hatalı oturum bırakılmalı (GPU belleği)');
  console.log('[5] beklenmeyen şekil → null, oturum bırakıldı, kapalı ✓');
}

console.log(`OK tarayıcı BiRefNet geri düşüş sözleşmesi (${uyarilar.length} beklenen uyarı)`);
