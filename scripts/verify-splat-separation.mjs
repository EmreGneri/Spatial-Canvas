// Splat object separation gate (pure CPU).
//
// With object separation ON, every point-based mode discards bridge backdrop
// texels (w = BACKDROP_OPACITY < 0.5). Splat mode used to draw them anyway:
// 82% of the bust photo's splats were backdrop, and their overlapping
// Gaussians merged into a continuous curved "curtain" behind the subject.
//   node scripts/verify-splat-separation.mjs
import assert from 'node:assert/strict';
import { BACKDROP_OPACITY } from '../src/engine/reconstruction/sampler.ts';
import {
  ensureSortScratch,
  sortSplatsByDepth,
  splatOpacityGate,
} from '../src/shaders/splatSort.ts';

const BASE = 0.02;
const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -3, 1];
// Two foreground splats, two backdrop splats (bridge two-level opacity).
const xyzw = new Float32Array([
  0, 0, 0.2, 1,
  0.1, 0, 0.1, 1,
  0, 0.5, -0.8, BACKDROP_OPACITY,
  0.5, 0, -0.7, BACKDROP_OPACITY,
]);
const drawn = (gate) => {
  const r = sortSplatsByDepth('radix', xyzw, 4, view, gate, ensureSortScratch(null, 4));
  return [...r.order.subarray(0, r.count)].sort();
};

// Separation ON + point-cloud bridge: backdrop never enters the draw order.
assert.deepEqual(drawn(splatOpacityGate(BASE, true, 'point-cloud')), [0, 1]);
// Separation OFF: whole scene stays, as in Point Cloud.
assert.deepEqual(drawn(splatOpacityGate(BASE, false, 'point-cloud')), [0, 1, 2, 3]);
// Authored (fused/trained) Gaussians carry real opacities, not the bridge's
// two-level mask; the separation gate must not cull them.
assert.equal(splatOpacityGate(BASE, true, 'authored'), BASE);
// Never lowers a stricter user gate.
assert.equal(splatOpacityGate(0.8, true, 'point-cloud'), 0.8);

console.log('verify-splat-separation: OK');
