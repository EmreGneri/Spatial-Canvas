import assert from 'node:assert/strict';
import { MASKE_ALT_ESIK, MASKE_UST_ESIK, maskeKarari, maskeTekParcaOrani } from '../src/ui/maskeKarari.ts';

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

console.log('OK maske kararı: küçük maske ekranı boşaltmıyor, meşru kadrajda eski davranış duruyor');
