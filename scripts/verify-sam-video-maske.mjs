// `?videoMaske=sam` denetleyicisi (saf; model sınırları sahte).  node scripts/verify-sam-video-maske.mjs
// Çapa → izleme → yeniden çapa (sıçrama / IS-Net kontrolü / zorunlu) → IS-Net'e dönüş sözleşmesi.
import assert from 'node:assert/strict';
const { SamVideoMaskesi, samVideoIstendi } = await import('../src/engine/reconstruction/samVideoMaske.ts');

assert.equal(samVideoIstendi('?videoMaske=sam'), true);
assert.equal(samVideoIstendi('?videoMaske=isnet'), false);
assert.equal(samVideoIstendi(''), false, 'bayraksız varsayılan değişmez');

const W = 20, H = 10;
/** x0..x1 arası sütunlar ön plan. */
const serit = (x0, x1, w = W, h = H) => {
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
  return m;
};
const sonuc = (m) => ({ mask: m, ham: m, width: W, height: H });

function kur({ isnet = () => serit(5, 10), sam = () => ({ olasilik: serit(5, 10), nesneSkoru: 4 }), secenek } = {}) {
  const kayit = { segment: 0, capa: [], izle: 0, kodla: 0, sifirla: 0, birak: 0 };
  let capaVar = false;
  const z = {
    capaGerekli: () => !capaVar,
    sifirla: () => { capaVar = false; kayit.sifirla++; },
    kodla: async () => { kayit.kodla++; return 'kod'; },
    birak: () => { kayit.birak++; },
    capa: async (_kod, m, yeniden = false) => { capaVar = true; kayit.capa.push({ yeniden, alan: m.reduce((s, v) => s + v, 0) }); return { olasilik: m, nesneSkoru: 10 }; },
    izle: async () => { kayit.izle++; return sam(); },
  };
  const d = {
    segment: async () => { kayit.segment++; return sonuc(isnet()); },
    izleyici: async () => z,
    izgaraya: (ham) => ham,
    maskeye: (o) => sonuc(o),
  };
  return { c: new SamVideoMaskesi(d, secenek), kayit };
}

// [1] ilk kare çapa (IS-Net), sonra izleme; kontrol karesine dek IS-Net çağrılmaz
{
  const { c, kayit } = await kur({ secenek: { kontrol: 5 } });
  const r0 = await c.adim('kaynak', W, H);
  assert.equal(r0.sebep, 'ilk'); assert.equal(kayit.segment, 1); assert.equal(kayit.capa.length, 1);
  for (let k = 1; k < 5; k++) assert.equal((await c.adim('kaynak', W, H)).sebep, null);
  assert.equal(kayit.izle, 4); assert.equal(kayit.segment, 1, 'izleme karelerinde IS-Net yok');
  // kare 5: kontrol karesi, IS-Net aynı maskeyi verir → IoU 1, çapa yok
  assert.equal((await c.adim('kaynak', W, H)).sebep, null);
  assert.equal(kayit.segment, 2);
  console.log('[1] çapa + izleme + periyodik IS-Net kontrolü ✓');
}

// [2] IS-Net kontrolü uyuşmazsa aynı karede yeniden çapa (yeniden=true), IS-Net maskesi döner
{
  let isnet = serit(5, 10);
  const { c, kayit } = await kur({ isnet: () => isnet, secenek: { kontrol: 2 } });
  await c.adim('k', W, H);
  await c.adim('k', W, H);
  isnet = serit(12, 18);
  const r = await c.adim('k', W, H);
  assert.equal(r.sebep, 'isnet-uyusmuyor');
  assert.deepEqual(kayit.capa.at(-1), { yeniden: true, alan: 60 });
  assert.equal(r.mask[0 * W + 13], 1, 'çıktı IS-Net maskesi');
  console.log('[2] IS-Net uyuşmazlığında yeniden çapa ✓');
}

// [3] alan sıçraması → yeniden çapa (kontrol karesi olmasa da)
{
  let samM = serit(5, 10);
  const { c, kayit } = await kur({ sam: () => ({ olasilik: samM, nesneSkoru: 3 }), secenek: { kontrol: 100 } });
  await c.adim('k', W, H); await c.adim('k', W, H);
  samM = serit(0, 20);
  const r = await c.adim('k', W, H);
  assert.equal(r.sebep, 'alan-sicradi');
  assert.equal(kayit.segment, 2); assert.equal(kayit.capa.at(-1).yeniden, true);
  console.log('[3] alan sıçramasında yeniden çapa ✓');
}

// [4] nesne kayboldu + IS-Net de güvenilmez (boş) → null (çağıran maskeyi kaldırır), sonra tekrar dener
{
  let samSkor = 3, isnet = serit(5, 10);
  const { c } = await kur({ isnet: () => isnet, sam: () => ({ olasilik: samSkor > 0 ? serit(5, 10) : new Float32Array(W * H), nesneSkoru: samSkor }) });
  await c.adim('k', W, H);
  samSkor = -2; isnet = new Float32Array(W * H);
  assert.equal(await c.adim('k', W, H), null);
  console.log('[4] nesne kaybı + güvenilmez IS-Net → null ✓');
}

// [5] ilk çapada IS-Net kapsaması geçersizse (<%8) çapa yok, null; sonraki kare yine çapa dener
{
  let isnet = serit(0, 1);
  const { c, kayit } = await kur({ isnet: () => isnet });
  assert.equal(await c.adim('k', W, H), null);
  assert.equal(kayit.capa.length, 0);
  isnet = serit(5, 10);
  assert.equal((await c.adim('k', W, H)).sebep, 'ilk');
  console.log('[5] geçersiz çapa reddedilir ✓');
}

// [6] zorunlu periyodik çapa (her) ve dışarıdan istek (drift); sifirla bellek atar
{
  const { c, kayit } = await kur({ secenek: { her: 3, kontrol: 100 } });
  const seb = [];
  for (let k = 0; k < 7; k++) seb.push((await c.adim('k', W, H)).sebep);
  assert.deepEqual(seb, ['ilk', null, null, 'her', null, null, 'her']);
  c.capaIste();
  assert.equal((await c.adim('k', W, H)).sebep, 'istek');
  c.sifirla();
  assert.equal(kayit.sifirla, 1);
  assert.equal((await c.adim('k', W, H)).sebep, 'ilk');
  console.log('[6] zorunlu çapa, dış istek, sıfırlama ✓');
}

// [7] model hatası yukarı fırlar (çağıran IS-Net'e döner, sessiz yutma yok)
{
  const { c, kayit } = await kur({ sam: () => { throw new Error('GPU kayboldu'); } });
  await c.adim('k', W, H);
  await assert.rejects(c.adim('k', W, H), /GPU kayboldu/);
  assert.equal(kayit.birak, kayit.kodla, 'GPU tamponları her karede (hatada da) bırakılır');
  console.log('[7] hata çağırana gider ✓');
}
console.log('verify-sam-video-maske: tamam');
