// WebM kayıt pompası sözleşmesi (#15). GPU/DOM gerekmez.
//
// Eskiden imzalı kayıt kendi rAF döngüsünde `renderFrame()` çağırıyordu: motorun
// normal döngüsü zaten çizdiği için composer her kare İKİ kez çalışıyordu.
// Şimdi kare, çizim-sonrası kancadan kopyalanır. Gerçek Chrome sayımı
// (scripts/olcum-cikti-export.mjs): kayıtta composer.render == döngü karesi.
//   node scripts/verify-kayit-pompasi.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tapEkle } from '../src/engine/export.ts';

// ── çoklu kanca: ekleyen kendi kancasını bırakır, başkasınınkine dokunmaz ──
{
  const kume = new Set();
  const cagri = [];
  const izleyici = () => cagri.push('izleyici');
  const birak1 = tapEkle(kume, izleyici);
  const birakKayit = tapEkle(kume, () => cagri.push('kayit'));
  for (const t of kume) t();
  assert.deepEqual(cagri, ['izleyici', 'kayit']);
  birakKayit();
  cagri.length = 0;
  for (const t of kume) t();
  assert.deepEqual(cagri, ['izleyici'], 'kayıt bırakılınca yalnız kendisi gider');
  birak1();
  assert.equal(kume.size, 0);
  birak1(); // ikinci bırakma zararsız
}

const engine = readFileSync(new URL('../src/engine/Engine.ts', import.meta.url), 'utf8');
const bar = readFileSync(new URL('../src/ui/ExportBar.tsx', import.meta.url), 'utf8');

// Döngü: tracker yuvası (setFrameTap) ve ek kancalar composer.render'dan SONRA.
{
  const render = engine.indexOf('this.composer.render();');
  const tap = engine.indexOf('this.frameTap?.(this.renderer.domElement)');
  const ek = engine.indexOf('for (const t of this.frameTaps) t(this.renderer.domElement)');
  assert.ok(render > 0 && tap > render && ek > tap, 'iki kanca da çizimden sonra çalışmalı');
  assert.match(engine, /setFrameTap\(tap: .*\) \{\s*this\.frameTap = tap;/, 'tracker yuvası aynı kaldı');
  assert.match(engine, /addFrameTap\(tap: .*\): \(\) => void \{\s*return tapEkle\(this\.frameTaps, tap\)/);
}

// Kayıt pompası artık çizim yapmaz: renderFrame / rAF yok, kanca ekler ve bırakır.
{
  const a = bar.indexOf('async function webmKaydet');
  const b = bar.indexOf('function plyIndir');
  const webm = bar.slice(a, b);
  assert.ok(!/renderFrame|requestAnimationFrame/.test(webm), 'webmKaydet ikinci çizim yapmamalı');
  assert.match(webm, /engine\.addFrameTap\(/);
  assert.match(webm, /finally \{[\s\S]*birak\?\.\(\)/, 'kanca finally içinde bırakılmalı (hata/bitişte)');
  assert.match(webm, /imzaCiz\(ctx/, 'imza aynı yoldan kareye çizilir');
  assert.ok(!/setFrameTap/.test(bar), 'ExportBar tracker yuvasını ezmemeli');
}

console.log('kayit pompasi: OK');
