import assert from 'node:assert/strict';
import { createLiveWarmupGate } from '../src/engine/vision/liveDepth.ts';

const gate = createLiveWarmupGate();
let release;
const blocked = new Promise((resolve) => { release = resolve; });
const events = [];
const warmup = gate.run(async () => {
  events.push('warmup-start');
  await blocked;
  events.push('warmup-end');
});
const consumer = gate.wait().then(() => events.push('consumer'));
await Promise.resolve();
assert.deepEqual(events, ['warmup-start'], 'live inference must wait for warmup');
release();
await Promise.all([warmup, consumer]);
assert.deepEqual(events, ['warmup-start', 'warmup-end', 'consumer']);

await gate.run(async () => { events.push('next-warmup'); });
assert.equal(events.at(-1), 'next-warmup', 'settled gate should not block later work');
console.log('OK live warmup gate');
