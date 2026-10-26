// Yerel yardımcı istemcisi: açılma kuralı + model başına yanıt şekli.
//   node scripts/verify-sidecar-client.mjs
import assert from 'node:assert/strict';
const { beklenenSekil, sidecarAcikMi, localInference, SidecarClient, SidecarDroppedError } = await import('../src/engine/sidecarClient.ts');

// Yayındaki site (yerel değil): varsayılan KAPALI, hiçbir şey kaydedilmemişse yoklanmaz.
assert.deepEqual(sidecarAcikMi('', null), { acik: false, acikca: false, kaydet: undefined });
assert.deepEqual(sidecarAcikMi('?x=1', null, false), { acik: false, acikca: false, kaydet: undefined });
// Localhost: varsayılan AÇIK ama "açıkça" değil (canlı video kapalı kalır).
assert.deepEqual(sidecarAcikMi('', null, true), { acik: true, acikca: false, kaydet: undefined });
// ?inference=sidecar açar ve kalıcı yazar; sonraki ziyaret kayıttan açık ve açıkça.
assert.deepEqual(sidecarAcikMi('?inference=sidecar', null), { acik: true, acikca: true, kaydet: '1' });
assert.deepEqual(sidecarAcikMi('', '1'), { acik: true, acikca: true, kaydet: undefined });
// ?inference=browser kapatır ve kalıcı yazar; localhost varsayılanını da ezer.
assert.deepEqual(sidecarAcikMi('?inference=browser', '1', true), { acik: false, acikca: false, kaydet: '0' });
assert.deepEqual(sidecarAcikMi('', '0', true), { acik: false, acikca: false, kaydet: undefined });

assert.deepEqual(beklenenSekil('small', [1, 3, 392, 518]), [1, 392, 518]);
assert.deepEqual(beklenenSekil('da3', [1, 3, 518, 518]), [1, 2, 518, 518]);
assert.deepEqual(beklenenSekil('moge', [1, 3, 518, 518]), [1, 5, 518, 518]);
assert.deepEqual(beklenenSekil('mask', [1, 3, 1024, 1024]), [1, 1, 1024, 1024]);

// Node'da (location yok) istemci hiç kurulmaz.
assert.equal(localInference, null);

// Sahte saat/ağ: canlı karelerde bekleme veya aynı kareyi yeniden deneme yok.
const originalFetch = globalThis.fetch, originalNow = Date.now, originalWarn = console.warn;
let now = 1000, healthCalls = 0, inferCalls = 0, mode = 'ok';
const tensor = { data: new Float32Array([1, 2, 3]), dims: [1, 3, 1, 1] };
const browser = { data: new Float32Array([9]), dims: [1, 1, 1] };
const fallback = async () => browser;
Date.now = () => now;
console.warn = () => {};
globalThis.fetch = async (url, options) => {
  if (url.endsWith('/health')) {
    healthCalls++;
    if (mode === 'health-fail') throw new TypeError('offline');
    return Response.json({ ok: true, arkaUc: 'DmlExecutionProvider', modeller: ['small'] });
  }
  inferCalls++;
  if (mode === 'network') throw new TypeError('offline');
  if (mode === 'busy') return new Response(null, { status: 503 });
  if (mode === 'drop') return new Response(null, { status: 409 });
  if (mode === 'error') return new Response(null, { status: 500 });
  return new Response(new Float32Array([2]).buffer, { headers: {
    'x-dims': '1,1,1', 'x-frame-id': options.headers['X-Frame-Id'],
  } });
};
try {
  const client = new SidecarClient('http://test');
  mode = 'busy';
  assert.equal(await client.infer('small', tensor, fallback), browser);
  mode = 'ok';
  assert.equal(await client.infer('small', tensor, fallback), browser, '503 kısa geri çekilme uygulamalı');
  assert.equal(inferCalls, 1, 'aynı kare veya geri çekilme sırasında ağ tekrarı yok');
  now += 3000;
  assert.equal((await client.infer('small', tensor, fallback)).data[0], 2, '503 sonrası yardımcı geri gelmeli');
  assert.equal(healthCalls, 1, '503 health önbelleğini silmemeli');

  for (const failure of ['network', 'error']) {
    const broken = new SidecarClient('http://test');
    mode = failure;
    for (let i = 0; i < 3; i++) {
      await broken.infer('small', tensor, fallback);
      now += 3000;
    }
    const before = [healthCalls, inferCalls];
    for (let i = 0; i < 20; i++) assert.equal(await broken.infer('small', tensor, fallback), browser);
    assert.deepEqual([healthCalls, inferCalls], before, 'devre açıkken her karede yoklama yok');
    now += 30000;
    mode = 'health-fail';
    assert.deepEqual(await Promise.all([broken.available(), broken.available(), broken.available()]), [false, false, false]);
    assert.equal(healthCalls, before[0] + 1, 'soğuma sonrası tek eşzamanlı health');
    await broken.available();
    assert.equal(healthCalls, before[0] + 1, 'başarısız health yeni soğuma başlatmalı');
    now += 30000;
    mode = 'ok';
    assert.equal((await broken.infer('small', tensor, fallback)).data[0], 2);
    assert.equal(healthCalls, before[0] + 2);
  }

  mode = 'drop';
  await assert.rejects(client.infer('small', tensor, fallback), SidecarDroppedError);
  mode = 'ok';
  assert.equal((await client.infer('small', tensor, fallback)).data[0], 2, '409 devreyi kapatmamalı');
  mode = 'error';
  for (let i = 0; i < 3; i++) await client.infer('david-mask', tensor, fallback);
  mode = 'ok';
  assert.equal((await client.infer('small', tensor, fallback)).data[0], 2, 'DAViD hatası ana yardımcıyı etkilememeli');

  // Başlangıçta kapalı sunucu da sayfa yenilemeden geri dönebilmeli.
  const initiallyOffline = new SidecarClient('http://test');
  mode = 'health-fail';
  assert.equal(await initiallyOffline.available(), false);
  const offlineHealthCalls = healthCalls;
  for (let i = 0; i < 20; i++) await initiallyOffline.available();
  assert.equal(healthCalls, offlineHealthCalls);
  now += 30000;
  mode = 'ok';
  assert.equal((await initiallyOffline.infer('small', tensor, fallback)).data[0], 2);

  // Başarılı çıkarım eski hata serisini sıfırlamalı.
  const intermittent = new SidecarClient('http://test');
  for (let i = 0; i < 4; i++) {
    mode = 'network';
    assert.equal(await intermittent.infer('small', tensor, fallback), browser);
    now += 3000;
    mode = 'ok';
    assert.equal((await intermittent.infer('small', tensor, fallback)).data[0], 2);
  }
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  console.warn = originalWarn;
}
console.log('verify-sidecar-client OK');
