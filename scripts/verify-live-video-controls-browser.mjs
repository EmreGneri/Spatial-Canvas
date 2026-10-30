import assert from 'node:assert/strict';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

// Actual React controls + HTMLVideoElement/WebCodecs. No inference or model downloads.
const fixtureId = '\0live-video-controls-fixture';
const fixtureCode = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveVideoControls } from '/src/ui/LiveVideoControls.tsx';
import * as mb from '/src/vendor/splat.js/vendor/mediabunny.min.mjs';
const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
const ctx = canvas.getContext('2d');
const target = new mb.BufferTarget();
const output = new mb.Output({ format: new mb.WebMOutputFormat(), target });
const source = new mb.CanvasSource(canvas, { codec: 'vp9', bitrate: 100000 });
output.addVideoTrack(source, { frameRate: 10 });
await output.start();
for (let i = 0; i < 40; i++) {
  ctx.fillStyle = '#203040'; ctx.fillRect(0, 0, 160, 90);
  ctx.fillStyle = '#ff8000'; ctx.fillRect(5 + i * 3, 20, 15, 40);
  await source.add(i / 10, .1);
}
source.close(); await output.finalize();
const url = URL.createObjectURL(new Blob([target.buffer], { type: 'video/webm' }));
async function makeVideo(style) {
  const video = document.createElement('video'); video.muted = true; video.preload = 'auto';
  if (style !== null) video.setAttribute('style', style);
  video.src = url;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Fixture video failed to load')), 10000);
    video.onloadeddata = () => { clearTimeout(timeout); video.onloadeddata = null; resolve(); };
    video.onerror = () => { clearTimeout(timeout); reject(Error('Fixture codec unavailable')); };
  });
  return video;
}
const video = await makeVideo('display:none;opacity:0.4');
const root = createRoot(document.querySelector('#controls'));
const fixture = window.fixture = { video, originalStyle: video.getAttribute('style'), errors: [], qualities: [], url };
function Harness() {
  const [activeVideo, setVideo] = useState(video);
  fixture.replaceVideo = async () => {
    fixture.replacement = await makeVideo(null); setVideo(fixture.replacement);
  };
  return React.createElement(LiveVideoControls, {
    video: activeVideo,
    onError: message => fixture.errors.push(message),
    stats: { path: 'depth', hz: 8, inferenceMs: 75, width: 266, height: 154,
      frames: 12, mediaTime: 0, geometryAgeMs: 100, backend: 'test-provider' },
  });
}
root.render(React.createElement(Harness));
fixture.unmount = () => { root.unmount(); video.pause(); fixture.replacement?.pause(); URL.revokeObjectURL(url); };
`;
const session = await tarayiciOturumu({ chrome: true, basli: true, vite: {
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [{ name: 'live-video-controls-fixture',
    resolveId(id) { return id === '/__live_controls_fixture.mjs' ? fixtureId : null; },
    load(id) { return id === fixtureId ? fixtureCode : null; },
  }],
} });
const page = session.page;
const pageErrors = [], modelRequests = [];
let timeout;
try {
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/models/**', route => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.route('https://**', route => route.abort());
  await page.route('**/__live_controls_check', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><title>Live video controls browser check</title><h1>Live video controls check</h1><div id="controls"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/__live_controls_fixture.mjs');
    </script>` }));
  const result = await Promise.race([(async () => {
    await page.goto(session.url('/__live_controls_check'), { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.bringToFront();
    await page.getByRole('button', { name: 'Oynat', exact: true }).waitFor();
    assert.equal(await page.locator('[aria-label="Kaynak video önizlemesi"] video').count(), 1);
    await page.getByRole('button', { name: 'Oynat', exact: true }).click();
    await page.waitForFunction(() => !window.fixture.video.paused && window.fixture.video.currentTime > .05);
    await page.getByRole('button', { name: 'Duraklat', exact: true }).click();
    await page.waitForFunction(() => window.fixture.video.paused);
    await page.getByLabel('Video oynatma hızı').selectOption('0.5');
    assert.equal(await page.evaluate(() => window.fixture.video.playbackRate), .5);
    assert.equal(await page.getByLabel('Canlı derinlik kalitesi').count(), 0, 'no quality selector: the live depth input is fixed');
    await page.getByLabel('Video zamanı').focus();
    await page.getByLabel('Video zamanı').press('Home');
    try {
      await page.waitForFunction(() => window.fixture.video.currentTime === 0 && !window.fixture.video.seeking);
    } catch (error) {
      console.log('Seek failure', await page.evaluate(() => ({ time: window.fixture.video.currentTime,
        seeking: window.fixture.video.seeking, readyState: window.fixture.video.readyState,
        value: document.querySelector('[aria-label="Video zamanı"]').value,
        seekable: Array.from({ length: window.fixture.video.seekable.length }, (_, i) => [window.fixture.video.seekable.start(i), window.fixture.video.seekable.end(i)]) })));
      throw error;
    }
    assert.match(await page.getByLabel('Canlı derinlik ölçümü').innerText(), /75 ms.*3D lag 100 ms.*266×154/);
    await page.evaluate(() => { window.fixture.video.playbackRate = .25; });
    await page.waitForFunction(() => document.querySelector('[aria-label="Video oynatma hızı"]').value === '0.25');
    await page.evaluate(() => window.fixture.replaceVideo());
    await page.waitForFunction(() => document.querySelector('[aria-label="Kaynak video önizlemesi"] video') === window.fixture.replacement);
    assert.equal(await page.getByLabel('Video oynatma hızı').inputValue(), '1', 'replacement reflects its actual rate');
    const replaced = await page.evaluate(() => ({ detached: window.fixture.video.parentElement === null,
      style: window.fixture.video.getAttribute('style'), original: window.fixture.originalStyle }));
    assert.equal(replaced.detached, true);
    assert.equal(replaced.style, replaced.original);
    await page.evaluate(() => window.fixture.unmount());
    const cleanup = await page.evaluate(() => ({ replacementDetached: window.fixture.replacement.parentElement === null,
      replacementStyle: window.fixture.replacement.getAttribute('style'), elements: document.querySelector('#controls').childElementCount,
      errors: window.fixture.errors }));
    assert.equal(cleanup.replacementDetached, true);
    assert.ok(!cleanup.replacementStyle, 'unmount leaves no inline styles on the replacement');
    assert.equal(cleanup.elements, 0);
    assert.deepEqual(cleanup.errors, []);
    return { playPause: true, seek: 0, rate: .5, replacement: replaced, cleanup };
  })(), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Live controls browser check timed out')), 45000); })]);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(modelRequests, []);
  console.log('OK React live video controls: actual video play/pause, seek, speed and lifecycle (no quality selector)', JSON.stringify(result));
} finally {
  clearTimeout(timeout);
  await session.kapat();
}
