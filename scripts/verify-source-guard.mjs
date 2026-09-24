/**
 * KAYNAK DEGISIMI GUVENLIGI (review-fixes gorev 2).
 *
 * Bulgu: App'in async kaynak yollari (run, handleFile, toggleCamera, canli
 * derinlik baslatma) kaynak degistiginde durmuyordu. Kamera izni beklerken
 * ikinci tik ikinci akisi aciyor, ilki hic kapanmiyordu; islenen fotograf
 * sonradan birakilan kaynagin derinligini eziyordu. Cozum: teardownSource
 * bir nesil sayacini artirir, her async yol baslangicta nesli yakalar ve
 * her await'ten sonra hala guncel mi diye bakar.
 *
 * Bu script koruyucu yardimcinin (src/sourceGuard.ts) sozlesmesini ve
 * dosya-acma hata mesajlarini kanitlar; App.tsx icin yalniz iki kablolama
 * degismezini metin uzerinden denetler (React/DOM olmadan App kurulamaz).
 *
 *   node scripts/verify-source-guard.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { captureGeneration, sourceErrorMessage } = await import('../src/sourceGuard.ts');

const tick = () => new Promise((r) => setTimeout(r, 0));

// [1] Guncel vs bayat: yakalanan nesil, sayac artana kadar guncel kalir.
{
  const gen = { current: 0 };
  const a = captureGeneration(gen);
  assert.equal(a(), true, 'yakalandigi anda guncel');
  assert.equal(a(), true, 'kontrol sayaci degistirmez');
  gen.current++;
  assert.equal(a(), false, 'kaynak degisince bayat');
  const b = captureGeneration(gen);
  assert.equal(b(), true, 'yeni kaynak guncel');
  gen.current++;
  assert.equal(a(), false, 'bayat olan bir daha guncel olmaz');
  assert.equal(b(), false, 'ikinci degisim ikinciyi de bayatlatir');
}

// [2] Ic ice await: bayat yol, degisimden SONRAKI ilk kontrolde durur ve
// sonraki adimlari (derinlik/maske/ayar yazimi) hic calistirmaz. Ic yol
// (handleFile -> run) ayni nesli ayrica yakalar ve ayni anda bayatlar.
{
  const gen = { current: 0 };
  const writes = [];
  async function inner(tag) {
    const isCurrent = captureGeneration(gen);
    await tick();
    if (!isCurrent()) return 'inner-stale';
    writes.push(`${tag}:mask`);
    await tick();
    if (!isCurrent()) return 'inner-stale';
    writes.push(`${tag}:depth`);
    return 'inner-done';
  }
  async function outer(tag) {
    const isCurrent = captureGeneration(gen);
    await tick();
    if (!isCurrent()) return 'outer-stale';
    const r = await inner(tag);
    if (!isCurrent()) return `outer-stale-after-${r}`;
    writes.push(`${tag}:settings`);
    return 'done';
  }

  // Degisim yok: tum yazimlar yapilir.
  assert.equal(await outer('A'), 'done');
  assert.deepEqual(writes, ['A:mask', 'A:depth', 'A:settings']);

  // Degisim ic yolun iki await'i arasinda: maske yazildi ama derinlik ve
  // ayarlar yazilmaz — dis yol da ic yol donunce bayat oldugunu gorur.
  writes.length = 0;
  const p = outer('B');
  await tick(); // outer ilk await'i gecti
  await tick(); // inner ilk await'i gecti, maske yazildi
  gen.current++; // teardownSource
  assert.equal(await p, 'outer-stale-after-inner-stale');
  assert.deepEqual(writes, ['B:mask'], 'degisimden sonra hicbir yazim yok');

  // Iki yol ust uste: eskisi (C) yeni kaynak (D) basladiginda bayatlar,
  // yalniz D yazar.
  writes.length = 0;
  const c = outer('C');
  gen.current++; // D'nin teardownSource'u
  const d = outer('D');
  assert.deepEqual([await c, await d], ['outer-stale', 'done']);
  assert.deepEqual(writes, ['D:mask', 'D:depth', 'D:settings']);
}

// [3] Hata mesajlari: Turkce, eyleme donuk, ham hata metni korunur.
{
  const mov = sourceErrorMessage(
    { name: 'IMG_0001.MOV', type: 'video/quicktime' },
    new Error('The element has no supported sources.'),
  );
  assert.match(mov, /IMG_0001\.MOV/);
  assert.match(mov, /HEVC\/H\.265/);
  assert.match(mov, /H\.264 MP4/);
  assert.match(mov, /The element has no supported sources\./, 'ham hata metni kalir');

  const heic = sourceErrorMessage({ name: 'IMG_0002.HEIC', type: 'image/heic' }, new Error('decode failed'));
  assert.match(heic, /IMG_0002\.HEIC/);
  assert.match(heic, /HEIC/);
  assert.match(heic, /JPG\/PNG/);
  assert.match(heic, /decode failed/);

  const generic = sourceErrorMessage({ name: 'x.bin', type: 'application/octet-stream' }, 'kaboom');
  assert.match(generic, /^HATA/);
  assert.match(generic, /kaboom/, 'Error olmayan ret de metne doner');
  assert.doesNotMatch(generic, /HEVC|HEIC/, 'genel yol yanlis ipucu vermez');
}

// [4] App kablolamasi (metin degismezleri).
{
  const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
  const teardown = app.slice(app.indexOf('function teardownSource()'));
  const teardownBody = teardown.slice(0, teardown.indexOf('\n  }'));
  assert.match(teardownBody, /sourceGenRef\.current\+\+/, 'teardownSource nesli artirir');

  const drop = app.slice(app.indexOf('onDrop={'));
  const dropBody = drop.slice(0, drop.indexOf('}}'));
  assert.match(dropBody, /busy/, 'surukle-birak da busy iken dosya almaz');
}

console.log('verify-source-guard: OK');
