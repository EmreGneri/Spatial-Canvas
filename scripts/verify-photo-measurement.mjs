// Gerçek işlemler yerine saat/ağ kayıt sınırı taklit edilir; model çıktısı üretilmez.
import assert from 'node:assert/strict';
const { beginPhotoMeasurement, currentPhotoMeasurement, measureOutput } = await import('../src/engine/photoMeasurement.ts');
const original = { performance: globalThis.performance, window: globalThis.window,
  location: globalThis.location, observer: globalThis.PerformanceObserver, info: console.info };
let clock = 10, entries = [], disconnects = 0, observers = 0;
globalThis.performance = { now: () => clock, getEntriesByType: () => entries };
globalThis.window = {};
globalThis.location = { search: '', href: 'http://localhost:5173/' };
globalThis.PerformanceObserver = class {
  constructor(callback) { this.callback = callback; observers++; }
  observe() {}
  takeRecords() { return []; }
  disconnect() { disconnects++; }
};
console.info = () => {};
const meta = { generation: 1, width: 1122, height: 1402 };
try {
  assert.equal(beginPhotoMeasurement(meta), null, 'ölçüm açıkça istenmedikçe çalışmamalı');
  assert.equal(observers, 0);
  location.search = '?olcum=1';
  const session = beginPhotoMeasurement(meta);
  assert.ok(session);
  assert.equal(currentPhotoMeasurement(), session);
  assert.equal(session.measureSync('sync', () => { clock += 3; return 42; }), 42);
  const failure = new Error('operation failed');
  await assert.rejects(session.measure('async failure', async () => { clock += 7; throw failure; }), error => error === failure);
  assert.throws(() => session.measureSync('sync failure', () => { throw failure; }), error => error === failure);
  await session.measure('outer', async () => session.measure('inner', async () => { clock += 5; }));
  session.recordDownload({ url: 'https://host.test/model.onnx?token=secret#fragment', label: 'model',
    source: 'fetch', bodyBytes: 100, startedAt: 10, endedAt: 20, status: 'ok' });
  session.recordDownload({ url: '/models/cached.onnx', label: 'cache', source: 'cache-storage',
    bodyBytes: 80, startedAt: 20, endedAt: 21, status: 'ok' });
  session.recordDownload({ url: '/models/failed.onnx', label: 'partial', source: 'fetch',
    bodyBytes: 12, startedAt: 21, endedAt: 23, status: 'failed' });
  const resource = { name: 'https://host.test/model.onnx?token=secret', startTime: 11,
    duration: 8, responseEnd: 19, transferSize: 140, encodedBodySize: 100, decodedBodySize: 100, initiatorType: 'fetch' };
  entries = [resource, { ...resource }, { ...resource, name: 'https://other.test/opaque?secret=yes', startTime: 13,
    transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 }, { ...resource, startTime: 1 }];
  clock = 35;
  const report = session.finish('failed', { reason: 'test' });
  assert.equal(report.totalMs, 25);
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.spans.map(s => [s.name, s.status, s.durationMs]),
    [['sync', 'ok', 3], ['async failure', 'failed', 7], ['sync failure', 'failed', 0], ['inner', 'ok', 5], ['outer', 'ok', 5]]);
  assert.equal(report.resources.length, 2, 'aynı resource kaydı iki kez sayılmamalı; önce başlayanlar pencere dışında');
  assert.equal(report.resources[1].transferBytes, null, 'cross-origin sıfır transfer cache kanıtı değildir');
  assert.deepEqual(report.downloadBytes, { cacheStorageBodyBytes: 80, fetchBodyBytes: 112 });
  assert.deepEqual(report.resourceBytes, { observedTransferBytes: 140, unknownTransferCount: 1 });
  assert.ok(!JSON.stringify(report).includes('secret'), 'URL query/hash rapora sızmamalı');
  assert.equal(disconnects, 1);
  assert.equal(currentPhotoMeasurement(), null);
  assert.equal(session.finish('ready'), report, 'finish idempotent olmalı');
  assert.equal(window.__photoMeasurements.length, 1);
  const count = report.spans.length;
  await session.measure('late', async () => 1);
  assert.equal(report.spans.length, count, 'bitmiş oturuma geç olay eklenmemeli');
  const superseded = beginPhotoMeasurement(meta, true);
  let release;
  const pending = superseded.measure('pending old photo', () => new Promise(resolve => { release = resolve; }));
  clock += 4;
  const next = beginPhotoMeasurement({ ...meta, generation: 2 }, true);
  assert.equal(window.__photoMeasurements.at(-1).status, 'cancelled');
  const cancelled = window.__photoMeasurements.at(-1);
  assert.equal(cancelled.spans.at(-1).status, 'cancelled');
  assert.equal(cancelled.spans.at(-1).durationMs, 4);
  release('old value');
  assert.equal(await pending, 'old value', 'ölçümü iptal etmek asıl işi iptal etmez');
  superseded.recordDownload({ url: '/late', label: 'old fetch', source: 'fetch', bodyBytes: 8,
    startedAt: 0, endedAt: clock, status: 'ok' });
  assert.equal(cancelled.downloads.length, 0);
  assert.equal(cancelled.spans.at(-1).status, 'cancelled', 'geç tamamlanma eski raporu değiştirmemeli');
  assert.equal(currentPhotoMeasurement(), next);
  assert.equal(next.finish('cancelled').downloads.length, 0, 'eski indirme yeni fotoğrafa yazılmamalı');
  for (let i = 0; i < 12; i++) beginPhotoMeasurement({ ...meta, generation: i }, true).finish('ready');
  assert.equal(window.__photoMeasurements.length, 10, 'yerel rapor geçmişi sınırlı olmalı');
  assert.equal(disconnects, observers, 'başarısız/iptal oturumlarda observer sızmamalı');
  const latest = window.__photoMeasurements.at(-1).id;
  const outputValue = { file: 'test' };
  assert.equal(await measureOutput('png', async () => { clock += 9; return outputValue; }, { scope: 'encode wall' }), outputValue);
  const output = window.__outputMeasurements.at(-1);
  assert.equal(output.wallMs, 9);
  assert.equal(output.lastPhotoId, latest);
  assert.equal(output.status, 'ok');
  await assert.rejects(measureOutput('webm', async () => { throw failure; }), error => error === failure);
  assert.equal(window.__outputMeasurements.at(-1).status, 'failed');
  assert.throws(() => measureOutput('sync throw', () => { throw failure; }), error => error === failure);
  for (let i = 0; i < 12; i++) await measureOutput('png', async () => i);
  assert.equal(window.__outputMeasurements.length, 10);
  location.search = '';
  const promise = Promise.resolve(outputValue);
  assert.equal(measureOutput('off', () => promise), promise, 'kapalı output ölçümü Promise kimliğini korumalı');
  assert.equal(window.__outputMeasurements.length, 10);
} finally {
  for (const [key, value] of Object.entries({ performance: original.performance, window: original.window,
    location: original.location, PerformanceObserver: original.observer })) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
  console.info = original.info;
}
console.log('verify-photo-measurement OK');
