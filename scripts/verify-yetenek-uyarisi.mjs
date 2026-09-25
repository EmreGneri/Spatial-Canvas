import assert from 'node:assert/strict';
import { yetenekGorunumu } from '../src/ui/yetenekGorunum.ts';

// Z2 — yetenek uyarısının EN ÖNEMLİ kuralı: her şey çalışırken susar.
// Çalışan kurulumda "her şey yolunda" rozeti göstermek, sonraki gerçek
// uyarının okunmamasına yol açar.
const saglam = { webgpu: true, canliDerinlik: 'acik', tespit: 'acik', sebep: null };
assert.equal(yetenekGorunumu(saglam, false).goster, false, 'sağlam kurulumda uyarı çıkıyor');
assert.deepEqual(yetenekGorunumu(saglam, false).rozetler, []);

// Rapor henüz gelmediyse de çizilmez (mount anında boş şerit yanıp sönmesin).
assert.equal(yetenekGorunumu(null, false).goster, false);

// WebGPU yoksa: şerit çıkar, sebep taşınır, kapalı yetenekler rozetlenir.
const webgpuYok = {
  webgpu: false,
  canliDerinlik: 'kapali',
  tespit: 'kapali',
  sebep: 'Tarayıcın WebGPU desteklemiyor: canlı video derinliği kapalı.',
};
const g = yetenekGorunumu(webgpuYok, false);
assert.equal(g.goster, true);
assert.equal(g.sebep, webgpuYok.sebep, 'sebep metni arayüze olduğu gibi taşınmıyor');
assert.deepEqual(
  g.rozetler,
  [
    { ad: 'WebGPU', acik: false },
    { ad: 'canlı derinlik', acik: false },
    { ad: 'nesne tespiti', acik: false },
  ],
  'rozetler rapordaki durumu yansıtmıyor',
);

// Karma durum: WebGPU var ama canlı derinlik kapalı (sidecar yok vb.) —
// açık olan açık, kapalı olan kapalı görünmeli.
const karma = {
  webgpu: true,
  canliDerinlik: 'kapali',
  tespit: 'acik',
  sebep: 'Canlı derinlik modeli yüklenemedi.',
};
const k = yetenekGorunumu(karma, false);
assert.deepEqual(k.rozetler.map((r) => r.acik), [true, false, true]);

// Kullanıcı kapattıysa gizlenir (sebep log şeridinde kalır, bileşen değil).
assert.equal(yetenekGorunumu(webgpuYok, true).goster, false, 'kapatma çalışmıyor');

console.log('OK yetenek uyarısı: sağlam kurulumda susuyor, sorun varsa sebebi ve rozetleri taşıyor');
