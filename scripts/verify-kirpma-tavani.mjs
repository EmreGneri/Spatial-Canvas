// `?kirpmaTavan=N` crop-grid cap: off by default (384, unchanged), clamps only in range, grid follows it.
import assert from 'node:assert/strict';
import { kirpmaIzgarasi, kirpmaIzgaraTavani } from '../src/engine/vision/liveDepth.ts';

assert.equal(kirpmaIzgaraTavani(''), 384, 'default unchanged');
assert.equal(kirpmaIzgaraTavani('?kirpmaTavan=256'), 256);
for (const bad of ['?kirpmaTavan=0', '?kirpmaTavan=10', '?kirpmaTavan=999', '?kirpmaTavan=abc', '?kirpmaTavan=384'])
  assert.equal(kirpmaIzgaraTavani(bad), 384, bad);
const crop = Float32Array.from({ length: 100 * 175 }, (_, i) => (i % 100) / 100);
const kutu = { x: 0.3, y: 0.1, w: 0.4, h: 0.5 };
const full = kirpmaIzgarasi(crop, 100, 175, kutu);
assert.deepEqual([full.width, full.height], [250, 350], 'no cap reached: same grid as before');
assert.deepEqual(kirpmaIzgarasi(crop, 100, 175, kutu, 384).data, full.data, 'explicit default = old call');
const capped = kirpmaIzgarasi(crop, 100, 175, kutu, 256);
assert.deepEqual([capped.width, capped.height], [250, 256]);
console.log('verify-kirpma-tavani OK');
