// Drives GSTrainer._refineLegacy() (vendor gs/trainer.js) on a pure-CPU stub
// — no GPU, no navigator.gpu, no shader compilation — to verify opts.growRegion
// (Task 2 of docs/plans/2026-09-27-gezinme-4-derinlik-egitimi.md): an optional
// (x, y, z) => boolean that restricts GROWTH donors to a spatial region while
// leaving dead-splat relocation untouched, and leaves behaviour byte-for-byte
// identical to the pre-existing code when the option is undefined.
//
// The trainer is a real GSTrainer instance (Object.create(GSTrainer.prototype)
// — the SAME approach verify-gaussian-ownership.mjs uses for Engine): the
// constructor (_buildPipelines, navigator.gpu) is never called, only the
// fields _refineLegacy/_refinePatch actually read are set by hand, and
// `device` is a tiny fake implementing just the handful of WebGPU calls those
// two methods make (createBuffer/createCommandEncoder/createBindGroup +
// queue.writeBuffer/submit), backed by plain Uint8Arrays. This is possible
// because _refineLegacy's GPU traffic is exactly: one readback of bufParams
// (which we seed with a synthetic scene) and, at the end, _refinePatch's
// writeBuffer of the touched rows' FINAL params — which is also how this
// script observes the outcome, since `params` itself is a local variable the
// method never returns: the "GPU" IS the observation channel, not a mock to
// ignore.
//
// Assertions:
//  1. growRegion = x > 0: relocation still moves every dead splat (some from
//     donors on BOTH sides of the plane, proving relocation draws from the
//     full, unfiltered pool), and every newly GROWN splat's position lands
//     deep inside x > 0 (donors are separated by +-1000 with <0.1 jitter, so
//     landing on the wrong side would be unmistakable).
//  2. growRegion undefined: replay the SAME seeded RNG through the CURRENT
//     _refineLegacy and through the byte-identical function extracted from
//     `git show 876be9e:.../trainer.js` (the last trainer.js before the
//     growRegion patch) — every touched row's final 16
//     params must match exactly, proving RNG consumption and outcome are
//     unchanged when the option is not set.
//  3. growRegion that matches nothing: growth is skipped (grown = 0) with
//     exactly one console.warn, while relocation still runs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STRIDE } from '../src/vendor/splat.js/gs/shaders.js';
import { GSTrainer } from '../src/vendor/splat.js/gs/trainer.js';
import { makeRng } from '../src/vendor/splat.js/sfm/geometry.js';

// _refineLegacy/_refinePatch read these as bare globals (as real WebGPU
// exposes them); the actual numeric values are never inspected by our fake
// device, so any distinct-ish bitmask works.
globalThis.GPUBufferUsage = { MAP_READ: 1, COPY_DST: 2, COPY_SRC: 4, STORAGE: 8, UNIFORM: 16, QUERY_RESOLVE: 32 };
globalThis.GPUMapMode = { READ: 1, WRITE: 2 };

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// ---- fake WebGPU device -----------------------------------------------
function makeDevice() {
  return {
    createBuffer({ size }) {
      const data = new Uint8Array(Math.max(0, size | 0));
      return {
        size, data,
        async mapAsync() {},
        getMappedRange(offset = 0, len) { return data.buffer.slice(offset, offset + (len ?? (data.byteLength - offset))); },
        unmap() {}, destroy() {},
      };
    },
    createBindGroup() { return {}; },
    createCommandEncoder() {
      return {
        copyBufferToBuffer(src, srcOff, dst, dstOff, size) {
          if (size) dst.data.set(src.data.subarray(srcOff, srcOff + size), dstOff);
        },
        beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; },
        finish() { return {}; },
      };
    },
    queue: {
      submit() {},
      writeBuffer(buf, offset, data) {
        const bytes = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset ?? 0, data.byteLength);
        buf.data.set(bytes, offset);
      },
    },
  };
}

// ---- synthetic scene ---------------------------------------------------
// STRIDE-16 rows: [0-2]=xyz [3-5]=log-scale [6-9]=quat [10-12]=unused
// [13]=opacity logit [14-15]=grad accum (zeroed on spawn).
// Donors sit at |x| ~= 1000, split cleanly across the x=0 plane; scale is
// tiny (exp(-4) ~= 0.018) so growth/split jitter (<0.1) can never cross
// the plane — a grown splat's sign of x unambiguously names its donor's side.
const SCALE_LOG = -4;
function buildScene({ deadRows, posDonors, negDonors }) {
  const rows = [];
  for (let i = 0; i < deadRows; i++) rows.push({ x: 0, y: 0, z: 0, opacityLogit: -10 });
  for (let i = 0; i < posDonors; i++) rows.push({ x: 1000 + i, y: 0, z: 0, opacityLogit: Math.log(0.9 / 0.1) });
  for (let i = 0; i < negDonors; i++) rows.push({ x: -1000 - i, y: 0, z: 0, opacityLogit: Math.log(0.9 / 0.1) });
  const n = rows.length;
  const f32 = new Float32Array(n * STRIDE);
  rows.forEach((r, i) => {
    const b = i * STRIDE;
    f32[b] = r.x; f32[b + 1] = r.y; f32[b + 2] = r.z;
    f32[b + 3] = SCALE_LOG + (i % 5) * 0.01; f32[b + 4] = SCALE_LOG; f32[b + 5] = SCALE_LOG;
    f32[b + 6] = 1; // identity quaternion
    f32[b + 13] = r.opacityLogit;
  });
  return { f32, n };
}

function makeTrainer(f32, n, opts) {
  const t = Object.create(GSTrainer.prototype);
  t.device = makeDevice();
  t.opts = opts;
  t.iter = 0;
  t.horizon = 10000;
  t.n = n;
  t.cap = n + 200;
  t.growLimit = null;
  t.shK = 0; // no SH: _refinePatch takes its dummy-buffer path, nothing else to stub
  t.maxTiles = 0; // skips the tile-pressure readback entirely
  t.pipeRefinePatch = { getBindGroupLayout: () => ({}) };
  t.bufM = {}; t.bufV = {};
  t.bufParams = { data: new Uint8Array(f32.buffer) };
  t.bufTileCnt = { data: new Uint8Array(0) };
  t.camMeta = []; // .map(...) over [] never touches _camUniform
  t.adamData = new Float64Array(24);
  return t;
}

// Decode the rows _refinePatch's writeBuffer calls actually carried — the
// only place the mutated (local, never-returned) `params` array surfaces.
function decodeTouched(t) {
  const n = new Uint32Array(t.uniRefinePatch.data.buffer)[0];
  const ops = new Uint32Array(t.bufPatchOps.data.buffer, 0, n * 4);
  const vals = new Float32Array(t.bufPatchVals.data.buffer, 0, n * 16);
  const rows = new Map();
  for (let k = 0; k < n; k++) rows.set(ops[k * 4], vals.subarray(k * 16, k * 16 + 16));
  return rows;
}

// ---- extract the pre-growRegion _refineLegacy from a pinned commit ----
// 876be9e = last trainer.js before the growRegion patch (depth loss commit).
const ONCEKI_COMMIT = '876be9e';
const headSrc = execFileSync('git', ['show', `${ONCEKI_COMMIT}:src/vendor/splat.js/gs/trainer.js`], { cwd: repoRoot, encoding: 'utf8' });
const startMarker = '  async _refineLegacy(rng = this.rand) {';
const endMarker = '/** Cheap health probe:';
const startIdx = headSrc.indexOf(startMarker);
const endIdx = headSrc.indexOf(endMarker, startIdx);
assert.ok(startIdx >= 0 && endIdx > startIdx, 'could not locate _refineLegacy in the pinned commit (git show) — update the markers');
const body = headSrc.slice(startIdx, endIdx).trim();
assert.ok(body.endsWith('}'), 'extracted _refineLegacy body does not end at its closing brace');
const params0 = body.indexOf('(rng = this.rand)');
// direct eval (not aliased) keeps this module's lexical scope, so the
// extracted body's one free identifier (STRIDE) resolves to our import.
const oldRefineLegacy = eval(`(async function ${body.slice(params0)})`); // eslint-disable-line no-eval

let scenarioCount = 0;
function scenario() {
  scenarioCount++;
  // 20 dead (moveCap below keeps every one), 40+40 donors split across the
  // plane — enough that "all 20 relocations happened to land on one side"
  // has probability ~2 * 0.5**20 (~2e-6): seeing both signs is not luck.
  return buildScene({ deadRows: 20, posDonors: 40, negDonors: 40 });
}

// ---- 1. growRegion restricts GROWTH, not relocation --------------------
{
  const { f32, n } = scenario();
  const t = makeTrainer(f32, n, { moveCap: 1, growRegion: (x) => x > 0 });
  const rng = makeRng(1234);
  const n0 = t.n;
  const res = await t._refineLegacy(rng);
  assert.equal(res.moved, 20, 'every dead splat should have been relocated (moveCap=1)');
  assert.ok(res.grown > 0, 'growth should have happened (region is non-empty)');
  const touched = decodeTouched(t);

  let relocPos = 0, relocNeg = 0;
  for (let i = 0; i < 20; i++) {
    const v = touched.get(i);
    assert.ok(v, `relocated row ${i} must be in the patch`);
    if (v[0] > 0) relocPos++; else if (v[0] < 0) relocNeg++;
  }
  assert.ok(relocPos > 0 && relocNeg > 0,
    `relocation must still draw from BOTH sides of growRegion's plane (got ${relocPos} pos / ${relocNeg} neg) — ` +
    'growRegion must only narrow growth donors');

  for (let k = 0; k < res.grown; k++) {
    const row = n0 + k;
    const v = touched.get(row);
    assert.ok(v, `grown row ${row} must be in the patch`);
    assert.ok(v[0] > 500, `grown splat ${row} at x=${v[0]} must sit deep in growRegion's x>0 half (donor jitter is <0.1)`);
  }
  console.log(`OK 1/3: growRegion restricts growth only (moved ${res.moved}, grown ${res.grown}, ` +
    `relocation split ${relocPos}/${relocNeg} pos/neg)`);
}

// ---- 2. growRegion undefined => identical to the pre-existing code -----
{
  const seed = 777;
  const sceneA = scenario(); // fresh, independent typed-array copies for each run
  const sceneB = scenario();
  const optsNoRegion = { moveCap: 1 };
  const tOld = makeTrainer(sceneA.f32, sceneA.n, optsNoRegion);
  const tNew = makeTrainer(sceneB.f32, sceneB.n, optsNoRegion);

  const resOld = await oldRefineLegacy.call(tOld, makeRng(seed));
  const resNew = await tNew._refineLegacy(makeRng(seed));

  assert.equal(resNew.moved, resOld.moved, 'moved count must match the pre-existing code');
  assert.equal(resNew.grown, resOld.grown, 'grown count must match the pre-existing code');
  assert.equal(resNew.n, resOld.n, 'n must match the pre-existing code');

  const rowsOld = decodeTouched(tOld);
  const rowsNew = decodeTouched(tNew);
  assert.equal(rowsNew.size, rowsOld.size, 'the same set of rows must be touched');
  assert.ok(rowsOld.size > 0, 'this scenario must actually touch rows (or the comparison is vacuous)');
  for (const [row, vOld] of rowsOld) {
    const vNew = rowsNew.get(row);
    assert.ok(vNew, `row ${row} touched by the old code must also be touched by the new code`);
    for (let k = 0; k < 16; k++) {
      assert.equal(vNew[k], vOld[k], `row ${row} slot ${k}: new=${vNew[k]} old=${vOld[k]} (RNG-driven divergence)`);
    }
  }
  console.log(`OK 2/3: growRegion undefined reproduces the pre-existing code exactly ` +
    `(${rowsOld.size} touched rows, moved ${resOld.moved}, grown ${resOld.grown})`);
}

// ---- 3. growRegion matching nothing skips growth, once-logged, reloc OK ----
{
  const { f32, n } = scenario();
  const t = makeTrainer(f32, n, { moveCap: 1, growRegion: () => false });
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  let res;
  try {
    res = await t._refineLegacy(makeRng(4242));
  } finally {
    console.warn = origWarn;
  }
  assert.equal(res.grown, 0, 'growth must be skipped when growRegion matches no donor');
  assert.equal(res.moved, 20, 'relocation must still run when growth is skipped');
  assert.equal(warnings.length, 1, `expected exactly one warning, got ${warnings.length}: ${JSON.stringify(warnings)}`);
  assert.match(warnings[0], /growRegion/);
  console.log(`OK 3/3: empty growRegion skips growth (moved ${res.moved}, grown ${res.grown}, 1 warning logged)`);
}

console.log(`growRegion densification hook: OK (${scenarioCount} scenarios)`);
