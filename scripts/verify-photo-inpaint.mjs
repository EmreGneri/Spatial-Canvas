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

const { inpaintMaskedPhoto } = await import('../src/engine/reconstruction/photo-inpaint.ts');

// A horizontal background gradient is hidden by a foreground rectangle. The
// completed layer should smoothly continue the known colors through it.
const width = 17;
const height = 9;
const rgb = new Float32Array(width * height * 3);
const mask = new Float32Array(width * height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = y * width + x;
    rgb[i * 3] = x / (width - 1);
    rgb[i * 3 + 1] = y / (height - 1);
    rgb[i * 3 + 2] = 0.25;
    if (x >= 5 && x <= 11 && y >= 2 && y <= 6) mask[i] = 1;
  }
}
const filled = inpaintMaskedPhoto(rgb, width, height, mask);
assert.equal(filled.length, rgb.length, 'preserves RGB buffer dimensions');
assert.deepEqual(filled.slice(0, 3), rgb.slice(0, 3), 'preserves known pixels exactly');
const center = (4 * width + 8) * 3;
assert.ok(Math.abs(filled[center] - 0.5) < 0.08, 'continues horizontal gradient through the hidden region');
assert.ok(Math.abs(filled[center + 1] - 0.5) < 0.1, 'continues vertical gradient through the hidden region');
assert.equal(filled[center + 2], 0.25, 'preserves constant background channel');
assert.deepEqual(
  inpaintMaskedPhoto(rgb, width, height, new Float32Array(width * height)),
  rgb,
  'does not change an image when no foreground is masked',
);
console.log('PASS photo inpaint: gradient continuation, known pixels, no-mask identity');
