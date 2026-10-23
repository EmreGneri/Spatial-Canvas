// Yerel yardımcı istemcisi: açılma kuralı + model başına yanıt şekli.
//   node scripts/verify-sidecar-client.mjs
import assert from 'node:assert/strict';
const { beklenenSekil, sidecarAcikMi, localInference } = await import('../src/engine/sidecarClient.ts');

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
console.log('verify-sidecar-client OK');
