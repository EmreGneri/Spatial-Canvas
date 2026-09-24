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
blendEngine.pointsMaterial = { blending: THREE.AdditiveBlending, depthWrite: false, uniforms: {
  uImageTexture: { value: null }, uHasImage: { value: 0 }, uVideoFootprint: { value: 0 },
} };
blendEngine.renderModes = new Map();
blendEngine.viewportPx = new THREE.Vector2(640, 420);
blendEngine.imageColorTexture = null;
blendEngine.videoTexture = { image: {} };
blendEngine.pushSharedUniformsAll();
assert.equal(blendEngine.pointsMaterial.blending, THREE.NormalBlending,
  'live video must not accumulate its dense grid additively');
// The grid draws in row order, not depth order: without depth writes a far
// row drawn later paints over a near one while orbiting.
assert.equal(blendEngine.pointsMaterial.depthWrite, true,
  'live video points must occlude the points behind them');
blendEngine.videoTexture = null;
blendEngine.pushSharedUniformsAll();
assert.equal(blendEngine.pointsMaterial.blending, THREE.AdditiveBlending,
  'photos must keep the additive point cloud look');
assert.equal(blendEngine.pointsMaterial.depthWrite, false,
  'additive photo glow must not clip the particles behind it');

// OutputPass tonemaps the whole composed frame, so the flat plane's
// toneMapped:false never reached the screen. Both render paths (the animation
// loop via pushLookUniforms, and renderFrame for export) must drop ACES
// while flat video shows and restore it for the 3D scene.
const { createLookUniforms } = await import('../src/shaders/look.ts');
const toneEngine = Object.create(Engine.prototype);
toneEngine.look = createLookUniforms();
toneEngine.renderModes = new Map();
toneEngine.pointsMaterial = { uniforms: {} };
toneEngine.renderer = { toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1 };
toneEngine.simulation = { positionTexture: null };
const renderedToneMapping = [];
toneEngine.composer = { render() { renderedToneMapping.push(toneEngine.renderer.toneMapping); } };
toneEngine.flatVideoOn = true;
toneEngine.videoTexture = { image: {} };
toneEngine.renderFrame();
assert.equal(renderedToneMapping.at(-1), THREE.NoToneMapping,
  'exported flat video must keep the source colors');
toneEngine.flatVideoOn = false;
toneEngine.renderFrame();
assert.equal(renderedToneMapping.at(-1), THREE.ACESFilmicToneMapping,
  'the 3D scene keeps the ACES curve');
toneEngine.flatVideoOn = true;
toneEngine.pushLookUniforms();
assert.equal(toneEngine.renderer.toneMapping, THREE.NoToneMapping,
  'the per-frame look update must switch the curve off for flat video');
toneEngine.videoTexture = null;
toneEngine.pushLookUniforms();
assert.equal(toneEngine.renderer.toneMapping, THREE.ACESFilmicToneMapping,
  'flat mode without a video shows the 3D scene, so ACES stays');
// The flat plane's visibility and the tone curve both follow flatVideoActive,
// so a source switch must re-sync visibility after the new texture is bound;
// otherwise flat mode shows the 3D cloud without ACES (or a dead plane).
const sourceEngine = Object.create(Engine.prototype);
sourceEngine.videoElement = null;
sourceEngine.videoTexture = null;
sourceEngine.imageColorTexture = null;
sourceEngine.releasePhoto = () => {};
sourceEngine.pushSharedUniformsAll = () => {};
const syncedWithVideo = [];
sourceEngine.syncRenderVisibility = () => syncedWithVideo.push(Boolean(sourceEngine.videoTexture));
sourceEngine.setVideoSource({ videoWidth: 16, videoHeight: 9 });
assert.equal(syncedWithVideo.at(-1), true, 'visibility must see the newly bound video');
sourceEngine.setVideoSource(null);
assert.equal(syncedWithVideo.at(-1), false, 'visibility must see the video is gone');

// Photo, ASCII and neon sprite sizes are physical pixels. When adaptive DPR
// drops the pixel ratio they must shrink with it, or sprites grow on screen.
const dprMaterial = () => ({ uniforms: {
  uImageTexture: { value: null }, uHasImage: { value: 0 }, uDprScale: { value: 1 },
} });
const dprScaleEngine = Object.create(Engine.prototype);
dprScaleEngine.adaptiveDpr = true;
dprScaleEngine.initialDpr = 2;
dprScaleEngine.currentDpr = 2;
dprScaleEngine.lowFpsCount = 0;
dprScaleEngine.highFpsCount = 0;
dprScaleEngine.renderer = {
  setPixelRatio() {},
  getPixelRatio: () => dprScaleEngine.currentDpr,
  domElement: { parentElement: { clientWidth: 640, clientHeight: 420 } },
  setSize() {},
  getDrawingBufferSize(out) { return out.set(640 * dprScaleEngine.currentDpr, 420 * dprScaleEngine.currentDpr); },
};
dprScaleEngine.camera = { aspect: 1, updateProjectionMatrix() {} };
dprScaleEngine.composer = { setPixelRatio() {}, setSize() {} };
dprScaleEngine.grainPass = { uniforms: { uResolution: { value: new THREE.Vector2() } } };
dprScaleEngine.viewportPx = new THREE.Vector2();
dprScaleEngine.imageColorTexture = null;
dprScaleEngine.videoTexture = null;
dprScaleEngine.pointsMaterial = dprMaterial();
dprScaleEngine.renderModes = new Map([
  ['points', { material: dprScaleEngine.pointsMaterial }],
  ['ascii', { material: dprMaterial() }],
  ['neon', { material: dprMaterial() }],
]);
const dprScales = () => [...dprScaleEngine.renderModes.values()]
  .map((entry) => entry.material.uniforms.uDprScale.value);
dprScaleEngine.fps = 20;
dprScaleEngine.adaptResolution();
assert.equal(dprScaleEngine.currentDpr, 1.5);
assert.deepEqual(dprScales(), [0.75, 0.75, 0.75],
  'a DPR drop must shrink physical-pixel sprites by the same ratio');
dprScaleEngine.fps = 60;
dprScaleEngine.adaptResolution();
dprScaleEngine.adaptResolution();
assert.equal(dprScaleEngine.currentDpr, 2);
assert.deepEqual(dprScales(), [1, 1, 1], 'recovering DPR restores the startup size');

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

console.log('OK live engine projection, synchronization, blending, depth, tone mapping, DPR scale, and inactive splat work');
