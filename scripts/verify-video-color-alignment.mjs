import { Vector3 as LayerVector3 } from 'three';
// Video colors and reference anatomical geometry use the same source coordinates.
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
const { createHomeTexture, POSITION_TEXTURE_SIZE: N } = await import('../src/engine/buffers.ts');
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
Object.assign(engine, { layerGap: 0, layerVisible: new LayerVector3(1, 1, 1),
  layers: null, layerTexture: null, layerInput: null });
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
const linear = sampleVolumePositions(depth, width, height, {
  gridSize: N, importanceSampling: false, referenceVideo: { aspect: width / height },
});
const warped = sampleVolumePositions(depth, width, height, { gridSize: N });
const near = (a, b) => Math.abs(a - b) < 1e-5;
let warpedSamples = 0;
for (const [x, y] of [[80, 80], [192, 80], [300, 192], [192, 300]].map((p) => p.map((c) => Math.round((c * N) / 384)))) {
  const z = (y * N + x) * 4 + 2;
  assert.ok(near(actual[z], linear[z]), `video depth at (${x}, ${y}) must match raw video UV`);
  const offset = z - 2;
  const u = (x + 0.5) / N;
  const v = 1 - (y + 0.5) / N;
  const baseX = (u - 0.5) * 2 * (width / height);
  const baseY = (v - 0.5) * 2;
  assert.ok(near(actual[offset], baseX),
    'reference geometry and video color use the same horizontal source coordinate');
  assert.ok(near(actual[offset + 1], baseY),
    'reference geometry and video color use the same vertical source coordinate');
  if (!near(warped[z], linear[z])) warpedSamples++;
}
assert.ok(warpedSamples > 0, 'fixture must reveal the color/depth UV mismatch');

const emptyScene = new Float32Array(width * height);
engine.setDepth(emptyScene, width, height);
for (const [x, y] of [[0, 0], [N >> 1, N >> 1], [N - 1, N - 1]]) {
  const offset = (y * N + x) * 4;
  assert.equal(actual[offset + 3], Math.fround(0.2), 'empty reference scene keeps low-opacity backdrop samples');
  assert.equal(actual[offset + 2], -1, 'empty reference scene keeps its distant backdrop depth');
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
assert.equal(colors[((N >> 1) * N + Math.round((80 * N) / 384)) * 4], 255, 'left video pixels remain red');
assert.equal(colors[((N >> 1) * N + Math.round((300 * N) / 384)) * 4 + 2], 255, 'right video pixels remain blue');

console.log('OK · video depth coordinates align with raw video color UVs');
