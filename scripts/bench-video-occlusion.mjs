// Measurement only: ?videoOrtme side-view occlusion experiment (docs/benchmarks/video-side-view-occlusion.md).
//   node scripts/bench-video-occlusion.mjs <clip> [--phases images,fps] [--runs 3] [--seconds 20]
//     [--variants off,m1,m2] [--img-t 12] [--out reports/video-occlusion.json]
// images: one session, one paused frame with geometry frozen (setDepth no-op), poses front / 45 / 90 deg,
//         each variant switched at runtime on the SAME frame, off captured first and last (identity check),
//         plus a short playback burst per variant at 45 deg (consecutive-frame diff, flicker proxy) and a
//         per-draw-mode check. PNGs: reports/video-occlusion/.
// scan:   see scan() below.
// fps:    one fresh session per (run, variant), interleaved; playback window at the default camera.
// Headed installed Chrome (the built-in pane throttles rAF); waits for a quiet machine before every window.
import { execFileSync, spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';
process.env.TARAYICI_EK_BAYRAKLAR ??= '--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const phases = opt('--phases', 'images,fps').split(','), runs = Number(opt('--runs', 3)), seconds = Number(opt('--seconds', 20));
const IMG_T = Number(opt('--img-t', 12)), MAX_CPU = Number(opt('--max-cpu', 40)), out = opt('--out', 'reports/video-occlusion.json');
// Variant = off | m1 | m2, optionally @bias (world units), e.g. m1@0.005. Core stays at the default.
const spec = (name) => { const [m, bias] = name.split('@'); return { mode: { off: 0, m1: 1, m2: 2 }[m], tuning: { bias: bias ? Number(bias) : 0.03 } }; };
const setVariant = (page, name) => page.evaluate(({ mode, tuning }) => window.__engine.setVideoOcclusion(mode, tuning), spec(name));
const variants = opt('--variants', 'off,m1,m2').split(',');
const [clip] = args;
if (!clip) throw new Error('Pass <clip>');
const DIR = 'reports/video-occlusion';
mkdirSync(DIR, { recursive: true });
const report = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
const save = () => writeFileSync(out, JSON.stringify(report, null, 2));
const pct = (v, q) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };

// ---------- machine load (same gate as bench-video-vs-reference.mjs) ----------
const cpuBusy = async (ms) => { const t = () => cpus().reduce((s, c) => { const v = c.times; s.idle += v.idle; s.all += v.user + v.nice + v.sys + v.irq + v.idle; return s; }, { idle: 0, all: 0 });
  const a = t(); await new Promise(r => setTimeout(r, ms)); const b = t(); return Math.round(100 * (1 - (b.idle - a.idle) / (b.all - a.all))); };
const competitors = () => { try {
  return execFileSync('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'run verify|scripts[\\\\/]verify-|bench-(?!video-occlusion)' } | ForEach-Object { \"$($_.ProcessId)\" }"],
  { encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(s => s && s !== String(process.pid)); } catch { return ['<query failed>']; } };
const nvidia = () => { try { return Number(execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim()); } catch { return null; } };
// Windows 3D engine utilisation per adapter (luid), all processes, averaged over `samples` x 2 s.
const gpu3d = (samples) => new Promise(done => {
  const ps = spawn('powershell', ['-NoProfile', '-Command',
    `Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -SampleInterval 2 -MaxSamples ${samples} | ForEach-Object { $_.CounterSamples | ForEach-Object { "$($_.InstanceName)|$($_.CookedValue)" }; '---' }`]);
  let text = ''; ps.stdout.on('data', d => { text += d; });
  ps.on('close', () => { const per = {}; let n = 0;
    for (const block of text.split('---')) { const sums = {};
      for (const line of block.split('\n')) { const [inst, val] = line.trim().split('|'); const luid = /luid_(0x[0-9a-f]+_0x[0-9a-f]+)/i.exec(inst ?? '')?.[1]; if (luid) sums[luid] = (sums[luid] ?? 0) + Number(val); }
      if (Object.keys(sums).length) { n++; for (const k in sums) per[k] = (per[k] ?? 0) + sums[k]; } }
    for (const k in per) per[k] = Math.round(per[k] / Math.max(1, n)); done(per); });
});
async function quietGate() {
  const started = Date.now();
  for (;;) {
    const comp = competitors(), cpu = await cpuBusy(3000), gpu = await gpu3d(2), nv = nvidia();
    const busyGpu = Math.max(0, ...Object.values(gpu));
    if (!comp.length && cpu < MAX_CPU && busyGpu < 50) return { cpuBeforePct: cpu, gpu3dBeforePct: gpu, nvidiaBeforePct: nv, waitedS: Math.round((Date.now() - started) / 1000) };
    if (Date.now() - started > 15 * 60_000) return { cpuBeforePct: cpu, gpu3dBeforePct: gpu, nvidiaBeforePct: nv, waitedS: Math.round((Date.now() - started) / 1000), gateTimedOut: true };
    console.log(`busy (cpu ${cpu} %, gpu3d ${JSON.stringify(gpu)}, nvidia ${nv} %, ${comp.length} competing node procs) - waiting 30 s`);
    await new Promise(r => setTimeout(r, 30_000));
  }
}

// ---------- session ----------
async function open(search = '') {
  const session = await tarayiciOturumu({ chrome: true, basli: true, vite: { server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } } });
  const page = session.page, errors = [], infos = [];
  page.setDefaultTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/videoOrtme/.test(m.text())) infos.push(m.text()); });
  await page.route('https://**', r => r.abort());
  await page.route('http://127.0.0.1:8765/**', r => r.abort()); // browser WebGPU inference, as in the other video benches
  await page.goto(session.url('/' + search), { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction(() => window.__engine);
  const gl = await page.evaluate(() => { const g = window.__engine.renderer.getContext(); const x = g.getExtension('WEBGL_debug_renderer_info');
    return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : null; });
  await page.mouse.move(0, 0);
  await page.locator('input[accept="image/*,video/*"]').setInputFiles(clip);
  await page.getByLabel('Canlı derinlik ölçümü').filter({ hasText: /\d+ ms/ }).waitFor();
  await page.waitForTimeout(8000); // warm-up, first mask
  return { session, page, errors, infos, gl };
}
const frames = (page, n) => page.evaluate(n => new Promise(r => { let i = 0; const f = () => ++i >= n ? r() : requestAnimationFrame(f); requestAnimationFrame(f); }), n);
const pose = (page, deg) => page.evaluate(deg => { const e = window.__engine; e.swayEnabled = false; e.controls.reset();
  const t = e.controls.target, d = e.camera.position.clone().sub(t).length(), a = deg * Math.PI / 180;
  e.camera.position.set(t.x + d * Math.sin(a), t.y, t.z + d * Math.cos(a)); e.camera.lookAt(t); e.controls.update(); }, deg);
const shot = async (page, path) => { const c = await page.evaluateHandle(() => window.__engine.renderer.domElement); await c.asElement().screenshot({ path }); return path; };

async function images() {
  const load = await quietGate();
  const { session, page, errors, infos, gl } = await open();
  const res = { load, gl, imgT: IMG_T, shots: [], bursts: [], modes: [] };
  try {
    await page.evaluate(async t => { const v = document.querySelector('[aria-label="Kaynak video önizlemesi"] video'); v.pause();
      const s = new Promise(y => v.addEventListener('seeked', y, { once: true })); v.currentTime = t; await s; }, IMG_T);
    await page.waitForTimeout(8000); // depth + mask on the paused frame
    await page.evaluate(() => { const e = window.__engine; e.__setDepth = e.setDepth; e.setDepth = () => {}; }); // freeze geometry
    await frames(page, 120);
    for (const deg of [0, 45, 90]) {
      await pose(page, deg);
      for (const name of ['off', ...variants.filter(v => v !== 'off'), 'off']) {
        await setVariant(page, name);
        await frames(page, 30);
        const tag = res.shots.some(s => s.deg === deg && s.variant === 'off') && name === 'off' ? 'off-again' : name;
        res.shots.push({ deg, variant: tag, path: await shot(page, `${DIR}/pose${deg}-${tag}.png`) });
      }
    }
    // Playback burst at 45 deg: 8 shots ~200 ms apart per variant (flicker proxy; content moves too).
    await page.evaluate(() => { const e = window.__engine; e.setDepth = e.__setDepth; });
    await pose(page, 45);
    for (const name of variants) {
      await setVariant(page, name);
      await page.evaluate(t => { const v = document.querySelector('[aria-label="Kaynak video önizlemesi"] video'); v.currentTime = t; return v.play(); }, IMG_T - 2);
      await page.waitForTimeout(1500);
      const paths = [];
      for (let i = 0; i < 8; i++) { paths.push(await shot(page, `${DIR}/burst45-${name}-${i}.png`)); await page.waitForTimeout(150); }
      res.bursts.push({ variant: name, paths });
    }
    // Draw modes with the flag on: which honour it (pre-pass visible) and whether anything throws.
    await page.evaluate(() => document.querySelector('[aria-label="Kaynak video önizlemesi"] video').pause());
    await pose(page, 90);
    for (const label of ['ASCII', 'Neon', 'Solid', 'Crystal', 'Point Cloud']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.evaluate(() => window.__engine.setVideoOcclusion(1));
      await frames(page, 60);
      const st = await page.evaluate(() => { const e = window.__engine; return { mode: e.renderModeName, material: e.pointsMaterial.name,
        pointsVisible: e.points.visible, prepassVisible: !!e.occlusion?.points.visible }; });
      res.modes.push({ label, ...st, path: await shot(page, `${DIR}/mode-${label.replace(' ', '')}-m1.png`) });
    }
  } finally { res.errors = errors; res.infos = infos; await session.kapat(); }
  report.images = res; save();
  console.log('images', JSON.stringify({ shots: res.shots.length, modes: res.modes, errors, infos }));
}

// scan: paused frames --scan-times, poses 0/30/45/60/90, each variant; finds frames where a large bias
// (hides only surfaces well behind the front one) changes the image, i.e. real near/far overlap.
async function scan() {
  const times = opt('--scan-times', '2,4,6,8,10,12,14,16,18,20').split(',').map(Number);
  const load = await quietGate();
  const { session, page, errors, gl } = await open();
  const res = { load, gl, shots: [] };
  try {
    for (const t of times) {
      await page.evaluate(() => { const e = window.__engine; if (e.__setDepth) e.setDepth = e.__setDepth; });
      await page.evaluate(async t => { const v = document.querySelector('[aria-label="Kaynak video önizlemesi"] video'); v.pause();
        const s = new Promise(y => v.addEventListener('seeked', y, { once: true })); v.currentTime = t; await s; }, t);
      await page.waitForTimeout(6000);
      await page.evaluate(() => { const e = window.__engine; e.__setDepth ??= e.setDepth; e.setDepth = () => {}; });
      await frames(page, 90);
      for (const deg of [0, 30, 45, 60, 90]) {
        await pose(page, deg);
        for (const name of variants) {
          await setVariant(page, name); await frames(page, 20);
          res.shots.push({ t, deg, variant: name, path: await shot(page, `${DIR}/scan-t${t}-pose${deg}-${name}.png`) });
        }
      }
    }
  } finally { res.errors = errors; await session.kapat(); }
  report.scan = res; save();
  console.log('scan', res.shots.length, JSON.stringify(errors));
}

const measureWindow = ({ seconds }) => new Promise(done => { const ft = []; let last = null; const end = performance.now() + seconds * 1000;
  const f = (now) => { if (last !== null) ft.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else done(ft); }; requestAnimationFrame(f); });

async function fps() {
  report.fps = report.fps ?? [];
  for (let run = 1; run <= runs; run++) for (const name of variants) {
    const load = await quietGate();
    const { session, page, errors, gl } = await open(`?videoOrtme=${spec(name).mode}`);
    if (name.includes('@')) await setVariant(page, name);
    try {
      await page.evaluate(() => { const e = window.__engine; e.swayEnabled = false; e.controls.reset(); });
      await frames(page, 60);
      const gpuWin = gpu3d(Math.floor(seconds / 2) - 1), cpuWin = cpuBusy(seconds * 1000 - 500);
      const ft = await page.evaluate(measureWindow, { seconds });
      const row = { run, variant: name, gl, load: { ...load, cpuDuringPct: await cpuWin, gpu3dDuringPct: await gpuWin, nvidiaAfterPct: nvidia() },
        prepassVisible: await page.evaluate(() => !!window.__engine.occlusion?.points.visible),
        playing: await page.evaluate(() => !document.querySelector('[aria-label="Kaynak video önizlemesi"] video').paused),
        renderFps: ft.length / seconds, fpsP50: 1000 / pct(ft, .5), fps1pctLow: 1000 / pct(ft, .99), frameP99Ms: pct(ft, .99),
        over25PerMin: ft.filter(x => x > 25).length / seconds * 60, errors };
      report.fps.push(row); save();
      console.log('fps', JSON.stringify(row));
    } finally { await session.kapat(); }
  }
}

if (phases.includes('scan')) await scan();
if (phases.includes('images')) await images();
if (phases.includes('fps')) await fps();
console.log('WROTE', out);
