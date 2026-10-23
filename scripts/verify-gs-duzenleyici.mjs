// gsplat'tan (Apache-2.0) uyarlanan ucuz düzenleyiciler — GPU'suz denetim.
//  1. Seçenek geçişi: --opacity-reg / --scale-reg / --abs-grad (bench URL'si)
//     -> EgitimOlcumAyari -> createSession trainer seçenekleri.
//  2. opts.absGrad (AbsGS): büyüme donörleri yalnız pencere-toplamı |grad|
//     istatistiği (gradP yuva 12) eşiği geçen splat'lardan; büyüme sayısı aday
//     sayısıyla sınırlı; taşıma (relocation) etkilenmez.
//  3. Sert bütçe (cap): growRegion ve absGrad açıkken de büyüme cap'i aşmaz,
//     cap doluyken büyüme durur ama taşıma (MCMC relocation) sürer.
// Sahte WebGPU aygıtı verify-grow-region.mjs ile aynı desen.
import assert from 'node:assert/strict';
import { STRIDE } from '../src/vendor/splat.js/gs/shaders.js';
import { GSTrainer } from '../src/vendor/splat.js/gs/trainer.js';
import { makeRng } from '../src/vendor/splat.js/sfm/geometry.js';
import { egitimOturumAyari } from '../src/engine/reconstruction/egitim3dgs.ts';
import * as page from '../src/bench/gezinmeSayfasi.ts';

globalThis.GPUBufferUsage = { MAP_READ: 1, COPY_DST: 2, COPY_SRC: 4, STORAGE: 8, UNIFORM: 16, QUERY_RESOLVE: 32 };
globalThis.GPUMapMode = { READ: 1, WRITE: 2 };

// ---- 1. seçenek geçişi -------------------------------------------------
const quick = { tier: 'quick', maxFrames: 24, maxIters: 3000, gpu: 'test', zayifGpu: true, entegreGpu: false };
assert.deepEqual(egitimOturumAyari(quick, { opacityReg: 0, scaleReg: 0.01, absGrad: 2 }), {
  maxIters: 3000, holdout: 'auto', refineEvery: 375,
  trainer: { scaleReg: 0.01, opacityReg: 0, absGrad: 2 },
});
// varsayılan: scaleReg 0,1 açık (ölçümle kabul edildi); 0 ile kapatılabilir
assert.equal(egitimOturumAyari(quick).trainer.scaleReg, 0.1);
assert.equal(egitimOturumAyari(quick, { scaleReg: 0 }).trainer.scaleReg, 0);
assert.equal(egitimOturumAyari(quick).trainer.absGrad, undefined, 'absGrad varsayılan kapalı');
const p = page.parametreleriOku('?klip=/c.webm&opacity-reg=0&scale-reg=0.1&abs-grad=4');
assert.deepEqual(p.egitim, { opacityReg: 0, scaleReg: 0.1, absGrad: 4 });
assert.throws(() => page.parametreleriOku('?klip=/c.webm&scale-reg=-1'), /scale-reg/);
assert.throws(() => page.parametreleriOku('?klip=/c.webm&abs-grad=0'), /abs-grad/);
assert.throws(() => page.parametreleriOku('?klip=/c.webm&opacity-reg=x'), /opacity-reg/);
const rapor = page.egitimOlcumRaporu(quick, p.egitim, [], 10, 20, 1, []);
assert.equal(rapor.settings.scaleReg, 0.1);
assert.equal(rapor.settings.absGrad, 4);
console.log('OK 1/3: düzenleyici seçenekleri bench -> oturum');

// ---- sahte aygıt + sahne ----------------------------------------------
function makeDevice() {
  const mk = (size) => {
    const data = new Uint8Array(Math.max(0, size | 0));
    return { size, data, async mapAsync() {}, unmap() {}, destroy() {},
      getMappedRange(o = 0, len) { return data.buffer.slice(o, o + (len ?? (data.byteLength - o))); } };
  };
  return {
    createBuffer: ({ size }) => mk(size),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      copyBufferToBuffer(src, so, dst, doff, size) { if (size) dst.data.set(src.data.subarray(so, so + size), doff); },
      beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }),
      finish: () => ({}),
    }),
    queue: {
      submit() {},
      writeBuffer(buf, off, d) {
        buf.data.set(d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset ?? 0, d.byteLength), off);
      },
    },
  };
}

// 20 ölü, 40 donör x>0 (yüksek |grad|), 40 donör x<0 (düşük |grad|)
function makeTrainer(opts, capExtra = 200) {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({ x: 0, o: -10, g: 0 });
  for (let i = 0; i < 40; i++) rows.push({ x: 1000 + i, o: Math.log(9), g: 10 });
  for (let i = 0; i < 40; i++) rows.push({ x: -1000 - i, o: Math.log(9), g: 1 });
  const n = rows.length;
  const f32 = new Float32Array(n * STRIDE);
  const gather = new Float32Array(n * 4);
  rows.forEach((r, i) => {
    const b = i * STRIDE;
    f32[b] = r.x; f32[b + 3] = -4 + (i % 5) * 0.01; f32[b + 4] = -4; f32[b + 5] = -4; f32[b + 6] = 1; f32[b + 13] = r.o;
    gather[i * 4] = r.o; gather[i * 4 + 1] = r.g; gather[i * 4 + 3] = -4;
  });
  const t = Object.create(GSTrainer.prototype);
  const d = makeDevice();
  Object.assign(t, {
    device: d, opts, iter: 0, horizon: 10000, n, cap: n + capExtra, growLimit: null, shK: 0, maxTiles: 0,
    pipeRefinePatch: { getBindGroupLayout: () => ({}) }, bufM: {}, bufV: {},
    bufParams: { data: new Uint8Array(f32.buffer) }, bufTileCnt: { data: new Uint8Array(0) },
    camMeta: [], adamData: new Float64Array(24),
    pipeGather: {}, bgGather: {}, uniGather: d.createBuffer({ size: 16 }),
    bufGather: { data: new Uint8Array(gather.buffer) }, bufGatherRead: d.createBuffer({ size: n * 16 }),
  });
  return t;
}
function touchedRows(t) {
  const k = new Uint32Array(t.uniRefinePatch.data.buffer)[0];
  const ops = new Uint32Array(t.bufPatchOps.data.buffer, 0, k * 4);
  const vals = new Float32Array(t.bufPatchVals.data.buffer, 0, k * 16);
  const m = new Map();
  for (let j = 0; j < k; j++) m.set(ops[j * 4], vals.subarray(j * 16, j * 16 + 16));
  return m;
}

// ---- 2. AbsGS büyüme havuzu ---------------------------------------------
{
  const t = makeTrainer({ moveCap: 1, absGrad: 1 });
  const n0 = t.n;
  const res = await t._refineLegacy(makeRng(99));
  assert.equal(res.moved, 20, 'taşıma etkilenmemeli');
  assert.ok(res.grown > 0 && res.grown <= 40, `büyüme aday sayısıyla sınırlı olmalı (grown ${res.grown})`);
  const rows = touchedRows(t);
  let relocNeg = 0;
  for (let i = 0; i < 20; i++) if (rows.get(i)[0] < 0) relocNeg++;
  assert.ok(relocNeg > 0, 'taşıma düşük |grad| donörlerini de kullanmalı');
  for (let k = 0; k < res.grown; k++) assert.ok(rows.get(n0 + k)[0] > 500, 'büyüme yalnız yüksek |grad| donörlerinden');
  // growRegion ile kesişim: bölge x<0 (yalnız düşük |grad|) -> aday yok -> büyüme yok
  const warns = []; const w = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  try {
    const t2 = makeTrainer({ moveCap: 1, absGrad: 1, growRegion: (x) => x < 0 });
    const r2 = await t2._refineLegacy(makeRng(5));
    assert.equal(r2.grown, 0); assert.equal(r2.moved, 20);
  } finally { console.warn = w; }
  assert.equal(warns.length, 1);
  console.log(`OK 2/3: absGrad büyümeyi yüksek |grad| donörlerine kısıtlıyor (grown ${res.grown}, taşıma ${res.moved})`);
}

// ---- 3. sert bütçe -------------------------------------------------------
{
  const t = makeTrainer({ moveCap: 1, absGrad: 1, growRegion: (x) => x > 0 }, 3);
  const r = await t._refineLegacy(makeRng(1));
  assert.equal(r.grown, 3, 'cap-n kadar büyümeli'); assert.equal(t.n, t.cap);
  const full = makeTrainer({ moveCap: 1, absGrad: 1, growRegion: (x) => x > 0 }, 0);
  const rf = await full._refineLegacy(makeRng(1));
  assert.equal(rf.grown, 0, 'cap doluyken büyüme yok'); assert.equal(rf.moved, 20, 'cap doluyken taşıma sürmeli');
  console.log('OK 3/3: sert bütçe growRegion + absGrad ile korunuyor; dolu cap\'te taşıma sürüyor');
}
console.log('gsplat düzenleyicileri: OK');
