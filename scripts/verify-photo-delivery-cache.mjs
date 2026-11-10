import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
// Runtime cache regressions: actual Response bodies, optional storage, corruption, and revision changes.
import assert from 'node:assert/strict';
import { ilerlemeliGetir } from '../src/indirmeIlerleme.ts';
const previous = globalThis.caches, store = new Map();
let deletes = 0;
const cache = {
  match: async u => store.get(u)?.clone(),
  put: async (u, r) => { store.set(u, r.clone()); },
  delete: async u => { deletes++; return store.delete(u); },
};
globalThis.caches = { open: async () => cache };
const response = (data, etag) => new Response(Uint8Array.from(data), { headers: {
  'content-length': String(data.length), ...(etag ? { etag } : {}),
} });
const settle = () => new Promise(r => setTimeout(r, 10));
try {
  // HTTPS does not imply immutable: the second visit must validate an unversioned URL.
  const url = 'https://fixture.invalid/model.onnx', requests = [];
  const fetcher = async (_u, init) => {
    requests.push(init?.headers?.['If-None-Match'] ?? null);
    return requests.at(-1) === '"a"' ? new Response(null, { status: 304 }) : response([1, 2, 3, 4], '"a"');
  };
  await ilerlemeliGetir(url, 'test', fetcher); await settle();
  assert.deepEqual([...new Uint8Array(await ilerlemeliGetir(url, 'test', fetcher))], [1, 2, 3, 4]);
  assert.deepEqual(requests, [null, '"a"'], 'unversioned HTTPS must revalidate');
  // A server's 304 validates the remote revision, not bytes left by an old deployment.
  const legacy = '/models/imgly/isnet-general-onnx/onnx/model_fp16.onnx';
  for (const data of [[0], [0, 0, 0, 0]]) {
    await settle();
    store.set(legacy, new Response(Uint8Array.from(data), { headers: { etag: '"existing-v1"' } }));
    const legacyRequests = [], deletesBefore = deletes;
    const result = await ilerlemeliGetir(legacy, 'legacy IS-Net', async (_u, init) => {
      legacyRequests.push(init?.headers?.['If-None-Match'] ?? null);
      return legacyRequests.length === 1 ? new Response(null, { status: 304 }) : response([1, 2, 3, 4], '"existing-v1"');
    });
    assert.deepEqual([...new Uint8Array(result)], [1, 2, 3, 4], 'legacy bytes must be replaced by the complete network response');
    assert.deepEqual(legacyRequests, ['"existing-v1"', null], 'legacy repair makes exactly one unconditional retry');
    assert.equal(deletes, deletesBefore + 1, 'unverifiable legacy entry must be deleted');
  }
  // The exact pinned deployment path is safe on secure localhost HTTP as well as HTTPS.
  const pinned = 'http://localhost/models/microsoft-david/7b404af3cfa9c1fb8851bae03a20b4250608aa7b/model.onnx';
  const integrity = { size: 4, sha256: createHash('sha256').update(Uint8Array.of(5,6,7,8)).digest('hex') };
  let calls = 0;
  const get = async () => { calls++; return response([5, 6, 7, 8]); };
  await ilerlemeliGetir(pinned, 'pinned', get, undefined, integrity); await settle();
  // Trusted manifest bytes remain reusable even when their cache entry predates format migration.
  store.set(pinned, new Response(Uint8Array.of(5, 6, 7, 8)));
  await ilerlemeliGetir(pinned, 'pinned', get, undefined, integrity);
  assert.equal(calls, 1, 'a second visit reuses pinned bytes');
  const stored = store.get(pinned), headers = new Headers(stored.headers);
  store.set(pinned, new Response(Uint8Array.of(0, 0, 0, 0), { headers }));
  assert.deepEqual([...new Uint8Array(await ilerlemeliGetir(pinned, 'corrupt', get, undefined, integrity))], [5, 6, 7, 8]);
  assert.equal(calls, 2, 'same-size corrupt cache triggers exactly one fresh fetch');
  assert.ok(deletes > 0, 'corrupt cache entry is removed');
  await settle();
  const next = pinned.replace('7b404af3cfa9c1fb8851bae03a20b4250608aa7b', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  await ilerlemeliGetir(next, 'new revision', get, undefined, integrity);
  assert.equal(calls, 3, 'new revision fetches new bytes');
  await assert.rejects(ilerlemeliGetir(next + '?bad-sha', 'bad checksum', async () => response([0,0,0,0]), undefined, integrity), /checksum/i);
  globalThis.caches = { open: () => { throw Error('Synchronous private-mode failure'); } };
  assert.equal((await ilerlemeliGetir(pinned, 'sync private', get, undefined, integrity)).byteLength, 4);
  await settle(); globalThis.caches = { open: async () => cache };
  const partial = 'https://fixture.invalid/partial.onnx';
  await assert.rejects(ilerlemeliGetir(partial, 'partial', async () => new Response(Uint8Array.of(1, 2), {
    headers: { 'content-length': '8', etag: '"partial"' },
  })), /length|incomplete|byte/i);
  await settle(); assert.equal(store.has(partial), false, 'partial bytes never persist');
  // This loader never sends Range, so even a self-consistent 206 must not become a complete model.
  for (const contentRange of ['bytes 0-3/8', undefined]) {
    const partial206 = `${partial}?range=${contentRange ?? 'missing'}`;
    await assert.rejects(ilerlemeliGetir(partial206, 'partial206', async () => new Response(Uint8Array.of(1, 2, 3, 4), {
      status: 206, headers: { 'content-length': '4', etag: '"p1"', ...(contentRange ? { 'content-range': contentRange } : {}) },
    })), /partial|206/i);
    await settle(); assert.equal(store.has(partial206), false, '206 bytes never persist');
  }
  // Exercise real HTTP/fetch semantics: reject the partial response, recover with 200, then reuse via 304.
  const httpRequests = [];
  let servePartial = true;
  const server = createServer((req, res) => {
    httpRequests.push(req.headers['if-none-match'] ?? null);
    if (servePartial) {
      servePartial = false;
      res.writeHead(206, { 'Content-Length': '4', 'Content-Range': 'bytes 0-3/8', ETag: '"p1"' });
      res.end(Buffer.from([1, 2, 3, 4]));
    } else if (req.headers['if-none-match'] === '"p1"') {
      res.writeHead(304); res.end();
    } else {
      res.writeHead(200, { 'Content-Length': '8', ETag: '"p1"' });
      res.end(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const httpUrl = `http://127.0.0.1:${server.address().port}/model.onnx`;
    await assert.rejects(ilerlemeliGetir(httpUrl, 'HTTP partial206'), /partial|206/i);
    await settle(); assert.equal(store.has(httpUrl), false, 'real HTTP 206 leaves no cache entry');
    assert.deepEqual([...new Uint8Array(await ilerlemeliGetir(httpUrl, 'HTTP recovery'))], [1, 2, 3, 4, 5, 6, 7, 8]);
    await settle();
    assert.deepEqual([...new Uint8Array(await ilerlemeliGetir(httpUrl, 'HTTP revalidation'))], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(httpRequests, [null, null, '"p1"'], 'only the complete 200 response gains an ETag cache entry');
    assert.equal(store.get(httpUrl).headers.get('x-model-byte-length'), '8');
    console.log('PASS real HTTP partial206 rejection, complete 200 recovery, valid 304 reuse');
    // The old writer hashed partial 206 bodies as though they were complete models.
    // A matching ETag and self-consistent metadata cannot certify their completeness.
    const oldPartial = Uint8Array.of(1, 2, 3, 4), deletesBefore = deletes;
    store.set(httpUrl, new Response(oldPartial, { headers: {
      etag: '"p1"', 'x-model-byte-length': '4',
      'x-model-sha256': createHash('sha256').update(oldPartial).digest('hex'),
    } }));
    httpRequests.length = 0;
    const repaired = await ilerlemeliGetir(httpUrl, 'HTTP old206 migration');
    assert.deepEqual([...new Uint8Array(repaired)], [1, 2, 3, 4, 5, 6, 7, 8], 'old206 cache must never return a partial model');
    assert.deepEqual(httpRequests, ['"p1"', null], 'old206 migration makes exactly one unconditional retry');
    assert.equal(deletes, deletesBefore + 1, 'old206 entry must be evicted');
    await settle();
    const secondVisit = await ilerlemeliGetir(httpUrl, 'HTTP migrated second visit');
    assert.equal(secondVisit.byteLength, 8);
    assert.deepEqual(httpRequests, ['"p1"', null, '"p1"'], 'the migrated entry needs no second full download');
    console.log('PASS real HTTP old206 cache migration and subsequent 304 reuse; trusted pinned cache preserved');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  globalThis.caches = { open: async () => { throw Error('Private mode'); } };
  assert.equal((await ilerlemeliGetir(pinned, 'private', get, undefined, integrity)).byteLength, 4);
  globalThis.caches = { open: async () => ({ ...cache, put: async () => { throw Error('Quota exceeded'); } }) };
  assert.equal((await ilerlemeliGetir(next + '?quota', 'quota', get, undefined, integrity)).byteLength, 4); await settle();
  delete globalThis.caches;
  assert.equal((await ilerlemeliGetir(pinned, 'no cache API', get, undefined, integrity)).byteLength, 4);
  console.log('PASS photo delivery cache: HTTPS validation, legacy ETag-only partial/corrupt repair, pinned localhost reuse, revision, checksum corruption, incomplete bytes, private/quota/no API');
} finally { if (previous === undefined) delete globalThis.caches; else globalThis.caches = previous; }
