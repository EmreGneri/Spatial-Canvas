// İndirme ilerlemesi (saf): satır biçimi, baskın dosya seçimi, akıtarak
// getirme ve Content-Length olmayan yol.
//   node scripts/verify-indirme-ilerleme.mjs
import assert from 'node:assert/strict';
import { beginPhotoMeasurement } from '../src/engine/photoMeasurement.ts';
import {
  baskinDurum, boyut, ilerlemeSatiri, ilerlemeliGetir,
  indirmeBildir, indirmeBitti, indirmeDinle, indirmeSifirla,
} from '../src/indirmeIlerleme.ts';

// ── BOYUT ──────────────────────────────────────────────────────────────────
assert.equal(boyut(512), '512 B');
assert.equal(boyut(2048), '2 KB');
assert.equal(boyut(88_160_000), '84.1 MB');
// Ondalıkta NOKTA: uygulamanın mevcut düzeni (olcumSatiri ile aynı kural).
assert.ok(boyut(88_160_000).includes('.'), 'ondalık ayracı değişmiş');

// ── SATIR ──────────────────────────────────────────────────────────────────
assert.equal(
  ilerlemeSatiri({ ad: 'nesne ayırma modeli', inen: 42_000_000, toplam: 84_000_000 }),
  'nesne ayırma modeli iniyor · %50 · 80.1 MB',
);
// Toplam bilinmiyorsa YÜZDE UYDURULMAZ (künye kuralı · paylasim.ts).
assert.equal(
  ilerlemeSatiri({ ad: 'derinlik modeli', inen: 3_145_728 }),
  'derinlik modeli iniyor · 3.0 MB',
);
assert.equal(ilerlemeSatiri({ ad: 'derinlik modeli', inen: 0 }), 'derinlik modeli iniyor');
assert.equal(ilerlemeSatiri(null), null, 'indirme yokken satır çizilmemeli');
// %100'ü aşmaz: sunucu eksik Content-Length verirse satır saçmalamasın.
assert.match(ilerlemeSatiri({ ad: 'x', inen: 200, toplam: 100 }), /%100/);

// ── BASKIN DOSYA ───────────────────────────────────────────────────────────
// Model + config aynı anda iner; kullanıcı için büyük olan önemlidir.
const buyuk = { ad: 'ağırlık', inen: 10, toplam: 84_000_000 };
const kucuk = { ad: 'config', inen: 900, toplam: 1_000 };
assert.equal(baskinDurum([kucuk, buyuk]), buyuk, 'küçük dosya satırı kapıyor');
assert.equal(baskinDurum([buyuk, kucuk]), buyuk, 'sıra sonucu değiştiriyor');
assert.equal(baskinDurum([]), null);
// Eşit toplamda daha çok inmiş olan seçilir ki satır GERİ SIÇRAMASIN.
const a = { ad: 'a', inen: 10, toplam: 100 };
const b = { ad: 'b', inen: 80, toplam: 100 };
assert.equal(baskinDurum([a, b]), b, 'satır geri sıçrayabilir');

// ── YAYIN ──────────────────────────────────────────────────────────────────
indirmeSifirla();
const gorulen = [];
const birak = indirmeDinle((s) => gorulen.push(s));
indirmeBildir('m', { ad: 'derinlik modeli', inen: 1024, toplam: 2048 });
assert.equal(gorulen.at(-1), 'derinlik modeli iniyor · %50 · 2 KB');
// Biten dosya satırdan DÜŞER; yoksa gösterge takılı kalır.
indirmeBitti('m');
assert.equal(gorulen.at(-1), null, 'biten indirme satırda kalıyor');
// Bilinmeyen anahtarı bitirmek yayın yapmamalı (gereksiz render).
const once = gorulen.length;
indirmeBitti('yok');
assert.equal(gorulen.length, once, 'bilinmeyen anahtar yayın tetikliyor');
birak();
indirmeBildir('m2', { ad: 'x', inen: 1, toplam: 2 });
assert.equal(gorulen.length, once, 'abonelik bırakıldıktan sonra da yayın geliyor');
indirmeSifirla();

// ── AKITARAK GETİRME ───────────────────────────────────────────────────────
function sahteYanit(bayt, { uzunlukVer = true, parca = 4 } = {}) {
  const veri = new Uint8Array(bayt).map((_, i) => i % 251);
  let konum = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => (k === 'content-length' && uzunlukVer ? String(bayt) : null) },
    body: {
      getReader: () => ({
        read: async () => {
          if (konum >= veri.length) return { done: true, value: undefined };
          const son = Math.min(veri.length, konum + parca);
          const dilim = veri.slice(konum, son);
          konum = son;
          return { done: false, value: dilim };
        },
      }),
    },
    arrayBuffer: async () => veri.buffer,
  };
}

{
  const satirlar = [];
  const birak2 = indirmeDinle((s) => satirlar.push(s));
  const buf = await ilerlemeliGetir('/m.onnx', 'nesne ayırma modeli', async () => sahteYanit(16));
  birak2();
  assert.equal(buf.byteLength, 16, 'baytlar eksik döndü');
  // Parçalar DOĞRU SIRADA birleştirilmeli; bozuk tampon modeli çökertir.
  const u = new Uint8Array(buf);
  for (let i = 0; i < 16; i++) assert.equal(u[i], i % 251, `bayt ${i} yanlış yerde`);
  assert.ok(satirlar.some((s) => s && s.includes('%')), 'ilerleme hiç bildirilmedi');
  assert.equal(satirlar.at(-1), null, 'indirme bitince satır düşmeli');
}

// Content-Length yoksa yüzde yazılmaz ama indirme ÇALIŞMALI.
{
  const satirlar = [];
  const birak3 = indirmeDinle((s) => satirlar.push(s));
  const buf = await ilerlemeliGetir('/n.onnx', 'model', async () => sahteYanit(12, { uzunlukVer: false }));
  birak3();
  assert.equal(buf.byteLength, 12);
  assert.ok(satirlar.some((s) => s && !s.includes('%')), 'uzunluk yokken yüzde uydurulmuş');
}

// Gövde akıtılamıyorsa sessizce tam okumaya düşülür (eski tarayıcı/önbellek).
{
  const y = sahteYanit(8);
  y.body = null;
  const buf = await ilerlemeliGetir('/o.onnx', 'model', async () => y);
  assert.equal(buf.byteLength, 8, 'akıtılamayan gövdede indirme kırılıyor');
}

// Hata durumunda satır TAKILI KALMAMALI.
{
  const satirlar = [];
  const birak4 = indirmeDinle((s) => satirlar.push(s));
  await assert.rejects(
    () => ilerlemeliGetir('/p.onnx', 'model', async () => ({ ok: false, status: 404, statusText: 'Not Found' })),
    /404/,
  );
  birak4();
  assert.ok(!satirlar.some((s) => s !== null), 'hata sonrası satır kalmış');
}

// Ölçüm buffer okumasını tekrar etmez; indirilen gövdeyi cache transferi diye saymaz.
{
  const trace = beginPhotoMeasurement({ generation: 1, width: 8, height: 8 }, true);
  let calls = 0;
  const response = sahteYanit(12);
  const buffer = await ilerlemeliGetir('/measured.onnx', 'measured', async () => { calls++; return response; });
  const report = trace.finish('ready');
  assert.equal(calls, 1);
  assert.equal(buffer.byteLength, 12);
  assert.equal(report.downloads.length, 1);
  assert.equal(report.downloads[0].source, 'fetch');
  assert.equal(report.downloads[0].bodyBytes, 12);
  assert.equal(report.downloads[0].status, 'ok');
  assert.ok(report.downloads[0].endedAt >= report.downloads[0].startedAt);
}
{
  const trace = beginPhotoMeasurement({ generation: 2, width: 8, height: 8 }, true);
  const original = new Uint8Array([1, 2, 3]).buffer;
  const response = { ...sahteYanit(0), body: null, arrayBuffer: async () => original };
  assert.equal(await ilerlemeliGetir('/bodyless.onnx', 'bodyless', async () => response), original);
  const report = trace.finish('ready');
  assert.equal(report.downloads[0].bodyBytes, 3);
}
{
  const trace = beginPhotoMeasurement({ generation: 3, width: 8, height: 8 }, true);
  await assert.rejects(ilerlemeliGetir('/failed.onnx', 'failed', async () => { throw Error('offline'); }), /offline/);
  const report = trace.finish('ready');
  assert.equal(report.downloads[0].status, 'failed');
  assert.equal(report.downloads[0].bodyBytes, 0);
}
{
  const previous = globalThis.caches;
  let fetches = 0, reads = 0;
  globalThis.caches = { open: async () => ({ match: async () => ({ arrayBuffer: async () => { reads++; return new Uint8Array([4, 5]).buffer; } }) }) };
  try {
    const trace = beginPhotoMeasurement({ generation: 4, width: 8, height: 8 }, true);
    const buffer = await ilerlemeliGetir('https://models.invalid/pinned.onnx', 'cached', async () => { fetches++; throw Error('must not fetch'); });
    const report = trace.finish('ready');
    assert.deepEqual([...new Uint8Array(buffer)], [4, 5]);
    assert.equal(reads, 1);
    assert.equal(fetches, 0);
    assert.equal(report.downloads[0].source, 'cache-storage');
    assert.equal(report.downloads[0].bodyBytes, 2);
  } finally { if (previous === undefined) delete globalThis.caches; else globalThis.caches = previous; }
}
{
  const trace = beginPhotoMeasurement({ generation: 5, width: 8, height: 8 }, true);
  let reads = 0;
  const response = sahteYanit(4);
  response.body.getReader = () => ({ read: async () => {
    if (reads++ === 0) return { done: false, value: new Uint8Array([1, 2, 3, 4]) };
    throw Error('stream failed');
  } });
  await assert.rejects(ilerlemeliGetir('/stream-failure.onnx', 'stream', async () => response), /stream failed/);
  const report = trace.finish('ready');
  assert.equal(report.downloads[0].status, 'failed');
  assert.equal(report.downloads[0].bodyBytes, 4, 'partial bytes must survive a stream error');
}
{
  const old = beginPhotoMeasurement({ generation: 6, width: 8, height: 8 }, true);
  let resolve;
  const pending = ilerlemeliGetir('/stale.onnx', 'stale', () => new Promise(r => { resolve = r; }));
  const next = beginPhotoMeasurement({ generation: 7, width: 8, height: 8 }, true);
  resolve(sahteYanit(4));
  await pending;
  assert.equal(next.finish('ready').downloads.length, 0, 'old completion leaked into the new photo');
  assert.equal(old.finish('ready').status, 'cancelled');
}
console.log('verify-indirme-ilerleme: OK · existing paths, measured fetch/cache/failure/bodyless/stale parity');
