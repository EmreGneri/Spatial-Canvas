import assert from 'node:assert/strict';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';
const session = await tarayiciOturumu({ chrome: true, basli: true });
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
    const progress = [];
    const handle = await prepareVideoDepth(new Blob([target.buffer], { type: 'video/webm' }), {
      onProgress: value => { progress.push(value); document.querySelector('#result').textContent = JSON.stringify(value); },
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
      mediaTime: frame?.mediaTime, decodedFrames: progress.filter(p => p.stage === 'decoding').length - 1,
      stage: progress.at(-1), providerDisposed: disposed };
    output.maskBefore = handle.hasMask(0.3);
    await handle.prepareMasks(async f => new Float32Array(f.width * f.height).fill(0.75));
    const masked = await handle.frameAt(0.3);
    output.mask = { ready: handle.hasMask(0.3), value: masked?.mask?.[0], length: masked?.mask?.length };
    await handle.dispose(); output.disposed = !handle.hasFrame(0.2);
    document.querySelector('#result').textContent = JSON.stringify(output, null, 2);
    return output;
  }, real), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Browser integration timed out')), real ? 210_000 : 60_000); })]);
  clearTimeout(timer);
  assert.equal(result.ready, true, JSON.stringify(result));
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
} finally { await session.kapat(); }
