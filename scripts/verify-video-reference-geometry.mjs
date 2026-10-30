import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Vector2, Vector3 } from 'three';
register('./ts-extension-loader.mjs', import.meta.url);
const { sampleVolumePositions, sampleImageGrid } = await import('../src/engine/reconstruction/sampler.ts');
const { maskeBboxPenceresi } = await import('../src/engine/reconstruction/videoReferenceSampling.ts');
const { Engine } = await import('../src/engine/Engine.ts');
const { createPointCloudMaterial } = await import('../src/shaders/pointCloudMaterial.ts');
const { createHomeTexture, POSITION_TEXTURE_SIZE } = await import('../src/engine/buffers.ts');

const width = 80, height = 64, grid = 32;
const depth = Float32Array.from({ length: width * height }, (_, i) => .25 + .6 * ((i % width) / width));
const mask = Float32Array.from(depth, (_, i) => {
  const x = i % width, y = Math.floor(i / width);
  return x >= 23 && x < 58 && y >= 9 && y < 60 ? 1 : 0;
});
const rgb = Float32Array.from({ length: width * height * 3 }, (_, i) => {
  const pixel = Math.floor(i / 3);
  return i % 3 === 0 ? (pixel % width + .5) / width
    : i % 3 === 1 ? (Math.floor(pixel / width) + .5) / height : .5;
});
const window = maskeBboxPenceresi(mask, width, height);
assert.ok(window && window.x0 > 0 && window.x1 < 1);
assert.equal(maskeBboxPenceresi(mask, width, height, undefined, undefined, window), window);
const options = {
  gridSize: grid, foregroundMask: mask, importanceSampling: false,
  referenceVideo: { aspect: width / height }, samplingWindow: window,
};
const actual = sampleVolumePositions(depth, width, height, options);
const color = sampleImageGrid(rgb, width, height, depth, width, height,
  { ...options, foregroundColorIsolation: false });
for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
  const k = j * grid + i;
  const u = window.x0 + (i + .5) / grid * (window.x1 - window.x0);
  const t = window.y0 + (j + .5) / grid * (window.y1 - window.y0);
  assert.ok(Math.abs(actual[k * 4] - (u - .5) * 2 * width / height) < 1e-6);
  assert.ok(Math.abs(actual[k * 4 + 1] - (.5 - t) * 2) < 1e-6);
  assert.ok(Math.abs(color[k * 3] - u) < 1e-6 && Math.abs(color[k * 3 + 1] - t) < 1e-6,
    'RGB and XYZ share source pixel coordinates');
}
const photo = sampleVolumePositions(depth, width, height,
  { gridSize: grid, foregroundMask: mask, importanceSampling: false });
assert.notDeepEqual(actual, photo, 'video reference is isolated from photo geometry');

// Exercise the real Engine path, not only the sampling helper. Keep the photo
// 512-square budget while comparing the same source coordinates and depth rules.
const engine = Object.create(Engine.prototype);
Object.assign(engine, {
  layerGap: 0, layerVisible: new Vector3(1, 1, 1), layers: null,
  layerTexture: null, layerInput: null, homeTexture: createHomeTexture(),
  videoTexture: { image: { videoWidth: width, videoHeight: height } },
  camera: { fov: 60, aspect: 1.5 }, dynamicHome: true, seeded: false,
  renderModeName: 'points', gaussianSource: 'point-cloud',
  simulation: { seedFrom() {} }, renderModes: new Map(),
  pointsMaterial: createPointCloudMaterial(), viewportPx: new Vector2(640, 420),
  currentDpr: 1, initialDpr: 1,
});
engine.setDepth(depth, width, height, mask, width, height);
const positions = engine.homeTexture.image.data;
const expectedEngine = sampleVolumePositions(depth, width, height,
  { ...options, gridSize: POSITION_TEXTURE_SIZE });
assert.deepEqual(positions, expectedEngine, 'Engine wires source aspect and the shared ROI into video geometry');

if (process.argv[2]) {
  const reference = await import(pathToFileURL(process.argv[2]).href);
  for (const [candidate, size] of [[actual, grid], [positions, POSITION_TEXTURE_SIZE]]) {
    const expected = reference.sampleVolumePositions(depth, width, height, {
      gridSize: size, foregroundMask: mask, importanceSampling: false,
      sourceAspect: width / height, pencere: window,
    });
    let maxError = 0;
    for (let i = 0; i < candidate.length; i++) maxError = Math.max(maxError, Math.abs(candidate[i] - expected[i]));
    console.log(`Reference numeric geometry ${size}-square max error`, maxError);
    assert.ok(maxError < 1e-6, `Reference XYZ+opacity mismatch: ${maxError}`);
  }
}
console.log('OK video ROI anatomy, Engine wiring, source color alignment and isolated photo geometry');

// ROI spacing changes the world derivatives used by shell lighting.
const { buildShellMesh } = await import('../src/engine/reconstruction/mesh.ts');
const planeWidth = 64, planeHeight = 64, shellGrid = 16;
const plane = Float32Array.from({ length: planeWidth * planeHeight }, (_, i) =>
  .3 + .2 * (i % planeWidth) / planeWidth + .1 * Math.floor(i / planeWidth) / planeHeight);
const shell = buildShellMesh(plane, planeWidth, planeHeight, {
  gridSize: shellGrid, curvature: 0, depthScale: 1, importanceSampling: false,
  foregroundMask: new Float32Array(plane.length).fill(1),
  referenceVideo: { aspect: 1 }, samplingWindow: { x0: .2, x1: .7, y0: .1, y1: .8 },
});
assert.ok(shell);
const center = (8 * (shellGrid + 1) + 8) * 6;
const right = center + 6, down = center + (shellGrid + 1) * 6;
const dx = (shell.positions[right + 2] - shell.positions[center + 2])
  / (shell.positions[right] - shell.positions[center]);
const dy = (shell.positions[down + 2] - shell.positions[center + 2])
  / (shell.positions[down + 1] - shell.positions[center + 1]);
const norm = Math.hypot(dx, dy, 1);
for (const [axis, expected] of [[0, -dx / norm], [1, -dy / norm], [2, 1 / norm]]) {
  assert.ok(Math.abs(shell.normals[center + axis] - expected) < 1e-5,
    'ROI shell normals must use the actual world spacing of the sloped plane');
}
console.log('OK reference video ROI shell normals');

engine.layerGap = .2;
engine.setDepth(depth, width, height, mask, width, height);
assert.equal(engine.videoSamplingWindow, null, 'optional layer editing retains full-source UV coordinates');
engine.layerGap = 0;
engine.layerVisible.set(0, 1, 1);
engine.setDepth(depth, width, height, mask, width, height);
assert.equal(engine.videoSamplingWindow, null, 'hidden layer maps retain full-source UV coordinates');
console.log('OK optional layer edits use matching full-source sampling');

// A paused layer toggle has no new decoded RGB frame: resample the retained
// paired source color together with its geometry instead of leaving an old ROI.
engine.layerGap = 0;
engine.layerVisible.set(1, 1, 1);
const rgba = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < width * height; i++) {
  rgba.set([rgb[i * 3] * 255, rgb[i * 3 + 1] * 255, rgb[i * 3 + 2] * 255, 255], i * 4);
}
engine.setDepth(depth, width, height, mask, width, height, { data: rgba, width, height });
const croppedRed = engine.imageColorTexture.image.data[0];
assert.ok(engine.videoSamplingWindow);
engine.setLayerVisible(0, false);
assert.equal(engine.videoSamplingWindow, null, 'paused layer toggle immediately restores source UVs');
assert.ok(engine.imageColorTexture.image.data[0] < croppedRed - 20,
  'paired cached RGB must be resampled from its source when the ROI changes');
engine.setLayerVisible(0, true);
assert.ok(engine.videoSamplingWindow, 'restoring layers immediately restores the reference ROI');
assert.equal(engine.imageColorTexture.image.data[0], croppedRed);
console.log('OK paused layer edits keep retained paired RGB aligned');

engine.viewportPx.set(1280, 840);
engine.currentDpr = 2;
engine.pushSharedUniformsAll();
assert.equal(engine.pointsMaterial.uniforms.uViewportHeightPx.value, 420,
  'DPR2 video matches the reference CSS viewport sprite sizing');
engine.viewportPx.set(640, 420);
engine.currentDpr = 1;
engine.pushSharedUniformsAll();
assert.equal(engine.pointsMaterial.uniforms.uViewportHeightPx.value, 420,
  'reference video sprite sizing stays in CSS pixels after adaptive DPR');
console.log('OK reference CSS viewport sizing at DPR2 and DPR1');
