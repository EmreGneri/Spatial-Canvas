// Measurement only: how far the colour the renderer shows is ahead of the
// geometry (depth) it is drawn on, during live video playback.
// node scripts/measure-video-color-depth-lag.mjs <clip.mp4> [more clips] [--seconds 12]
//   [--modes live,araKare,aligned,advance] [--runs 1] [--out reports/video-color-depth-lag.json]
// advance = ?derinlikIlerlet=1 (docs/benchmarks/video-depth-advance.md). Runs are interleaved.
// Headed installed Chrome (tarayiciOturumu chrome+basli): the built-in pane throttles rAF.
// Modes: live (default: realtime VideoTexture colour), araKare (?araKare=1), aligned
// (setRealtimeVideoColor(false): depth-time RGB). Results: reports/video-color-depth-lag.json
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const args = process.argv.slice(2);
const secIdx = args.indexOf('--seconds');
const seconds = secIdx >= 0 ? Number(args.splice(secIdx, 2)[1]) : 12;
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const runs = Number(opt('--runs', 1));
const out = opt('--out', 'reports/video-color-depth-lag.json');
const modeNames = opt('--modes', 'live,araKare,aligned').split(',');
const clips = args;
assert.ok(clips.length, 'Pass at least one local video path');
const MODES = [
  { name: 'live', query: '' },
  { name: 'araKare', query: '?araKare=1' },
  { name: 'aligned', query: '', aligned: true },
  { name: 'advance', query: '?derinlikIlerlet=1' },
].filter(m => modeNames.includes(m.name));

// Tags every ImageData read from a canvas that was drawn from the video with the
// video.currentTime at draw time: that is exactly the mediaTime liveDepth stores.
const instrument = () => {
  const canvasTime = new WeakMap(), tags = new WeakMap();
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
    if (src instanceof HTMLVideoElement) canvasTime.set(this.canvas, src.currentTime);
    else if (canvasTime.has(src)) canvasTime.set(this.canvas, canvasTime.get(src));
    else canvasTime.delete(this.canvas);
    return draw.call(this, src, ...rest);
  };
  const read = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (...rest) {
    const image = read.apply(this, rest);
    if (canvasTime.has(this.canvas)) tags.set(image, canvasTime.get(this.canvas));
    return image;
  };
  window.__lagTags = tags;
};

// Runs in the page. Phase A: cheap timing only. Phase B: adds pixel analysis at ~3 Hz.
const measure = async ({ seconds }) => {
  const e = window.__engine, video = e.videoElement, tags = window.__lagTags;
  const flowModule = await import('/src/engine/vision/liveDepthFlow.ts');
  const AW = 160;
  const pct = (v, q) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
  const summary = v => ({ n: v.length, p50: pct(v, .5), p95: pct(v, .95), mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null });
  const wrapLoop = d => { const dur = video.duration; if (d < -dur / 2) d += dur; if (d > dur / 2) d -= dur; return d; };
  // Bilinear resample of a w*h scalar grid (or RGBA luma) onto AW x AH.
  const resample = (get, w, h, AH) => {
    const out = new Float32Array(AW * AH);
    for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
      const sx = Math.min(w - 1, (x + .5) * w / AW - .5), sy = Math.min(h - 1, (y + .5) * h / AH - .5);
      const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy));
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = Math.max(0, sx - x0), fy = Math.max(0, sy - y0);
      out[y * AW + x] = (get(x0, y0) * (1 - fx) + get(x1, y0) * fx) * (1 - fy) + (get(x0, y1) * (1 - fx) + get(x1, y1) * fx) * fy;
    }
    return out;
  };
  const lumaOf = (rgba, w, h, AH) => resample((x, y) => { const i = (y * w + x) * 4;
    return (.299 * rgba[i] + .587 * rgba[i + 1] + .114 * rgba[i + 2]) / 255; }, w, h, AH);
  const grad = (a, AH) => { const g = new Float32Array(a.length);
    for (let y = 1; y < AH - 1; y++) for (let x = 1; x < AW - 1; x++) { const i = y * AW + x;
      g[i] = Math.hypot(a[i + 1] - a[i - 1], a[i + AW] - a[i - AW]); } return g; };
  // Integer shift (|d|<=R) maximising NCC of a(x) vs b(x+d) over masked pixels.
  const nccShift = (a, b, mask, AH, R = 6) => {
    let best = -2, bx = 0, by = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = R + 1; y < AH - R - 1; y++) for (let x = R + 1; x < AW - R - 1; x++) {
        const i = y * AW + x; if (!mask[i]) continue;
        const va = a[i], vb = b[i + dy * AW + dx];
        n++; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
      }
      if (n < 50) return null;
      const c = (sab - sa * sb / n) / Math.sqrt(Math.max(1e-12, (saa - sa * sa / n) * (sbb - sb * sb / n)));
      if (c > best) { best = c; bx = dx; by = dy; }
    }
    return { dx: bx, dy: by, mag: Math.hypot(bx, by), ncc: best };
  };
  // Per-block SAD displacement of luma a -> b on moving, textured blocks.
  const blockShift = (a, b, mask, AH, B = 12, R = 8) => {
    const mags = [];
    for (let by = R; by + B + R <= AH; by += B) for (let bx = R; bx + B + R <= AW; bx += B) {
      let moving = 0, s = 0, ss = 0;
      for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) { const v = a[y * AW + x]; moving += mask[y * AW + x]; s += v; ss += v * v; }
      if (moving < B * B * .3 || ss / (B * B) - (s / (B * B)) ** 2 < 4e-4) continue;
      let best = Infinity, bestMag = 0, zero = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        let sad = 0;
        for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) sad += Math.abs(a[y * AW + x] - b[(y + dy) * AW + x + dx]);
        if (dx === 0 && dy === 0) zero = sad;
        if (sad < best - 1e-9 || (Math.abs(sad - best) < 1e-9 && Math.hypot(dx, dy) < bestMag)) { best = sad; bestMag = Math.hypot(dx, dy); }
      }
      mags.push(zero - best < 1e-6 ? 0 : bestMag);
    }
    return mags;
  };

  // Edge artefact proxies on the analysis grid. depth is 0..1, so the thresholds are absolute.
  const DEPTH_EDGE = 0.06, LUMA_EDGE = 0.06;
  const edgeStats = (gD, gL, mask, AH) => {
    let edges = 0, unsupported = 0, movingEdges = 0, movingUnsupported = 0;
    for (let y = 3; y < AH - 3; y++) for (let x = 3; x < AW - 3; x++) {
      const i = y * AW + x; if (gD[i] <= DEPTH_EDGE) continue;
      let lumaEdge = false;
      for (let dy = -2; dy <= 2 && !lumaEdge; dy++) for (let dx = -2; dx <= 2; dx++) if (gL[i + dy * AW + dx] > LUMA_EDGE) { lumaEdge = true; break; }
      edges++; if (!lumaEdge) unsupported++;
      if (mask[i]) { movingEdges++; if (!lumaEdge) movingUnsupported++; }
    }
    const area = (AW - 6) * (AH - 6);
    return { density: edges / area, unsupported: edges ? unsupported / edges : 0,
      movingUnsupported: movingEdges ? movingUnsupported / movingEdges : null };
  };
  let analyse = false, depth = null, prevDepth = null, depthCalls = 0, untagged = 0, advanceTagged = 0;
  const original = e.setDepth;
  e.setDepth = function (data, width, height, m1, m2, m3, frame, ...rest) {
    let mediaTime = frame ? tags.get(frame) : undefined;
    // ?derinlikIlerlet=1: geometry was pushed to `target`; the RGB passed is still the model frame,
    // so the analysis warps it with the same field to get the RGB that geometry corresponds to.
    const adv = window.__videoStats.advanceLast?.data === data ? window.__videoStats.advanceLast : null;
    if (adv && mediaTime !== undefined) { mediaTime = adv.target; advanceTagged++; }
    depthCalls++;
    if (mediaTime === undefined) untagged++;
    else {
      const record = { mediaTime, at: performance.now() };
      if (analyse) {
        const AH = Math.round(AW * height / width);
        record.AH = AH;
        record.depth = resample((x, y) => data[y * width + x], width, height, AH);
        record.luma = lumaOf(adv ? flowModule.advanceByField(frame.data, frame.width, frame.height, 4, adv.field, adv.k) : frame.data,
          frame.width, frame.height, AH);
      }
      prevDepth = depth; depth = record;
    }
    return original.call(this, data, width, height, m1, m2, m3, frame, ...rest);
  };
  let presented = null;
  const onFrame = (_, meta) => { presented = meta.mediaTime; handle = video.requestVideoFrameCallback(onFrame); };
  let handle = video.requestVideoFrameCallback(onFrame);
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });

  const phase = async (withAnalysis) => {
    analyse = withAnalysis; depth = prevDepth = null; depthCalls = untagged = advanceTagged = 0;
    const interp0 = window.__videoStats.interpolatedApplied;
    const adv0 = { ...window.__videoStats };
    const lag = [], stale = [], frameMs = [], edgeShown = [], edgeAligned = [], block = [], motionFrac = [];
    const edgeDensity = [], edgeUnsupported = [], edgeMovingUnsupported = [];
    let frames = 0, videoFrames = 0, lastT = null, lastAnalysis = 0;
    const end = performance.now() + seconds * 1000, start = performance.now();
    await new Promise(done => {
      const tick = (now) => {
        frames++; if (lastT !== null) frameMs.push(now - lastT); lastT = now;
        const tex = e.pointsMaterial.uniforms.uImageTexture.value;
        const live = !!tex?.isVideoTexture;
        if (live) videoFrames++;
        if (depth && presented !== null && !video.paused && !video.seeking) {
          const colourT = live ? presented : depth.mediaTime;
          const l = wrapLoop(colourT - depth.mediaTime) * 1000;
          if (Math.abs(l) < 1000) { lag.push(l); stale.push(wrapLoop(video.currentTime - colourT) * 1000); }
          if (withAnalysis && depth.depth && prevDepth?.luma?.length === depth.luma.length && now - lastAnalysis > 330 && Math.abs(l) < 1000) {
            lastAnalysis = now;
            const AH = depth.AH;
            let shown = depth.luma;
            if (live) {
              canvas.width = AW; canvas.height = AH;
              ctx.drawImage(video, 0, 0, AW, AH);
              const px = ctx.getImageData(0, 0, AW, AH).data;
              shown = new Float32Array(AW * AH);
              for (let i = 0; i < shown.length; i++) shown[i] = (.299 * px[i * 4] + .587 * px[i * 4 + 1] + .114 * px[i * 4 + 2]) / 255;
            }
            // Moving pixels: luma changed between consecutive depth frames (dilated 1 px).
            const raw = new Uint8Array(AW * AH), mask = new Uint8Array(AW * AH);
            for (let i = 0; i < raw.length; i++) raw[i] = Math.abs(depth.luma[i] - prevDepth.luma[i]) > .06 ? 1 : 0;
            let count = 0;
            for (let y = 1; y < AH - 1; y++) for (let x = 1; x < AW - 1; x++) { const i = y * AW + x;
              mask[i] = raw[i] | raw[i - 1] | raw[i + 1] | raw[i - AW] | raw[i + AW]; count += mask[i]; }
            motionFrac.push(count / mask.length);
            if (count / mask.length > .01) {
              const gD = grad(depth.depth, AH), gS = grad(shown, AH);
              const es = edgeStats(gD, gS, mask, AH);
              edgeDensity.push(es.density); edgeUnsupported.push(es.unsupported);
              if (es.movingUnsupported !== null) edgeMovingUnsupported.push(es.movingUnsupported);
              const s1 = nccShift(gD, gS, mask, AH), s0 = nccShift(gD, grad(depth.luma, AH), mask, AH);
              if (s1 && s0) { edgeShown.push(s1.mag); edgeAligned.push(s0.mag); }
              block.push(...blockShift(depth.luma, shown, mask, AH));
            }
          }
        }
        if (now < end) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    const elapsed = (performance.now() - start) / 1000;
    const interpolated = window.__videoStats.interpolatedApplied - interp0;
    const pxScale = video.videoWidth / AW;
    const toSrc = v => v.map(x => x * pxScale);
    const stats = window.__videoStats, advApplied = stats.advanceApplied - adv0.advanceApplied;
    return { elapsedS: elapsed, renderFps: frames / elapsed, frameMs: { ...summary(frameMs), p99: pct(frameMs, .99) },
      longFramesOver25ms: frameMs.filter(v => v > 25).length, longFramesPerMin: frameMs.filter(v => v > 25).length / elapsed * 60,
      advance: { applied: advApplied, fallbacks: stats.advanceFallbacks - adv0.advanceFallbacks, setDepthWithTarget: advanceTagged,
        meanWarpMs: advApplied ? (stats.advanceMs - adv0.advanceMs) / advApplied : null,
        meanFlowCoverage: advApplied ? (stats.advanceCoverage - adv0.advanceCoverage) / advApplied : null,
        meanSteps: advApplied ? (stats.advanceSteps - adv0.advanceSteps) / advApplied : null },
      videoTextureShareOfFrames: videoFrames / Math.max(1, frames),
      depthHz: depthCalls / elapsed, modelHz: (depthCalls - interpolated) / elapsed, interpolatedHz: interpolated / elapsed,
      untaggedDepthCalls: untagged, colourMinusDepthMs: summary(lag), shownColourAgeVsClockMs: summary(stale),
      ...(withAnalysis ? { analysisGridPx: AW, sourcePxPerGridPx: pxScale, motionFraction: summary(motionFrac),
        blockDisplacementSrcPx: summary(toSrc(block)), edgeShiftShownSrcPx: summary(toSrc(edgeShown)),
        edgeShiftAlignedBaselineSrcPx: summary(toSrc(edgeAligned)),
        depthEdgeDensity: summary(edgeDensity), depthEdgeWithoutShownLumaEdge: summary(edgeUnsupported),
        movingDepthEdgeWithoutShownLumaEdge: summary(edgeMovingUnsupported) } : {}) };
  };
  try {
    const timing = await phase(false);
    const pixels = await phase(true);
    return { timing, pixels, video: [video.videoWidth, video.videoHeight, video.duration] };
  } finally { e.setDepth = original; video.cancelVideoFrameCallback(handle); }
};

const results = [];
for (let run = 1; run <= runs; run++) for (const clip of clips) for (const mode of MODES) {
  const session = await tarayiciOturumu({ chrome: true, basli: true,
    vite: { server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } } });
  const page = session.page, errors = [], remote = [];
  let timeout;
  try {
    page.setDefaultTimeout(90000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**', route => { remote.push(route.request().url()); return route.abort(); });
    await page.addInitScript(instrument);
    await page.goto(session.url('/' + mode.query), { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => window.__engine);
    const adapter = await page.evaluate(async () => { const a = await navigator.gpu?.requestAdapter();
      return a ? { vendor: a.info?.vendor, architecture: a.info?.architecture, description: a.info?.description } : null; });
    await page.locator('input[accept="image/*,video/*"]').setInputFiles(clip);
    await page.getByLabel('Canlı derinlik ölçümü').filter({ hasText: /\d+ ms/ }).waitFor();
    if (mode.aligned) await page.evaluate(() => window.__engine.setRealtimeVideoColor(false));
    await page.waitForTimeout(6000); // model warm-up, first mask
    const result = await Promise.race([page.evaluate(measure, { seconds }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error(`${mode.name} timed out`)), (seconds * 2 + 60) * 1000); })]);
    const row = { run, clip: basename(clip), mode: mode.name, adapter, browser: 'installed Chrome, headed (playwright-core)', ...result, errors, remote };
    results.push(row);
    const t = result.timing, p = result.pixels;
    console.log(run, row.clip, mode.name, JSON.stringify({ fps: t.renderFps.toFixed(1), long: t.longFramesOver25ms, p99: t.frameMs.p99?.toFixed(1),
      adv: t.advance, edgeUnsup: p.depthEdgeWithoutShownLumaEdge?.p50, density: p.depthEdgeDensity?.p50,
      depthHz: t.depthHz.toFixed(2), modelHz: t.modelHz.toFixed(2),
      lagP50: t.colourMinusDepthMs.p50, lagP95: t.colourMinusDepthMs.p95, block: p.blockDisplacementSrcPx, edge: p.edgeShiftShownSrcPx,
      edgeBase: p.edgeShiftAlignedBaselineSrcPx, untagged: t.untaggedDepthCalls }));
  } catch (err) {
    console.error(basename(clip), mode.name, 'FAILED', err.message);
    results.push({ run, clip: basename(clip), mode: mode.name, failed: err.message, errors });
  } finally { clearTimeout(timeout); await session.kapat(); }
}
mkdirSync('reports', { recursive: true });
writeFileSync(out, JSON.stringify({ seconds, runs, results }, null, 2));
console.log('WROTE', out);
