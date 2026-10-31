// Photo mask acceptance (audit 2026-10-31 items 8, 9, 12): the production mask clean-up
// (keepMainComponents -> dilateAndFeatherMask, as segmentForeground runs it) and the photo
// colour sampler on controlled masks. Prints IoU against the true subject and a contour metric
// (mean symmetric distance in px between result and truth outlines) per case, then asserts.
//   node scripts/verify-foto-maske-kabul.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const { keepMainComponents, dilateAndFeatherMask, VIDEO_FAR_MIN_FRAC } = await import('../src/engine/reconstruction/silhouette.ts');
const { sampleImageGrid } = await import('../src/engine/reconstruction/sampler.ts');
const { maskeKarari, maskeTekParcaOrani } = await import('../src/ui/maskeKarari.ts');

const W = 120, H = 100;
const bos = (w = W, h = H) => new Float32Array(w * h);
const kutu = (m, x0, y0, x1, y1, v = 1, w = W) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = v; return m; };
const say = (m) => m.reduce((s, v) => s + (v >= 0.5 ? 1 : 0), 0);
/** What segmentForeground does to a photo mask after the model. */
const fotoTemizle = (raw, w = W, h = H) => dilateAndFeatherMask(keepMainComponents(raw, w, h), w, h);

function iou(a, gt) {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) { const p = a[k] >= 0.5, q = gt[k] >= 0.5; if (p && q) i++; if (p || q) u++; }
  return u ? i / u : 1;
}
function kontur(m, w, h) {
  const o = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (m[y * w + x] < 0.5) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || m[y * w + x - 1] < 0.5 || m[y * w + x + 1] < 0.5
      || m[(y - 1) * w + x] < 0.5 || m[(y + 1) * w + x] < 0.5) o.push([x, y]);
  }
  return o;
}
/** Mean symmetric outline distance (px); 0 for two empty masks, Infinity if only one is empty. */
function konturMesafe(a, gt, w = W, h = H) {
  const A = kontur(a, w, h), B = kontur(gt, w, h);
  if (!A.length || !B.length) return A.length === B.length ? 0 : Infinity;
  const ort = (P, Q) => P.reduce((s, [x, y]) => s + Math.sqrt(Math.min(...Q.map(([u, v]) => (u - x) ** 2 + (v - y) ** 2))), 0) / P.length;
  return (ort(A, B) + ort(B, A)) / 2;
}
const satirlar = [];
const rapor = (vaka, sonuc, gt, ek = '') => {
  const s = `${vaka.padEnd(24)} IoU ${iou(sonuc, gt).toFixed(3)}  kontur ${konturMesafe(sonuc, gt).toFixed(2)} px  fg ${say(sonuc)}${ek ? '  ' + ek : ''}`;
  satirlar.push(s); console.log(s);
};
const hatalar = [];
const kontrol = (ad, f) => { try { f(); } catch (e) { hatalar.push(`${ad}: ${e.message}`); } };

// 1) Hair / thin wire: body with a 0.49 soft hair band on top (one component: the input comes
//    back untouched). Adding a far speck, or a kept 1 px wire 10 px away, makes it a
//    multi-component mask; neither may change the hair edge.
const sac = kutu(kutu(bos(), 30, 20, 70, 90), 35, 12, 65, 20, 0.49);
const sacBenek = kutu(sac.slice(), 110, 90, 112, 92);
const sacTel = kutu(sac.slice(), 80, 20, 81, 60, 0.9);
const sacGt = kutu(kutu(bos(), 30, 20, 70, 90), 35, 12, 65, 20);
const sacTelGt = kutu(sacGt.slice(), 80, 20, 81, 60);
const sacTemiz = fotoTemizle(sac), sacBenekli = fotoTemizle(sacBenek), sacTelli = fotoTemizle(sacTel);
const SAC_ORNEK = 15 * W + 50; // inside the hair band, the audit's contour sample
rapor('saç (tek parça)', sacTemiz, sacGt, `kenar ${sacTemiz[SAC_ORNEK].toFixed(3)}`);
rapor('saç + uzak benek', sacBenekli, sacGt, `kenar ${sacBenekli[SAC_ORNEK].toFixed(3)}`);
rapor('saç + ince tel', sacTelli, sacTelGt, `kenar ${sacTelli[SAC_ORNEK].toFixed(3)}  tel (80,40) ${sacTelli[40 * W + 80].toFixed(2)}`);
const enBuyukFark = (a, b, atla) => {
  let fark = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!atla(x, y)) fark = Math.max(fark, Math.abs(a[y * W + x] - b[y * W + x]));
  return fark;
};
kontrol('#8 benek saç kenarını değiştirmez', () => {
  assert.equal(enBuyukFark(sacTemiz, sacBenekli, (x, y) => x >= 100 && y >= 80), 0);
  assert.equal(sacBenekli[91 * W + 111], 0, 'benek düşer');
});
kontrol('#8 tutulan tel saç kenarını değiştirmez', () => {
  assert.equal(enBuyukFark(sacTemiz, sacTelli, (x) => x >= 72), 0);
  assert.ok(sacTelli[40 * W + 80] >= 0.5, 'tel kalır');
});

// 2) Dark subject vs light wall (audit 32x32): object from x=10, RGB .1 on white. After the
//    4 px dilation x=8 is geometry; its colour must come from the subject, not the wall.
{
  const w = 32, h = 32, ham = bos(w, h), rgb = new Float32Array(w * h * 3).fill(1), derinlik = new Float32Array(w * h).fill(0.6);
  for (let y = 0; y < h; y++) for (let x = 10; x < 22; x++) { ham[y * w + x] = 1; rgb.fill(0.1, (y * w + x) * 3, (y * w + x) * 3 + 3); }
  const geo = dilateAndFeatherMask(ham, w, h);
  const opts = { gridSize: 32, importanceSampling: false, foregroundMask: geo };
  const once = sampleImageGrid(rgb, w, h, derinlik, w, h, opts);
  const sonra = sampleImageGrid(rgb, w, h, derinlik, w, h, { ...opts, foregroundColorMask: ham });
  const r = (a, x) => a[(16 * 32 + x) * 3];
  const s = `koyu özne/açık duvar    x=8 maske ${ham[16 * w + 8]}->${geo[16 * w + 8].toFixed(2)}  renk (yalnız geo maske) ${r(once, 8).toFixed(3)}  renk (özgün güven ayrı) ${r(sonra, 8).toFixed(3)}  x=9 ${r(sonra, 9).toFixed(3)}  x=15 ${r(sonra, 15).toFixed(3)}  x=2 ${r(sonra, 2).toFixed(3)}`;
  satirlar.push(s); console.log(s);
  kontrol('#9 genişletme bandı özne rengini alır', () => {
    assert.ok(Math.abs(r(sonra, 8) - 0.1) < 1e-6, `x=8 renk ${r(sonra, 8)}`);
    assert.ok(Math.abs(r(sonra, 9) - 0.1) < 1e-6, `x=9 renk ${r(sonra, 9)}`);
    assert.equal(r(sonra, 15), r(once, 15), 'iç renk aynı');
    assert.equal(r(sonra, 2), r(once, 2), 'arka plan aynı');
    assert.deepEqual(sampleImageGrid(rgb, w, h, derinlik, w, h, { ...opts, foregroundColorMask: geo }), once, 'aynı maske verilirse eski sonuç');
  });
}

// 3) Two separate people, 60 px apart (audit: 3500 + 3000 = 6500 fg), plus a small far speck.
// Audit counts: 35x100 = 3500 and 30x100 = 3000 (6500 fg), 55 px apart (> nearPx 12).
const ikiKisi = kutu(kutu(bos(), 0, 0, 35, 100), 90, 0, 120, 100);
const ikiKisiGt = ikiKisi.slice();
const ikiKisiBenek = ikiKisi.slice(); kutu(ikiKisiBenek, 60, 50, 62, 52);
const ikiAna = keepMainComponents(ikiKisiBenek, W, H);
const ikiSon = dilateAndFeatherMask(ikiAna, W, H);
// Reported, not asserted: with two near-equal people the largest part is 54% < MASKE_ANA_PARCA_MIN
// (0.6), so maskeKarari (src/ui, outside this change) now skips the mask instead of cutting one out.
const karar = maskeKarari(say(ikiSon) / ikiSon.length, maskeTekParcaOrani(ikiSon, W, H));
rapor('iki ayrı kişi', ikiSon, ikiKisiGt, `temizlik sonrası ${say(ikiAna)} / ham ${say(ikiKisi)}  maskeKarari=${karar.tip}${karar.ayirmaAcik ? '+ayırma' : ''}`);
kontrol('#12 ikinci kişi kalır, uzak benek düşer', () => {
  assert.equal(say(ikiAna), say(ikiKisi), 'iki kişi de kalır');
  assert.equal(ikiAna[51 * W + 61], 0, 'benek düşer');
  const video = keepMainComponents(ikiKisiBenek, W, H, undefined, undefined, VIDEO_FAR_MIN_FRAC);
  assert.deepEqual(video, ikiAna, 'foto = video kuralı');
});

// 4) Arm-torso gap: arm 6 px from the torso (kept by the near rule); the gap closes after the
//    4 px dilation (geometry, unchanged on purpose) - reported, not asserted.
const kol = kutu(kutu(bos(), 20, 10, 60, 90), 66, 30, 76, 80);
const kolSon = fotoTemizle(kol);
rapor('kol-gövde boşluğu', kolSon, kol, `boşluk (63,50) ham ${kol[50 * W + 63]} -> ${kolSon[50 * W + 63].toFixed(2)}`);
kontrol('kol kalır', () => assert.equal(say(keepMainComponents(kol, W, H)), say(kol)));

// 5) Product (non-human): mug body + handle ring with a 12 px hole, and a far 20%-size box.
const urun = bos();
kutu(urun, 20, 20, 60, 85);
kutu(urun, 60, 35, 78, 39); kutu(urun, 60, 63, 78, 67); kutu(urun, 74, 35, 78, 67); // handle
kutu(urun, 95, 60, 115, 85); // second product, 500 px = 19% of the mug
const urunSon = fotoTemizle(urun);
rapor('ürün (insan değil)', urunSon, urun, `kulp deliği (67,50) ${urunSon[50 * W + 67].toFixed(2)}`);
kontrol('ürün + ikinci ürün kalır', () => assert.equal(say(keepMainComponents(urun, W, H)), say(urun)));

// 6) Empty mask: unchanged object back, nothing invented, decision rejects it.
const bosMaske = bos();
const bosSon = fotoTemizle(bosMaske);
rapor('boş maske', bosSon, bosMaske, `maskeKarari=${maskeKarari(0, 1).tip}`);
kontrol('boş maske', () => {
  assert.equal(keepMainComponents(bosMaske, W, H), bosMaske);
  assert.equal(say(bosSon), 0);
  assert.equal(maskeKarari(0, 1).tip, 'atla');
});

// Single component: the input array itself comes back (no copy, soft values untouched).
const tek = kutu(kutu(bos(), 30, 20, 70, 90), 35, 12, 65, 20, 0.49);
kontrol('tek parça girdiyi döndürür', () => assert.equal(keepMainComponents(tek, W, H), tek));

// Video: keepMainComponents with the video parameter on the existing binary fixtures
// (verify-maske-zamansal) must be byte-identical to the base commit (5f0b34e).
const ozet = (m) => createHash('sha256').update(Buffer.from(m.buffer, m.byteOffset, m.byteLength)).digest('hex').slice(0, 16);
const vf = [];
{ const m = bos(); kutu(m, 10, 10, 50, 90); kutu(m, 56, 30, 70, 50); kutu(m, 70, 40, 80, 46); kutu(m, 105, 10, 115, 40); kutu(m, 52, 80, 54, 82); vf.push(m); }
{ const m = bos(); kutu(m, 10, 10, 50, 90); kutu(m, 70, 20, 90, 80); kutu(m, 105, 10, 115, 40); vf.push(m); }
{ const m = bos(); kutu(m, 10, 10, 50, 90); kutu(m, 58, 30, 70, 50); kutu(m, 78, 30, 90, 50); vf.push(m); }
vf.push(ikiKisiBenek, kol, urun);
const videoOzet = vf.map((m) => ozet(keepMainComponents(m, W, H, undefined, undefined, VIDEO_FAR_MIN_FRAC))).join(' ');
console.log(`video özetleri: ${videoOzet}`);
const VIDEO_TABAN = 'acd5b4fc0b88ff38 824aea68ade440f8 4707e66304cf6d15 00bf90bda82583d0 7c77019a05deafca 3edb7eb092d9108b';
kontrol('video çıktısı taban ile aynı', () => assert.equal(videoOzet, VIDEO_TABAN));

if (hatalar.length) { console.error(`FAIL verify-foto-maske-kabul:\n  ${hatalar.join('\n  ')}`); process.exit(1); }
console.log('verify-foto-maske-kabul OK: saç kenarı beneğe bağlı değil, genişletme bandı özne rengi, iki kişi kalır, video aynı');
