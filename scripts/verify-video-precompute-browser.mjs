import assert from 'node:assert/strict';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';
const session = await tarayiciOturumu({ chrome: true, basli: true,
  vite: { server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } } });
const real = process.argv.includes('--real');
try {
  await session.page.route('**/__prepared_video_test', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><h1>Video preparation integration check</h1><pre id="result">Checking real decoder and OPFS with a deterministic test provider…</pre>' }));
  await session.page.goto(session.url('/__prepared_video_test'));
  await session.page.bringToFront();
  let timer;
  const result = await Promise.race([session.page.evaluate(async real => {
    const { prepareVideoDepth } = await import('/src/engine/vision/videoPrecompute.ts');
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext('2d');
    const mb = await import('/src/vendor/splat.js/vendor/mediabunny.min.mjs');
    const target = new mb.BufferTarget();
    const muxer = new mb.Output({ format: new mb.WebMOutputFormat(), target });
    const source = new mb.CanvasSource(canvas, { codec: 'vp9', bitrate: 100_000 });
    muxer.addVideoTrack(source, { frameRate: 10 });
    await muxer.start();
    for (let i = 0; i < 8; i++) {
      context.fillStyle = `rgb(${40 + i * 15},80,120)`; context.fillRect(0, 0, 160, 90);
      await source.add(i / 10, 1 / 10);
    }
    source.close(); await muxer.finalize();
    let disposed = false;
    let decodeStarted = 0, decodeElapsed = 0;
    const progress = [];
    const handle = await prepareVideoDepth(new Blob([target.buffer], { type: 'video/webm' }), {
      onProgress: value => {
        if (value.stage === 'decoding' && !decodeStarted) decodeStarted = performance.now();
        if (value.stage === 'processing' && !decodeElapsed) decodeElapsed = performance.now() - decodeStarted;
        progress.push(value); document.querySelector('#result').textContent = JSON.stringify(value);
      },
      shouldPause: real ? undefined : () => true,
      provider: real ? undefined : { width: 16, height: 9,
        infer: async frames => frames.map(frame => Float32Array.from({ length: 144 }, (_, i) => frame[0] / 255 + i / 144)),
        dispose: async () => { disposed = true; } },
    });
    await Promise.race([handle.done, new Promise((_, reject) => setTimeout(() => reject(Error('Preparation timed out')), real ? 180_000 : 30_000))]);
    const frame = await handle.frameAt(0.6), ready = handle.hasFrame(0.6);
    const timestamps = [];
    for (let i = 0; i < 8; i++) timestamps.push((await handle.frameAt(i / 10 + 1e-6))?.mediaTime);
    const output = { ready, frame: frame && { width: frame.width, height: frame.height, finite: frame.data.every(Number.isFinite) },
      timestamps,
      decodeElapsed, finalized: progress.some(p => p.stage === 'finalizing'),
      processingStart: progress.find(p => p.stage === 'processing')?.processedSeconds,
      mediaTime: frame?.mediaTime, decodedFrames: progress.filter(p => p.stage === 'decoding').length - 1,
      stage: progress.at(-1), providerDisposed: disposed };
    output.maskBefore = handle.hasMask(0.3);
    await handle.prepareMasks(async f => new Float32Array(f.width * f.height).fill(0.75));
    const masked = await handle.frameAt(0.3, true);
    output.mask = { ready: handle.hasMask(0.3), value: masked?.mask?.[0], length: masked?.mask?.length };
    await handle.dispose(); output.disposed = !handle.hasFrame(0.2);
    document.querySelector('#result').textContent = JSON.stringify(output, null, 2);
    return output;
  }, real), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Browser integration timed out')), real ? 210_000 : 60_000); })]);
  clearTimeout(timer);
  assert.equal(result.ready, true, JSON.stringify(result));
  if (!real) assert.ok(result.decodeElapsed < 3000, `playback pressure must not add a second per decoded frame: ${result.decodeElapsed} ms`);
  assert.equal(result.finalized, true, 'storage finalization has a distinct progress stage');
  assert.equal(result.processingStart, 0, 'inference must not inherit the final decoder timestamp');
  assert.equal(result.frame.finite, true);
  assert.ok(result.decodedFrames <= 2, 'progress is throttled (F3), not one React update per decoded frame');
  result.timestamps.forEach((time, i) => assert.ok(Math.abs(time - i / 10) < 0.001, `source timestamp ${i} preserved`));
  assert.equal(new Set(result.timestamps).size, 8);
  assert.ok(result.mediaTime >= 0.5, 'late playback must read a late source frame');
  assert.equal(result.disposed, true);
  assert.equal(result.maskBefore, false, 'no mask track until object separation asks for it');
  assert.equal(result.mask.ready, true, 'mask track becomes readable');
  assert.ok(Math.abs(result.mask.value - 0.75) < 0.01 && result.mask.length === result.frame.width * result.frame.height, JSON.stringify(result.mask));
  assert.equal(result.frame.width, real ? 266 : 16);
  assert.equal(result.frame.height, real ? 154 : 9);
  if (!real) assert.equal(result.providerDisposed, true);
  console.log(`OK ${real ? 'actual offline32 model +' : ''} real browser video decoder, timestamps, OPFS Uint16 readback and cleanup`, JSON.stringify(result));
  if (!real) await regressions(session);
} finally { await session.kapat(); }

/** Audit 2026-10-31 items 4-7, deterministic provider and synthetic masks in real Chrome/WebCodecs/OPFS. */
async function regressions(session) {
  // Two-scene synthetic clip (6 dark frames, hard cut, 6 light frames) and a 40x23 provider
  // whose squeezed subject box covers 32.6 % of the grid.
  const clip = await session.page.evaluate(async () => {
    const mb = await import('/src/vendor/splat.js/vendor/mediabunny.min.mjs');
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext('2d');
    const target = new mb.BufferTarget(), muxer = new mb.Output({ format: new mb.WebMOutputFormat(), target });
    const source = new mb.CanvasSource(canvas, { codec: 'vp9', bitrate: 100_000 });
    muxer.addVideoTrack(source, { frameRate: 10 }); await muxer.start();
    for (let i = 0; i < 12; i++) { context.fillStyle = i < 6 ? '#282828' : '#eeeeee'; context.fillRect(0, 0, 160, 90); await source.add(i / 10, 0.1); }
    source.close(); await muxer.finalize();
    const box = i => i % 40 >= 10 && i % 40 < 30 && Math.floor(i / 40) >= 4 && Math.floor(i / 40) < 19;
    window.subjectMask = () => Float32Array.from({ length: 920 }, (_, i) => box(i) ? 1 : 0);
    window.testProvider = () => ({ width: 40, height: 23, dispose: async () => {},
      infer: async frames => frames.map(() => Float32Array.from({ length: 920 }, (_, i) => box(i) ? 0.7 + 0.04 * (i % 40) / 40 : 0.2)) });
    window.testClip = () => new Blob([target.buffer], { type: 'video/webm' });
    return Array.from(new Uint8Array(target.buffer));
  });

  const masks = await session.page.evaluate(async () => {
    const { prepareVideoDepth } = await import('/src/engine/vision/videoPrecompute.ts');
    const handle = await prepareVideoDepth(window.testClip(), { provider: window.testProvider() });
    await handle.done;
    window.fullBeforeMasks = await handle.frameAt(0.2, false);
    let rejected = 0;
    // The second (light) scene's segmentation is rejected at every key frame.
    await handle.prepareMasks(async frame => {
      if (frame.data[0] > 100) { rejected++; return null; }
      return window.subjectMask();
    });
    const coverage = f => f?.mask ? f.mask.reduce((s, v) => s + (v >= 0.5), 0) / 920 : null;
    const first = await handle.frameAt(0.2, true), second = await handle.frameAt(0.8, true);
    const out = { rejected, firstMask: handle.hasMask(0.2), firstCoverage: coverage(first),
      secondMask: handle.hasMask(0.8), secondCoverage: coverage(second), secondReadable: !!second };
    // #6 Separation on/off/on after the mask track: off returns the original full-scene file.
    const diff = (a, b) => a.data.reduce((s, v, i) => s + Math.abs(v - b.data[i]), 0) / a.data.length;
    const off = await handle.frameAt(0.2, false), on = await handle.frameAt(0.2, true);
    out.toggle = { offDiff: diff(window.fullBeforeMasks, off), offMask: !!off.mask,
      onDiff: diff(window.fullBeforeMasks, on), onMask: !!on.mask, defaultMask: !!(await handle.frameAt(0.2)).mask };
    await handle.dispose();
    return out;
  });
  assert.equal(masks.rejected, 2, JSON.stringify(masks));
  assert.equal(masks.firstMask, true, 'the first scene keeps its trusted mask');
  assert.ok(Math.abs(masks.firstCoverage - 0.326087) < 1e-4, JSON.stringify(masks));
  assert.equal(masks.secondMask, false, `#4 a rejected scene must not inherit the previous scene's mask: ${JSON.stringify(masks)}`);
  assert.equal(masks.secondCoverage, null, 'the rejected scene reads full-scene depth without a mask');
  assert.equal(masks.secondReadable, true);
  console.log('OK #4 scene-local mask fallback', JSON.stringify(masks));
  assert.equal(masks.toggle.offDiff, 0, `#6 separation off must read the full-scene depth again: ${JSON.stringify(masks.toggle)}`);
  assert.equal(masks.toggle.offMask, false);
  assert.ok(masks.toggle.onDiff > 0.05 && masks.toggle.onMask, `separation on reads the mask-stretched track: ${JSON.stringify(masks.toggle)}`);
  assert.equal(masks.toggle.defaultMask, false, 'the mask track is opt-in per read');
  console.log('OK #6 mask mode chosen at cache read', JSON.stringify(masks.toggle));

  // #7 Model download/compile happens inside the metadata callback: the decoder's 30 s idle
  // timer (shortened to 300 ms, still far above a 40x23 frame gap) must not run during it.
  // Slow model prep (1 s), healthy video.
  const slowModel = await session.page.evaluate(async () => {
    const { decodeVideoDepthSource } = await import('/src/engine/vision/videoPrecomputeDecode.ts');
    const native = window.setTimeout;
    window.setTimeout = (callback, ms, ...args) => native(callback, ms === 30_000 ? 300 : ms, ...args);
    let frames = 0;
    try {
      await decodeVideoDepthSource(window.testClip(), 40, 23, new AbortController().signal,
        () => new Promise(resolve => native(resolve, 1000)), async () => { frames++; });
      return { frames };
    } catch (error) { return { frames, error: String(error) }; } finally { window.setTimeout = native; }
  });
  assert.deepEqual(slowModel, { frames: 12 }, `#7 slow model preparation must not dispose a valid video: ${JSON.stringify(slowModel)}`);
  console.log('OK #7 decoder idle timer paused during model preparation', JSON.stringify(slowModel));

  // #5 OPFS is shared per origin: a second tab must not delete the first tab's live store,
  // but still removes stores nobody holds (orphan, closed tab).
  const stores = page => page.evaluate(async () => {
    const names = [];
    for await (const name of (await navigator.storage.getDirectory()).keys()) if (name.startsWith('video-depth-')) names.push(name);
    return names.sort();
  });
  const tab = async () => {
    // Same browser context as the first tab (the default context opens pages only as popups).
    const popup = session.page.waitForEvent('popup');
    await session.page.evaluate(() => window.open('about:blank', '_blank'));
    const page = await popup;
    await page.route('**/__prepared_video_test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Second tab</h1>' }));
    await page.goto(session.url('/__prepared_video_test'));
    return page;
  };
  const prepareIn = (page, bytes) => page.evaluate(async bytes => {
    const { prepareVideoDepth } = await import('/src/engine/vision/videoPrecompute.ts');
    const progress = [];
    window.tabHandle = await prepareVideoDepth(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }), { onProgress: p => progress.push(p.stage),
      provider: { width: 40, height: 23, infer: async frames => frames.map(() => new Float32Array(920).fill(0.5)), dispose: async () => {} } });
    await window.tabHandle.done;
    return progress.at(-1);
  }, bytes);
  const readable = page => page.evaluate(async () => ({ hasFrame: window.tabHandle.hasFrame(0.2), readable: !!await window.tabHandle.frameAt(0.2) }));
  assert.equal(await prepareIn(session.page, clip), 'ready');
  const storeA = await stores(session.page);
  await session.page.evaluate(async () => (await navigator.storage.getDirectory()).getDirectoryHandle('video-depth-orphan', { create: true }));
  const tabB = await tab();
  assert.equal(await prepareIn(tabB, clip), 'ready');
  const afterB = await stores(tabB), storeB = afterB.filter(name => !storeA.includes(name));
  const tabs = { storeA: storeA.length, afterB, first: await readable(session.page) };
  assert.deepEqual(tabs.first, { hasFrame: true, readable: true }, `#5 the first tab keeps its store: ${JSON.stringify(tabs)}`);
  assert.ok(storeA.length === 1 && storeB.length === 1 && afterB.length === 2 && !afterB.includes('video-depth-orphan'), JSON.stringify(tabs));
  // Closing a tab releases its lease: the next tab's cleanup removes that store only.
  await tabB.close();
  const tabC = await tab();
  assert.equal(await prepareIn(tabC, clip), 'ready');
  const afterC = await stores(tabC);
  tabs.afterC = afterC; tabs.firstAfterC = await readable(session.page);
  assert.ok(afterC.length === 2 && afterC.includes(storeA[0]) && !afterC.includes(storeB[0]), `closed tab's store is reclaimed: ${JSON.stringify(tabs)}`);
  assert.deepEqual(tabs.firstAfterC, { hasFrame: true, readable: true });
  await tabC.evaluate(() => window.tabHandle.dispose()); await session.page.evaluate(() => window.tabHandle.dispose());
  assert.deepEqual(await stores(session.page), [], 'each tab deletes its own store on dispose');
  console.log('OK #5 cross-tab store ownership', JSON.stringify(tabs));
}
