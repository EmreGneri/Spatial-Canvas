// Exercise the Engine's splat buffer ownership without allocating a WebGL context.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.(?:ts|js|mjs|json)$/.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { /* Try the original specifier. */ }
    }
    return nextResolve(specifier, context);
  },
});

const { Engine } = await import('../src/engine/Engine.ts');
const { createGaussianTextures } = await import('../src/engine/splats.ts');
const { POSITION_TEXTURE_SIZE } = await import('../src/engine/buffers.ts');

const engine = Object.create(Engine.prototype);
const textures = createGaussianTextures();
engine.splatObject = {
  textures,
  count: 0,
  syncFromTextures(count) { this.count = count; },
};
engine.homeTexture = { image: { data: new Float32Array(POSITION_TEXTURE_SIZE ** 2 * 4) } };
engine.currentDepthTexture = { image: { data: new Float32Array(4), width: 1, height: 1 } };
engine.syncRenderVisibility = () => {};
engine.pushSharedUniformsAll = () => {};

const fused = {
  count: 1,
  a: new Float32Array([0.25, 0.5, 0.75, 1]),
  b: new Float32Array([0, 0, 1, 0.1]),
  c: new Float32Array([1, 0, 0, 1]),
};
engine.setGaussians(fused);
assert.equal(engine.splatObject.count, 1);
engine.refreshGaussians();
assert.equal(engine.splatObject.count, 1, 'live depth must not overwrite the captured splat scene');
assert.equal(textures.a.image.data[0], 0.25, 'authored splat position remains unchanged');

engine.setVideoSource(null);
engine.refreshGaussians();
assert.equal(engine.splatObject.count, POSITION_TEXTURE_SIZE ** 2, 'changing source restores the live point-cloud bridge');

console.log('OK · fused Gaussian scene survives depth refresh, new source restores bridge');
