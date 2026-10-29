// The brightness preview runs only until the live depth model takes over. Run on every decoded
// frame (30 fps x 60-180 ms) it kept the main thread ~100 % busy and starved model start-up
// (docs/benchmarks/video-startup-mask-latency.md). Budget: at most PREVIEW_DUTY of main-thread time.
import assert from 'node:assert/strict';
import { previewNextAt, PREVIEW_DUTY } from '../src/engine/vision/previewBudget.ts';

// 30 fps decoded frames, each preview tick costs `cost` ms; count ticks and busy time over 10 s.
const simulate = (cost) => {
  let next = 0, busy = 0, ticks = 0, firstAt = null;
  for (let t = 0; t < 10_000; t += 1000 / 30) {
    if (t < next) continue;
    ticks++; firstAt ??= t; busy += cost;
    next = previewNextAt(t, t + cost);
  }
  return { ticks, duty: busy / 10_000, firstAt };
};

for (const cost of [5, 20, 70, 180]) {
  const r = simulate(cost);
  assert.equal(r.firstAt, 0, 'the first frame is shown at once');
  assert.ok(r.duty <= PREVIEW_DUTY + 0.02, `cost ${cost} ms: duty ${r.duty.toFixed(2)} > ${PREVIEW_DUTY}`);
  assert.ok(r.ticks >= 10, `cost ${cost} ms: preview still updates (${r.ticks} ticks / 10 s)`);
}
assert.ok(simulate(5).ticks >= 290, 'a cheap preview keeps every frame');
assert.ok(PREVIEW_DUTY > 0 && PREVIEW_DUTY <= 0.5);
console.log('verify-preview-budget OK', [5, 20, 70, 180].map(c => `${c}ms:${simulate(c).ticks}`).join(' '));
