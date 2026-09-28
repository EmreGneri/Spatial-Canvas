import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.(?:ts|js|mjs|json)$/.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { /* Preserve normal resolution. */ }
    }
    return nextResolve(specifier, context);
  },
});

const { Engine } = await import('../src/engine/Engine.ts');
const { createGrainPass } = await import('../src/shaders/grainPass.ts');
const { createFxaaPass } = await import('../src/shaders/fxaaPass.ts');

/**
 * Tur 3 sözleşmesi: `renderFromPose(pose, w, h) -> { color, coverage }`.
 *
 * Node has no WebGL. Keep the existing contract checks and exercise the real
 * Engine method with EffectComposer to verify target/pass sizing and restore
 * behavior. Pixel appearance still needs a browser test.
 */
const src = readFileSync(new URL('../src/engine/Engine.ts', import.meta.url), 'utf8');

const imza = src.match(/renderFromPose\(\s*pose:[^)]*\)\s*:\s*\{[^}]*\}/s);
assert.ok(imza, 'renderFromPose imzası bulunamadı');
assert.match(imza[0], /position:\s*\[number, number, number\]/, 'pose.position üçlü değil');
assert.match(imza[0], /target:\s*\[number, number, number\]/, 'pose.target üçlü değil');
assert.match(imza[0], /fov\?:\s*number/, 'fov isteğe bağlı alan değil');
assert.match(imza[0], /color:\s*Uint8Array/, 'color alanı sözleşmedeki tipte değil');
assert.match(imza[0], /coverage:\s*Float32Array \| null/, 'coverage alanı sözleşmedeki tipte değil');

const govde = src.slice(src.indexOf('renderFromPose('), src.indexOf('private pushLookUniforms()'));

// ŞART 1 — aynı rasterizasyon: ekrandaki kareyi çizen composer'ın TA KENDİSİ.
assert.match(govde, /this\.composer\.render\(\)/, 'offscreen yol composer zincirini kullanmıyor');
assert.ok(
  !/new\s+(THREE\.)?WebGLRenderer/.test(govde),
  'offscreen yol kendi renderer’ını kuruyor — ekrandakiyle aynı rasterizasyon garantisi kalkar',
);
// Döngünün ilk adımı (uPositions) atlanırsa kare boş çıkıyor; ölçüldü.
assert.match(govde, /uPositions/, 'konum texture push edilmiyor — kare boş çıkar');

// ŞART 2 — yeni texture kanalı açılmaz: yalnız var olan yoldan okunur.
assert.ok(
  !/new\s+(THREE\.)?(DataTexture|WebGLRenderTarget)/.test(govde),
  'offscreen yol yeni texture/hedef açıyor — GaussianBuffer sözleşmesi dışına çıkılmış',
);

// Çağrı ekranı BOZMAMALI: poz, boyut ve DPR geri yüklenir.
assert.match(govde, /finally\s*\{/, 'geri yükleme finally bloğunda değil');
for (const geri of ['setPixelRatio', 'setSize', 'position.copy', 'target.copy', 'updateProjectionMatrix']) {
  assert.ok(govde.includes(geri), `geri yüklemede ${geri} yok`);
}

// Exercise the real method and EffectComposer sizing without requiring WebGL.
// Removing the composer DPR update must make the requested 200x100 target
// become 400x200 on a DPR-2 screen, rather than silently changing rasterization.
const engine = Object.create(Engine.prototype);
let pixelRatio = 2;
const size = new THREE.Vector2(800, 500);
engine.renderer = {
  domElement: {},
  getSize: (target) => target.copy(size),
  getPixelRatio: () => pixelRatio,
  setPixelRatio: (value) => { pixelRatio = value; },
  setSize: (w, h) => { size.set(w, h); },
  getDrawingBufferSize: (target) => target.copy(size).multiplyScalar(pixelRatio).floor(),
  setRenderTarget() {},
};
engine.composer = new EffectComposer(engine.renderer);
engine.grainPass = createGrainPass();
const fxaa = createFxaaPass();
engine.composer.addPass(engine.grainPass);
engine.composer.addPass(fxaa);
engine.grainPass.uniforms.uResolution.value.set(1600, 1000);
engine.viewportPx = new THREE.Vector2(1600, 1000);
engine.currentDpr = engine.initialDpr = 2;
engine.camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
engine.camera.position.set(0, 0, 3.5);
engine.controls = { target: new THREE.Vector3(), update() {} };
const cameraBefore = {
  position: engine.camera.position.toArray(),
  target: engine.controls.target.toArray(),
  fov: engine.camera.fov,
  aspect: engine.camera.aspect,
};
engine.pointsMaterial = new THREE.ShaderMaterial({ uniforms: {
  uPositions: { value: null }, uImageTexture: { value: null },
  uHasImage: { value: 0 }, uViewportHeightPx: { value: 1000 },
  uDprScale: { value: 1 },
} });
engine.renderModes = new Map();
engine.simulation = { positionTexture: new THREE.Texture() };
engine.pushLookUniforms = () => {};
const previousDocument = globalThis.document;
globalThis.document = { createElement: () => ({
  getContext: () => ({ drawImage() {}, getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }),
}) };

function assertRenderResolution() {
  assert.equal(engine.composer.renderTarget1.width, 200, 'offscreen composer width must use DPR 1');
  assert.equal(engine.composer.renderTarget1.height, 100, 'offscreen composer height must use DPR 1');
  assert.deepEqual(engine.grainPass.uniforms.uResolution.value.toArray(), [200, 100], 'grain must use output pixels');
  assert.deepEqual(engine.viewportPx.toArray(), [200, 100], 'point footprints must use output pixels');
  assert.equal(engine.pointsMaterial.uniforms.uViewportHeightPx.value, 100);
  assert.equal(engine.pointsMaterial.uniforms.uDprScale.value, 0.5, 'physical sprite sizes must account for temporary DPR');
  assert.deepEqual(fxaa.uniforms.resolution.value.toArray(), [1 / 200, 1 / 100]);
}
function assertRestored() {
  assert.equal(pixelRatio, 2);
  assert.deepEqual(size.toArray(), [800, 500]);
  assert.equal(engine.composer.renderTarget1.width, 1600);
  assert.equal(engine.composer.renderTarget1.height, 1000);
  assert.deepEqual(engine.grainPass.uniforms.uResolution.value.toArray(), [1600, 1000]);
  assert.deepEqual(engine.viewportPx.toArray(), [1600, 1000]);
  assert.equal(engine.pointsMaterial.uniforms.uViewportHeightPx.value, 1000);
  assert.equal(engine.pointsMaterial.uniforms.uDprScale.value, 1);
  assert.deepEqual(fxaa.uniforms.resolution.value.toArray(), [1 / 1600, 1 / 1000]);
  assert.deepEqual({
    position: engine.camera.position.toArray(),
    target: engine.controls.target.toArray(),
    fov: engine.camera.fov,
    aspect: engine.camera.aspect,
  }, cameraBefore, 'offscreen rendering must restore the interactive camera');
}
const pose = { position: [1, 0, 3.5], target: [0.2, 0.1, 0], fov: 45 };
try {
  engine.composer.render = assertRenderResolution;
  assert.equal(engine.renderFromPose(pose, 200, 100).color.length, 200 * 100 * 4);
  assertRestored();
  engine.composer.render = () => { assertRenderResolution(); throw new Error('readback test failure'); };
  assert.throws(() => engine.renderFromPose(pose, 200, 100), /readback test failure/);
  assertRestored();
} finally {
  globalThis.document = previousDocument;
  engine.composer.dispose();
  engine.grainPass.dispose();
  fxaa.dispose();
  engine.pointsMaterial.dispose();
  engine.simulation.positionTexture.dispose();
}

console.log('OK renderFromPose: contract, DPR-2 output resolution, pass uniforms and restoration after success/failure');
