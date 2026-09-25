import assert from 'node:assert/strict';
import { MASKE_ALT_ESIK, MASKE_UST_ESIK, maskeKarari } from '../src/ui/maskeKarari.ts';

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

console.log('OK maske kararı: küçük maske ekranı boşaltmıyor, meşru kadrajda eski davranış duruyor');
