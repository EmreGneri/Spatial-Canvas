// The live depth cycle's CPU stages (also shared with the photo path) must stay bit-identical
// when they are made cheaper. Golden SHA-256 hashes of every output on fixed synthetic input
// were produced by the code BEFORE the speedups (`node scripts/verify-depth-cycle-parity.mjs
// --print`); any byte of difference fails. Timings are reported, not asserted.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
const { smoothDepthSteps, limitDepthSlope, applyDetail } = await import('../src/depth.ts');
const live = await import('../src/engine/vision/liveDepth.ts');
const { buildSilhouette } = await import('../src/engine/reconstruction/silhouette.ts');
const { sampleVolumePositions } = await import('../src/engine/reconstruction/sampler.ts');

const hash = (...arrays) => {
  const h = createHash('sha256');
  for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  return h.digest('hex').slice(0, 16);
};
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
/** Depth-like field: background ramp, a near subject blob with a step edge, fine noise, a few spikes. */
function scene(w, h, t = 0) {
  const depth = new Float32Array(w * h), lum = new Float32Array(w * h), mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const r = Math.hypot((x - w * 0.5 - t) / (w * 0.22), (y - h * 0.55) / (h * 0.35));
    const subject = r < 1;
    const arm = x > w * 0.7 && x < w * 0.74 && y > h * 0.2 && y < h * 0.6;
    depth[i] = (subject ? 0.6 + 0.25 * Math.cos(r * 2) : arm ? 0.55 : 0.1 + 0.2 * y / h)
      + 0.01 * Math.sin(1.7 * x + 2.3 * y + t) + 0.004 * (rnd() - 0.5);
    if (rnd() < 0.002) depth[i] += 0.3;
    mask[i] = subject || arm ? (r > 0.9 ? 0.5 + 0.5 * rnd() : 1) : rnd() < 0.01 ? 0.7 : 0.2 * rnd();
    lum[i] = 0.05 + 0.85 * (((x * 7 + y * 3 + t * 5) % 23) / 23) * (subject ? 0.8 : 1);
  }
  return { depth, lum, mask };
}
const SIZES = [[1, 1], [5, 1], [1, 6], [3, 4], [37, 23], [64, 48], [448, 252]];
const results = {};
const put = (key, value) => { results[key] = value; };

for (const [w, h] of SIZES) {
  seed = 7 + w * 31 + h;
  const { depth, lum, mask } = scene(w, h);
  const s = depth.slice(); smoothDepthSteps(s, w, h); put(`smooth ${w}x${h}`, hash(s));
  put(`slope ${w}x${h}`, hash(limitDepthSlope(depth, w, h, null)));
  put(`slope mask ${w}x${h}`, hash(limitDepthSlope(depth, w, h, mask)));
  put(`slope pairs ${w}x${h}`, hash(limitDepthSlope(depth, w, h, mask, 0.02, 3, true)));
  put(`slope pairs nomask ${w}x${h}`, hash(limitDepthSlope(depth, w, h, null, 0.01, 2, true)));
  put(`slope step ${w}x${h}`, hash(limitDepthSlope(depth, w, h, null, 0.003, 6)));
  const d = depth.slice(); applyDetail(d, lum, w, h, 0.05); put(`detail ${w}x${h}`, hash(d));
  for (const m of [null, mask]) {
    const sil = buildSilhouette(depth, w, h, m);
    put(`silhouette ${m ? 'mask' : 'nomask'} ${w}x${h}`, hash(sil.alpha, sil.isForeground, sil.dist));
  }
  // Temporal filter: luma + crop window, no luma, plain depth-only history.
  for (const variant of ['luma', 'window', 'plain']) {
    const st = live.zamansalDurumAc();
    const outs = [];
    for (let t = 0; t < 4; t++) {
      seed = 11 + t * 3 + w;
      const f = scene(w, h, t * 0.7);
      if (t === 2) for (let i = 0; i < f.lum.length; i++) f.lum[i] = Math.min(1, f.lum[i] * 1.1 + 0.02); // exposure change
      const appearance = variant === 'plain' ? undefined : {
        luminance: f.lum, width: w, height: h,
        sourceWindow: variant === 'window' ? { x: 0.1, y: 0.05, w: 0.7, h: 0.8 } : null,
      };
      outs.push(live.zamansalYumusat(f.depth, st, undefined, undefined, appearance).slice());
    }
    put(`temporal ${variant} ${w}x${h}`, hash(...outs));
  }
}

// Whole live chain (temporal -> post-process), with and without a mask, as the app runs it.
for (const [w, h] of [[37, 23], [448, 252]]) {
  for (const withMask of [false, true]) {
    live.resetLiveDepthState();
    const outs = [];
    for (let t = 0; t < 5; t++) {
      seed = 101 + t;
      const f = scene(w, h, t);
      const raw = f.depth.map((v) => 2 + 6 * v);
      outs.push(live.depthResultFromTensor([h, w], raw, withMask ? f.mask : null, f.lum, null, t / 10).data);
    }
    put(`chain ${withMask ? 'mask' : 'nomask'} ${w}x${h}`, hash(...outs));
  }
}

// Point positions (video reference path and photo path) from the same depth.
for (const [w, h] of [[37, 23], [448, 252]]) {
  seed = 5;
  const { depth, mask } = scene(w, h);
  put(`positions video ${w}x${h}`, hash(sampleVolumePositions(depth, w, h, { gridSize: 96, referenceVideo: { aspect: 16 / 9 } })));
  put(`positions video mask ${w}x${h}`, hash(sampleVolumePositions(depth, w, h, { gridSize: 96, referenceVideo: { aspect: 16 / 9 }, foregroundMask: mask })));
  put(`positions photo ${w}x${h}`, hash(sampleVolumePositions(depth, w, h, { gridSize: 96, foregroundMask: mask, photoEdgeCull: true })));
}

if (process.argv.includes('--print')) {
  console.log(JSON.stringify(results, null, 1));
  process.exit(0);
}

// Pre-speedup output (base 5f0b34e).
const GOLDEN = {
  "smooth 1x1": "cb6c12bda079aae5",
  "slope 1x1": "cb6c12bda079aae5",
  "slope mask 1x1": "cb6c12bda079aae5",
  "slope pairs 1x1": "cb6c12bda079aae5",
  "slope pairs nomask 1x1": "cb6c12bda079aae5",
  "slope step 1x1": "cb6c12bda079aae5",
  "detail 1x1": "cb6c12bda079aae5",
  "silhouette nomask 1x1": "777de664af9a01aa",
  "silhouette mask 1x1": "3e7077fd2f66d689",
  "temporal luma 1x1": "a51928323311c721",
  "temporal window 1x1": "a51928323311c721",
  "temporal plain 1x1": "a51928323311c721",
  "smooth 5x1": "11bd88e4ecd7a901",
  "slope 5x1": "7988da0cf95b4932",
  "slope mask 5x1": "2f48badc629ea9a6",
  "slope pairs 5x1": "2f48badc629ea9a6",
  "slope pairs nomask 5x1": "602ddfacfce25e79",
  "slope step 5x1": "254c5d9562f1ab29",
  "detail 5x1": "2f48badc629ea9a6",
  "silhouette nomask 5x1": "3ef0740bc3ab6dee",
  "silhouette mask 5x1": "8a1020634191c27b",
  "temporal luma 5x1": "92a3a1320c0352ae",
  "temporal window 5x1": "fc485ea984187be7",
  "temporal plain 5x1": "9ff1ddb56e9e04df",
  "smooth 1x6": "b72bdf945f8c6c27",
  "slope 1x6": "d108ec7b1fd93d14",
  "slope mask 1x6": "c4bc6c05f60f09a4",
  "slope pairs 1x6": "c4bc6c05f60f09a4",
  "slope pairs nomask 1x6": "c4bc6c05f60f09a4",
  "slope step 1x6": "90d649069e135bae",
  "detail 1x6": "4fb7fdbd4f17dc0d",
  "silhouette nomask 1x6": "cecd11d6d421d934",
  "silhouette mask 1x6": "ea659cdc838619b3",
  "temporal luma 1x6": "675daf1c2585a525",
  "temporal window 1x6": "15447ddd76704ee0",
  "temporal plain 1x6": "15447ddd76704ee0",
  "smooth 3x4": "95d27b888567b41c",
  "slope 3x4": "f3e0bfefaba5a38e",
  "slope mask 3x4": "037b0e7dbf2ed5b1",
  "slope pairs 3x4": "037b0e7dbf2ed5b1",
  "slope pairs nomask 3x4": "ef1e492258d16b3b",
  "slope step 3x4": "9602a72e5e7dac96",
  "detail 3x4": "425a14ef5ea7638f",
  "silhouette nomask 3x4": "63644b533c24ce40",
  "silhouette mask 3x4": "2f4613a17b4971e5",
  "temporal luma 3x4": "6fe922ec7554348e",
  "temporal window 3x4": "1245d404a6102df7",
  "temporal plain 3x4": "20e7e8755d2d5f37",
  "smooth 37x23": "1388838662cda9b0",
  "slope 37x23": "44152edc6a8aa4ea",
  "slope mask 37x23": "f05e8b5741f6afd7",
  "slope pairs 37x23": "d8f22fb14d70f6ad",
  "slope pairs nomask 37x23": "4d4bc36bc4875de2",
  "slope step 37x23": "60f7fefe5e496f70",
  "detail 37x23": "2d53cd787da3c14b",
  "silhouette nomask 37x23": "a50bd31c40fb31c3",
  "silhouette mask 37x23": "19bc40ea42ffa819",
  "temporal luma 37x23": "9d3d3a7eedfe074f",
  "temporal window 37x23": "b21bdb7488ca4ecf",
  "temporal plain 37x23": "55830b99d8772b72",
  "smooth 64x48": "0c98537ec65a3c78",
  "slope 64x48": "5faa089eedf896b1",
  "slope mask 64x48": "c9e0fdb3d4eec8f1",
  "slope pairs 64x48": "670826e0141720c3",
  "slope pairs nomask 64x48": "73836dc329524ada",
  "slope step 64x48": "898004affee6bfd8",
  "detail 64x48": "76ecaae06e7b3409",
  "silhouette nomask 64x48": "8d989d9abffe8e50",
  "silhouette mask 64x48": "b49741dd3ef475d4",
  "temporal luma 64x48": "50e5e049d26fb609",
  "temporal window 64x48": "4ad6db3c594b7233",
  "temporal plain 64x48": "b50a7135a3efae16",
  "smooth 448x252": "3acce6dac2fd9549",
  "slope 448x252": "7cf26942f11eb576",
  "slope mask 448x252": "7cec6d281499751b",
  "slope pairs 448x252": "09b46406aaa4face",
  "slope pairs nomask 448x252": "2c4a4ae9c21224e1",
  "slope step 448x252": "7dea725f17242084",
  "detail 448x252": "a1d61aa5d6a9384a",
  "silhouette nomask 448x252": "79fc6d56da36f45b",
  "silhouette mask 448x252": "f1df10a9d74ffd23",
  "temporal luma 448x252": "14cd2d963738454b",
  "temporal window 448x252": "4f92097fb17096e2",
  "temporal plain 448x252": "bc2b7e1b6c1b1d17",
  "chain nomask 37x23": "1f1e5002a1abfdbd",
  "chain mask 37x23": "587ef1602aa0d710",
  "chain nomask 448x252": "4f4b22825df88eac",
  "chain mask 448x252": "8f929de6988a8ec1",
  "positions video 37x23": "c79757c57cffeda8",
  "positions video mask 37x23": "1c6b169586a16c28",
  "positions photo 37x23": "27d6eb26fd91794e",
  "positions video 448x252": "fdc0dc6c5461ed72",
  "positions video mask 448x252": "6b9d02fe7227bde4",
  "positions photo 448x252": "907ab5413945346b",
};
for (const [key, value] of Object.entries(GOLDEN)) assert.equal(results[key], value, `${key} changed`);
assert.equal(Object.keys(results).length, Object.keys(GOLDEN).length);

// Speed at the live 252 grid (448x252): reported only (machine dependent).
{
  const w = 448, h = 252;
  seed = 9;
  const { depth, lum } = scene(w, h);
  const time = (f) => {
    for (let i = 0; i < 5; i++) f();
    const ms = [];
    for (let i = 0; i < 21; i++) { const t0 = performance.now(); f(); ms.push(performance.now() - t0); }
    return ms.sort((a, b) => a - b)[10].toFixed(2); // median
  };
  const st = live.zamansalDurumAc();
  live.zamansalYumusat(depth.slice(), st, undefined, undefined, { luminance: lum, width: w, height: h });
  console.log(`448x252 ms: smoothDepthSteps ${time(() => smoothDepthSteps(depth.slice(), w, h))}`
    + ` · limitDepthSlope ${time(() => limitDepthSlope(depth, w, h, null))}`
    + ` · zamansalYumusat ${time(() => live.zamansalYumusat(depth.slice(), st, undefined, undefined, { luminance: lum, width: w, height: h }))}`
    + ` · buildSilhouette ${time(() => buildSilhouette(depth, w, h, null))}`
    + ` · sampleVolumePositions ${time(() => sampleVolumePositions(depth, w, h, { referenceVideo: { aspect: 16 / 9 } }))}`);
}
console.log(`verify-depth-cycle-parity: OK · ${Object.keys(GOLDEN).length} outputs bit-identical to the pre-speedup code`);
