// E2 — yetenek raporu sözleşme testi. Node'da WebGPU YOKTUR; rapor bu
// durumda ne demeli, onu kilitler. Sessiz bozulmanın panzehiri: kapalı olan
// her kol SEBEBİYLE birlikte raporlanır.
import assert from 'node:assert/strict';
import { yetenekRaporu, yetenekOnbelleginiSifirla } from '../src/engine/vision/yetenek.ts';

const r = await yetenekRaporu();

assert.equal(typeof r.webgpu, 'boolean', 'webgpu alanı boolean');
assert.ok(r.canliDerinlik === 'acik' || r.canliDerinlik === 'kapali', 'canliDerinlik değeri sözleşmede');
assert.ok(r.tespit === 'acik' || r.tespit === 'kapali', 'tespit değeri sözleşmede');

// Node'da navigator.gpu yok → WebGPU false.
assert.equal(r.webgpu, false, 'Node ortamında WebGPU false olmalı');
assert.equal(r.tespit, 'kapali', 'WebGPU yoksa tespit kapalı (wasm yolu canlı tempoyu taşımıyor)');
console.log(`[1] WebGPU yok → tespit kapalı ✓`);

// EN KRİTİK MADDE: kapalı bir kol varsa sebep BOŞ OLAMAZ.
const kapaliVar = r.canliDerinlik === 'kapali' || r.tespit === 'kapali';
assert.ok(kapaliVar, 'bu ortamda en az bir kol kapalı olmalı');
assert.ok(typeof r.sebep === 'string' && r.sebep.length > 10,
  'kapalı kol varken sebep dolu olmalı — sessiz bozulma yasak');
console.log(`[2] kapalı kol var → sebep dolu ✓`);
console.log(`     "${r.sebep}"`);

// Önbellek: aynı nesne döner (oturum başına tek ölçüm).
const r2 = await yetenekRaporu();
assert.equal(r, r2, 'rapor önbelleklenir, her çağrıda yeniden ölçülmez');
yetenekOnbelleginiSifirla();
const r3 = await yetenekRaporu();
assert.notEqual(r, r3, 'sıfırlama sonrası yeniden ölçülür');
assert.deepEqual(r3, r, 'yeniden ölçüm aynı sonucu verir (determinizm)');
console.log('[3] önbellek + sıfırlama + determinizm ✓');

console.log('OK yetenek raporu (E2)');
