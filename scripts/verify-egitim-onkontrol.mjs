import assert from 'node:assert/strict';
import { ayarOzeti, egitimOnKontrol } from '../src/ui/egitimOnKontrol.ts';

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (Macintosh; rv:130.0) Gecko/20100101 Firefox/130.0';

// WebGPU varsa: eğitim başlatılabilir ve GEREKSİZ adım listesi çıkmaz.
for (const ua of [CHROME, SAFARI, FIREFOX]) {
  const k = egitimOnKontrol({ webgpu: true, ua });
  assert.equal(k.calisir, true);
  assert.deepEqual(k.adimlar, [], 'çalışan cihazda kurtarma adımı gösteriliyor');
}

// WebGPU yoksa: başlatılamaz, sebep + en az bir kurtarma adımı verilir.
// Bu maddenin tamamı "sessiz bozulma yerine sebep" kuralının eğitim ayağı.
for (const ua of [CHROME, SAFARI, FIREFOX]) {
  const k = egitimOnKontrol({ webgpu: false, ua });
  assert.equal(k.calisir, false, 'WebGPU yokken eğitim başlatılabilir görünüyor');
  assert.match(k.baslik, /WebGPU/, 'sebep WebGPU demiyor');
  assert.ok(k.adimlar.length > 0, 'kurtarma yolu yok');
}

// Adımlar TARAYICIYA göre ayrışır: yanlış tarayıcıya yanlış talimat vermek
// kullanıcıyı boşa yorar.
const safari = egitimOnKontrol({ webgpu: false, ua: SAFARI });
assert.ok(safari.adimlar.some((a) => /Safari/i.test(a)), 'Safari adımı Safari’den söz etmiyor');
const firefox = egitimOnKontrol({ webgpu: false, ua: FIREFOX });
assert.ok(firefox.adimlar.some((a) => /about:config|Firefox/i.test(a)), 'Firefox adımı yanlış');
const chrome = egitimOnKontrol({ webgpu: false, ua: CHROME });
assert.ok(
  chrome.adimlar.some((a) => /donanım hızlandırma/i.test(a)),
  'Chrome/Edge adımı donanım hızlandırmadan söz etmiyor',
);
// Her üçü de bir kurtarma alternatifi sunar (başka tarayıcı / güncelleme).
for (const k of [safari, firefox, chrome]) {
  assert.ok(k.adimlar.length >= 2, 'tek adım kurtarma yolu sayılmaz');
}

// Ayar özeti: kullanıcı hangi GPU ve hangi katmanla koştuğunu okuyabilmeli.
const ozet = ayarOzeti({ gpu: 'apple / metal-3', tier: 'quick', maxIters: 3000, maxFrames: 24, zayifGpu: true });
assert.match(ozet, /apple \/ metal-3/);
assert.match(ozet, /hafif/);
assert.match(ozet, /24 kare/);
assert.match(ozet, /3\.000 iterasyon/);
const tam = ayarOzeti({ gpu: 'nvidia / turing', tier: 'standard', maxIters: 10000, maxFrames: 40, zayifGpu: false });
assert.match(tam, /tam/);
assert.match(tam, /40 kare/);

console.log('OK eğitim ön kontrolü: WebGPU yoksa başlatılmıyor, sebep ve tarayıcıya özel kurtarma yolu veriliyor');
