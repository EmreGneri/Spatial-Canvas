// Photo stage timing, cold vs warm cache, with network throttled over CDP (docs/photo-measurement.md).
//   node scripts/bench-photo-david.mjs [--image assets/thumbnail.jpg] [--mbps 100] [--query '&x=1'] [--out <dir>] [--label name]
// Fresh Chrome profile per invocation (cold); the warm pass reloads the page in the same profile.
// file-chosen -> preview and -> final are measured from the input `change` event on the report's
// performance.now() timeline; nothing here sums nested spans.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const image = resolve(opt('--image', join(root, 'assets/thumbnail.jpg'))), mbps = Number(opt('--mbps', 100));
const query = opt('--query', ''), label = opt('--label', 'run'), outDir = opt('--out', null);

process.env.SIDECAR_OTOMATIK = '0';
const server = await createServer({ root, cacheDir: join(tmpdir(), 'bench-photo-david-vite'), logLevel: 'error', optimizeDeps: { entries: ['index.html'] },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const base = server.resolvedUrls.local[0];
const profile = mkdtempSync(join(tmpdir(), 'bench-photo-david-profile-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu'], viewport: { width: 1280, height: 800 } });
const rows = [];
try {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.setDefaultTimeout(900_000);
  await page.addInitScript(() => {
    window.__bench = { t0: null };
    document.addEventListener('change', e => { if (e.target?.type === 'file') window.__bench.t0 = performance.now(); }, true);
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*127.0.0.1:8765*', '*localhost:8765*'] });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: mbps * 125_000, uploadThroughput: 2_500_000 });
  const url = `${base}?olcum=1&inference=browser${query}`;
  for (const pass of ['cold', 'warm']) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const adapter = await page.evaluate(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? [a.info?.vendor, a.info?.architecture, a.info?.description].filter(Boolean).join('/') : null; });
    await page.locator('input[accept="image/*,video/*"]').setInputFiles(image);
    await page.waitForFunction(() => window.__photoMeasurements?.some(r => r.status !== 'cancelled'));
    const r = await page.evaluate(() => {
      const m = window.__photoMeasurements.find(x => x.status !== 'cancelled'), t0 = window.__bench.t0;
      const dl = m.downloads.map(d => ({ label: d.label, source: d.source, mb: +(d.bodyBytes / 1e6).toFixed(1), status: d.status,
        startS: +((d.startedAt - t0) / 1000).toFixed(1), endS: +((d.endedAt - t0) / 1000).toFixed(1) }));
      const span = n => m.spans.filter(s => s.name === n).map(s => ({ startS: +((s.startedAt - t0) / 1000).toFixed(1), durS: +(s.durationMs / 1000).toFixed(1) }));
      return { status: m.status, previewS: +((m.startedAt + m.metadata.previewReadyMs - t0) / 1000).toFixed(1), finalS: +((m.endedAt - t0) / 1000).toFixed(1),
        decodeS: +((m.startedAt - t0) / 1000).toFixed(2), davidMask: m.metadata.davidMask, depthModel: m.metadata.depthModel,
        david: dl.filter(d => /DAViD/.test(d.label)), downloads: dl, davidRun: span('david.mask.run'), segmentation: span('segmentation.pipeline'),
        spans: m.spans.map(s => `${s.name} ${((s.startedAt - t0) / 1000).toFixed(1)}+${(s.durationMs / 1000).toFixed(1)}`) };
    });
    rows.push({ label, pass, mbps, adapter, ...r });
    console.log(JSON.stringify({ label, pass, adapter, previewS: r.previewS, finalS: r.finalS, status: r.status, david: r.david, davidRun: r.davidRun, davidMask: r.davidMask }));
  }
} finally {
  await ctx.close();
  await server.close();
  rmSync(profile, { recursive: true, force: true });
}
if (outDir) { mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, `${label}-${Date.now()}.json`), JSON.stringify(rows, null, 2)); }
