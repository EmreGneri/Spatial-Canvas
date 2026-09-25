import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Tur 3 sözleşmesi: `renderFromPose(pose, w, h) -> { color, coverage }`.
 *
 * Node'da WebGL yok; gerçek çizim TARAYICIDA ölçüldü (CHANGELOG). Burada
 * sözleşmenin KENDİSİ korunuyor mu ona bakılır: imza, dönüş alanları ve iki
 * şartın (aynı rasterizasyon · yeni kanal yok) kodda izleri.
 */
const src = readFileSync(new URL('../src/engine/Engine.ts', import.meta.url), 'utf8');

const imza = src.match(/renderFromPose\(\s*pose:[^)]*\)\s*:\s*\{[^}]*\}/s);
assert.ok(imza, 'renderFromPose imzası bulunamadı');
assert.match(imza[0], /position:\s*\[number, number, number\]/, 'pose.position üçlü değil');
assert.match(imza[0], /target:\s*\[number, number, number\]/, 'pose.target üçlü değil');
assert.match(imza[0], /fov\?:\s*number/, 'fov isteğe bağlı alan değil');
assert.match(imza[0], /color:\s*Uint8Array/, 'color alanı sözleşmedeki tipte değil');
assert.match(imza[0], /coverage:\s*Float32Array \| null/, 'coverage alanı sözleşmedeki tipte değil');

const govde = src.slice(src.indexOf('renderFromPose('), src.indexOf('renderFromPose(') + 4000);

// ŞART 1 — aynı rasterizasyon: ekrandaki kareyi çizen composer'ın TA KENDİSİ.
assert.match(govde, /this\.composer\.render\(\)/, 'offscreen yol composer zincirini kullanmıyor');
assert.ok(
  !/new\s+(THREE\.)?WebGLRenderer/.test(govde),
  'offscreen yol kendi renderer’ını kuruyor — ekrandakiyle aynı rasterizasyon garantisi kalkar',
);
// Döngünün ilk adımı (uPositions) atlanırsa kare boş çıkıyor; ölçüldü.
assert.match(govde, /uPositions/, 'konum texture push edilmiyor — kare boş çıkar');

// ŞART 2 — yeni texture kanalı açılmaz: yalnız var olan yoldan okunur.
assert.ok(
  !/new\s+(THREE\.)?(DataTexture|WebGLRenderTarget)/.test(govde),
  'offscreen yol yeni texture/hedef açıyor — GaussianBuffer sözleşmesi dışına çıkılmış',
);

// Çağrı ekranı BOZMAMALI: poz, boyut ve DPR geri yüklenir.
assert.match(govde, /finally\s*\{/, 'geri yükleme finally bloğunda değil');
for (const geri of ['setPixelRatio', 'setSize', 'position.copy', 'target.copy', 'updateProjectionMatrix']) {
  assert.ok(govde.includes(geri), `geri yüklemede ${geri} yok`);
}

console.log('OK renderFromPose sözleşmesi: imza, aynı rasterizasyon, yeni kanal yok, ekran geri yükleniyor');
