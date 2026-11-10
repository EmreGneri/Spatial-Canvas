// Production photo benchmark. Each invocation creates one cold/warm pair in a fresh Chrome profile.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const args = process.argv.slice(2);
const opt = (n, fallback) => args.includes(n) ? args[args.indexOf(n) + 1] : fallback;
const image = resolve(opt('--image', 'assets/thumbnail.jpg')), mbps = Number(opt('--mbps', 100));
const label = opt('--label', 'run'), out = resolve(opt('--out', 'docs/benchmarks/photo-raw'));
const timeout = Number(opt('--timeout-ms', 900000));
mkdirSync(out, { recursive: true });
const stem = join(out, label), profile = mkdtempSync(join(tmpdir(), 'photo-profile-'));
const bytes = readFileSync(image), rows = [];
const gpuSnapshot = async () => {
  const at = new Date().toISOString();
  try {
    const { stdout } = await promisify(execFile)('nvidia-smi', ['--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw,clocks.sm', '--format=csv,noheader'], { timeout: 10000, windowsHide: true });
    return { at, fields: 'name, temperature C, utilization, memory used, power, SM clock', value: stdout.trim() };
  } catch (error) { return { at, unavailable: error.message }; }
};
let server, ctx;
try {
  let base = opt('--base-url', null);
  if (!base) {
    process.env.SIDECAR_OTOMATIK = '0';
    server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
    await server.listen(); base = server.resolvedUrls.local[0];
  }
  ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false,
    args: ['--enable-unsafe-webgpu'], viewport: { width: 1280, height: 800 } });
  if (args.includes('--make-12mp')) {
    const data = await ctx.pages()[0].evaluate(async src => {
      const i = new Image(); i.src = src; await i.decode();
      const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
      c.getContext('2d').drawImage(i, 0, 0, 4000, 3000); return c.toDataURL('image/jpeg', .92).split(',')[1];
    }, `data:image/jpeg;base64,${bytes.toString('base64')}`);
    writeFileSync(opt('--fixture-out', join(tmpdir(), 'spatial-photo-12mp.jpg')), Buffer.from(data, 'base64'));
  } else for (const pass of ['cold', 'warm']) {
    const page = pass === 'cold' ? ctx.pages()[0] : await ctx.newPage();
    page.setDefaultTimeout(timeout);
    const network = [], requests = new Map(), errors = [], frames = [];
    page.on('pageerror', e => errors.push({ type: 'pageerror', text: e.message }));
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push({ type: m.type(), text: m.text() }); });
    await page.addInitScript(() => {
      window.__bench = { t0: null, previewOpportunity: null, finalGate: null, visibility: [] };
      document.addEventListener('visibilitychange', () => window.__bench.visibility.push({ at: performance.now(), state: document.visibilityState }));
      document.addEventListener('change', e => { if (e.target?.type === 'file') window.__bench.t0 = performance.now(); }, true);
      new MutationObserver(() => {
        const b = window.__bench; if (b.t0 === null) return;
        // The overlay is committed after renderFrame: two rAFs bound a browser presentation opportunity.
        // This does not claim physical display latency. A separate screenshot retains actual canvas content.
        if (b.previewOpportunity === null && /Önizleme ·/.test(document.body.innerText)) {
          b.previewOpportunity = 'pending';
          requestAnimationFrame(() => requestAnimationFrame(() => { b.previewOpportunity = performance.now(); }));
        }
        const png = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'PNG');
        if (b.finalGate === null && png && !png.disabled && window.__photoMeasurements?.some(r => r.status === 'ready')) b.finalGate = performance.now();
      }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await cdp.send('Network.setBlockedURLs', { urls: ['*127.0.0.1:8765*', '*localhost:8765*'] });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20,
      downloadThroughput: mbps * 125000, uploadThroughput: 2500000 });
    cdp.on('Network.requestWillBeSent', e => { const r = { id: e.requestId, url: e.request.url, method: e.request.method, start: e.timestamp, headers: e.request.headers }; requests.set(e.requestId, r); network.push(r); });
    cdp.on('Network.requestServedFromCache', e => { const r = requests.get(e.requestId); if (r) r.servedFromCache = true; });
    cdp.on('Network.responseReceived', e => { const r = requests.get(e.requestId); if (r) Object.assign(r, { status: e.response.status, responseHeaders: e.response.headers, fromDiskCache: e.response.fromDiskCache, fromServiceWorker: e.response.fromServiceWorker, headerEncodedBytes: e.response.encodedDataLength, protocol: e.response.protocol }); });
    cdp.on('Network.responseReceivedExtraInfo', e => { const r = requests.get(e.requestId); if (r) Object.assign(r, { wireStatus: e.statusCode, wireHeaders: e.headers }); });
    cdp.on('Network.dataReceived', e => { const r = requests.get(e.requestId); if (r) r.bodyEncodedBytes = (r.bodyEncodedBytes ?? 0) + e.encodedDataLength; });
    cdp.on('Network.loadingFinished', e => { const r = requests.get(e.requestId); if (r) {
      Object.assign(r, { end: e.timestamp, encodedDataLength: e.encodedDataLength });
      if (/models\/|\/ort\/|mediapipe-wasm/.test(r.url)) console.log(JSON.stringify({ label, pass, downloaded: r.url, status: r.status, bytes: e.encodedDataLength, seconds: e.timestamp - r.start }));
    } });
    cdp.on('Network.loadingFailed', e => { const r = requests.get(e.requestId); if (r) Object.assign(r, { end: e.timestamp, failure: e.errorText }); });
    cdp.on('Page.screencastFrame', e => { frames.push({ timestamp: e.metadata.timestamp, index: frames.length }); void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
    const url = new URL(base); url.search = `?olcum=1&inference=browser${opt('--query', '')}`;
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout });
    const environment = await page.evaluate(async () => {
      const a = await navigator.gpu?.requestAdapter();
      return { userAgent: navigator.userAgent, adapter: a ? { vendor: a.info?.vendor, architecture: a.info?.architecture, description: a.info?.description, device: a.info?.device, fallback: a.info?.isFallbackAdapter ?? a.isFallbackAdapter ?? null, features: [...a.features] } : null,
        connection: navigator.connection ? { effectiveType: navigator.connection.effectiveType, downlink: navigator.connection.downlink, saveData: navigator.connection.saveData } : null, visibility: document.visibilityState };
    });
    writeFileSync(`${stem}-${pass}-environment.json`, JSON.stringify({ environment, base, profile, mbps, at: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ label, pass, environment }));
    if (!environment.adapter) throw Error('No WebGPU adapter on production page');
    const gpuStart = gpuSnapshot();
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 35, maxWidth: 640, maxHeight: 400, everyNthFrame: 60 });
    let shot = false;
    const monitor = setInterval(async () => {
      try { if (!shot && await page.evaluate(() => typeof window.__bench.previewOpportunity === 'number')) {
        shot = true; await page.screenshot({ path: `${stem}-${pass}-preview.png` });
      } } catch {}
    }, 500);
    const heartbeat = setInterval(async () => {
      try {
        const timing = await page.evaluate(() => ({ ...window.__bench, now: performance.now() }));
        const progress = { label, pass, at: new Date().toISOString(), timing,
          active: network.filter(r => !r.end && /models\/|\/ort\/|mediapipe-wasm/.test(r.url)).map(r => ({ url: r.url, bodyEncodedBytes: r.bodyEncodedBytes ?? null, status: r.wireStatus ?? r.status })),
          knownModelEncodedBytes: network.filter(r => /models\/|\/ort\/|mediapipe-wasm/.test(r.url)).reduce((s, r) => s + (r.encodedDataLength ?? r.bodyEncodedBytes ?? 0), 0) };
        writeFileSync(`${stem}-${pass}-progress.json`, JSON.stringify(progress, null, 2)); console.log(JSON.stringify(progress));
      } catch {}
    }, 45000);
    let failure = null;
    try {
      await page.locator('input[accept="image/*,video/*"]').setInputFiles(image);
      await page.waitForFunction(() => window.__photoMeasurements?.some(r => r.status !== 'cancelled'), null, { timeout });
      await page.waitForFunction(() => window.__bench.finalGate !== null || window.__photoMeasurements?.some(r => r.status === 'failed'), null, { timeout: 10000 });
    } catch (e) { failure = e.message; }
    clearInterval(monitor); clearInterval(heartbeat); await cdp.send('Page.stopScreencast');
    await page.screenshot({ path: `${stem}-${pass}-final.png` });
    const result = await page.evaluate(async () => {
      const cache = {};
      try { for (const n of await caches.keys()) cache[n] = (await (await caches.open(n)).keys()).map(r => r.url); } catch {}
      return { report: window.__photoMeasurements?.find(r => r.status !== 'cancelled') ?? null, timing: window.__bench, caches: cache,
        pngDisabled: [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'PNG')?.disabled,
        memory: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null };
    });
    const row = { label, pass, mbps, latency: 20, throughputBytesPerSecond: mbps * 125000, base, profile,
      fixture: { path: image, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      environment, gpuStart: await gpuStart, gpuEnd: await gpuSnapshot(), failure, ...result, network, presentationFrames: frames, errors };
    rows.push(row); writeFileSync(`${stem}.json`, JSON.stringify(rows, null, 2));
    console.log(JSON.stringify({ label, pass, status: result.report?.status, failure, adapter: environment.adapter,
      previewOpportunityMs: typeof result.timing.previewOpportunity === 'number' ? result.timing.previewOpportunity - result.timing.t0 : null,
      finalMs: result.report ? result.report.endedAt - result.timing.t0 : null }));
    // Wait for cache keys to stabilize before closing the page; do not reuse JS model memoization.
    let previous = '', stable = 0;
    for (let i = 0; i < 30 && stable < 3; i++) {
      const keys = JSON.stringify(await page.evaluate(async () => { const a = []; for (const n of await caches.keys()) a.push([n, (await (await caches.open(n)).keys()).map(r => r.url)]); return a; }));
      stable = keys === previous ? stable + 1 : 0; previous = keys; await page.waitForTimeout(1000);
    }
    row.cacheKeysStableSeconds = stable;
    row.cacheKeysAfterWait = JSON.parse(previous);
    row.cacheWaitLimitation = 'Stable atomic cache keys observed for three seconds; no application pending-put counter is exposed.';
    writeFileSync(`${stem}.json`, JSON.stringify(rows, null, 2));
    await page.close();
    if (failure || result.report?.status !== 'ready') throw Error('Photo benchmark failed; preserved JSON contains evidence');
  }
} finally {
  await ctx?.close(); await server?.close();
  // Only the exact freshly created profile inside the system temporary directory can be removed.
  if (resolve(dirname(profile)).toLowerCase() !== resolve(tmpdir()).toLowerCase() || !basename(profile).startsWith('photo-profile-'))
    throw Error(`Refusing to remove unexpected profile path: ${profile}`);
  rmSync(profile, { recursive: true, force: true });
}
