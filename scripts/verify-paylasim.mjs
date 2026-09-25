import assert from 'node:assert/strict';
import { kunyeMetni, PAYLASIM_KLIP_SN, turAcisi, turHizi } from '../src/ui/paylasim.ts';

// Z1 — künye sonucun NASIL üretildiğini taşır: sürüm, kaynak, Gaussian
// sayısı, ölçülen PSNR, süre ve GPU.
const tam = kunyeMetni({
  surum: '1.0.0',
  dosyaAdi: 'yay-100derece-stgeorge.mp4',
  splats: 61380,
  psnr: 30.6,
  gpu: 'apple / metal-3',
  sureSn: 151,
  yalnizOzne: false,
});
assert.match(tam, /spatial-canvas v1\.0\.0/);
assert.match(tam, /yay-100derece-stgeorge\.mp4/);
assert.match(tam, /61\.380 Gaussian/);
assert.match(tam, /PSNR 30\.6 dB/);
assert.match(tam, /151 sn eğitim/);
assert.match(tam, /apple \/ metal-3/);

// Yalnız özne modu künyede görünür: iki koşunun PSNR'si aynı şey değildir.
const ozne = kunyeMetni({
  surum: '1.0.0', dosyaAdi: 'a.mp4', splats: 100, psnr: 28, gpu: null, sureSn: null, yalnizOzne: true,
});
assert.match(ozne, /yalnız özne/);

// ÖLÇÜLMEYEN DEĞER UYDURULMAZ: eksik alanlar künyeden düşer, "?" ya da 0
// yazılmaz.
const eksik = kunyeMetni({
  surum: '1.0.0', dosyaAdi: 'b.mp4', splats: null, psnr: null, gpu: null, sureSn: null, yalnizOzne: false,
});
assert.equal(eksik, 'spatial-canvas v1.0.0 · 3D Gaussian Splatting · b.mp4');
// (regex "Gaussian" değil: başlıktaki "3D Gaussian Splatting" ile karışır)
assert.ok(!/PSNR|\d+ Gaussian|sn eğitim/.test(eksik), 'eksik ölçüm künyeye sızıyor');

// Klip TAM TUR dönmeli: döngüye alındığında baş ve son aynı kadraj olsun.
// Dönüş ZAMANA bağlı (rad/sn): kare hızı ne olursa olsun süre dolunca tur
// kapanır. Kare başına sabit açı denendi ve ölçüldü — sekme yavaşlayınca
// 8 sn'lik klip 5,96 sn kadar dönüyordu.
for (const sureSn of [4, 8, 12]) {
  const hiz = turHizi(sureSn);
  assert.ok(Math.abs(hiz * sureSn - 2 * Math.PI) < 1e-9, `tam tur değil (${sureSn} sn)`);
  // Kare hızından BAĞIMSIZ: 24 fps ve 120 fps aynı toplam açıyı verir.
  for (const fps of [24, 60, 120]) {
    const dt = 1 / fps;
    let toplam = 0;
    for (let i = 0; i < sureSn * fps; i++) toplam += hiz * dt;
    assert.ok(Math.abs(toplam - 2 * Math.PI) < 1e-9, `${fps} fps'te tur kapanmıyor`);
  }
}
assert.equal(PAYLASIM_KLIP_SN, 8);

// MUTLAK açı: süre dolduğunda tam 2π, kaç kare düşerse düşsün. Kare başına
// artış denendi ve ölçüldü — yavaşlayan sekmede tur kapanmıyordu.
assert.equal(turAcisi(0), 0);
assert.ok(Math.abs(turAcisi(4) - Math.PI) < 1e-9, 'yarı sürede yarım tur değil');
assert.ok(Math.abs(turAcisi(8) - 2 * Math.PI) < 1e-9, 'süre dolunca tam tur değil');
// Süreyi aşan kayıtta fazla dönülmez (klip sonu başa oturur).
assert.ok(Math.abs(turAcisi(12) - 2 * Math.PI) < 1e-9, 'süre aşımında fazla dönüyor');
// Kare düşmesi toplamı değiştirmez: seyrek örneklerle de aynı açı.
for (const ornekler of [[0.5, 2, 5, 8], [1, 8], [0.1, 0.2, 7.9, 8]]) {
  const son = ornekler[ornekler.length - 1];
  assert.ok(Math.abs(turAcisi(son) - 2 * Math.PI) < 1e-9, 'seyrek karede tur kapanmıyor');
}

console.log('OK paylaşım: künye ölçülmeyeni uydurmuyor, klip tam tur dönüyor (döngüde sıçrama yok)');
