import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
assert.ok(existsSync(new URL('./vda-temporal-metrics.mjs', import.meta.url)), 'Temporal metrics implementation must exist');
const { temporalDepthMetrics } = await import('./vda-temporal-metrics.mjs');
const w = 20, h = 12;
const frame = (tx, z = 5) => ({
  camera: { R: [1,0,0,0,1,0,0,0,1], t: [-tx,0,0], f: 20, cx: w/2, cy: h/2, w, h },
  depth: new Float32Array(w*h).fill(z), gt: new Float32Array(w*h).fill(5), rgb: new Float32Array(w*h*3).fill(0.5),
});
const steady = temporalDepthMetrics([frame(0), frame(0.25)]);
assert.ok(steady.tae < 1e-7 && steady.opwMeters < 1e-7);
assert.ok(steady.taeSamples > 0 && steady.opwSamples > 0);
const flicker = temporalDepthMetrics([frame(0), frame(0, 5.5)]);
assert.ok(Math.abs(flicker.tae - (0.1 + 1/11)/2) < 1e-6);
assert.ok(Math.abs(flicker.opwMeters - 0.5) < 1e-6);
const occluded = frame(0.25); occluded.gt.fill(50);
assert.equal(temporalDepthMetrics([frame(0), occluded]).opwSamples, 0, 'GT occlusions cannot produce optical-flow correspondences');
console.log('verify-vda-temporal-metrics: stable, flickering and occluded planes passed');
