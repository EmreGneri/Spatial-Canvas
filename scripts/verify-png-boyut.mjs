// PNG çıktı boyutu sözleşmesi (#16). GPU/DOM gerekmez; gerçek Chrome kanıtı
// scripts/olcum-cikti-export.mjs.
//   node scripts/verify-png-boyut.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pngBoyutu } from '../src/engine/export.ts';

// Varsayılan 'mevcut': ekrandaki tampon aynen.
assert.deepEqual(pngBoyutu('mevcut', 726, 453), { w: 726, h: 453 });

// Uzun kenar seçilene oturur, oran korunur (yatay, dikey, kare).
assert.deepEqual(pngBoyutu('1080p', 726, 453), { w: 1920, h: 1198 });
assert.deepEqual(pngBoyutu('2k', 726, 453), { w: 2560, h: 1597 });
assert.deepEqual(pngBoyutu('1080p', 453, 726), { w: 1198, h: 1920 });
assert.deepEqual(pngBoyutu('1080p', 500, 500), { w: 1920, h: 1920 });
for (const [bw, bh] of [[726, 453], [610, 382], [1000, 333], [333, 1000], [1, 1]]) {
  for (const m of ['1080p', '2k']) {
    const { w, h } = pngBoyutu(m, bw, bh);
    assert.equal(Math.max(w, h), m === '1080p' ? 1920 : 2560);
    assert.ok(Math.abs(w / h - bw / bh) <= 1 / Math.min(w, h) * (bw / bh) + 1e-9, 'oran korunmalı');
  }
}
// Dar ve geniş pencere aynı sahnede aynı kadrajı (aynı oran) verir.
const dar = pngBoyutu('1080p', 614, 384), genis = pngBoyutu('1080p', 1228, 768);
assert.deepEqual(dar, genis);
// Bozuk giriş çökmez, en az 1 px.
assert.ok(pngBoyutu('1080p', 0, 0).w >= 1);

const engine = readFileSync(new URL('../src/engine/Engine.ts', import.meta.url), 'utf8');
const bar = readFileSync(new URL('../src/ui/ExportBar.tsx', import.meta.url), 'utf8');

// renderAtSize: yeniden çizim + eski boyut/DPR/composer finally'de geri yüklenir.
{
  const a = engine.indexOf('renderAtSize(w: number, h: number)');
  const b = a + engine.slice(a).search(/\n  \}\r?\n/); // ilk 2-boşluklu metot kapanışı
  const m = engine.slice(a, b);
  assert.match(m, /this\.composer\.render\(\)/, 'gerçek yeniden çizim');
  assert.ok(!/renderFromPose|upscale|scale\(/.test(m), '2B büyütme değil');
  const fin = m.slice(m.indexOf('} finally {'));
  for (const gerek of ['setPixelRatio(eskiDpr)', 'renderer.setSize(eskiBoyut.x, eskiBoyut.y)', 'composer.setPixelRatio(eskiDpr)',
    'composer.setSize(eskiBoyut.x, eskiBoyut.y)', 'this.currentDpr = eskiCurrentDpr', 'pushSharedUniformsAll()']) {
    assert.ok(fin.includes(gerek), `finally geri yüklemeli: ${gerek}`);
  }
  assert.ok(!/camera\.(aspect|position|fov)\s*=/.test(m), 'kamera oranı/pozu DEĞİŞMEZ: aynı kadraj');
}

// ExportBar: varsayılan 'mevcut'; seçim yalnız seçilince yeniden çizdirir.
assert.match(bar, /useState<PngBoyut>\('mevcut'\)/);
assert.match(bar, /pngBoyut !== 'mevcut'[\s\S]*engine\.renderAtSize\(w, h\)/);
assert.match(bar, /<option value="1080p">/);
assert.match(bar, /<option value="2k">/);

console.log('png boyut: OK');
