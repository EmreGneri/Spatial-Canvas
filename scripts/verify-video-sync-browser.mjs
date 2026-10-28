import assert from 'node:assert/strict';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

// Real WebCodecs/OPFS/video events; deterministic depth avoids model downloads.
const session = await tarayiciOturumu({ chrome: true, basli: true,
  vite: { server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } } });
const page = session.page;
const errors = [], blockedModels = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/models/**', route => { blockedModels.push(route.request().url()); return route.abort(); });
await page.route('https://**', route => route.abort());
try {
  await page.route('**/__video_sync_check', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><title>Video synchronization check</title><h1>Video synchronization check</h1><pre id="result">Running decoder, OPFS and timestamp regressions…</pre><video id="video" muted controls></video>' }));
  await page.goto(session.url('/__video_sync_check'), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.bringToFront();
  const result = await page.evaluate(async () => {
    const { prepareVideoDepth } = await import('/src/engine/vision/videoPrecompute.ts');
    const { startBufferedVideoPlayback } = await import('/src/engine/vision/bufferedVideoPlayback.ts');
    const { propagateMaskInterval } = await import('/src/engine/vision/videoMaskTrack.ts');
    const mb = await import('/src/vendor/splat.js/vendor/mediabunny.min.mjs');
    const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));
    const waitUntil = async predicate => {
      const end = performance.now() + 10000;
      while (!predicate()) { if (performance.now() > end) throw new Error('Video sync condition timed out'); await nextTick(); }
    };
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d');
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.WebMOutputFormat(), target });
    const source = new mb.CanvasSource(canvas, { codec: 'vp9', bitrate: 100000 });
    output.addVideoTrack(source, { frameRate: 10 });
    await output.start();
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i < 4 ? '#202020' : '#e0e0e0'; ctx.fillRect(0, 0, 160, 90);
      ctx.fillStyle = '#ff8000'; ctx.fillRect(10 + i * 12, 25, 20, 35);
      await source.add(i / 10, 1 / 10);
    }
    source.close(); await output.finalize();
    const blob = new Blob([target.buffer], { type: 'video/webm' });
    const handle = await prepareVideoDepth(blob, { provider: { width: 16, height: 9,
      infer: async frames => frames.map(() => new Float32Array(144).fill(.5)), dispose: async () => {} } });
    await handle.done;
    const video = document.querySelector('#video');
    const url = URL.createObjectURL(blob);
    video.src = url;
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
    const seek = async time => {
      const ready = new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));
      video.currentTime = time; await ready;
    };
    let stop = () => {};
    try {
      await seek(.65);
      const actual = await handle.frameAt(video.currentTime);
      const published = [];
      stop = startBufferedVideoPlayback(video, handle, { onFrame: frame => published.push(frame.mediaTime) });
      await waitUntil(() => published.length > 0);
      stop();
      const preserved = published[0] === actual.mediaTime && Math.abs(published[0] - .6) < .001;

      let enabled = true, release, readStarted = false;
      const gate = new Promise(resolve => { release = resolve; });
      const disabledPublications = [];
      stop = startBufferedVideoPlayback(video, {
        hasFrame: time => handle.hasFrame(time),
        frameAt: async time => { readStarted = true; const frame = await handle.frameAt(time); await gate; return frame; },
      }, { enabled: () => enabled, onFrame: frame => disabledPublications.push(frame.mediaTime) });
      await waitUntil(() => readStarted);
      enabled = false; release();
      await new Promise(resolve => setTimeout(resolve, 100));
      stop();

      const frames = [0, 0, 255, 255].map(value => {
        const data = new Uint8ClampedArray(16 * 9 * 4);
        for (let i = 0; i < 16 * 9; i++) data.set([value, value, value, 255], i * 4);
        return { data, width: 16, height: 9 };
      });
      const a = new Float32Array(144), b = new Float32Array(144); a[18] = 1; b[29] = 1;
      const masks = await propagateMaskInterval(frames, a, b, 16, 9);
      const cutClean = masks[1][18] === 1 && masks[1][29] === 0
        && masks[2][18] === 0 && masks[2][29] === 1;
      const result = { sourceTimestamp: actual.mediaTime, requestedTimestamp: video.currentTime,
        publishedTimestamp: published[0], timestampPreserved: preserved,
        disabledPublications: disabledPublications.length, cutClean, frames: 8, model: 'deterministic fixture (no inference)' };
      document.querySelector('#result').textContent = JSON.stringify(result, null, 2);
      return result;
    } finally { stop(); await handle.dispose(); URL.revokeObjectURL(url); video.removeAttribute('src'); video.load(); }
  });
  assert.equal(result.timestampPreserved, true, JSON.stringify(result));
  assert.equal(result.disabledPublications, 0, JSON.stringify(result));
  assert.equal(result.cutClean, true, JSON.stringify(result));
  assert.deepEqual(errors, []);
  assert.deepEqual(blockedModels, []);
  console.log('PASS real browser video decoding, OPFS source timestamps, disable race and scene-local masks', JSON.stringify(result));
} finally { await session.kapat(); }
