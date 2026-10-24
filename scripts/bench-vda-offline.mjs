// Actual exported T32 temporal inference; distinct frames exercise the entire offline provider.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';
const session = await tarayiciOturumu({ chrome: true, basli: true });
const report = { started: new Date().toISOString(), mode: 'true-offline32-154x266' };
try {
  await session.page.route('**/__vda_offline', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>True T32 offline video depth</h1><pre id="status">Loading exported model…</pre>' }));
  await session.page.goto(session.url('/__vda_offline'));
  Object.assign(report, await session.page.evaluate(async () => {
    const { openVideoWindowProvider } = await import('/src/engine/vision/videoPrecomputeProvider.ts');
    const started = performance.now(), provider = await openVideoWindowProvider();
    const loadedMs = performance.now() - started;
    const frames = Array.from({ length: 32 }, (_, frame) => {
      const rgba = new Uint8ClampedArray(266 * 154 * 4);
      for (let i = 0; i < 266 * 154; i++) {
        rgba[i * 4] = (i % 266 + frame * 2) % 256;
        rgba[i * 4 + 1] = (Math.floor(i / 266) * 2 + frame) % 256;
        rgba[i * 4 + 2] = 100; rgba[i * 4 + 3] = 255;
      }
      return rgba;
    });
    try {
      const start = performance.now();
      const output = await provider.infer(frames, undefined, frames.map((_, i) => i));
      let min = Infinity, max = -Infinity, finite = 0;
      for (const frame of output) for (const value of frame) { min = Math.min(min, value); max = Math.max(max, value); if (Number.isFinite(value)) finite++; }
      const result = { loadedMs, windowMs: performance.now() - start, frames: output.length, width: provider.width, height: provider.height, min, max, finite, expectedFinite: 32 * 154 * 266 };
      if (finite !== result.expectedFinite || !(max > min)) throw Error('Invalid true offline32 output');
      document.querySelector('#status').textContent = JSON.stringify(result, null, 2);
      return result;
    } finally { await provider.dispose(); }
  }));
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  mkdirSync('olcum-out/vda', { recursive: true });
  writeFileSync('olcum-out/vda/offline32-smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await session.kapat();
}
