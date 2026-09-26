import assert from 'node:assert/strict';
import { fadeGaussianOpacity } from '../src/engine/reconstruction/gaussianDeform.ts';

function near(actual, expected, label, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, received ${actual}`);
}

const gaussian = (x, y, z, logitOpacity = 0.4) =>
  [x, y, z, Math.log(0.1), Math.log(0.1), Math.log(0.1), 1, 0, 0, 0, 0.1, 0.2, 0.3, logitOpacity, 7, 9];

// Inside the region (|r| <= halfLength): opacity untouched, bit-identical.
const halfLength = 2;
const inside = new Float32Array([...gaussian(0, 0, 0), ...gaussian(1.5, 0, 0), ...gaussian(0, -2, 0)]);
const insideFaded = fadeGaussianOpacity(inside, 3, halfLength);
assert.deepEqual(insideFaded, inside, 'inside the region opacity (and everything else) is bit-identical');

// Just beyond the edge: still very close to unfaded (continuity), strictly
// less than 1 slope near the boundary, then strictly decreasing further out.
const source = new Float32Array([
  ...gaussian(3, 0, 0), // r=3, excess=1
  ...gaussian(6, 0, 0), // r=6, excess=4
  ...gaussian(halfLength + 1e-6, 0, 0), // r just past the edge
]);
const faded = fadeGaussianOpacity(source, 3, halfLength);
// position, scale, quaternion, DC and padding must be untouched
for (const base of [0, 16, 32]) {
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15]) {
    near(faded[base + i], source[base + i], `field ${i} at base ${base} untouched by opacity fade`);
  }
}
const opacityOf = (logit) => 1 / (1 + Math.exp(-logit));
const nearBoundary = opacityOf(faded[13]);
const farOut = opacityOf(faded[16 + 13]);
const barelyBeyond = opacityOf(faded[32 + 13]);
const original = opacityOf(source[13]);
assert.ok(nearBoundary < original, 'opacity strictly decreases just beyond the region');
assert.ok(farOut < nearBoundary, 'fade is monotone: farther out fades more');
near(barelyBeyond, original, 'continuous at the boundary (opacity ~unchanged just past the edge)', 1e-4);

// Monotone sweep along a ray, well beyond the tested points above.
let previous = opacityOf(fadeGaussianOpacity(new Float32Array(gaussian(halfLength, 0, 0)), 1, halfLength)[13]);
for (let r = halfLength + 0.25; r <= halfLength * 8; r += 0.25) {
  const opacity = opacityOf(fadeGaussianOpacity(new Float32Array(gaussian(r, 0, 0)), 1, halfLength)[13]);
  assert.ok(opacity <= previous + 1e-12, `monotone fade at r=${r}: ${opacity} should be <= ${previous}`);
  assert.ok(opacity > 0 && opacity < 1, `opacity stays a valid probability at r=${r}`);
  previous = opacity;
}

// Radial distance, not a single axis: an off-axis point at the same radius fades identically.
const onAxis = fadeGaussianOpacity(new Float32Array(gaussian(5, 0, 0)), 1, halfLength);
const offAxis = fadeGaussianOpacity(new Float32Array(gaussian(0, 3, 4)), 1, halfLength);
near(opacityOf(onAxis[13]), opacityOf(offAxis[13]), 'fade depends on 3D radial distance, not a single axis', 1e-9);

// Disabled (Infinity halfLength, i.e. the toggle is off): bit-identical, no fade at all.
const anySource = new Float32Array([...gaussian(0, 0, 0), ...gaussian(1000, 0, 0)]);
assert.deepEqual(fadeGaussianOpacity(anySource, 2, Infinity), anySource, 'Infinity half-length = fade disabled, bit-identical');

// Never fully zeros or inverts opacity (outliers must not vanish completely).
const distant = fadeGaussianOpacity(new Float32Array(gaussian(1e4, 0, 0)), 1, halfLength);
assert.ok(opacityOf(distant[13]) > 0, 'even extreme outliers keep a positive opacity, never hard-clipped to zero');

// Invalid inputs.
assert.throws(() => fadeGaussianOpacity(new Float32Array(16), 1, 0), /positive half-length/);
assert.throws(() => fadeGaussianOpacity(new Float32Array(16), 1, -1), /positive half-length/);
assert.throws(() => fadeGaussianOpacity(new Float32Array(8), 1, 1), /valid Gaussian count/);

console.log('OK · far-background opacity fade (pure function)');
