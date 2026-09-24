import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';

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

function makeEngine() {
  const engine = Object.create(Engine.prototype);
  engine.homeTexture = createHomeTexture();
  engine.videoTexture = { image: {} };
  engine.videoElement = { videoWidth: 4096, videoHeight: 1974 };
  engine.camera = { fov: 60, aspect: 800 / 526 };
  engine.currentDepthTexture = null;
  engine.dynamicHome = true;
  engine.seeded = false;
  engine.renderModeName = 'points';
  engine.gaussianSource = 'point-cloud';
  engine.splatObject = {};
  engine.simulation = {
    seedCount: 0,
    homeCount: 0,
    seedFrom() { this.seedCount++; },
    setHome() { this.homeCount++; },
  };
  engine.refreshCount = 0;
  engine.refreshGaussians = () => { engine.refreshCount++; };
  return engine;
}

const width = 64;
const height = 32;
const depth = new Float32Array(width * height).fill(0.5);
const engine = makeEngine();
engine.setDepth(depth, width, height);
const positions = engine.homeTexture.image.data;
const top = positions[1];
const viewHeight = 2 * 3.5 * Math.tan(Math.PI / 6);
const expectedHeight = viewHeight * Math.min(1, engine.camera.aspect / (width / height));
assert.ok(top > expectedHeight * 0.42,
  `video should occupy the viewport instead of a fixed 2-unit rectangle: y=${top}, fitted height=${expectedHeight}`);

const before = [positions[0], positions[1], positions[2]];
const mask = new Float32Array(width * height).fill(1);
mask[0] = 0;
engine.setDepth(depth, width, height, mask, width, height);
for (let i = 0; i < 3; i++) {
  assert.ok(Math.abs(positions[i] - before[i]) < 1e-6,
    'mask arrival must not change video XYZ projection');
}
assert.equal(engine.simulation.seedCount, 2,
  'each video depth frame must synchronize positions and reset spring velocity');
assert.equal(engine.simulation.homeCount, 0,
  'video geometry must not trail the matching video color through the spring');
assert.equal(engine.refreshCount, 0,
  'point-cloud video must not rebuild invisible Gaussian textures each frame');

const aspectEngine = makeEngine();
aspectEngine.pointsMaterial = { uniforms: {
  uImageTexture: { value: null }, uHasImage: { value: 0 },
  uVideoAspect: { value: 1 },
} };
aspectEngine.renderModes = new Map();
aspectEngine.viewportPx = new THREE.Vector2(640, 420);
aspectEngine.setDepth(depth, width, height);
assert.equal(aspectEngine.pointsMaterial.uniforms.uVideoAspect.value, width / height,
  'video point footprint must account for wider horizontal grid spacing');

globalThis.window = { devicePixelRatio: 2 };
const dprEngine = Object.create(Engine.prototype);
dprEngine.adaptiveDpr = true;
dprEngine.currentDpr = 2;
dprEngine.lowFpsCount = 0;
dprEngine.highFpsCount = 0;
dprEngine.fps = 20;
dprEngine.renderer = { setPixelRatio() {}, getPixelRatio: () => dprEngine.currentDpr };
dprEngine.composer = { pixelRatio: 2, setPixelRatio(value) { this.pixelRatio = value; } };
dprEngine.resize = () => {};
dprEngine.adaptResolution();
assert.equal(dprEngine.composer.pixelRatio, dprEngine.currentDpr,
  'postprocessing targets must follow adaptive renderer DPR');

const resizeEngine = Object.create(Engine.prototype);
resizeEngine.renderer = {
  domElement: { parentElement: { clientWidth: 640, clientHeight: 420 } },
  setSize() {},
  getDrawingBufferSize(out) { return out.set(640, 420); },
};
resizeEngine.camera = { aspect: 1, updateProjectionMatrix() {} };
resizeEngine.composer = { setSize() {} };
resizeEngine.grainPass = { uniforms: { uResolution: { value: new THREE.Vector2() } } };
resizeEngine.viewportPx = new THREE.Vector2();
let uniformUpdates = 0;
resizeEngine.pushSharedUniformsAll = () => { uniformUpdates++; };
resizeEngine.resize();
assert.equal(uniformUpdates, 1, 'video point footprint must follow viewport resize');

// Dense video points need alpha blending, but photos and presets were tuned
// for the additive glow. The switch must follow the source both ways.
const blendEngine = Object.create(Engine.prototype);
blendEngine.pointsMaterial = { blending: THREE.AdditiveBlending, uniforms: {
  uImageTexture: { value: null }, uHasImage: { value: 0 }, uVideoFootprint: { value: 0 },
} };
blendEngine.renderModes = new Map();
blendEngine.viewportPx = new THREE.Vector2(640, 420);
blendEngine.imageColorTexture = null;
blendEngine.videoTexture = { image: {} };
blendEngine.pushSharedUniformsAll();
assert.equal(blendEngine.pointsMaterial.blending, THREE.NormalBlending,
  'live video must not accumulate its dense grid additively');
blendEngine.videoTexture = null;
blendEngine.pushSharedUniformsAll();
assert.equal(blendEngine.pointsMaterial.blending, THREE.AdditiveBlending,
  'photos must keep the additive point cloud look');

// Video never has a shell, so Crystal takes the early shell fallback. The
// deferred Gaussian bridge must still be rebuilt before Crystal draws it.
const crystalEngine = makeEngine();
const crystalMaterial = {};
crystalEngine.renderModes = new Map([['crystal', { material: crystalMaterial }]]);
crystalEngine.pointsMaterial = {};
crystalEngine.solidReady = false;
crystalEngine.gaussiansDirty = true;
crystalEngine.syncRenderVisibility = () => {};
crystalEngine.setPointsMaterial(crystalMaterial);
assert.equal(crystalEngine.refreshCount, 1,
  'Crystal on video must not show stale or empty Gaussian data');

console.log('OK live engine projection, synchronization, blending, and inactive splat work');
