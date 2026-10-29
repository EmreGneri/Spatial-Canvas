import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.(?:ts|js|mjs|json)$/.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { /* Keep original resolution. */ }
    }
    return nextResolve(specifier, context);
  },
});

const { createHomeTexture, fillPositionsFromDepth, POSITION_TEXTURE_SIZE } = await import('../src/engine/buffers.ts');
const { VIDEO_BACKDROP_OPACITY, sampleVolumePositions } = await import('../src/engine/reconstruction/sampler.ts');

const width = 4;
const height = 2;
const depth = new Float32Array(width * height).fill(0.75);
const fullFrame = { cameraDistance: 3.5 };
const unmasked = sampleVolumePositions(depth, width, height, {
  gridSize: 8, fullFrame, worldHeight: 3.2,
});
const mask = new Float32Array(width * height);
for (let y = 0; y < height; y++) mask[y * width] = 1;
const masked = sampleVolumePositions(depth, width, height, {
  gridSize: 8, fullFrame, worldHeight: 3.2,
  foregroundMask: mask,
});
for (let offset = 0; offset < masked.length; offset += 4) {
  assert.deepEqual(masked.subarray(offset, offset + 3), unmasked.subarray(offset, offset + 3),
    'a segmentation mask must not switch live video to portrait silhouette geometry');
}
assert.equal(masked[(4 * 8 + 0) * 4 + 3], 1, 'foreground pixels remain opaque');
assert.ok(Math.abs(masked[(4 * 8 + 7) * 4 + 3] - VIDEO_BACKDROP_OPACITY) < 1e-6,
  'background pixels use the existing two-level alpha');
const invalidMask = sampleVolumePositions(depth, width, height, {
  gridSize: 8, fullFrame, foregroundMask: new Float32Array(1),
});
assert.equal(invalidMask[(4 * 8 + 7) * 4 + 3], 1,
  'a malformed mask must not make the video frame disappear');

const home = createHomeTexture();
fillPositionsFromDepth(home, depth, width, height, {
  fullFrame, worldHeight: 3.2, foregroundMask: new Float32Array(width * height),
  importanceSampling: false,
});
const actual = home.image.data;
const first = [actual[0], actual[1], actual[2], actual[3]];
const expectedZ = 0.5;
const expectedScale = (3.5 - expectedZ) / 3.5;
const expectedX = ((0.5 / POSITION_TEXTURE_SIZE) - 0.5) * 2 * (width / height) * 1.6 * expectedScale;
const expectedY = (0.5 - (0.5 / POSITION_TEXTURE_SIZE)) * 2 * 1.6 * expectedScale;
assert.ok(Math.abs(first[0] - expectedX) < 1e-6,
  'video worldHeight must reach the position buffer in X');
assert.ok(Math.abs(first[1] - expectedY) < 1e-6,
  'video worldHeight must reach the position buffer in Y');
assert.equal(first[2], expectedZ);
assert.ok(Math.abs(first[3] - VIDEO_BACKDROP_OPACITY) < 1e-6,
  'mask dims background without changing full-frame video geometry');

// F7: cloud width follows the source video aspect, not the depth grid
// (prepared 266x154 and live V2 grids must give the same 16:9 cloud).
{
  const span = (w, h) => {
    const p = sampleVolumePositions(new Float32Array(w * h).fill(0.5), w, h,
      { gridSize: 8, worldHeight: 2, fullFrame: { cameraDistance: 3.5, aspect: 16 / 9 } });
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.length; i += 4) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); }
    return hi - lo;
  };
  assert.ok(Math.abs(span(266, 154) - span(32, 18)) < 1e-6, 'prepared and live grids share the video width');
}

console.log('OK · full-frame video geometry stays aligned across masks and world heights');
