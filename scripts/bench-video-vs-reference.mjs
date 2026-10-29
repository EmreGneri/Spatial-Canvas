// Measurement only: ours vs the reference build on the SAME local clip, same Chrome, same window, same
// inference backend (browser WebGPU; the 127.0.0.1:8765 sidecar is blocked unless a cell asks for it).
//   node scripts/bench-video-vs-reference.mjs <clip> <reference-root> [--runs 3] [--seconds 20]
//     [--phases live,masks,compose] [--cells ours,reference] [--out reports/video-vs-reference-dev.json]
//   node scripts/bench-video-vs-reference.mjs --selftest
// live:    upload -> first model depth / first masked frame, playback frame times, depth Hz,
//          applied-mask age and IoU vs the app's own mask model run on the exact presented frame.
// masks:   each app's production mask model on the same sampled frames (task d).
// compose: side-by-side PNGs under reports/vvp/ from the saved masks + app screenshots.
// Headed installed Chrome (the built-in pane throttles rAF). Before every run it waits for a quiet
// machine (no `npm run verify` / verify-* node process, CPU < --max-cpu (default 40 %)) and records the load it saw.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';
// Same for both apps: an occluded/unfocused headed window gets 1 Hz timers and throttled rAF on Windows,
// which looked like a 1 Hz depth loop in a pilot. These switches keep the measurement window unthrottled.
process.env.TARAYICI_EK_BAYRAKLAR ??= '--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling';

// ---------- mask maths (node side; self-tested) ----------
const MW = 144, MH = 256; // applied-mask grid (portrait 9:16), 1 cell = 7.5 source px on 1080x1920
export const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k] & b[k]; u += a[k] | b[k]; } return u ? i / u : 1; };
const edges = (m, w, h) => { const e = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = y * w + x, v = m[k];
    if ((x > 0 && m[k - 1] !== v) || (x < w - 1 && m[k + 1] !== v) || (y > 0 && m[k - w] !== v) || (y < h - 1 && m[k + w] !== v)) e[k] = 1; }
  return e; };
const dilate = (m, w, h, r) => { const t = new Uint8Array(m.length), o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let d = -r; d <= r && !v; d++) { const xx = x + d; if (xx >= 0 && xx < w) v = m[y * w + xx]; } t[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let d = -r; d <= r && !v; d++) { const yy = y + d; if (yy >= 0 && yy < h) v = t[yy * w + x]; } o[y * w + x] = v; }
  return o; };
/** Boundary F-measure with a (2r+1)^2 tolerance window. */
export const boundaryF = (a, b, w, h, r) => {
  const ea = edges(a, w, h), eb = edges(b, w, h), da = dilate(ea, w, h, r), db = dilate(eb, w, h, r);
  let na = 0, nb = 0, pa = 0, pb = 0;
  for (let k = 0; k < a.length; k++) { na += ea[k]; nb += eb[k]; pa += ea[k] & db[k]; pb += eb[k] & da[k]; }
  if (!na && !nb) return 1; if (!na || !nb) return 0;
  const P = pa / na, R = pb / nb; return P + R ? 2 * P * R / (P + R) : 0; };
const shiftOf = (m, w, h, dx, dy) => { const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = x - dx, sy = y - dy; if (sx >= 0 && sx < w && sy >= 0 && sy < h) o[y * w + x] = m[sy * w + sx]; } return o; };
const half = (m, w, h) => { const o = new Uint8Array((w >> 1) * (h >> 1));
  for (let y = 0; y < h >> 1; y++) for (let x = 0; x < w >> 1; x++) o[y * (w >> 1) + x] = m[2 * y * w + 2 * x]; return o; };
/** A new applied mask that is a pure translation of the previous one is the app's cheap shift, not a model refresh. */
export const isTranslation = (prev, cur, w, h, R = 16) => {
  const a = half(prev, w, h), b = half(cur, w, h), hw = w >> 1, hh = h >> 1;
  let best = 0, bdx = 0, bdy = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const v = iou(shiftOf(a, hw, hh, dx, dy), b); if (v > best) { best = v; bdx = dx; bdy = dy; } }
  return (bdx || bdy) && best > 0.985 && iou(a, b) < best - 0.003;
};
const b64 = s => new Uint8Array(Buffer.from(s, 'base64'));
const pct = (v, q) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
const stats = v => ({ n: v.length, p50: pct(v, .5), p5: pct(v, .05), p95: pct(v, .95), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null });

if (process.argv.includes('--selftest')) {
  const w = 64, h = 64, sq = (x0, y0) => { const m = new Uint8Array(w * h); for (let y = y0; y < y0 + 20; y++) for (let x = x0; x < x0 + 20; x++) m[y * w + x] = 1; return m; };
  const a = sq(10, 10), b = sq(16, 10);
  assert.equal(iou(a, a), 1); assert.ok(Math.abs(iou(a, b) - 280 / 520) < 1e-9);
  assert.equal(boundaryF(a, a, w, h, 0), 1); assert.ok(boundaryF(a, b, w, h, 0) < .6); assert.equal(boundaryF(a, b, w, h, 6), 1);
  assert.ok(isTranslation(a, b, w, h, 8)); assert.ok(!isTranslation(a, a, w, h, 8));
  const c = sq(10, 10); for (let y = 10; y < 30; y++) for (let x = 30; x < 40; x++) c[y * w + x] = 1; // grew: refresh, not shift
  assert.ok(!isTranslation(a, c, w, h, 8));
  console.log('selftest OK'); process.exit(0);
}

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const runs = Number(opt('--runs', 3)), seconds = Number(opt('--seconds', 20)), MAX_CPU = Number(opt('--max-cpu', 40)), MAX_GPU = Number(opt('--max-gpu', 100));
const phases = opt('--phases', 'live,masks,compose').split(',');
const cellNames = opt('--cells', 'ours,reference').split(',');
const out = opt('--out', 'reports/video-vs-reference-dev.json');
const crops = JSON.parse(opt('--crops', '[]')); // compose: [{f, crop:[x,y,w,h], zoom, tag}]
const [clip, referenceRoot] = args;
assert.ok(clip && referenceRoot, 'Pass <clip> <reference-root>');
const OURS = process.cwd(), REFERENCE = resolve(referenceRoot);
const IMG_T = Number(opt('--img-t', 12.0)); // paused frame for the render screenshots
mkdirSync('reports/vvp', { recursive: true });
const report = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
const save = () => writeFileSync(out, JSON.stringify(report, null, 2));

// ---------- machine load ----------
const cpuBusy = async (ms) => { const t = () => cpus().reduce((s, c) => { const v = c.times; s.idle += v.idle; s.all += v.user + v.nice + v.sys + v.irq + v.idle; return s; }, { idle: 0, all: 0 });
  const a = t(); await new Promise(r => setTimeout(r, ms)); const b = t(); return Math.round(100 * (1 - (b.idle - a.idle) / (b.all - a.all))); };
const competitors = () => { try {
  return execFileSync('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'run verify|scripts[\\\\/]verify-|bench-(?!video-vs-reference)' } | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }"],
  { encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(s => s && !s.startsWith(`${process.pid} `)); } catch { return ['<query failed>']; } };
const gpuUtil = () => { try { return Number(execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim()); } catch { return null; } };
async function quietGate() {
  const started = Date.now();
  for (;;) {
    const comp = competitors(), cpu = await cpuBusy(3000), gpu = gpuUtil();
    if (!comp.length && cpu < MAX_CPU && !(gpu > MAX_GPU)) return { cpuBeforePct: cpu, gpuBeforePct: gpu, waitedS: Math.round((Date.now() - started) / 1000) };
    if (Date.now() - started > 20 * 60_000) return { cpuBeforePct: cpu, gpuBeforePct: gpu, waitedS: Math.round((Date.now() - started) / 1000), gateTimedOut: true, competitors: comp };
    console.log(`busy (cpu ${cpu} %, gpu ${gpu} %, ${comp.length} competing node procs) — waiting 60 s`);
    await new Promise(r => setTimeout(r, 60_000));
  }
}

// ---------- in-page instrumentation (both apps expose window.__engine in DEV) ----------
const instrument = ({ MW, MH }) => {
  const L = window.__bench = { t0: null, frames: [], depth: [], masks: [], draws: [], presented: null, firstModel: null, firstMasked: null,
    firstModelRendered: null, firstMaskedRendered: null, lastMask: null };
  document.addEventListener('change', e => { if (e.target?.type === 'file' && L.t0 === null) L.t0 = performance.now(); }, true);
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
    if (src instanceof HTMLVideoElement && Math.max(this.canvas.width, this.canvas.height) >= 600 && !L.offline)
      L.draws.push([performance.now(), this.canvas.width, this.canvas.height, src.currentTime]); // mask-capture sized draws
    return draw.call(this, src, ...rest);
  };
  const tick = () => { const now = performance.now(); L.frames.push(now);
    if (L.firstModel !== null && L.firstModelRendered === null) L.firstModelRendered = now;
    if (L.firstMasked !== null && L.firstMaskedRendered === null) L.firstMaskedRendered = now;
    requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const down = (m, w, h) => { let s = ''; for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    s += m[Math.min(h - 1, Math.floor((y + .5) * h / MH)) * w + Math.min(w - 1, Math.floor((x + .5) * w / MW))] >= .5 ? '\x01' : '\x00'; } return btoa(s); };
  L.down = down;
  let lastData = null, lastMask = null, rvfc = null;
  const iv = setInterval(() => {
    const v = document.querySelector('[aria-label="Kaynak video önizlemesi"] video');
    if (v && v !== rvfc) { rvfc = v; const f = (_, m) => { if (rvfc === v) { L.presented = m.mediaTime; v.requestVideoFrameCallback(f); } }; v.requestVideoFrameCallback(f); }
    const e = window.__engine; if (!e || e.__bench) return; e.__bench = true;
    const orig = e.setDepth;
    e.setDepth = function (data, w, h, mask, mw, mh, ...rest) {
      const now = performance.now();
      if (data !== lastData && !L.offline) { lastData = data;
        const model = /liveDepth\.ts/.test(new Error().stack ?? '');
        L.depth.push([now, w, h, model ? 1 : 0, mask ? 1 : 0, L.presented]);
        if (model && L.firstModel === null) L.firstModel = now;
        if (model && mask && L.firstMasked === null) L.firstMasked = now; }
      if (mask && mask !== lastMask && !L.offline) { lastMask = mask; L.lastMask = { data: mask, w: mw, h: mh };
        L.masks.push({ now, w: mw, h: mh, presented: L.presented, b64: down(mask, mw, mh) }); }
      return orig.call(this, data, w, h, mask, mw, mh, ...rest);
    };
  }, 5);
};

// Window of `seconds` playback; label = the app's own "Canlı derinlik ölçümü" output.
const measureWindow = async ({ seconds }) => {
  const L = window.__bench, video = document.querySelector('[aria-label="Kaynak video önizlemesi"] video');
  const f0 = L.frames.length, d0 = L.depth.length, m0 = L.masks.length, start = performance.now(), samples = [], labels = [];
  await new Promise(done => { const iv = setInterval(() => { const now = performance.now();
    samples.push({ now, t: L.presented, ct: video.currentTime, mask: L.masks.length - 1, paused: video.paused, vis: document.visibilityState, focus: document.hasFocus(),
      sep: !!window.__engine?.objectSeparation });
    if (samples.length % 2) labels.push(document.querySelector('[aria-label="Canlı derinlik ölçümü"]')?.textContent ?? '');
    if (now - start >= seconds * 1000) { clearInterval(iv); done(); } }, 500); });
  const end = performance.now();
  return { start, end, frames: L.frames.slice(f0).filter(t => t <= end), depth: L.depth.slice(d0), masksFrom: m0, samples, labels,
    video: [video.videoWidth, video.videoHeight, video.duration], frameDur: 3 / 89 };
};

// Own production mask model on the exact presented frame of each sample (separate <video>, app paused).
const referencePass = async ({ app, times }) => {
  const L = window.__bench; L.offline = true;
  const appVideo = document.querySelector('[aria-label="Kaynak video önizlemesi"] video'); appVideo.pause();
  const v = document.createElement('video'); v.muted = true; v.src = appVideo.currentSrc || appVideo.src;
  await new Promise((y, n) => { v.onloadeddata = y; v.onerror = n; });
  let run;
  if (app === 'reference') { const { segmentForeground } = await import('/src/engine/reconstruction/segmentation.ts');
    run = async c => { const r = await segmentForeground(c); return { data: r.mask, width: r.width, height: r.height, model: 'rmbg-1.4' }; }; }
  else { const { captureLiveMask } = await import('/src/engine/vision/liveMask.ts'); run = c => captureLiveMask(c); }
  const res = [];
  for (const t of times) {
    const sought = new Promise(y => v.addEventListener('seeked', y, { once: true })); v.currentTime = t + 0.002; await sought;
    const c = document.createElement('canvas');
    const s = app === 'reference' ? 1 : Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight)); // as each app captures
    c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
    c.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, c.width, c.height);
    const t0 = performance.now(); const r = await run(c); const ms = performance.now() - t0;
    res.push({ t, ms, model: r.model, b64: L.down(r.data, r.width, r.height) });
  }
  return res;
};

async function liveRun(cell, run, takeImages) {
  const load = await quietGate();
  const root = cell.root ?? (cell.app === 'reference' ? REFERENCE : OURS);
  // A variant snapshot (junctioned node_modules) gets its own deps cache: never rewrite the shared one.
  const session = await tarayiciOturumu({ chrome: true, basli: true, vite: { root, ...(cell.root && { cacheDir: resolve(cell.root, '.vite') }),
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, ...(cell.root && { fs: { allow: [cell.root, OURS] } }) } } });
  const page = session.page, errors = [], remote = [], sidecar = [];
  try {
    page.setDefaultTimeout(150_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://**', r => { remote.push(r.request().url()); return r.abort(); });
    if (!cell.sidecar) await page.route('http://127.0.0.1:8765/**', r => { sidecar.push(r.request().url()); return r.abort(); });
    await page.addInitScript(instrument, { MW, MH });
    await page.goto(session.url('/'), { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => window.__engine?.__bench);
    const adapter = await page.evaluate(async () => { const a = await navigator.gpu?.requestAdapter(); const hp = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      const i = x => x && [x.info?.vendor, x.info?.architecture, x.info?.description].join('/'); return { default: i(a), highPerformance: i(hp) }; });
    await page.mouse.move(0, 0);
    await page.locator('input[accept="image/*,video/*"]').setInputFiles(clip);
    await page.waitForFunction(() => window.__bench.firstModelRendered !== null, undefined, { timeout: 150_000 });
    // A masked frame may never come (mask rejected / too small -> separation off): measure anyway after 60 s.
    const masked = await page.waitForFunction(() => window.__bench.firstMaskedRendered !== null, undefined, { timeout: 60_000 }).then(() => true, () => false);
    await page.waitForTimeout(3000);
    const cpuWindow = cpuBusy(seconds * 1000 - 500);
    const w = await page.evaluate(measureWindow, { seconds });
    const cpuDuringPct = await cpuWindow, gpuAfterPct = gpuUtil();
    const B = await page.evaluate(() => { const L = window.__bench; return { t0: L.t0, firstModel: L.firstModel, firstModelRendered: L.firstModelRendered,
      firstMasked: L.firstMasked, firstMaskedRendered: L.firstMaskedRendered, masks: L.masks, draws: L.draws, depthHead: L.depth.slice(0, 12) }; });
    // ---- derived ----
    const ft = w.frames.slice(1).map((t, i) => t - w.frames[i]), dur = (w.end - w.start) / 1000;
    const fpsFrom = ms => ms ? 1000 / ms : null;
    const modelDepth = w.depth.filter(d => d[3]);
    const labelMs = w.labels.map(s => /· (\d+) ms/.exec(s)?.[1]).filter(Boolean).map(Number);
    const labelHz = w.labels.map(s => /([\d.]+) derinlik\/sn/.exec(s)?.[1]).filter(Boolean).map(Number);
    const label3d = w.labels.map(s => /3D lag (\d+) ms/.exec(s)?.[1]).filter(Boolean).map(Number);
    // mask installs: refresh vs translation
    const masks = B.masks.map(m => ({ ...m, bin: b64(m.b64) }));
    const captures = B.draws; // [now, w, h, currentTime]
    let prev = null;
    for (const m of masks) { m.kind = prev && isTranslation(prev.bin, m.bin, MW, MH) ? 'shift' : 'refresh';
      const cap = captures.filter(c => c[0] < m.now).at(-1); m.captureT = m.kind === 'refresh' ? cap?.[3] ?? null : prev?.captureT ?? null;
      m.captureWallMs = m.kind === 'refresh' && cap ? m.now - cap[0] : null; prev = m; }
    const inWin = masks.filter(m => m.now >= w.start && m.now <= w.end);
    const refreshes = inWin.filter(m => m.kind === 'refresh');
    const wrap = d => d < 0 ? d + w.video[2] : d; // looping clip: a capture 'after' t means the loop wrapped
    const samples = w.samples.filter(s => s.mask >= 0 && s.t !== null).map(s => ({ ...s, ageMs: masks[s.mask].captureT === null ? null : wrap(s.t - masks[s.mask].captureT) * 1000 }));
    // successive refresh agreement (flicker of the applied stream)
    const refreshIou = []; let lastR = null;
    for (const m of masks.filter(m => m.kind === 'refresh')) { if (lastR) refreshIou.push(iou(lastR.bin, m.bin)); lastR = m; }
    // ---- reference pass: own model on exact presented frame ----
    const pick = samples.filter((_, i) => i % 2 === 0);
    const ref = await page.evaluate(referencePass, { app: cell.app, times: pick.map(s => s.t) });
    const lag = pick.map((s, i) => { const a = masks[s.mask].bin, r = b64(ref[i].b64);
      return { t: s.t, ageMs: s.ageMs, iou: iou(a, r), bf2: boundaryF(a, r, MW, MH, 2), refMs: ref[i].ms, refModel: ref[i].model }; });
    const row = { cell: cell.name, app: cell.app, run, maskedFrameSeen: masked, load: { ...load, cpuDuringWindowPct: cpuDuringPct, gpuAfterPct }, adapter,
      viewport: [1280, 800], sidecarBlocked: !cell.sidecar, sidecarRequestsBlocked: sidecar.length,
      startup: { firstModelDepthMs: B.firstModel - B.t0, firstModelRenderedMs: B.firstModelRendered - B.t0,
        firstMaskedMs: B.firstMasked - B.t0, firstMaskedRenderedMs: B.firstMaskedRendered - B.t0 },
      depthHead: B.depthHead.map(d => ({ atMs: Math.round(d[0] - B.t0), w: d[1], h: d[2], model: d[3], mask: d[4] })),
      playback: { seconds: dur, renderFps: ft.length / dur, frameMs: stats(ft), fpsP50: fpsFrom(pct(ft, .5)), fps1pctLow: fpsFrom(pct(ft, .99)),
        frameP99Ms: pct(ft, .99), longOver25PerMin: ft.filter(x => x > 25).length / dur * 60,
        depthUpdateHz: modelDepth.length / dur, depthSizes: [...new Set(modelDepth.map(d => `${d[1]}x${d[2]}`))],
        labelInferenceMs: stats(labelMs), labelDepthHz: stats(labelHz), label3dLagMs: stats(label3d), lastLabel: w.labels.at(-1) },
      mask: { refreshHz: refreshes.length / dur, appliedUpdateHz: inWin.length / dur, shiftsInWindow: inWin.length - refreshes.length,
        refreshesInWindow: refreshes.length, captureToInstallMs: stats(refreshes.map(m => m.captureWallMs).filter(x => x !== null)),
        ageMs: stats(samples.map(s => s.ageMs).filter(x => x !== null)), ageFrames: stats(samples.map(s => s.ageMs).filter(x => x !== null).map(x => x / (w.frameDur * 1000))),
        iouVsExactFrame: stats(lag.map(x => x.iou)), bf2VsExactFrame: stats(lag.map(x => x.bf2)), successiveRefreshIou: stats(refreshIou),
        refModel: [...new Set(lag.map(x => x.refModel))], refMs: stats(lag.map(x => x.refMs)), maskGrid: [B.masks[0]?.w, B.masks[0]?.h] },
      lagSamples: lag, errors, remote: remote.length,
      maskLog: masks.map(m => ({ atMs: Math.round(m.now - B.t0), kind: m.kind, captureT: m.captureT, presented: m.presented, w: m.w, h: m.h })),
      captures: captures.map(c => [Math.round(c[0] - B.t0), c[1], c[2], c[3]]),
      sampleTimes: w.samples.map(x => [Math.round(x.now - B.t0), x.t, x.ct, x.mask]), hiddenSamples: w.samples.filter(x => x.vis !== 'visible').length, unfocusedSamples: w.samples.filter(x => !x.focus).length };
    row.appLogTail = await page.evaluate(() => document.body.innerText.split('\n').filter(l => /canlı derinlik|mask|maske/i.test(l)).slice(-12));
    row.videoStats = await page.evaluate(() => { const s = window.__videoStats; return s ? { ...s, advanceLast: undefined } : null; });
    // Ours only (App instrumentation): each mask job request -> compute done -> first render, and why refreshes were not asked.
    row.mask.separationOnFraction = w.samples.filter(s => s.sep).length / w.samples.length;
    if (row.videoStats?.maskLog) {
      const jobs = row.videoStats.maskLog.map(j => ({ ...j, atMs: Math.round(j.startAt - B.t0), computeMs: j.doneAt && j.doneAt - j.startAt,
        doneToAppliedMs: j.appliedAt && j.doneAt && j.appliedAt - j.doneAt, inWindow: j.startAt >= w.start && j.startAt <= w.end }));
      row.maskJobs = jobs;
      row.mask.jobsPerS = jobs.filter(j => j.inWindow && !j.dropped).length / dur;
      row.mask.computeMs = stats(jobs.map(j => j.computeMs).filter(x => x !== null));
      row.mask.doneToAppliedMs = stats(jobs.map(j => j.doneToAppliedMs).filter(x => x !== null));
      row.mask.gate = row.videoStats.maskGate;
    }
    if (takeImages) row.images = await screenshots(page, cell.name).catch(e => ({ failed: e.message }));
    console.log(cell.name, run, JSON.stringify({ load: row.load, startup: row.startup, fps: row.playback.fpsP50, low: row.playback.fps1pctLow, p99: row.playback.frameP99Ms,
      long: row.playback.longOver25PerMin, depthHz: row.playback.depthUpdateHz, inf: row.playback.labelInferenceMs.p50, mask: { hz: row.mask.refreshHz, age: row.mask.ageMs.p50, ageP95: row.mask.ageMs.p95,
        iou: row.mask.iouVsExactFrame.p50, sepOn: row.mask.separationOnFraction, jobsPerS: row.mask.jobsPerS, computeMs: row.mask.computeMs?.p50, gate: row.mask.gate } }));
    return row;
  } catch (e) {
    const state = await page.evaluate(() => { const L = window.__bench; return L && { t0: L.t0, firstModel: L.firstModel, firstMasked: L.firstMasked, depth: L.depth.slice(-8), masks: L.masks.length,
      label: document.querySelector('[aria-label="Canlı derinlik ölçümü"]')?.textContent, log: document.body.innerText.slice(-1500) }; }).catch(() => null);
    console.error(cell.name, run, 'FAILED', e.message, JSON.stringify(state)); return { cell: cell.name, run, load, failed: e.message, state, errors };
  } finally { await session.kapat(); }
}

// Paused frame IMG_T: wait for a mask captured on that frame, then the WebGL canvas + applied mask.
async function screenshots(page, name) {
  await page.evaluate(async t => { const L = window.__bench; L.offline = false; L.draws.length = 0;
    const v = document.querySelector('[aria-label="Kaynak video önizlemesi"] video'); v.pause();
    const s = new Promise(y => v.addEventListener('seeked', y, { once: true })); v.currentTime = t; await s; L.seekAt = performance.now(); }, IMG_T);
  // A mask captured on this frame, then either its install or (rejected / too small: separation off) 8 s.
  await page.waitForFunction(t => { const L = window.__bench; const cap = L.draws.find(d => Math.abs(d[3] - t) < .02);
    return cap && ((L.masks.length && L.masks.at(-1).now > cap[0]) || performance.now() - cap[0] > 8000); }, IMG_T, { timeout: 90_000 });
  const maskInstalled = await page.evaluate(t => { const L = window.__bench; const cap = L.draws.find(d => Math.abs(d[3] - t) < .02); return !!(L.masks.length && L.masks.at(-1).now > cap[0]); }, IMG_T);
  // Ours: the job on this frame must have finished (applied, or rejected with separation off).
  const job = await page.waitForFunction(t => { const j = window.__videoStats?.maskLog?.findLast(j => Math.abs(j.mediaTime - t) < .05);
    return !window.__videoStats?.maskLog || (j && j.doneAt !== null && (j.appliedAt !== null || j.separation === false) && { coverage: j.coverage, separation: j.separation }); }, IMG_T, { timeout: 30_000 })
    .then(h => h.jsonValue(), () => null);
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.__engine.controls?.reset()); // same default camera in every cell
  await page.evaluate(() => new Promise(r => { let n = 0; const f = () => ++n >= 60 ? r() : requestAnimationFrame(f); requestAnimationFrame(f); }));
  const canvas = await page.evaluateHandle(() => window.__engine.renderer.domElement);
  const render = `reports/vvp/${name}-render.png`; await canvas.asElement().screenshot({ path: render });
  const maskPng = await page.evaluate(() => { if (!window.__bench.lastMask) return ''; const { data, w, h } = window.__bench.lastMask; const c = document.createElement('canvas'); c.width = w; c.height = h;
    const im = c.getContext('2d').createImageData(w, h); for (let i = 0; i < w * h; i++) { const v = Math.round(255 * data[i]); im.data.set([v, v, v, 255], i * 4); }
    c.getContext('2d').putImageData(im, 0, 0); return c.toDataURL('image/png').split(',')[1]; });
  const mask = `reports/vvp/${name}-applied-mask.png`; writeFileSync(mask, Buffer.from(maskPng, 'base64'));
  const camera = await page.evaluate(() => { const c = window.__engine.camera; return c && [c.position.x, c.position.y, c.position.z, c.fov]; });
  return { render, mask, maskInstalled, job, separation: await page.evaluate(() => !!window.__engine.objectSeparation), camera, t: IMG_T };
}

// ---------- task d: production masks on identical frames ----------
const FD = 3 / 89, frameT = i => (i + 0.5) * FD;
const SPARSE = Array.from({ length: 12 }, (_, i) => Math.round((1.5 + i * 2.8) / FD));
const BURST = Array.from({ length: 10 }, (_, k) => Math.round(9.0 / FD) + k);
const RW = 540, RH = 960;
const maskPage = async ({ which, sidecar, frames, RW, RH, compose, grid }) => {
  const blob = await (await fetch('/__clip')).blob(); const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob);
  await new Promise((y, n) => { v.onloadeddata = y; v.onerror = n; });
  const seek = async t => { const s = new Promise(y => v.addEventListener('seeked', y, { once: true })); v.currentTime = t; await s; };
  const toB64 = (m, w, h) => { let s = ''; for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
    const sx = (x + .5) * w / RW - .5, sy = (y + .5) * h / RH - .5, x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = Math.max(0, sx - x0), fy = Math.max(0, sy - y0);
    const val = (m[y0 * w + x0] * (1 - fx) + m[y0 * w + x1] * fx) * (1 - fy) + (m[y1 * w + x0] * (1 - fx) + m[y1 * w + x1] * fx) * fy;
    s += String.fromCharCode(Math.max(0, Math.min(255, Math.round(val * 255)))); } return btoa(s); };
  if (grid) { // one tile per frame: outside-mask dark grey, label on top
    const tw = RW / 3, th = RH / 3, cols = Math.min(grid.length, 6), c = document.createElement('canvas');
    c.width = tw * cols; c.height = (th + 20) * Math.ceil(grid.length / cols); const g = c.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
    const tmp = document.createElement('canvas'); tmp.width = tw; tmp.height = th; const tg = tmp.getContext('2d', { willReadFrequently: true });
    for (const [k, cell] of grid.entries()) { await seek(cell.t); tg.drawImage(v, 0, 0, tw, th);
      const im = tg.getImageData(0, 0, tw, th), bin = atob(cell.b64);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const a = bin.charCodeAt(Math.floor(y * RH / th) * RW + Math.floor(x * RW / tw)) / 255, i = (y * tw + x) * 4;
        const grey = (im.data[i] + im.data[i + 1] + im.data[i + 2]) / 3 * .25; // outside mask: dark grey
        for (let ch = 0; ch < 3; ch++) im.data[i + ch] = im.data[i + ch] * a + grey * (1 - a); }
      const x0 = (k % cols) * tw, y0 = Math.floor(k / cols) * (th + 20);
      g.putImageData(im, x0, y0 + 20); g.fillStyle = '#eee'; g.font = '13px sans-serif'; g.fillText(cell.label, x0 + 4, y0 + 15); }
    return c.toDataURL('image/png').split(',')[1];
  }
  if (compose) { // compose panels in-page: frame | mask cutouts, plus crops
    const out = [];
    for (const p of compose) { await seek(p.t);
      const cols = p.masks.length + 1, cw = p.crop ? p.crop[2] * p.zoom : RW / 2, ch = p.crop ? p.crop[3] * p.zoom : RH / 2;
      const c = document.createElement('canvas'); c.width = cw * cols; c.height = ch + 24; const g = c.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = !p.crop;
      const [sx, sy, sw, sh] = p.crop ?? [0, 0, v.videoWidth, v.videoHeight];
      g.drawImage(v, sx, sy, sw, sh, 0, 24, cw, ch);
      const tmp = document.createElement('canvas'); tmp.width = v.videoWidth; tmp.height = v.videoHeight; const tg = tmp.getContext('2d'); tg.drawImage(v, 0, 0);
      const frame = tg.getImageData(0, 0, tmp.width, tmp.height);
      p.masks.forEach((m, k) => { const bin = atob(m.b64); const im = new ImageData(new Uint8ClampedArray(frame.data), tmp.width, tmp.height);
        for (let y = 0; y < tmp.height; y++) for (let x = 0; x < tmp.width; x++) { const a = bin.charCodeAt(Math.min(RH - 1, Math.floor(y * RH / tmp.height)) * RW + Math.min(RW - 1, Math.floor(x * RW / tmp.width))) / 255, i = (y * tmp.width + x) * 4;
          im.data[i] = im.data[i] * a + 255 * (1 - a); im.data[i + 1] = im.data[i + 1] * a; im.data[i + 2] = im.data[i + 2] * a + 255 * (1 - a); }
        tg.putImageData(im, 0, 0); g.drawImage(tmp, sx, sy, sw, sh, cw * (k + 1), 24, cw, ch); });
      g.fillStyle = '#eee'; g.font = '14px sans-serif'; ['frame', ...p.masks.map(m => m.label)].forEach((l, k) => g.fillText(`${l}${k ? '' : ` t=${p.t.toFixed(2)}s`}`, cw * k + 6, 17));
      out.push(c.toDataURL('image/png').split(',')[1]); }
    return out;
  }
  let run;
  if (which === 'rmbg') { const { segmentForeground } = await import('/src/engine/reconstruction/segmentation.ts');
    run = async c => { const r = await segmentForeground(c); return { data: r.mask, width: r.width, height: r.height, model: 'rmbg-1.4' }; }; }
  else { const { captureLiveMask } = await import('/src/engine/vision/liveMask.ts'); run = c => captureLiveMask(c); }
  if (sidecar) { // the shared sidecar may be busy (1.5 s health timeout, 30 s cool-down): wait until it lists DAViD
    const { localModelAvailable } = await import('/src/engine/sidecarClient.ts');
    let ok = false;
    for (let k = 0; k < 40 && !(ok = await localModelAvailable('david-mask')); k++) await new Promise(r => setTimeout(r, 5000));
    console.info('sidecar david-mask available:', ok, await fetch('http://127.0.0.1:8765/health').then(r => r.status, e => String(e)));
  }
  const res = [];
  for (let i = -2; i < frames.length; i++) { // two warm-up calls on the first frame
    const t = frames[Math.max(0, i)]; await seek(t);
    const c = document.createElement('canvas'); const s = which === 'rmbg' ? 1 : Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s); c.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, c.width, c.height);
    const t0 = performance.now(); const r = await run(c); const ms = performance.now() - t0;
    let fg = 0; for (const x of r.data) fg += x >= 0.5; // the app's own coverage (native grid, >= 0.5)
    if (i >= 0) res.push({ t, ms, model: r.model, native: [r.width, r.height], cov: fg / r.data.length, b64: toB64(r.data, r.width, r.height) });
  }
  return res;
};
async function maskSession(cfg, payload) {
  const session = await tarayiciOturumu({ chrome: true, basli: true, vite: { root: cfg.root, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } } });
  const page = session.page, errors = [];
  try {
    page.on('pageerror', e => errors.push(e.message));
    if (process.env.VVP_DEBUG) page.on('console', m => console.log('[mask page]', m.type(), m.text().slice(0, 300)));
    await page.route('https://**', r => r.abort());
    if (!cfg.sidecar) await page.route('http://127.0.0.1:8765/**', r => r.abort());
    await page.route('**/__clip', r => r.fulfill({ path: clip, contentType: 'video/quicktime' }));
    await page.route('**/__bench', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>vvp masks</title><body>masks</body>' }));
    await page.goto(session.url('/__bench')); await page.bringToFront();
    return await page.evaluate(maskPage, { ...payload, RW, RH });
  } finally { await session.kapat(); }
}
function maskMetrics(results) {
  const names = Object.keys(results), frames = results[names[0]].map(r => r.t);
  const bin = Object.fromEntries(names.map(n => [n, results[n].map(r => { const s = b64(r.b64), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s[i] >= 128 ? 1 : 0; return o; })]));
  const consensus = frames.map((_, f) => { const o = new Uint8Array(RW * RH); for (let i = 0; i < o.length; i++) { let c = 0; for (const n of names) c += bin[n][f][i]; o[i] = c * 2 > names.length ? 1 : 0; } return o; });
  const sparse = frames.map((t, f) => f).filter(f => f < SPARSE.length), burst = frames.map((t, f) => f).filter(f => f >= SPARSE.length);
  const pair = {}; for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
    const A = names[a], Bn = names[b]; pair[`${A}|${Bn}`] = { iou: stats(sparse.map(f => iou(bin[A][f], bin[Bn][f]))), bf3: stats(sparse.map(f => boundaryF(bin[A][f], bin[Bn][f], RW, RH, 3))) }; }
  const per = Object.fromEntries(names.map(n => [n, {
    msPerFrame: stats(results[n].map(r => r.ms)), model: [...new Set(results[n].map(r => r.model))], native: results[n][0].native,
    coverage: stats(sparse.map(f => bin[n][f].reduce((s, v) => s + v, 0) / (RW * RH))),
    vsConsensusIou: stats(sparse.map(f => iou(bin[n][f], consensus[f]))), vsConsensusBf3: stats(sparse.map(f => boundaryF(bin[n][f], consensus[f], RW, RH, 3))),
    burstConsecutiveIou: stats(burst.slice(1).map(f => iou(bin[n][f - 1], bin[n][f]))) }]));
  const consensusBurst = stats(burst.slice(1).map(f => iou(consensus[f - 1], consensus[f])));
  return { frames, per, pair, consensusBurstConsecutiveIou: consensusBurst };
}

// ---------- profile: CPU self time by function during playback (bottleneck evidence) ----------
async function profileRun(cell) {
  const load = await quietGate();
  const session = await tarayiciOturumu({ chrome: true, basli: true, vite: { root: cell.app === 'reference' ? REFERENCE : OURS, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } } });
  const page = session.page;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('https://**', r => r.abort());
    if (!cell.sidecar) await page.route('http://127.0.0.1:8765/**', r => r.abort());
    await page.addInitScript(instrument, { MW, MH });
    await page.goto(session.url('/'), { waitUntil: 'domcontentloaded' }); await page.bringToFront();
    await page.waitForFunction(() => window.__engine?.__bench);
    await page.locator('input[accept="image/*,video/*"]').setInputFiles(clip);
    await page.waitForFunction(() => window.__bench.firstModel !== null, undefined, { timeout: 150_000 });
    await page.waitForTimeout(8000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
    const d0 = await page.evaluate(() => window.__bench.depth.length);
    await page.waitForTimeout(8000);
    const { profile } = await cdp.send('Profiler.stop');
    const depthCalls = await page.evaluate(d0 => window.__bench.depth.slice(d0).map(d => d[0]), d0);
    const dt = new Map(); profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000));
    const self = new Map(); let total = 0;
    for (const n of profile.nodes) { const ms = dt.get(n.id) ?? 0; total += ms; const f = n.callFrame;
      const key = `${f.functionName || '(anon)'} ${f.url.replace(/^.*?\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`; self.set(key, (self.get(key) ?? 0) + ms); }
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, ms]) => ({ fn: k, ms: Math.round(ms), pct: Math.round(1000 * ms / total) / 10 }));
    const gaps = depthCalls.slice(1).map((t, i) => t - depthCalls[i]);
    const row = { cell: cell.name, load, profiledMs: Math.round(total), depthUpdates: depthCalls.length, depthGapMs: stats(gaps), top };
    console.log(cell.name, 'profile', JSON.stringify({ depthUpdates: row.depthUpdates, gap: row.depthGapMs.p50 }), '\n ' + top.slice(0, 10).map(t => `${t.pct}% ${t.fn}`).join('\n '));
    return row;
  } finally { await session.kapat(); }
}

// ---------- main ----------
const CELLS = { ours: { name: 'ours', app: 'ours' }, reference: { name: 'reference', app: 'reference' },
  'ours-sidecar': { name: 'ours-sidecar', app: 'ours', sidecar: true } };
// --variants base=<dir>,thr=<dir>: extra 'ours' cells served from source snapshots (A/B of one change).
for (const v of (opt('--variants', '') || '').split(',').filter(Boolean)) { const [name, dir] = v.split('='); CELLS[name] = { name, app: 'ours', root: resolve(dir) }; }
report.clip = clip; report.meta ??= { chrome: 'installed Chrome, headed, playwright-core', viewport: [1280, 800], flags: process.env.TARAYICI_EK_BAYRAKLAR };
if (phases.includes('live')) {
  report.live ??= [];
  const first = Number(opt('--first-run', 1)); // resume an interrupted interleave at this run index
  for (let run = first; run < first + runs; run++) {
    const order = cellNames.map(n => CELLS[n]); if (run % 2 === 0) order.reverse(); // interleave, alternate order
    for (const cell of order) { report.live.push(await liveRun(cell, run, run === 1)); save(); }
  }
}
if (phases.includes('profile')) {
  report.profile = [];
  for (const n of cellNames) { report.profile.push(await profileRun(CELLS[n])); save(); }
}
if (phases.includes('masks')) {
  const frames = [...SPARSE, ...BURST].map(frameT), load = await quietGate();
  const configs = [{ key: 'ours-isnet', root: OURS, which: 'ours' }, { key: 'ours-birefnet-david-sidecar', root: OURS, which: 'ours', sidecar: true }, { key: 'reference-rmbg', root: REFERENCE, which: 'rmbg' }];
  const only = opt('--mask-configs', null)?.split(','), rawPath = 'reports/vvp/masks-raw.json';
  const results = only && existsSync(rawPath) ? JSON.parse(readFileSync(rawPath, 'utf8')) : {};
  for (const cfg of configs.filter(c => !only || only.includes(c.key))) { results[cfg.key] = await maskSession(cfg, { which: cfg.which, sidecar: !!cfg.sidecar, frames }); console.log(cfg.key, results[cfg.key].map(r => `${r.model}:${Math.round(r.ms)}`).join(' ')); }
  writeFileSync(rawPath, JSON.stringify(results));
  report.masks = { load, sidecarBackend: 'DirectML (127.0.0.1:8765 /health arkaUc)', ...maskMetrics(results) }; save();
}
// IS-Net (ours, production captureLiveMask, sidecar blocked) every 0.5 s + the two first-capture times of the
// interim runs; prints the app's own coverage and saves a tinted grid of the given times (--grid t1,t2,...).
if (phases.includes('coverage')) {
  const rawPath = 'reports/vvp/coverage-raw.json';
  const frames = [...Array.from({ length: 70 }, (_, i) => 0.25 + i * 0.5), 13.504723, 14.148751];
  const res = existsSync(rawPath) ? JSON.parse(readFileSync(rawPath, 'utf8')) : await maskSession({ root: OURS }, { which: 'ours', frames });
  writeFileSync(rawPath, JSON.stringify(res));
  report.coverage = res.map(r => ({ t: r.t, cov: r.cov, ms: Math.round(r.ms), model: r.model })); save();
  console.log(res.map(r => `${r.t.toFixed(2)}:${(100 * r.cov).toFixed(1)}`).join(' '));
  const want = opt('--grid', null)?.split(',').map(Number);
  if (want) {
    const cells = want.map(t => res.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)).map(r => ({ t: r.t, b64: r.b64, label: `t=${r.t.toFixed(2)}s  IS-Net ${(100 * r.cov).toFixed(1)}%` }));
    const png = await maskSession({ root: OURS }, { grid: cells });
    writeFileSync(opt('--grid-out', 'reports/vvp/coverage-grid.png'), Buffer.from(png, 'base64')); console.log('grid written');
  }
}
if (phases.includes('compose')) {
  const results = JSON.parse(readFileSync('reports/vvp/masks-raw.json', 'utf8')), names = Object.keys(results);
  const panels = [SPARSE[4], BURST[0], SPARSE[9]].map(fr => ({ t: frameT(fr), masks: names.map(n => ({ label: n, b64: results[n].find(r => Math.abs(r.t - frameT(fr)) < 1e-6).b64 })), tag: `full-f${fr}` }));
  for (const c of crops) panels.push({ t: frameT(c.f), crop: c.crop, zoom: c.zoom ?? 2, tag: c.tag, masks: names.map(n => ({ label: n, b64: results[n].find(r => Math.abs(r.t - frameT(c.f)) < 1e-6).b64 })) });
  const pngs = await maskSession({ root: OURS }, { compose: panels });
  pngs.forEach((p, i) => writeFileSync(`reports/vvp/masks-${panels[i].tag}.png`, Buffer.from(p, 'base64')));
  console.log('composed', panels.map(p => p.tag).join(', '));
}
console.log('WROTE', out);
