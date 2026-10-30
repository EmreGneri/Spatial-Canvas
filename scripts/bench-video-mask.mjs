// Browser-only video mask bench (the 127.0.0.1:8765 sidecar is blocked, so the mask is the
// in-browser path a hosted visitor gets). One fresh headed Chrome per clip and root:
//   pass "cold": empty profile, network throttled (--mbps), upload the clip, measure --seconds;
//   pass "warm": reload the same profile (HTTP cache filled) and upload again.
// Per pass: upload -> first model depth / first mask job / first masked frame; mask age against
// the frame on screen; applied mask vs the same mask model run on the exact frame on screen
// (overlay PNGs under --out; the reference is only trusted on frames checked by eye); depth Hz,
// frame p99, long frames and whether a mask job was in flight during them.
//   node scripts/bench-video-mask.mjs <clip> --root <app-dir> --label base --out <dir> [--seconds 25]
//     [--mbps 100] [--passes cold,warm] [--samples 8]
//   node scripts/bench-video-mask.mjs --selftest
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

process.env.TARAYICI_EK_BAYRAKLAR ??= '--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling';

const pct = (v, q) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
const r1 = (x) => x === null || x === undefined ? null : Math.round(x * 10) / 10;
export const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const x = a[k] >= 128, y = b[k] >= 128; i += x && y; u += x || y; } return u ? i / u : 1; };
/** Mask in effect at `now`: the newest finished, kept and accepted job (both builds log the same shape). */
export const jobAt = (jobs, now) => {
  let best = null;
  for (const j of jobs) if (j.doneAt !== null && j.doneAt <= now && !j.dropped && j.coverage > 0 && j.coverage <= 0.92
    && (!best || j.doneAt > best.doneAt)) best = j;
  return best;
};
/** Media-time age with loop wrap: a source frame "after" the shown one means the clip looped. */
export const ageOf = (shown, source, duration) => { const d = shown - source; return d < -0.05 ? d + duration : d; };

if (process.argv.includes('--selftest')) {
  assert.equal(iou(new Uint8Array([255, 0, 255]), new Uint8Array([255, 255, 0])), 1 / 3);
  const jobs = [{ doneAt: 10, dropped: false, coverage: 0.2, mediaTime: 1 }, { doneAt: 20, dropped: true, coverage: 0.2, mediaTime: 2 },
    { doneAt: 30, dropped: false, coverage: 0.99, mediaTime: 3 }, { doneAt: null, dropped: false, coverage: null, mediaTime: 4 }];
  assert.equal(jobAt(jobs, 35).mediaTime, 1); assert.equal(jobAt(jobs, 5), null);
  assert.equal(ageOf(2, 1.5, 10), 0.5); assert.ok(Math.abs(ageOf(0.5, 9.5, 10) - 1) < 1e-9);
  console.log('selftest OK'); process.exit(0);
}

// --summarize <dir>...: median [min-max] per section, pass and label over every run JSON found.
if (process.argv.includes('--summarize')) {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const files = process.argv.slice(process.argv.indexOf('--summarize') + 1).flatMap(d => statSync(d).isDirectory()
    ? readdirSync(d).filter(f => f.endsWith('.json') && !f.endsWith('-track.json')).map(f => join(d, f)) : [d]);
  const cells = new Map();
  for (const f of files) for (const r of JSON.parse(readFileSync(f, 'utf8')).rows ?? []) {
    if (r.failed) continue;
    const key = `${r.clip.replace(/\.[^.]+$/, '')} ${r.pass} ${r.label}`; (cells.get(key) ?? cells.set(key, []).get(key)).push(r);
  }
  const m = (rows, get) => { const v = rows.map(get).filter(x => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return '-'; const med = v[Math.floor((v.length - 1) / 2)], f = x => Math.round(x * 100) / 100;
    return v.length > 1 ? `${f(med)} [${f(v[0])}-${f(v.at(-1))}]` : `${f(med)}`; };
  const cols = { n: r => 1, firstDepthS: r => r.startup.firstModelDepthS, firstMaskDoneS: r => r.startup.firstMaskDoneS,
    firstMaskedFrameS: r => r.startup.firstMaskedFrameS, maskAgeP50: r => r.steady.maskAgeP50, maskAgeP95: r => r.steady.maskAgeP95,
    iouVsShownFrame: r => r.iouVsExactFrameP50, depthHz: r => r.steady.depthHz, frameP99: r => r.steady.frameP99,
    over50PerMin: r => r.steady.framesOver50PerMin, jobs: r => r.jobs.count, maskedPct: r => r.steady.maskedDepthFraction };
  console.log(['cell', ...Object.keys(cols)].join(' | '));
  for (const [k, rows] of [...cells].sort()) console.log([k, rows.length, ...Object.values(cols).slice(1).map(g => m(rows, g))].join(' | '));
  process.exit(0);
}
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const root = resolve(opt('--root', process.cwd())), label = opt('--label', basename(root)), outDir = resolve(opt('--out', join(tmpdir(), 'bench-video-mask-out')));
const profileS = Number(opt('--profile', 0)), seconds = Number(opt('--seconds', 25)), mbps = Number(opt('--mbps', 100)), nSamples = Number(opt('--samples', 8));
const passes = opt('--passes', 'cold,warm').split(',');
const [clip] = args; assert.ok(clip, 'Pass <clip>');
const tag = `${basename(clip).replace(/\.[^.]+$/, '')}-${label}`;
mkdirSync(outDir, { recursive: true });

const cpuTimes = () => cpus().reduce((s, c) => { const v = c.times; s.idle += v.idle; s.all += v.user + v.nice + v.sys + v.irq + v.idle; return s; }, { idle: 0, all: 0 });
const gpuUtil = () => { try { return Number(execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim()); } catch { return null; } };

// ---------- in-page instrumentation ----------
const instrument = () => {
  const L = window.__vmb = { t0: null, frames: [], loaf: [], depth: [], shown: [], snaps: [], firstModel: null, firstMasked: null, vis: [], snapEvery: 0, snapFrom: Infinity, lastSnap: -Infinity };
  document.addEventListener('change', e => { if (e.target?.type === 'file' && L.t0 === null) L.t0 = performance.now(); }, true);
  const tick = (now) => { L.frames.push(now); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) L.loaf.push({ start: e.startTime, dur: e.duration, block: e.blockingDuration,
    scripts: (e.scripts ?? []).slice(0, 4).map(s => `${Math.round(s.duration)}ms ${s.sourceFunctionName || s.invoker || '?'} ${String(s.sourceURL).replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${s.sourceCharPosition}`) }); })
    .observe({ type: 'long-animation-frame', buffered: true }); } catch { /* no LoAF */ }
  setInterval(() => L.vis.push([document.visibilityState === 'visible', document.hasFocus()]), 500);
  let presented = null, rv = null;
  const down = (m, w, h) => { const W = 180, H = Math.max(1, Math.round(180 * h / w)), o = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o[y * W + x] = Math.round(255 * Math.min(1, Math.max(0, m[Math.min(h - 1, Math.floor((y + .5) * h / H)) * w + Math.min(w - 1, Math.floor((x + .5) * w / W))])));
    let str = ''; for (let i = 0; i < o.length; i += 8192) str += String.fromCharCode(...o.subarray(i, i + 8192));
    return { W, H, b64: btoa(str) }; };
  L.down = down;
  setInterval(() => {
    const v = document.querySelector('[aria-label="Kaynak video önizlemesi"] video');
    if (v && v !== rv) { rv = v; const f = (now, m) => { if (rv !== v) return; presented = m.mediaTime; L.shown.push([now, m.mediaTime]); v.requestVideoFrameCallback(f); }; v.requestVideoFrameCallback(f); }
    const e = window.__engine; if (!e || e.__vmb) return; e.__vmb = true;
    const orig = e.setDepth; let lastData = null;
    e.setDepth = function (data, w, h, mask, mw, mh, ...rest) {
      const now = performance.now();
      if (data !== lastData && L.t0 !== null) { lastData = data;
        const model = /liveDepth\.ts/.test(new Error().stack ?? '');
        L.depth.push([now, model ? 1 : 0, mask ? 1 : 0, presented]);
        if (model && L.firstModel === null) L.firstModel = now;
        if (model && mask && L.firstMasked === null) L.firstMasked = now;
        if (model && now >= L.snapFrom && now - L.lastSnap >= L.snapEvery && presented !== null) { L.lastSnap = now;
          L.snaps.push({ now, shown: presented, sep: !!e.objectSeparation, mask: mask ? down(mask, mw, mh) : null }); } }
      return orig.call(this, data, w, h, mask, mw, mh, ...rest);
    };
  }, 5);
};

// Same mask pipeline as the app (captureLiveMask, 640 px capture) on the exact shown frame + overlay.
const referenceAndOverlay = async ({ snaps }) => {
  const app = document.querySelector('[aria-label="Kaynak video önizlemesi"] video'); app.pause();
  const v = document.createElement('video'); v.muted = true; v.src = app.currentSrc || app.src;
  await new Promise((y, n) => { v.onloadeddata = y; v.onerror = n; });
  const { captureLiveMask } = await import('/src/engine/vision/liveMask.ts');
  const out = [];
  for (const s of snaps) {
    const sought = new Promise(y => v.addEventListener('seeked', y, { once: true })); v.currentTime = s.shown + 0.001; await sought;
    const c = document.createElement('canvas'), sc = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc);
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0, c.width, c.height);
    const r = await captureLiveMask(c), ref = window.__vmb.down(r.data, r.width, r.height);
    // Overlay: outside the APPLIED mask darkened, applied edge red, exact-frame reference edge cyan.
    const W = 360, H = Math.round(360 * c.height / c.width), o = document.createElement('canvas'); o.width = W; o.height = H + 18;
    const og = o.getContext('2d'); og.fillStyle = '#000'; og.fillRect(0, 0, W, H + 18); og.drawImage(c, 0, 18, W, H);
    const im = og.getImageData(0, 18, W, H), A = s.mask ? atob(s.mask.b64) : null, Rf = atob(ref.b64);
    const at = (str, m, x, y) => str.charCodeAt(Math.min(m.H - 1, Math.floor(y * m.H / H)) * m.W + Math.min(m.W - 1, Math.floor(x * m.W / W))) >= 128;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4;
      const a = A ? at(A, s.mask, x, y) : true, edgeA = A && x > 0 && y > 0 && (a !== at(A, s.mask, x - 1, y) || a !== at(A, s.mask, x, y - 1));
      const rr = at(Rf, ref, x, y), edgeR = x > 0 && y > 0 && (rr !== at(Rf, ref, x - 1, y) || rr !== at(Rf, ref, x, y - 1));
      if (!a) for (let k = 0; k < 3; k++) im.data[i + k] *= 0.3;
      if (edgeR) im.data.set([0, 255, 255], i); if (edgeA) im.data.set([255, 40, 40], i); }
    og.putImageData(im, 0, 18); og.fillStyle = '#fff'; og.font = '12px sans-serif';
    og.fillText(`t=${s.shown.toFixed(2)}s mask age ${s.age === null ? '-' : s.age.toFixed(2) + 's'} ${s.sep ? 'sep on' : 'sep off'}`, 4, 13);
    out.push({ ref: ref.b64, refW: ref.W, refH: ref.H, refModel: r.model, png: o.toDataURL('image/png').split(',')[1] });
  }
  return out;
};

async function pass(session, name, cdp) {
  const page = session.page;
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: mbps * 125_000, uploadThroughput: 2_500_000 });
  await page.goto(session.url('/'), { waitUntil: 'domcontentloaded' });
  await page.bringToFront(); await page.mouse.move(0, 0);
  await page.waitForFunction(() => window.__engine?.__vmb, undefined, { timeout: 60_000 });
  const c0 = cpuTimes(); const gpu = [];
  const gpuIv = setInterval(() => gpu.push(gpuUtil()), 2000);
  await page.evaluate(({ every }) => { window.__vmb.snapEvery = every; }, { every: (seconds * 1000 * 0.6) / nSamples });
  await page.locator('input[accept="image/*,video/*"]').setInputFiles(clip);
  // Snapshots spread over the last 60 % of the window (after start-up).
  await page.evaluate(({ s }) => { window.__vmb.snapFrom = window.__vmb.t0 + s * 400; }, { s: seconds });
  let profile = null;
  if (profileS && name === passes.at(-1)) { // CPU self time of the last `profileS` seconds (steady playback)
    await page.waitForTimeout((seconds - profileS) * 1000);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
    await page.waitForTimeout(profileS * 1000);
    profile = (await cdp.send('Profiler.stop')).profile;
  } else await page.waitForTimeout(seconds * 1000);
  clearInterval(gpuIv); const c1 = cpuTimes();
  const L = await page.evaluate(() => { const L = window.__vmb, v = document.querySelector('[aria-label="Kaynak video önizlemesi"] video');
    return { ...L, down: undefined, duration: v?.duration, jobs: window.__videoStats?.maskLog ?? [], gate: window.__videoStats?.maskGate,
      log: document.body.innerText.split('\n').filter(l => /canlı derinlik|mask|nesne ayırma/i.test(l)).slice(-30) }; });
  const t0 = L.t0, end = t0 + seconds * 1000, dur = L.duration;
  const jobs = L.jobs.filter(j => j.startAt >= t0);
  const steadyFrom = (L.firstModel ?? end) + 2000;
  const ft = L.frames.filter(t => t >= steadyFrom && t <= end).map((t, i, a) => i ? t - a[i - 1] : null).slice(1);
  const steadyS = Math.max(0.001, (end - steadyFrom) / 1000);
  const modelDepth = L.depth.filter(d => d[1] && d[0] >= steadyFrom && d[0] <= end);
  const ages = modelDepth.filter(d => d[2] && d[3] !== null).map(d => { const j = jobAt(jobs, d[0]); return j ? ageOf(d[3], j.mediaTime, dur) : null; }).filter(x => x !== null);
  const inJob = (t0x, t1x) => jobs.some(j => j.startAt < t1x && (j.doneAt ?? end) > t0x);
  const loafSteady = L.loaf.filter(e => e.start >= steadyFrom && e.start <= end);
  const longFrames = ft.length ? L.frames.filter(t => t >= steadyFrom && t <= end).map((t, i, a) => i ? [a[i - 1], t] : null).filter(p => p && p[1] - p[0] > 50) : [];
  const jobTime = jobs.reduce((s, j) => s + Math.max(0, Math.min(j.doneAt ?? end, end) - Math.max(j.startAt, steadyFrom)), 0) / 1000;
  const longInJob = longFrames.filter(([a, b]) => inJob(a, b)).length;
  const firstJob = jobs[0], firstOk = jobs.find(j => j.doneAt && !j.dropped && j.coverage > 0 && j.coverage <= 0.92);
  const s = (x) => x === null || x === undefined ? null : r1((x - t0) / 1000);
  // Reference + overlays
  const snaps = L.snaps.filter(x => x.now <= end).map(x => { const j = jobAt(jobs, x.now); return { ...x, age: x.mask && j ? ageOf(x.shown, j.mediaTime, dur) : null }; });
  const refs = await page.evaluate(referenceAndOverlay, { snaps });
  const sampleRows = snaps.map((x, i) => {
    const file = join(outDir, `${tag}-${name}-${String(i).padStart(2, '0')}-t${x.shown.toFixed(2)}.png`);
    writeFileSync(file, Buffer.from(refs[i].png, 'base64'));
    let io = null;
    if (x.mask) { const A = Buffer.from(x.mask.b64, 'base64'), R = Buffer.from(refs[i].ref, 'base64');
      const Rs = new Uint8Array(A.length); for (let y = 0; y < x.mask.H; y++) for (let xx = 0; xx < x.mask.W; xx++)
        Rs[y * x.mask.W + xx] = R[Math.min(refs[i].refH - 1, Math.floor(y * refs[i].refH / x.mask.H)) * refs[i].refW + Math.min(refs[i].refW - 1, Math.floor(xx * refs[i].refW / x.mask.W))];
      io = iou(A, Rs); }
    return { shown: r1(x.shown * 100) / 100, sep: x.sep, masked: !!x.mask, ageS: x.age === null ? null : Math.round(x.age * 100) / 100, iouVsExactFrame: io === null ? null : Math.round(io * 100) / 100, refModel: refs[i].refModel, file };
  });
  const row = {
    pass: name, label, clip: basename(clip), mbps, seconds,
    startup: { firstModelDepthS: s(L.firstModel), firstMaskRequestS: s(firstJob?.startAt), firstMaskDoneS: s(firstJob?.doneAt),
      firstMaskComputeS: firstJob?.doneAt ? r1((firstJob.doneAt - firstJob.startAt) / 1000) : null,
      firstAcceptedMaskDoneS: s(firstOk?.doneAt), firstMaskedFrameS: s(L.firstMasked), firstMaskCoverage: firstJob?.coverage ?? null },
    steady: { seconds: r1(steadyS), depthHz: r1(modelDepth.length / steadyS), maskedDepthFraction: modelDepth.length ? r1(100 * modelDepth.filter(d => d[2]).length / modelDepth.length) : null,
      frameP50: r1(pct(ft, .5)), frameP99: r1(pct(ft, .99)), framesOver50PerMin: r1(longFrames.length / steadyS * 60),
      longFramesDuringMaskJob: longInJob, longFramesTotal: longFrames.length, maskJobBusyFraction: r1(100 * jobTime / steadyS),
      loafCount: loafSteady.length, loafTop: Object.entries(loafSteady.flatMap(e => e.scripts.map(x => x.replace(/^\d+ms /, '').replace(/:\d+$/, ''))).reduce((m, k) => (m[k] = (m[k] ?? 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 6),
      maskAgeP50: r1(pct(ages, .5) * 10) / 10, maskAgeP95: r1(pct(ages, .95) * 10) / 10 },
    jobs: { count: jobs.length, computeMsP50: Math.round(pct(jobs.filter(j => j.doneAt).map(j => j.doneAt - j.startAt), .5) ?? 0),
      doneToAppliedMsP50: Math.round(pct(jobs.filter(j => j.appliedAt && j.doneAt).map(j => j.appliedAt - j.doneAt), .5) ?? 0),
      list: jobs.map(j => ({ reason: j.reason, atS: s(j.startAt), media: r1(j.mediaTime * 100) / 100, computeMs: j.doneAt ? Math.round(j.doneAt - j.startAt) : null, cov: j.coverage === null ? null : r1(j.coverage * 1000) / 10, sep: j.separation, dropped: j.dropped })) },
    samples: sampleRows,
    iouVsExactFrameP50: r1(pct(sampleRows.filter(r => r.iouVsExactFrame !== null).map(r => r.iouVsExactFrame), .5) * 100) / 100,
    load: { cpuPct: Math.round(100 * (1 - (c1.idle - c0.idle) / (c1.all - c0.all))), gpuPctP50: pct(gpu.filter(x => x !== null), .5),
      hiddenOrUnfocused: L.vis.filter(([v, f]) => !v || !f).length, visSamples: L.vis.length },
    appLog: L.log,
  };
  if (profile) {
    const dt = new Map(); profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000));
    const self = new Map(); let total = 0, idle = 0;
    for (const n of profile.nodes) { const ms = dt.get(n.id) ?? 0; total += ms; const f = n.callFrame; if (f.functionName === '(idle)') idle += ms;
      const key = `${f.functionName || '(anon)'} ${f.url.replace(/^.*?\/(src|deps)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`; self.set(key, (self.get(key) ?? 0) + ms); }
    row.profile = { seconds: profileS, busyPct: Math.round(100 * (1 - idle / total)), top: [...self].filter(([k]) => !/^\(idle\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, ms]) => `${Math.round(ms)}ms ${k}`) };
  }
  return row;
}

// ---------- --track-eval: tracking only (no playback timing). For each t on a grid and each delta,
// IoU of IS-Net(t + delta) against IS-Net(t) as captured and as moved by the app's tracker.
// Both arms carry the same model-to-model variation, so their difference is the tracker's effect.
const trackEval = async ({ times, deltas }) => {
  const blob = await (await fetch('/__clip')).blob(), v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob);
  await new Promise((y, n) => { v.onloadeddata = y; v.onerror = n; });
  const { captureLiveMask, estimateMaskShift, shiftLiveMask } = await import('/src/engine/vision/liveMask.ts');
  const { liveGrabSize } = await import('/src/engine/vision/liveDepth.ts');
  const cache = new Map();
  const at = async (t) => { const key = t.toFixed(3); if (cache.has(key)) return cache.get(key);
    const sought = new Promise(y => v.addEventListener('seeked', y, { once: true })); v.currentTime = t; await sought;
    const c = document.createElement('canvas'), sc = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const g = liveGrabSize(v.videoWidth, v.videoHeight), f = document.createElement('canvas'); f.width = g.w; f.height = g.h;
    const fc = f.getContext('2d', { willReadFrequently: true }); fc.drawImage(c, 0, 0, g.w, g.h);
    const m = await captureLiveMask(c), r = { mask: { data: m.data, width: m.width, height: m.height }, frame: fc.getImageData(0, 0, g.w, g.h) };
    cache.set(key, r); return r; };
  const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const x = a[k] >= .5, y = b[k] >= .5; i += x && y; u += x || y; } return u ? i / u : null; };
  const rows = [];
  for (const t of times) for (const d of deltas) {
    if (t + d > v.duration - 0.05) continue;
    const A = await at(t), B = await at(t + d), cov = A.mask.data.reduce((s, x) => s + (x >= .5), 0) / A.mask.data.length;
    if (A.mask.width !== B.mask.width || cov === 0) continue;
    const sh = estimateMaskShift(A.mask, A.frame, B.frame), moved = sh ? shiftLiveMask(A.mask, sh) : A.mask.data;
    rows.push({ t, d, cov, still: iou(A.mask.data, B.mask.data), tracked: iou(moved, B.mask.data), dx: sh?.dx ?? null, dy: sh?.dy ?? null, err: sh?.error ?? null, lost: sh?.lost ?? null });
  }
  return rows;
};
if (args.includes('--track-eval')) {
  args.splice(args.indexOf('--track-eval'), 1);
  const step = Number(opt('--step', 0.5)), deltas = opt('--deltas', '0.25,0.5,1,2').split(',').map(Number);
  const sess = await tarayiciOturumu({ chrome: true, basli: true, vite: { root, cacheDir: join(tmpdir(), `vmb-vite-${label}`), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [root] } } } });
  try {
    const page = sess.page; page.setDefaultTimeout(600_000);
    await page.route('**/__clip', r => r.fulfill({ path: clip, contentType: 'video/mp4' }));
    await page.route('**/__vmb', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>vmb</title>' }));
    await page.route('http://127.0.0.1:8765/**', r => r.abort()); // no HTTP cache needed here
    await page.goto(sess.url('/__vmb'));
    const dur = await page.evaluate(async () => { const b = await (await fetch('/__clip')).blob(), v = document.createElement('video'); v.src = URL.createObjectURL(b); await new Promise(y => { v.onloadedmetadata = y; }); return v.duration; });
    const times = Array.from({ length: Math.floor((dur - 0.3) / step) }, (_, i) => 0.1 + i * step);
    const rows = await page.evaluate(trackEval, { times, deltas });
    const summary = deltas.map(d => { const r = rows.filter(x => x.d === d && x.still !== null && x.tracked !== null);
      return { d, n: r.length, stillIouP50: r1(pct(r.map(x => x.still), .5) * 100) / 100, trackedIouP50: r1(pct(r.map(x => x.tracked), .5) * 100) / 100,
        betterPairs: r.filter(x => x.tracked > x.still + 0.02).length, worsePairs: r.filter(x => x.tracked < x.still - 0.02).length, lostPairs: r.filter(x => x.lost).length }; });
    console.log(JSON.stringify({ tag, summary }));
    writeFileSync(join(outDir, `${tag}-track.json`), JSON.stringify({ root, summary, rows }, null, 2));
  } finally { await sess.kapat(); }
  process.exit(0);
}

const session = await tarayiciOturumu({ chrome: true, basli: true, fsAllow: [], vite: { root, cacheDir: join(tmpdir(), `vmb-vite-${label}`),
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [root] } } } });
const rows = [], sidecar = [];
let netLog = () => [];
try {
  const page = session.page;
  page.setDefaultTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  // CDP blocking, not page.route: routing disables Chrome's HTTP cache and would make "warm" re-download.
  await page.addInitScript(instrument);
  const cdp = await page.context().newCDPSession(page); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*127.0.0.1:8765*', '*localhost:8765*'] });
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', e => { if (/8765/.test(e.request.url)) sidecar.push(e.request.url); if (/\/models\//.test(e.request.url)) reqs.set(e.requestId, { url: e.request.url.replace(/^.*\/models\//, ''), t: e.timestamp }); });
  cdp.on('Network.responseReceived', e => { const r = reqs.get(e.requestId); if (r) Object.assign(r, { status: e.response.status, fromDiskCache: e.response.fromDiskCache }); });
  cdp.on('Network.loadingFinished', e => { const r = reqs.get(e.requestId); if (r) Object.assign(r, { s: Math.round((e.timestamp - r.t) * 10) / 10, mb: Math.round(e.encodedDataLength / 1e5) / 10 }); });
  netLog = () => { const out = [...reqs.values()].filter(r => r.mb > 1 || r.fromDiskCache); reqs.clear(); return out; };
  const adapter = await (async () => { await page.goto(session.url('/'), { waitUntil: 'domcontentloaded' });
    return page.evaluate(async () => { const a = await navigator.gpu?.requestAdapter(); return a && [a.info?.vendor, a.info?.architecture].join('/'); }); })();
  for (const p of passes) {
    const row = await pass(session, p, cdp).catch(e => ({ pass: p, failed: e.message }));
    row.adapter = adapter; row.sidecarRequestsBlocked = sidecar.length; row.models = netLog(); rows.push(row);
    console.log(JSON.stringify({ tag, pass: p, startup: row.startup, steady: row.steady && { ...row.steady, loafTop: undefined }, iou: row.iouVsExactFrameP50, jobs: row.jobs && { ...row.jobs, list: undefined }, load: row.load, models: row.models, failed: row.failed }));
  }
} finally { await session.kapat(); }
writeFileSync(join(outDir, `${tag}.json`), JSON.stringify({ root, rows }, null, 2));
console.log('WROTE', join(outDir, `${tag}.json`));
