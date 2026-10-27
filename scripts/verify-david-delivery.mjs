import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { loadDavidMaskBytes, DAVID_MASK_PATH, DAVID_MASK_REMOTE } = await import('../src/engine/vision/davidMaskAsset.ts');
const buffer = new ArrayBuffer(8), calls = [];
const get = async url => { calls.push(url); return buffer; };
assert.equal(await loadDavidMaskBytes(get, 'https://fixture.example'), buffer);
assert.deepEqual(calls, ['https://fixture.example' + DAVID_MASK_PATH]);
calls.length = 0;
assert.equal(await loadDavidMaskBytes(async url => {
  calls.push(url);
  if (calls.length === 1) throw new Error('404 fixture');
  return buffer;
}, 'https://fixture.example'), buffer);
assert.deepEqual(calls, ['https://fixture.example' + DAVID_MASK_PATH, DAVID_MASK_REMOTE]);
const failure = new Error('offline');
await assert.rejects(loadDavidMaskBytes(async () => { throw failure; }, 'https://fixture.example'), e => e === failure);
const oldCaches = globalThis.caches;
try {
  globalThis.caches = { open: async () => ({ match: async url => url === DAVID_MASK_REMOTE ? {} : undefined }) };
  calls.length = 0;
  assert.equal(await loadDavidMaskBytes(get, 'https://fixture.example'), buffer);
  assert.deepEqual(calls, [DAVID_MASK_REMOTE], 'existing HF cache must not download identical deployment weights again');
} finally { if (oldCaches === undefined) delete globalThis.caches; else globalThis.caches = oldCaches; }
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(app, /if \(!canliKaynak\) return/, 'photo and idle pages must not warm the live video estimator');
console.log('PASS DAViD delivery: pinned local asset, remote fallback, byte identity; live warmup only on live sources');
