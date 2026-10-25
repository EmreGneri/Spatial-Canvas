import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { resampleVideoDepthEdges } from '../src/engine/reconstruction/videoDepthEdges.ts';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.(?:ts|js|mjs|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context); } catch { /* Keep original resolution. */ }
  }
  return nextResolve(specifier, context);
} });
const { sampleVolumePositions } = await import('../src/engine/reconstruction/sampler.ts');

const step = new Float32Array([0.1, 0.1, 0.1, 0.9, 0.9, 0.9]);
const off = resampleVideoDepthEdges(step, 6, 1, 12, 0);
assert.ok(off.depth.some(d => d > 0.15 && d < 0.85), 'off retains bilinear interpolation');
assert.ok(off.confidence.every(a => a === 1));
const clean = resampleVideoDepthEdges(step, 6, 1, 12, 2);
assert.ok(clean.depth.every(d => d < 0.15 || d > 0.85), 'no interpolated depth curtain');
assert.ok(clean.depth.filter(d => d > 0.85).length > off.depth.filter(d => d > 0.85).length,
  'maximum disparity expands the near surface');
assert.ok(clean.confidence.some(a => a < 1), 'relative depth discontinuities lower confidence');
assert.ok(clean.depth.every((d, i) => d < 0.85 || clean.confidence[i] === 1),
  'unmasked near silhouette never shrinks through confidence culling');
const aligned = resampleVideoDepthEdges(step, 6, 1, 6, 2);
assert.equal(aligned.confidence[1], 0, 'far side of a native-grid depth jump is culled');
assert.equal(aligned.confidence[2], 1, 'near silhouette is preserved');

const mask = new Float32Array([0, 0, 0, 1, 1, 1]);
const soft = new Float32Array([0.1, 0.1, 0.4, 0.6, 0.9, 0.9]);
const guided = resampleVideoDepthEdges(soft, 6, 1, 12, 2, mask);
for (let y = 0; y < 12; y++) {
  assert.ok(guided.depth[y * 12 + 5] < 0.15, 'mask background contour stays on far surface');
  assert.ok(guided.depth[y * 12 + 6] > 0.85, 'mask foreground contour snaps to near surface');
  assert.equal(guided.confidence[y * 12 + 6], 1, 'foreground silhouette is not culled');
}
const invalid = resampleVideoDepthEdges(new Float32Array([NaN, Infinity, -1, 2]), 2, 2, 7, 4);
assert.ok(invalid.depth.every(d => Number.isFinite(d) && d >= 0 && d <= 1));
assert.ok(invalid.confidence.every(d => Number.isFinite(d) && d >= 0 && d <= 1));
const one = resampleVideoDepthEdges(new Float32Array([0.7]), 1, 1, 3, 4);
assert.ok(one.depth.every(d => Math.abs(d - 0.7) < 1e-6));
const fullFrame = { cameraDistance: 3.5 };
const baseline = sampleVolumePositions(step, 6, 1, { gridSize: 12, fullFrame });
assert.deepEqual(sampleVolumePositions(step, 6, 1, {
  gridSize: 12, fullFrame, videoEdgeCleanup: 0,
}), baseline, 'zero preserves existing full-frame output exactly');
const enhanced = sampleVolumePositions(step, 6, 1, { gridSize: 12, fullFrame, videoEdgeCleanup: 2 });
assert.ok(enhanced.some((value, i) => i % 4 === 3 && value === 0), 'confidence reaches point opacity');
assert.deepEqual(sampleVolumePositions(step, 6, 1, { gridSize: 12, videoEdgeCleanup: 4 }),
  sampleVolumePositions(step, 6, 1, { gridSize: 12 }), 'photo geometry remains unchanged');
const invalidConfidence = new Float32Array([0, NaN, 0, 0, 0, 0]);
const hidden = sampleVolumePositions(step, 6, 1, {
  gridSize: 12, fullFrame, videoFlowConfidence: invalidConfidence,
});
assert.ok(hidden.every((v, i) => i % 4 === 3 ? v === 0 : Number.isFinite(v)),
  'invalid flow confidence hides points without invalidating geometry');
const fineMask = { data: new Float32Array([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1]), width: 12, height: 1 };
const fine = resampleVideoDepthEdges(step, 6, 1, 12, 2, mask, fineMask);
assert.ok(fine.depth[5] > 0.85 && fine.confidence[5] === 1,
  'full resolution mask recovers foreground beyond coarse depth mask');
const finePositions = sampleVolumePositions(step, 6, 1, {
  gridSize: 12, fullFrame, videoEdgeCleanup: 2, foregroundMask: mask, videoGuideMask: fineMask,
});
assert.equal(finePositions[5 * 4 + 3], 1, 'full resolution foreground remains opaque');
// Item 8: the separable (maskless) dilation must equal the masked kernel when every pixel is foreground.
{
  const w = 40, h = 23;
  const noisy = Float32Array.from({ length: w * h }, (_, i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1);
  const ones = new Float32Array(w * h).fill(1);
  for (const strength of [1, 2, 4]) {
    assert.deepEqual(resampleVideoDepthEdges(noisy, w, h, 64, strength).depth,
      resampleVideoDepthEdges(noisy, w, h, 64, strength, ones).depth, `separable dilation, strength ${strength}`);
  }
}
console.log('OK · video depth dilation, discontinuity confidence and mask-guided contour');
