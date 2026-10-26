import { Vector3 as LayerVector3 } from 'three';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.(ts|js|mjs|json)$/.test(specifier)) {
    try { return next(`${specifier}.ts`, context); } catch { /* Original resolver reports errors. */ }
  }
  return next(specifier, context);
} });
const { Engine } = await import('../src/engine/Engine.ts');
const { createHomeTexture } = await import('../src/engine/buffers.ts');
const engine = Object.create(Engine.prototype);
Object.assign(engine, { layerGap: 0, layerVisible: new LayerVector3(1, 1, 1),
  layers: null, layerTexture: null, layerInput: null });
assert.equal(typeof engine.setVideoEdgeCleanup, 'function', 'Engine exposes the video cleanup control');
engine.setVideoEdgeCleanup(9);
assert.equal(engine.videoEdgeCleanupStrength, 4, 'cleanup clamps to the supported range');
engine.setVideoEdgeCleanup(-2);
assert.equal(engine.videoEdgeCleanupStrength, 0, 'zero disables cleanup');
engine.setVideoEdgeCleanup(NaN);
assert.equal(engine.videoEdgeCleanupStrength, 0, 'invalid UI input cannot poison geometry');
engine.homeTexture = createHomeTexture();
engine.videoTexture = { image: {} };
engine.camera = { fov: 60, aspect: 2 };
engine.simulation = { seedFrom() {} };
engine.renderModeName = 'points';
engine.gaussianSource = 'point-cloud';
engine.setDepth(new Float32Array(8).fill(0.5), 4, 2,
  undefined, undefined, undefined, undefined, new Float32Array(8));
const positions = engine.homeTexture.image.data;
for (let i = 0; i < positions.length; i += 4) {
  assert.equal(positions[i + 3], 0, 'untrusted flow samples cannot draw');
  assert.ok(Number.isFinite(positions[i] + positions[i + 1] + positions[i + 2]), 'masked geometry stays finite');
}
console.log('OK video edge Engine control');
