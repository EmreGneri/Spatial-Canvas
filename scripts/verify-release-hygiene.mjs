/**
 * RELEASE HYGIENE (review-fixes gorev 3): ORT pin, cache headers, notices.
 *
 * Bulgu: onnxruntime-web bir dev-nightly `^` araligina bagliydi; bir ORT
 * yukseltmesi sonrasi yeni hash'li JS glue, ayni /ort/* URL'sinden bir yillik
 * cache'te kalan eski .wasm'i yukler ve tum modeller bozulur. /ort ve /models
 * "immutable" cache basligi tasiyordu ama icerikleri URL degismeden
 * degisebiliyor (model/ORT yukseltmesi); Vite'in hash'li /assets/* dosyalari
 * ise hicbir cache basligi almiyordu. Ayrica derlenen paket lisans
 * bildirimlerini siliyordu (mediabunny MPL, splat.js MIT).
 *
 * Bu script uc seyi dogrular: (1) vercel.json cache kurallari, (2)
 * onnxruntime-web'in tek, tam surume sabitlendigi, (3) public/THIRD_PARTY_NOTICES.txt
 * her uretim bagimliligini, vendored kodu ve model agirliklarini kapsiyor.
 *
 *   node scripts/verify-release-hygiene.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// [1] vercel.json cache kurallari: /ort ve /models icerik URL degismeden
// degisebilir -> must-revalidate. /assets Vite tarafindan icerik-hash'li ->
// sonsuza kadar cache'lenebilir.
{
  const vercel = readJson('vercel.json');
  const bySource = Object.fromEntries(
    vercel.headers.map((h) => [h.source, h.headers.find((x) => x.key === 'Cache-Control')?.value]),
  );
  assert.equal(bySource['/ort/(.*)'], 'public, max-age=0, must-revalidate',
    '/ort/* icerigi URL sabitken degisebilir, immutable cache eski .wasm sunar');
  assert.equal(bySource['/models/(.*)'], 'public, max-age=0, must-revalidate',
    '/models/* icerigi URL sabitken degisebilir, immutable cache eski agirlik sunar');
  assert.equal(bySource['/assets/(.*)'], 'public, max-age=31536000, immutable',
    'Vite /assets/* dosyalari icerik-hash tasir, sonsuza kadar cache guvenli');
}

// [2] onnxruntime-web tam surume sabit, @huggingface/transformers'in kendi
// bagimlilik spec'iyle ayni, ve node_modules'ta tek surum var.
{
  const pkg = readJson('package.json');
  const spec = pkg.dependencies['onnxruntime-web'];
  assert.ok(!/^[\^~]/.test(spec), `onnxruntime-web tam surume sabit olmali, bulundu: ${spec}`);

  const transformersPkg = readJson('node_modules/@huggingface/transformers/package.json');
  assert.equal(spec, transformersPkg.dependencies['onnxruntime-web'],
    'onnxruntime-web spec, @huggingface/transformers kendi bagimliligiyla ayni olmali');

  const lock = readJson('package-lock.json');
  const versions = new Set(
    Object.entries(lock.packages)
      .filter(([p]) => p.split('node_modules/').pop() === 'onnxruntime-web')
      .map(([, info]) => info.version),
  );
  assert.equal(versions.size, 1, `node_modules'ta tek onnxruntime-web surumu olmali, bulundu: ${[...versions]}`);
  assert.ok(versions.has(spec), 'kurulu surum package.json spec ile eslesmeli');
}

// [3] THIRD_PARTY_NOTICES.txt her uretim bagimliligini, vendored kodu ve
// model agirliklarini kapsiyor.
{
  const notices = readFileSync('public/THIRD_PARTY_NOTICES.txt', 'utf8');

  const lock = readJson('package-lock.json');
  const missing = [];
  for (const [p, info] of Object.entries(lock.packages)) {
    if (!p) continue; // root
    if (info.dev) continue; // sadece gelistirme bagimliligi
    const name = p.split('node_modules/').pop();
    if (name.startsWith('@types/')) continue; // sadece .d.ts, calisma zamaninda kod tasimaz
    if (!notices.includes(name)) missing.push(`${name}@${info.version}`);
  }
  assert.equal(missing.length, 0, `notices dosyasinda eksik uretim bagimliliklari: ${missing.join(', ')}`);

  for (const needle of [
    'splat.js',
    'MIT',
    'mediabunny',
    'MPL-2.0',
    'onnx-community/depth-anything-v2-small',
    'Apache-2.0',
    'Xenova/yolos-tiny',
    'imgly/isnet-general-onnx',
    'huggingface.co',
  ]) {
    assert.ok(notices.includes(needle), `notices dosyasinda "${needle}" bulunamadi`);
  }
}

// [4] Notices, fetch:assets ve vite build arasinda build zamaninda uretilir
// (dist/ kopyalanmadan once) -- boylece bagimliliklar degisince bayatlamaz.
{
  const pkg = readJson('package.json');
  assert.match(pkg.scripts.build, /npm run fetch:assets && node scripts\/gen-third-party-notices\.mjs && vite build/,
    'build script notices uretecini fetch:assets sonrasi, vite build oncesi zincirlemeli');
}

console.log('OK release hygiene: cache headers, ORT pin, third-party notices coverage');
