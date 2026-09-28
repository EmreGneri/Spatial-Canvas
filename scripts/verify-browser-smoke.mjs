// Real app smoke: React mount, WebGL rendering, mode controls and pause/resume.
// Usage: node scripts/verify-browser-smoke.mjs --chrome [--yazilim-gpu] [--basli]
import assert from 'node:assert/strict';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const TIMEOUT_MS = 30_000;
const flags = process.argv.slice(2);
const supportedFlags = ['--chrome', '--yazilim-gpu', '--basli'];

async function main() {
  assert.ok(flags.every((flag) => supportedFlags.includes(flag)),
    `Supported flags: ${supportedFlags.join(', ')}`);
  console.log('Browser smoke: starting the app in Chromium');
  const session = await tarayiciOturumu({
    chrome: flags.includes('--chrome'),
    yazilimGpu: flags.includes('--yazilim-gpu'),
    basli: flags.includes('--basli'),
  });
  const { page } = session;
  const errors = [];
  let missingFavicons = 0;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // The app has no favicon. Exempt only its known 404, not other resource failures.
    if (message.location().url === session.url('/favicon.ico') &&
        message.text() === 'Failed to load resource: the server responded with a status of 404 (Not Found)') {
      missingFavicons++;
      return;
    }
    errors.push(`console: ${message.text()} (${message.location().url})`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.stack ?? error.message}`));
  page.setDefaultTimeout(TIMEOUT_MS);
  page.setDefaultNavigationTimeout(TIMEOUT_MS);

  // Simulation render targets also advance Three's renderer counters. Only a
  // completed real composer render counts as an application frame here.
  async function waitForRendering(mode, timeout = TIMEOUT_MS) {
    const before = await page.evaluate(() => window.__browserSmoke.frames);
    await page.waitForFunction(({ mode, before }) => {
      const engine = window.__engine;
      return engine.renderMode === mode && window.__browserSmoke.frames > before + 2;
    }, { mode, before }, { timeout, polling: 100 });
    const state = await page.evaluate(() => {
      const renderer = window.__engine.renderer;
      const canvas = renderer.domElement;
      const bounds = canvas.getBoundingClientRect();
      return {
        visible: bounds.width > 0 && bounds.height > 0 && canvas.width > 0 && canvas.height > 0,
        contextLost: renderer.getContext().isContextLost(),
        calls: renderer.info.render.calls,
        programs: renderer.info.programs.length,
      };
    });
    assert.ok(state.visible && !state.contextLost && state.calls > 0 && state.programs > 0,
      `Expected a live WebGL render in ${mode}: ${JSON.stringify(state)}`);
  }

  async function assertRenderingPaused() {
    // A paused canvas alone can hide continuing GPGPU work. Both counters
    // must stay still while the browser's animation loop keeps ticking.
    const delta = await page.evaluate(async () => {
      const probe = window.__browserSmoke;
      const renderer = window.__engine.renderer;
      const before = { composer: probe.frames, renderer: renderer.info.render.frame };
      let timer;
      try {
        return await Promise.race([
          (async () => {
            for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
            return {
              composer: probe.frames - before.composer,
              renderer: renderer.info.render.frame - before.renderer,
            };
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Browser animation ticks timed out')), 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    });
    assert.equal(delta.composer, 0, 'Pause control must stop composer rendering');
    assert.equal(delta.renderer, 0, 'Pause control must stop simulation rendering');
  }

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    const response = await page.goto(session.url('/'), { waitUntil: 'load' });
    assert.ok(response?.ok(), `App document failed: HTTP ${response?.status()}`);
    await page.getByText('spatial-canvas', { exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => Boolean(window.__engine), undefined, { timeout: TIMEOUT_MS });
    await page.evaluate(() => {
      const composer = window.__engine.composer;
      const render = composer.render;
      const probe = window.__browserSmoke = { frames: 0, suppress: false };
      composer.render = function (...args) {
        if (probe.suppress) return;
        const result = render.apply(this, args);
        probe.frames++;
        return result;
      };
    });
    assert.ok(await page.getByRole('button', { name: 'sentetik görsel', exact: true }).isEnabled());
    await waitForRendering('points');
    // Negative control: simulation continues, but a suppressed composer must
    // fail the same progression check used by the actual smoke assertions.
    const simulationBefore = await page.evaluate(() => {
      window.__browserSmoke.suppress = true;
      return window.__engine.renderer.info.render.frame;
    });
    try {
      await assert.rejects(() => waitForRendering('points', 1000), { name: 'TimeoutError' });
      const simulationAfter = await page.evaluate(() => window.__engine.renderer.info.render.frame);
      assert.ok(simulationAfter > simulationBefore + 2,
        'Negative control must exercise continuing simulation renders');
      console.log('Browser smoke: negative control OK (simulation frames cannot satisfy the composer check)');
      await assert.rejects(() => assertRenderingPaused(), {
        name: 'AssertionError', message: /Pause control must stop simulation rendering/,
      });
      console.log('Browser smoke: pause negative control OK (composer-only pause is rejected)');
    } finally {
      await page.evaluate(() => { window.__browserSmoke.suppress = false; });
    }
    await waitForRendering('points');
    for (const [label, mode] of [['ASCII', 'ascii'], ['Point Cloud', 'points']]) {
      const button = page.getByRole('button', { name: label, exact: true });
      await button.click();
      await waitForRendering(mode);
      assert.equal(await button.getAttribute('aria-pressed'), 'true', `${label} must be selected`);
      assert.equal(await page.getByRole('button', {
        name: mode === 'points' ? 'ASCII' : 'Point Cloud', exact: true,
      }).getAttribute('aria-pressed'), 'false', 'Previous mode must be deselected');
    }
    await page.getByTitle('sahneyi duraklat (GPU boşa çalışmaz)', { exact: true }).click();
    await page.getByText('duraklatıldı', { exact: true }).waitFor({ state: 'visible' });
    await assertRenderingPaused();
    await page.getByTitle('sahneyi sürdür', { exact: true }).click();
    await waitForRendering('points');
    assert.deepEqual(errors, [], 'Browser reported errors');
    console.log('Browser smoke: OK (startup, WebGL frames, ASCII/Point Cloud, pause/resume; no application errors)');
    if (missingFavicons) console.log(`Known favicon 404 ignored: ${missingFavicons}`);
  } catch (error) {
    if (errors.length) console.error(errors.join('\n'));
    throw error;
  } finally {
    await session.kapat();
  }
}

main().catch((error) => {
  console.error('Browser smoke failed. Check Chrome availability, WebGL support and the error below.');
  console.error(error);
  process.exitCode = 1;
});
