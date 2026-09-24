// Raw video colors use linear UVs, so live depth must sample the same UVs.
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

const { Engine } = await import('../src/engine/Engine.ts');
const { createHomeTexture } = await import('../src/engine/buffers.ts');
const { sampleVolumePositions } = await import('../src/engine/reconstruction/sampler.ts');

const width = 48;
const height = 32;
const depth = new Float32Array(width * height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    depth[y * width + x] = 0.15 + 0.7 * (x / (width - 1)) ** 2;
  }
}

const engine = Object.create(Engine.prototype);
engine.homeTexture = createHomeTexture();
engine.videoTexture = { image: {} };
engine.camera = { fov: 60, aspect: 800 / 526 };
engine.currentDepthTexture = null;
engine.dynamicHome = false;
engine.seeded = false;
engine.simulation = { seedFrom() {}, setHome() {} };
engine.refreshGaussians = () => {};
engine.setDepth(depth, width, height);

const actual = engine.homeTexture.image.data;
const fittedHeight = 2 * 3.5 * Math.tan(Math.PI / 6)
  * Math.min(1, engine.camera.aspect / (width / height)) * 0.94;
const linear = sampleVolumePositions(depth, width, height, {
  gridSize: 384,
  importanceSampling: false,
  fullFrame: { cameraDistance: 3.5 },
  worldHeight: fittedHeight,
});
const warped = sampleVolumePositions(depth, width, height, { gridSize: 384 });
const near = (a, b) => Math.abs(a - b) < 1e-5;
let warpedSamples = 0;
for (const [x, y] of [[80, 80], [192, 80], [300, 192], [192, 300]]) {
  const z = (y * 384 + x) * 4 + 2;
  assert.ok(near(actual[z], linear[z]), `video depth at (${x}, ${y}) must match raw video UV`);
  const offset = z - 2;
  const u = (x + 0.5) / 384;
  const v = 1 - (y + 0.5) / 384;
  const baseX = (u - 0.5) * fittedHeight * (width / height);
  const baseY = (v - 0.5) * fittedHeight;
  assert.ok(near(actual[offset] / (3.5 - actual[z]), baseX / 3.5),
    'depth must not move a video pixel horizontally in the initial camera');
  assert.ok(near(actual[offset + 1] / (3.5 - actual[z]), baseY / 3.5),
    'depth must not move a video pixel vertically in the initial camera');
  if (!near(warped[z], linear[z])) warpedSamples++;
}
assert.ok(warpedSamples > 0, 'fixture must reveal the color/depth UV mismatch');

const emptyScene = new Float32Array(width * height);
engine.setDepth(emptyScene, width, height);
for (const [x, y] of [[0, 0], [192, 192], [383, 383]]) {
  const offset = (y * 384 + x) * 4;
  assert.equal(actual[offset + 3], 1, 'an unmasked video is a full scene, not a portrait cutout');
  assert.equal(actual[offset + 2], -1, 'distant video pixels retain their depth without backdrop pinning');
}

const pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    pixels[offset] = x < width / 2 ? 255 : 0;
    pixels[offset + 2] = x < width / 2 ? 0 : 255;
    pixels[offset + 3] = 255;
  }
}
engine.pointsMaterial = { uniforms: {
  uImageTexture: { value: null }, uHasImage: { value: 0 },
} };
engine.renderModes = new Map();
engine.setDepth(depth, width, height, undefined, undefined, undefined,
  { data: pixels, width, height });
assert.ok(engine.imageColorTexture, 'a processed video frame needs a stable color grid');
assert.equal(engine.pointsMaterial.uniforms.uImageTexture.value, engine.imageColorTexture,
  'the point renderer must read the color frame paired with this depth result');
const colors = engine.imageColorTexture.image.data;
assert.equal(colors[(192 * 384 + 80) * 4], 255, 'left video pixels remain red');
assert.equal(colors[(192 * 384 + 300) * 4 + 2], 255, 'right video pixels remain blue');

console.log('OK · video depth coordinates align with raw video color UVs');
