// DAViD ön plan maskesi: yardımcı (sidecar) yolu, tarayıcı açık isteği ve varsayılan politika (sahte HTTP; GPU yok).
//   node scripts/verify-david-sidecar.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const { beklenenSekil } = await import('../src/engine/sidecarClient.ts');
assert.deepEqual(beklenenSekil('david-mask', [1, 3, 512, 512]), [1, 1, 512, 512]);

// Politika (kullanıcı kararı 2026-10-24: DAViD MASKESİ daha iyi, varsayılan DERİNLİK daha iyi):
// bayraksız 'otomatik' (yalnız yardımcı listeliyorsa), ?maske=david tarayıcıda da, ?maske=isnet kapatır.
const { insanMaskesiSecimi, davidPlani, davidMaskeKesisimi, FOTO_KALITE } = await import('../src/depth.ts');
assert.equal(insanMaskesiSecimi(''), 'otomatik');
assert.equal(insanMaskesiSecimi('?derinlik=david'), 'otomatik');
assert.equal(insanMaskesiSecimi('?maske=david&david=int8'), 'david');
assert.equal(insanMaskesiSecimi('?maske=isnet'), undefined);
assert.equal(insanMaskesiSecimi('?maske=varsayilan'), undefined);
assert.deepEqual(davidPlani('david', true, false), { tarayici: true });
assert.deepEqual(davidPlani('otomatik', true, true), { tarayici: false });
assert.deepEqual(davidPlani('otomatik', true, false), { tarayici: true }, 'yardımcı yok (Vercel): tarayıcıda HF int8 maskesi');
assert.equal(davidPlani('david', false, true), null, 'özne maskesi yok: DAViD maskesi tek başına sızıyor');
assert.equal(davidPlani(undefined, true, true), null);
assert.deepEqual(FOTO_KALITE, { tileDetay: true, kenarHizalama: 0.5, model: 'da3-mono', insanMaskesi: 'otomatik' });
// Kesişim: DAViD ∩ özne (min) — sandalye/duvar (özne dışı) ve DAViD'in dışladığı yer düşer, kenar yumuşak kalır.
assert.deepEqual([...davidMaskeKesisimi(Float32Array.of(1, 1, 0.6, 0), Float32Array.of(1, 0.2, 0.9, 1))].map(v => +v.toFixed(3)), [1, 0.2, 0.6, 0]);

// Yardımcı yolu ayrı süreçte: sidecarClient modül düzeyinde location'a göre kurulur.
const kos = (kod, search = '', hostname = 'localhost') => execFileSync(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  globalThis.location = { hostname: ${JSON.stringify(hostname)}, search: ${JSON.stringify(search)} };
  console.warn = () => {};
  const S = 512, n = S * S, istekler = [];
  const araclar = { gpuSirasinaGir: f => f(), onceRetry: f => f, webgpuKullanilabilir: async () => { throw new Error('tarayıcı yolu çağrılmamalı'); } };
  const rgba = new Uint8ClampedArray(4 * n);
  for (let i = 0; i < n; i++) rgba.set([10, 20, 30, 255], 4 * i);
  const saglik = modeller => ({ ok: true, json: async () => ({ ok: true, arkaUc: 'DmlExecutionProvider', modeller }) });
  ${kod}
`], { cwd: new URL('..', import.meta.url), stdio: 'pipe' });

// 1) /health 'david-mask' listeliyor: tek POST, BGR girdi, [1,1,S,S] -> kırpılmış maske.
kos(`
  const cikti = new Float32Array(n).fill(0.5); cikti[0] = 1.5;
  globalThis.fetch = async (url, init) => {
    istekler.push(url);
    if (url.endsWith('/health')) return saglik(['small', 'da3', 'mask', 'david-mask']);
    assert.ok(url.includes('model=david-mask'), url);
    const x = new Float32Array(init.body.buffer, init.body.byteOffset, init.body.byteLength / 4);
    assert.equal(init.headers['X-Dims'], '1,3,512,512');
    assert.ok(Math.abs(x[0] - 30 / 255) < 1e-6 && Math.abs(x[2 * n] - 10 / 255) < 1e-6, 'BGR sırası');
    return { ok: true, status: 200, headers: { get: k => k === 'x-dims' ? '1,1,512,512' : init.headers['X-Frame-Id'] }, arrayBuffer: async () => cikti.buffer };
  };
  const { inferDavidMaske } = await import('./src/engine/vision/davidDepth.ts');
  const r = await inferDavidMaske(rgba, araclar, { tarayici: false });
  assert.equal(r.arkaUc, 'sidecar');
  assert.equal(r.maske.length, n);
  assert.equal(r.maske[0], 1, 'maske 0..1');
  assert.equal(r.maske[1], 0.5);
  assert.equal(istekler.length, 2, 'health + tek POST, model indirmesi yok');
`);

// 2) Yardımcı DAViD'de hata verir: null, yardımcı DA3 için AÇIK kalır, her fotoğrafta yeniden denenmez.
kos(`
  globalThis.fetch = async (url) => {
    istekler.push(url);
    if (url.endsWith('/health')) return saglik(['small', 'da3', 'mask', 'david-mask']);
    return { ok: false, status: 500, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const { inferDavidMaske } = await import('./src/engine/vision/davidDepth.ts');
  const { localInference } = await import('./src/engine/sidecarClient.ts');
  assert.equal(await inferDavidMaske(rgba, araclar, { tarayici: false }), null);
  assert.equal(await localInference.available(), true, 'DAViD hatası DA3 yardımcısını kapatmaz');
  assert.equal(await inferDavidMaske(rgba, araclar, { tarayici: false }), null);
  assert.equal(istekler.filter(u => u.includes('model=david-mask')).length, 1);
`);

// 3) Yardımcı DAViD listelemiyor ve açık istek yok: hiçbir POST ya da 449 MB indirme yok.
kos(`
  globalThis.fetch = async (url) => {
    istekler.push(url);
    if (url.endsWith('/health')) return saglik(['small', 'da3', 'mask']);
    throw new Error('beklenmeyen istek ' + url);
  };
  const { inferDavidMaske } = await import('./src/engine/vision/davidDepth.ts');
  assert.equal(await inferDavidMaske(rgba, araclar, { tarayici: false }), null);
  assert.deepEqual(istekler.map(u => u.split('/').pop()), ['health']);
`);

// 4) Tarayıcı açık isteği (?maske=david&david=int8, yardımcı yok): YALNIZ maske modeli, int8 dosyası.
kos(`
  const ort = await import('onnxruntime-web/webgpu');
  globalThis.fetch = async (url) => {
    istekler.push(url);
    return { ok: true, status: 200, headers: { get: () => '8' }, body: null, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  let olusan = 0;
  ort.InferenceSession.create = async () => ({ inputNames: ['input'], outputNames: ['output'], run: async feeds => {
    olusan++;
    assert.deepEqual(feeds.input.dims, [1, 3, S, S]);
    return { output: { data: new Float32Array(n).fill(0.25), dims: [1, 1, S, S], dispose() {} } };
  } });
  araclar.webgpuKullanilabilir = async () => true;
  const { inferDavidMaske } = await import('./src/engine/vision/davidDepth.ts');
  const r = await inferDavidMaske(rgba, araclar, { tarayici: true });
  assert.equal(r.arkaUc, 'webgpu');
  assert.equal(r.maske[5], 0.25);
  assert.equal(olusan, 1);
  assert.deepEqual(istekler, ['https://example.com/models/microsoft-david/7b404af3cfa9c1fb8851bae03a20b4250608aa7b/foreground-segmentation-model-vitb16_384-int8.onnx'], 'tarayıcı maskesi: deployment int8, sabit revizyon');
`, '', 'example.com');
console.log('OK DAViD maskesi: yardımcı protokolü, hata yalıtımı, indirme yok, tarayıcı/int8 açık isteği, politika');
