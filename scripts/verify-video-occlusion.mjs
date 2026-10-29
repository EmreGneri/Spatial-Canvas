// ?videoOrtme experiment (docs/benchmarks/video-side-view-occlusion.md):
// flag off adds nothing and leaves the live video material untouched; flag on
// adds a depth pre-pass that shares the material's uniforms by reference.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./ts-extension-loader.mjs', import.meta.url);
const { Engine } = await import('../src/engine/Engine.ts');
const { createPointCloudMaterial } = await import('../src/shaders/pointCloudMaterial.ts');
const { videoOcclusionMode, VIDEO_OCCLUSION_DEFAULTS } = await import('../src/engine/videoOcclusion.ts');

assert.equal(videoOcclusionMode(''), 0);
assert.equal(videoOcclusionMode('?videoOrtme=0'), 0);
assert.equal(videoOcclusionMode('?videoOrtme=yes'), 0);
assert.equal(videoOcclusionMode('?videoOrtme=1'), 1);
assert.equal(videoOcclusionMode('?a=b&videoOrtme=2'), 2);

const snapshot = (m) => JSON.stringify({ blending: m.blending, depthWrite: m.depthWrite, depthTest: m.depthTest,
  depthFunc: m.depthFunc, colorWrite: m.colorWrite, transparent: m.transparent, defines: m.defines,
  vs: m.vertexShader, fs: m.fragmentShader, uniforms: Object.keys(m.uniforms).sort(), version: m.version });

function makeEngine(mode, materialName) {
  const engine = Object.create(Engine.prototype);
  const material = materialName === 'point-cloud' ? createPointCloudMaterial()
    : new THREE.ShaderMaterial({ name: materialName, uniforms: {}, vertexShader: 'void main(){}', fragmentShader: 'void main(){}' });
  Object.assign(engine, { videoOcclusion: mode, videoOcclusionTuning: { ...VIDEO_OCCLUSION_DEFAULTS }, occlusion: null,
    occlusionIgnoredLogged: '', layerVisible: new THREE.Vector3(1, 1, 1), videoTexture: {}, renderModeName: materialName,
    pointsMaterial: material, points: new THREE.Points(new THREE.BufferGeometry(), material) });
  return engine;
}

// Flag off: no child, main material byte-for-byte the same state, also after an on->off round trip.
const off = makeEngine(0, 'point-cloud');
const before = snapshot(off.pointsMaterial);
off.syncVideoOcclusion();
assert.equal(off.points.children.length, 0, 'flag off must not add a pre-pass');
assert.equal(off.occlusion, null);
assert.equal(snapshot(off.pointsMaterial), before, 'flag off leaves the live material untouched');
assert.equal(off.pointsMaterial.blending, THREE.AdditiveBlending);
assert.equal(off.pointsMaterial.depthWrite, false);
// The default's no-alpha-cutoff contract lives in verify-video-point-footprint.mjs (it follows the
// committed look); here only "the flag changes nothing" is asserted, so this holds on either look.

// Flag on (1): depth-only pre-pass, same uniforms object, main material unchanged.
for (const mode of [1, 2]) {
  const on = makeEngine(mode, 'point-cloud');
  const mainBefore = snapshot(on.pointsMaterial);
  on.syncVideoOcclusion();
  assert.equal(on.points.children.length, 1);
  const pre = on.points.children[0].material;
  assert.equal(on.points.children[0].visible, true);
  assert.equal(on.points.children[0].frustumCulled, false);
  assert.equal(on.points.children[0].geometry, on.points.geometry, 'pre-pass shares the grid geometry');
  assert.equal(pre.uniforms, on.pointsMaterial.uniforms, 'uniforms shared by reference');
  assert.equal(pre.depthWrite, true);
  assert.equal(pre.depthTest, true);
  assert.equal(pre.transparent, false, 'opaque list: drawn before the additive cloud');
  assert.equal(pre.colorWrite, mode === 2);
  assert.equal(pre.blending, THREE.NormalBlending);
  assert.equal(pre.defines.VIDEO_OCCLUSION_BIAS, VIDEO_OCCLUSION_DEFAULTS.bias.toFixed(4));
  assert.equal(pre.defines.VIDEO_OCCLUSION_CORE, VIDEO_OCCLUSION_DEFAULTS.core.toFixed(4));
  assert.match(pre.vertexShader, /gl_PointSize \*= VIDEO_OCCLUSION_CORE;\s*mv\.z -= VIDEO_OCCLUSION_BIAS;\s*gl_Position = projectionMatrix \* mv;/);
  if (mode === 1) assert.doesNotMatch(pre.fragmentShader, /uImageTexture/, 'depth-only pre-pass samples no colour');
  else assert.match(pre.fragmentShader, /gl_FragColor = vec4\(col, 1\.0\);/);
  assert.equal(snapshot(on.pointsMaterial), mainBefore, 'flag on leaves the additive material untouched');
  // Retune recompiles the pre-pass only; mode 0 hides it.
  on.setVideoOcclusion(mode, { bias: 0.1 });
  assert.equal(on.points.children[0].material.defines.VIDEO_OCCLUSION_BIAS, '0.1000');
  on.setVideoOcclusion(0);
  assert.equal(on.points.children[0].visible, false);
  // No video: nothing drawn.
  on.setVideoOcclusion(mode); on.videoTexture = null; on.syncVideoOcclusion();
  assert.equal(on.points.children[0].visible, false);
}

// Other draw modes and layer edits do not honour it (and say so once).
const infos = [];
const info = console.info; console.info = (m) => infos.push(m);
for (const name of ['ascii', 'neon-wire']) {
  const e = makeEngine(1, name);
  e.syncVideoOcclusion(); e.syncVideoOcclusion();
  assert.equal(e.points.children.length, 0, `${name} ignores videoOrtme`);
}
const layered = makeEngine(1, 'point-cloud');
layered.layerVisible.set(1, 0, 1);
layered.syncVideoOcclusion();
assert.equal(layered.points.children.length, 0, 'layer edit skips the pre-pass');
console.info = info;
assert.equal(infos.length, 3, 'one notice per ignoring mode');
assert.ok(infos.every((m) => /only the point-cloud mode honours it/.test(m)));
console.log('OK videoOrtme: flag off adds nothing, flag on depth pre-pass state, other modes report ignore');
