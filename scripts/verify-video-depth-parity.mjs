// Live video depth must stay on the reference pipeline pipeline (user decision 2026-10-25):
// subject crop on, Detaylı sizes (252 playing / 378 paused), the same post-process
// chain and order, fixed per-frame range EMA, and the App defaults that keep the
// offline/VDA/flow/edge paths out of the default look.
// Golden values were produced by the reference pipeline's own liveDepth.ts on the same
// synthetic input (`node scripts/verify-video-depth-parity.mjs --golden <ref repo>`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const W = 48, H = 36;
function sequence() {
  const frames = [];
  for (let t = 0; t < 4; t++) {
    const raw = new Float32Array(W * H), lum = new Float32Array(W * H), mask = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, r = Math.hypot(x - 24 - t, y - 18);
      const subject = r < 11;
      mask[i] = subject ? 1 : 0;
      raw[i] = (subject ? 6 + 2 * Math.cos(r / 4) : 2 + y / H) + 0.05 * Math.sin(1.7 * x + 2.3 * y + t);
      lum[i] = 0.3 + 0.4 * ((x * 7 + y * 3 + t * 5) % 11) / 11;
    }
    frames.push({ raw, lum, mask });
  }
  return frames;
}
function run(mod) {
  mod.resetLiveDepthState();
  return sequence().map(({ raw, lum, mask }, t) => {
    const d = mod.depthResultFromTensor([H, W], raw, mask, lum, null, t / 10).data;
    let sum = 0; for (const v of d) sum += v;
    return [+sum.toFixed(4), +d[18 * W + 24].toFixed(5), +d[5 * W + 5].toFixed(5), +d[18 * W + 34].toFixed(5)];
  });
}

const goldenArg = process.argv.indexOf('--golden');
if (goldenArg > 0) {
  const pd = await import(pathToFileURL(resolve(process.argv[goldenArg + 1], 'src/engine/vision/liveDepth.ts')).href);
  console.log(JSON.stringify(run(pd)));
  process.exit(0);
}

// reference pipeline liveDepth.ts output (C:\Users\Emre\Desktop\reference build, 2026-10-25).
const GOLDEN = [[171.9318, 0.18017, 0.02922, 0.1271], [172.6827, 0.23518, 0.02889, 0.14995], [170.3104, 0.16437, 0.02955, 0.11537], [171.1988, 0.22872, 0.02973, 0.15532]];

const live = await import('../src/engine/vision/liveDepth.ts');
const ours = run(live);
if (GOLDEN) {
  for (let t = 0; t < GOLDEN.length; t++) for (let k = 0; k < GOLDEN[t].length; k++) {
    assert.ok(Math.abs(ours[t][k] - GOLDEN[t][k]) <= 1e-4 * Math.max(1, Math.abs(GOLDEN[t][k])),
      `frame ${t} value ${k}: ${ours[t][k]} vs reference pipeline ${GOLDEN[t][k]}`);
  }
}

// Sizes: the reference pipeline's Detaylı choice is the default.
assert.equal(live.LIVE_INPUT_SIZE, 154);
assert.equal(live.LIVE_PLAYBACK_MAX_INPUT, 252);
assert.equal(live.LIVE_DETAILED_INPUT, 378);
const q = live.createLiveQualityState();
assert.deepEqual([live.liveQualityInputSize(q, false), live.liveQualityInputSize(q, true)], [252, 378]);

// Chain order (reference pipeline): normalize -> temporal -> smooth -> detail -> stretch -> sobel -> limiter x2.
const src = readFileSync(new URL('../src/engine/vision/liveDepth.ts', import.meta.url), 'utf8');
const body = (name) => src.slice(src.indexOf(`export function ${name}(`), src.indexOf('\n}\n', src.indexOf(`export function ${name}(`)));
const inOrder = (text, steps, what) => {
  let at = -1;
  for (const step of steps) {
    const next = text.indexOf(step, at + 1);
    assert.ok(next > at, `${what}: ${step} out of order or missing`);
    at = next;
  }
};
inOrder(body('postProcessLiveDepth'), ['smoothDepthSteps(', 'applyDetail(', 'applyForegroundStretch(', 'applySobelRelief(', 'limitDepthSlope(depth, width, height, mask)', 'limitDepthSlope(icerisi'], 'post-process');
inOrder(body('depthResultFromTensor'), ['kararliNormalize(data)', 'zamansalYumusat(', 'postProcessLiveDepth('], 'tensor chain');
assert.match(src, /const kutu = sm \? canliKirpmaKutusu\(sm\.data, sm\.width, sm\.height, sonKirpmaKutusu\) : null;/, 'subject crop applies to video too');
assert.doesNotMatch(src, /timedRangeAlpha/, 'range EMA is per frame, as in reference pipeline');

// App defaults: mask feeds the post-process while playing; masks come by themselves;
// preparation, VDA, flow interpolation and edge cleanup stay off unless asked for.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(app, /maskeAl: \(\) => segmentRef\.current \? \(videoMask \?\? pausedPreparedMask\(video\.currentTime\)\) : null,/);
assert.match(app, /if \(segmentKapaliRef\.current \|\| iptal \|\| maskBusy/, 'mask capture is automatic unless the user turned separation off');
assert.match(app, /localStorage\.getItem\(VIDEO_PROCESSING_KEY\) === '1'/, 'offline preparation is opt-in');
assert.match(app, /get\('videoHazirla'\) === '1'/);
const engine = readFileSync(new URL('../src/engine/Engine.ts', import.meta.url), 'utf8');
assert.match(engine, /export const VIDEO_EDGE_CLEANUP_DEFAULT = 0;/);
const { vdaIstendi } = await import('../src/engine/vision/videoDepthAnything.ts');
const { liveInterpolationEnabled } = await import('../src/engine/vision/liveDepthFlow.ts');
assert.equal(vdaIstendi(''), false);
assert.equal(liveInterpolationEnabled(''), false);
assert.match(src, /if \(flowClient && isLiveDepthResultStale/, 'stale drop only in the flow experiment');
assert.match(src, /if \(flowClient && previous && raw\.mediaTime > previous\.mediaTime/, 'flow blend only in the flow experiment');

console.log(`OK video depth = reference pipeline pipeline${GOLDEN ? ' (golden output matched)' : ''}`);
