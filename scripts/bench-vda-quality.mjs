// VDA Small vs V2-small on the live/uploaded-video depth path, visible Chrome.
//   node scripts/bench-vda-quality.mjs [--quick]
// Both models go through estimateDepthLive (bench/vda.html), each in its own
// page load (?videoDerinlik=vda or not). Writes olcum-out/vda/quality.json.
// Synthetic clip: per-frame accuracy (disparity-affine fit per frame) and
// TAE/OPW after ONE affine fit for the whole sequence (so scale flicker
// counts). Real clips have no GT: flow-tracked disparity change is a proxy.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';
import { temporalDepthMetrics } from './vda-temporal-metrics.mjs';
register('./ts-extension-loader.mjs', import.meta.url);
const { gtDerinlik } = await import('../src/bench/sentetikSahne.ts');
const { computeOpticalFlow } = await import('../src/engine/vision/flow.ts');

const quick = process.argv.includes('--quick');
const n = (count) => (quick ? Math.min(count, 12) : count);
const CLIPS = [
  { name: 'sentetik-orman-yolu', clip: '/assets/test-clips/sentetik-orman-yolu.webm', gt: 'assets/test-clips/sentetik-orman-yolu.gt.json', fps: 30, startFrame: 0, stride: 5, count: n(72) },
  { name: 'sentetik-orman-yolu@30fps', clip: '/assets/test-clips/sentetik-orman-yolu.webm', gt: 'assets/test-clips/sentetik-orman-yolu.gt.json', fps: 30, startFrame: 0, stride: 1, count: n(90) },
  { name: 'forest-3679072', clip: '/assets/test-clips/forest-3679072.mp4', fps: 30, startFrame: 30, stride: 5, count: n(60) },
  { name: 'nyc', clip: '/assets/test-clips/nyc.mp4', fps: 30, startFrame: 300, stride: 5, count: n(60) },
];

const f32 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const u8 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

/** Least squares y ≈ a·x + b over pooled (x, y) pairs. */
function fit(pairs) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
  for (const [x, y] of pairs) { sx += x; sy += y; sxx += x * x; sxy += x * y; m++; }
  const a = (m * sxy - sx * sy) / (m * sxx - sx * sx);
  return { a, b: (sy - a * sx) / m };
}
function* disparityPairs(pred, gt) {
  for (let i = 0; i < gt.length; i += 3) if (Number.isFinite(gt[i]) && gt[i] > 0) yield [pred[i], 1 / gt[i]];
}
function toDepth(pred, { a, b }, lo, hi) {
  const out = new Float32Array(pred.length);
  for (let i = 0; i < pred.length; i++) out[i] = 1 / Math.min(1 / lo, Math.max(1 / hi, a * pred[i] + b));
  return out;
}
function accuracy(depth, gt) {
  let rel = 0, d1 = 0, m = 0;
  for (let i = 0; i < gt.length; i++) {
    if (!(gt[i] > 0) || !Number.isFinite(gt[i])) continue;
    rel += Math.abs(depth[i] - gt[i]) / gt[i];
    d1 += Math.max(depth[i] / gt[i], gt[i] / depth[i]) < 1.25 ? 1 : 0; m++;
  }
  return { absRel: rel / m, delta1: d1 / m };
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function luma(rgb, count) {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = (0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]) / 255;
  return out;
}
function bilinear(a, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x))), y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  return (a[y0 * w + x0] * (1 - fx) + a[y0 * w + x1] * fx) * (1 - fy) + (a[y1 * w + x0] * (1 - fx) + a[y1 * w + x1] * fx) * fy;
}
/** No-GT flicker proxy: |Δ disparity| along LK tracks, over the model's sequence median. */
function flowFlicker(frames, key) {
  const all = frames.flatMap((f) => Array.from(f[key].filter((_, i) => i % 7 === 0))).sort((a, b) => a - b);
  const scale = all[all.length >> 1] || 1;
  const samples = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i], { width: w, height: h } = b;
    const points = computeOpticalFlow(luma(a.rgb, w * h), luma(b.rgb, w * h), w, h, { maxCorners: 300 }).filter((p) => p.status === 1);
    for (const p of points) {
      const x1 = p.x + p.u, y1 = p.y + p.v;
      if (x1 < 0 || y1 < 0 || x1 > w - 1 || y1 > h - 1) continue;
      samples.push(Math.abs(bilinear(b[key], w, h, x1, y1) - bilinear(a[key], w, h, p.x, p.y)) / scale);
    }
  }
  return { flowFlicker: mean(samples), flowSamples: samples.length };
}

function evaluate(run, clip) {
  const frames = run.frames.map((f) => ({ ...f, raw: f32(f.raw), chain: f32(f.chain), rgb: u8(f.rgb) }));
  const ms = frames.slice(1).map((f) => f.inferenceMs);
  const result = {
    frames: frames.length, models: [...new Set(frames.map((f) => f.model))], width: frames[0].width, height: frames[0].height,
    inferenceMsMean: mean(ms), inferenceMsP95: ms.sort((a, b) => a - b)[Math.floor(ms.length * 0.95)], hz: 1000 / mean(ms),
    warmupMs: run.warmupMs, jsHeapMB: run.memory && run.memory / 2 ** 20,
  };
  for (const key of ['raw', 'chain']) result[key] = flowFlicker(frames, key);
  if (!clip.gt) return result;
  const gt = JSON.parse(readFileSync(clip.gt, 'utf8'));
  for (const f of frames) {
    const idx = f.presented != null ? Math.round(f.presented * clip.fps) : f.index;
    if (idx !== f.index) console.warn(`${clip.name}: seek landed on frame ${idx}, wanted ${f.index}`);
    const k = gt.kareler[idx];
    const camera = { R: k.R, t: k.tv, f: k.f, cx: k.cx, cy: k.cy, w: gt.w, h: gt.h };
    f.gt = gtDerinlik(camera, f.width, f.height, gt.tohum);
    const sx = f.width / gt.w, sy = f.height / gt.h;
    f.camera = { R: k.R, t: k.tv, f: k.f * sx, fy: k.f * sy, cx: k.cx * sx, cy: k.cy * sy, w: f.width, h: f.height };
    f.rgbF = Float32Array.from(f.rgb, (v) => v / 255);
  }
  let lo = Infinity, hi = 0;
  for (const f of frames) for (const z of f.gt) if (Number.isFinite(z) && z > 0) { lo = Math.min(lo, z); hi = Math.max(hi, z); }
  for (const key of ['raw', 'chain']) {
    const perFrame = frames.map((f) => toDepth(f[key], fit(disparityPairs(f[key], f.gt)), lo, hi));
    const acc = perFrame.map((d, i) => accuracy(d, frames[i].gt));
    const global = fit(frames.flatMap((f) => [...disparityPairs(f[key], f.gt)]));
    const seq = frames.map((f) => ({ camera: f.camera, depth: toDepth(f[key], global, lo, hi), gt: f.gt, rgb: f.rgbF }));
    const temporal = temporalDepthMetrics(seq);
    const perFrameTae = temporalDepthMetrics(frames.map((f, i) => ({ ...seq[i], depth: perFrame[i] }))).tae;
    Object.assign(result[key], {
      absRel: mean(acc.map((a) => a.absRel)), delta1: mean(acc.map((a) => a.delta1)),
      seqAbsRel: mean(seq.map((s) => accuracy(s.depth, s.gt).absRel)),
      tae: temporal.tae, taePerFrameFit: perFrameTae, opwMeters: temporal.opwMeters, opwSamples: temporal.opwSamples,
    });
  }
  return result;
}

mkdirSync('olcum-out/vda', { recursive: true });
const session = await tarayiciOturumu({ chrome: true, basli: true });
const errors = [];
session.page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') { errors.push(`${m.type()}: ${m.text()}`); console.log('[browser]', m.text()); }
});
session.page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
const report = { started: new Date().toISOString(), quick, clips: {} };
try {
  for (const clip of CLIPS) {
    report.clips[clip.name] = { stride: clip.stride, fps: clip.fps };
    for (const mode of ['v2', 'vda']) {
      const before = errors.length;
      await session.page.goto(session.url(`/bench/vda.html?inference=browser${mode === 'vda' ? '&videoDerinlik=vda' : ''}`), { waitUntil: 'load' });
      await session.page.bringToFront();
      await session.page.waitForFunction(() => typeof window.runVdaKiyas === 'function');
      console.log(`${clip.name} ${mode}: running ${clip.count} frames, stride ${clip.stride}`);
      const run = await session.page.evaluate((ayar) => window.runVdaKiyas(ayar), clip);
      const metrics = evaluate(run, clip);
      report.clips[clip.name][mode] = { adapters: run.adapters, visibility: run.visibility, hasFocus: run.hasFocus, video: run.video, errors: errors.slice(before), ...metrics };
      console.log(JSON.stringify({ clip: clip.name, mode, ...metrics }));
      writeFileSync('olcum-out/vda/quality.json', JSON.stringify(report, null, 2));
    }
  }
} finally {
  writeFileSync('olcum-out/vda/quality.json', JSON.stringify(report, null, 2));
  await session.kapat();
}
