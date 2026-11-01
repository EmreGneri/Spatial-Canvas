// WebM kayıt pompası sözleşmesi (#15). GPU/DOM gerekmez.
//
// Eskiden imzalı kayıt kendi rAF döngüsünde `renderFrame()` çağırıyordu: motorun
// normal döngüsü zaten çizdiği için composer her kare İKİ kez çalışıyordu.
// Şimdi kare, çizim-sonrası kancadan kopyalanır. Gerçek Chrome sayımı
// (scripts/olcum-cikti-export.mjs): kayıtta composer.render == döngü karesi.
//   node scripts/verify-kayit-pompasi.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportWebM, tapEkle } from '../src/engine/export.ts';

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

// Real export lifecycle; only browser encoder, clock and download are replaced.
// Catch leaked capture tracks and a failed encoder's later stop downloading data.
{
  const saved = Object.fromEntries(['MediaRecorder', 'document', 'setTimeout', 'clearTimeout'].map(k => [k, globalThis[k]]));
  const timers = new Map();
  let nextTimer = 0, downloads = 0, stopped = 0, failure = '', recorder;
  globalThis.setTimeout = (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.document = { createElement: () => ({ click: () => { downloads++; } }) };
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    state = 'inactive';
    ondataavailable = null;
    onerror = null;
    onstop = null;
    constructor() {
      if (failure === 'constructor') throw new Error('encoder constructor failed');
      recorder = this;
    }
    start() {
      if (failure === 'start') throw new Error('encoder start failed');
      this.state = 'recording';
    }
    stop() {
      assert.notEqual(this.state, 'inactive', 'an ended recorder must not be stopped again');
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['frame']) });
      this.onstop?.();
    }
  };
  const canvas = { captureStream: () => ({ getTracks: () => [{ stop: () => { stopped++; } }] }) };
  try {
    for (failure of ['constructor', 'start']) {
      const before = stopped;
      await assert.rejects(async () => exportWebM(canvas), /encoder .* failed/);
      assert.equal(stopped, before + 1, `${failure} failure must stop the capture track`);
      assert.equal(timers.size, 0, `${failure} failure leaves no recording timer`);
    }
    failure = '';
    const failed = exportWebM(canvas);
    const failedResult = assert.rejects(failed, /encoder runtime failed/);
    const lateStop = recorder.onstop, lateData = recorder.ondataavailable;
    recorder.state = 'inactive';
    recorder.onerror({ error: new Error('encoder runtime failed') });
    lateData?.({ data: new Blob(['partial']) });
    lateStop?.();
    await failedResult;
    assert.equal(downloads, 0, 'a failed recording never downloads its partial output');
    assert.equal(timers.size, 0, 'an error clears its recording deadline');
    assert.equal(recorder.ondataavailable, null);
    assert.equal(recorder.onerror, null);
    assert.equal(recorder.onstop, null);

    const successful = exportWebM(canvas, { durationSec: 5 });
    const [id, deadline] = [...timers].find(([, t]) => t.ms === 5000);
    timers.delete(id);
    deadline.fn();
    await successful;
    assert.equal(downloads, 1, 'successful recording still downloads once');
    assert.equal(stopped, 4, 'each recording releases its own capture track once');
    assert.equal(recorder.onstop, null);
    // The only remaining timer belongs to the downloaded URL, not recording.
    assert.equal(timers.size, 1);
    const revoke = [...timers.values()][0];
    assert.equal(revoke.ms, 60_000);
    revoke.fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

console.log('kayit pompasi: OK');
