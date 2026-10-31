import assert from 'node:assert/strict';
import { MASKE_ALT_ESIK, MASKE_UST_ESIK, davidKesisiminiDogrula, maskeKarari, maskeKarariniVer, maskeTekParcaOrani } from '../src/ui/maskeKarari.ts';

// Ölçülen gerçek oranlar (2026-09-25, IS-Net): bunlar kararın hangi tarafa
// düşmesi gerektiğinin kaydıdır — eşik değişirse bu satırlar patlar.
const OLCUM = {
  sentetikGorsel: 0.047, // hatalı davranış: sahnenin gerisini siliyordu
  projeKucukResmi: 0.179, // meşru özne kadrajı
  binaCephesi: 0.456, // meşru geniş kadraj
};

// Sentetik görsel: maske KULLANILIR (depth ondan faydalanır) ama ayırma
// kendiliğinden AÇILMAZ ve sebep söylenir.
const k1 = maskeKarari(OLCUM.sentetikGorsel);
assert.equal(k1.tip, 'kullan');
assert.equal(k1.ayirmaAcik, false, 'küçük maskede ayırma otomatik açılıyor — ekran boşalır');
assert.match(k1.sebep ?? '', /%5/, 'sebep ölçülen oranı söylemiyor');
assert.match(k1.sebep ?? '', /nesne ayırma/, 'sebep düğmenin adını söylemiyor');

// Meşru kadrajlarda eski davranış AYNEN korunur: ayırma otomatik açılır,
// gereksiz uyarı basılmaz.
for (const oran of [OLCUM.projeKucukResmi, OLCUM.binaCephesi]) {
  const k = maskeKarari(oran);
  assert.equal(k.tip, 'kullan');
  assert.equal(k.ayirmaAcik, true, `meşru maske (${oran}) otomatik açılmıyor`);
  assert.equal(k.sebep, null, 'çalışan durumda gereksiz uyarı basılıyor');
}

// Boş maske: kullanılmaz (AND tüm silueti sıfırlar, parçacıklar ölür).
const bos = maskeKarari(0);
assert.equal(bos.tip, 'atla');
assert.equal(bos.ayirmaAcik, false);
assert.match(bos.sebep ?? '', /boş maske/);

// "Model pes etti": tüm kare ön plan. Maske hiçbir şey ayırmaz ama zarar
// verir (stretch aralığı sahneye açılır) — atlanır.
const tam = maskeKarari(0.95);
assert.equal(tam.tip, 'atla');
assert.match(tam.sebep ?? '', /%95/);

// Eşiklerin tam sınırı: alt eşik dahil değil, üst eşik dahil değil.
assert.equal(maskeKarari(MASKE_ALT_ESIK).ayirmaAcik, true, 'alt eşiğin kendisi açık olmalı');
assert.equal(maskeKarari(MASKE_ALT_ESIK - 0.001).ayirmaAcik, false);
assert.equal(maskeKarari(MASKE_UST_ESIK).tip, 'kullan', 'üst eşiğin kendisi kullanılmalı');
assert.equal(maskeKarari(MASKE_UST_ESIK + 0.001).tip, 'atla');

// Dağınıklık: tek gövde (insan) geçer, kopuk yamalar (manzara) atlanır.
const W = 256, H = 256;
const kutu = (m, x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1; };
const insan = new Float32Array(W * H); kutu(insan, 90, 40, 170, 230); kutu(insan, 170, 100, 190, 112); // gövde + ince kol
const yamalar = new Float32Array(W * H); kutu(yamalar, 10, 10, 90, 70); kutu(yamalar, 150, 20, 240, 80); kutu(yamalar, 40, 150, 120, 230); kutu(yamalar, 170, 160, 240, 235);
assert.ok(maskeTekParcaOrani(insan, W, H) >= 0.9, 'tek gövde dağınık sayıldı');
assert.ok(maskeTekParcaOrani(yamalar, W, H) < 0.4, 'kopuk yamalar dağınık sayılmadı');
assert.equal(maskeKarari(0.3, maskeTekParcaOrani(insan, W, H)).ayirmaAcik, true);
const dag = maskeKarari(0.3, maskeTekParcaOrani(yamalar, W, H));
assert.equal(dag.tip, 'atla');
assert.match(dag.sebep ?? '', /dağınık/);

// ── #10: otomatik ve elle yol AYNI fonksiyondan karar alır (maskeKarariniVer). ──
{
  const tam = new Float32Array(W * H).fill(1), bos = new Float32Array(W * H);
  const tam95 = new Float32Array(W * H).fill(1); for (let i = 0; i < W * H * 0.06; i++) tam95[i] = 0;
  for (const [ad, m] of [['boş', bos], ['tüm kare', tam], ['%94 dolu', tam95], ['dağınık', yamalar], ['insan', insan]]) {
    const k = maskeKarariniVer(m, W, H);
    let say = 0; for (const v of m) if (v >= 0.5) say++;
    const el = maskeKarari(say / m.length, maskeTekParcaOrani(m, W, H));
    assert.deepEqual(k.karar, el, `${ad}: ortak karar maskeKarari ile ayrıştı`);
  }
  assert.equal(maskeKarariniVer(bos, W, H).karar.tip, 'atla');
  assert.equal(maskeKarariniVer(tam, W, H).karar.tip, 'atla');
  assert.equal(maskeKarariniVer(yamalar, W, H).karar.tip, 'atla');
  assert.equal(maskeKarariniVer(insan, W, H).karar.tip, 'kullan');
}

// ── #1: DAViD kesişimi kabul edilmiş özneyi silemez. ──
{
  const f = (...kutular) => { const m = new Float32Array(W * H); for (const k of kutular) kutu(m, ...k); return m; };
  const ozneler = {
    kisi: f([100, 30, 160, 240]),                                  // ~%19, uzun gövde
    bust: f([80, 60, 176, 200]),                                   // ~%20
    urun: f([70, 90, 190, 210]),                                   // ~%22
    hayvan: f([40, 110, 210, 190], [50, 190, 70, 230], [180, 190, 200, 230]), // yatay gövde + bacaklar
  };
  const kesisim = (o, d) => Float32Array.from(o, (v, i) => Math.min(v, d[i]));
  for (const [ad, o] of Object.entries(ozneler)) {
    const bosD = new Float32Array(W * H);
    const r = davidKesisiminiDogrula(o, kesisim(o, bosD), W, H);
    assert.equal(r.maske, o, `${ad}: boş DAViD kabul edilmiş özneyi sildi`);
    assert.match(r.sebep ?? '', /DAViD/);
    // kıl payı: tek bir tutam kalan DAViD de özneyi yıkar (eşiğin altı).
    const tutam = new Float32Array(W * H); kutu(tutam, 120, 100, 126, 106);
    assert.equal(davidKesisiminiDogrula(o, kesisim(o, tutam), W, H).maske, o, `${ad}: tutam DAViD özneyi yıktı`);
    // kısmi ama sağlıklı: DAViD öznenin sol %75'ini tutar -> kesişim aynen döner.
    const kismi = new Float32Array(W * H);
    const x0 = Math.min(...[...o.keys()].filter(i => o[i] > 0).map(i => i % W)), x1 = Math.max(...[...o.keys()].filter(i => o[i] > 0).map(i => i % W));
    const kes = x0 + Math.floor((x1 - x0) * 0.85);
    for (let y = 0; y < H; y++) for (let x = 0; x < kes; x++) kismi[y * W + x] = 1;
    const iyi = kesisim(o, kismi);
    const ri = davidKesisiminiDogrula(o, iyi, W, H);
    assert.equal(ri.maske, iyi, `${ad}: sağlıklı kesişim değiştirildi`);
    assert.equal(ri.sebep, null);
    // DAViD özneyi aynen tutar: değişmez.
    const ayni = davidKesisiminiDogrula(o, kesisim(o, new Float32Array(W * H).fill(1)), W, H);
    assert.equal(ayni.sebep, null);
  }
  // Küçük (ayırma KAPALI başlayan) kabul edilmiş özne: kesişim boşsa yine korunur.
  const kucuk = f([100, 100, 130, 130]);
  assert.equal(davidKesisiminiDogrula(kucuk, new Float32Array(W * H), W, H).maske, kucuk);
}

console.log('OK maske kararı: küçük maske ekranı boşaltmıyor, meşru kadrajda eski davranış duruyor');
