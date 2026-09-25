import assert from 'node:assert/strict';
import { IMZA_MIN_BOY, IMZA_ORAN, imzaMetni, imzaYerlesimi } from '../src/ui/ciktiImza.ts';

// Z1 — çıktı imzası. Kutu KAREDEN TAŞMAMALI: taşarsa köşedeki yazı kırpılır
// ve paylaşılan dosyada yarım imza kalır.
for (const [w, h] of [[640, 420], [1280, 840], [1920, 1080], [256, 256]]) {
  const metinGen = Math.round(w * 0.2);
  const y = imzaYerlesimi(w, h, metinGen);
  assert.ok(y.kutuX >= 0, `kutu sola taştı (${w}x${h}): ${y.kutuX}`);
  assert.ok(y.kutuY >= 0, `kutu yukarı taştı (${w}x${h}): ${y.kutuY}`);
  assert.ok(y.kutuX + y.kutuW <= w, `kutu sağa taştı (${w}x${h})`);
  assert.ok(y.kutuY + y.kutuH <= h, `kutu aşağı taştı (${w}x${h})`);
  // Yazı kutunun İÇİNDE: taban çizgisi kutunun altından yukarıda olmalı.
  assert.ok(y.metinY <= y.kutuY + y.kutuH, `yazı kutunun altına taştı (${w}x${h})`);
  assert.ok(y.metinX >= y.kutuX, `yazı kutunun solundan taştı (${w}x${h})`);
}

// Ölçekli PNG'de imza da büyür: 2x kare, 2x yazı boyu. Sabit px olsaydı
// büyütülmüş çıktıda imza okunmaz hale gelirdi.
const bir = imzaYerlesimi(640, 420, 100);
const iki = imzaYerlesimi(1280, 840, 200);
assert.equal(iki.boy, Math.round(bir.boy * 2), 'imza boyu kare yüksekliğiyle ölçeklenmiyor');
assert.equal(bir.boy, Math.round(420 * IMZA_ORAN));

// Çok küçük karede taban sınır devreye girer (okunabilirlik).
assert.equal(imzaYerlesimi(120, 80, 40).boy, IMZA_MIN_BOY);

// İmza metni sürümü TAŞIR: paylaşılan dosyadan hangi sürümün ürettiği okunur.
assert.equal(imzaMetni('1.0.0'), 'spatial-canvas v1.0.0');
assert.match(imzaMetni('9.9.9'), /9\.9\.9$/);

console.log('OK çıktı imzası: kutu kareden taşmıyor, boy ölçekle büyüyor, metin sürümü taşıyor');
