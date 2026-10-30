import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./ts-extension-loader.mjs', import.meta.url);
const { Engine } = await import('../src/engine/Engine.ts');
const { createPointCloudMaterial } = await import('../src/shaders/pointCloudMaterial.ts');
class VideoSource extends EventTarget {
  paused = false;
  pixelColor = [0, 255, 0, 255];
}
const material = createPointCloudMaterial();
const engine = Object.create(Engine.prototype);
Object.assign(engine, {
  layerGap: 0, layerVisible: new THREE.Vector3(1, 1, 1),
  layers: null, layerTexture: null, layerInput: null, videoElement: null,
  videoTexture: null, imageColorTexture: null, gaussianSource: 'point-cloud',
  pointsMaterial: material, renderModes: new Map(),
  viewportPx: new THREE.Vector2(640, 420), currentDpr: 1, initialDpr: 1,
  configurePhotoCamera() {}, syncRenderVisibility() {},
  releasePhoto() { this.imageColorTexture?.dispose(); this.imageColorTexture = null; },
});
const source = new VideoSource();
engine.setVideoSource(source);
const paired = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
paired.colorSpace = THREE.SRGBColorSpace;
engine.imageColorTexture = paired;
engine.videoSamplingWindow = { x0: .2, x1: .8, y0: .1, y1: .9 };
let disposed = 0;
paired.addEventListener('dispose', () => { disposed++; });
const currentPixel = () => {
  const texture = material.uniforms.uImageTexture.value;
  return texture.isVideoTexture ? texture.image.pixelColor : [...texture.image.data];
};
engine.pushSharedUniformsAll();
assert.deepEqual(currentPixel(), [0, 255, 0, 255], 'playing video shows the current green source, not its red captured anchor');
assert.equal(material.uniforms.uDecodeVideo.value, 1);
material.uniforms.uSourceUvTransform.value.toArray().forEach((value, index) => {
  assert.ok(Math.abs(value - [.2, .1, .6, .8][index]) < 1e-12, 'raw video uses the geometry ROI');
});
source.paused = true;
source.dispatchEvent(new Event('pause'));
assert.equal(material.uniforms.uImageTexture.value, paired, 'pause switches without another depth inference');
assert.deepEqual(currentPixel(), [255, 0, 0, 255]);
assert.equal(material.uniforms.uDecodeVideo.value, 0);
assert.deepEqual(material.uniforms.uSourceUvTransform.value.toArray(), [0, 0, 1, 1]);
source.paused = false;
source.dispatchEvent(new Event('play'));
assert.equal(material.uniforms.uImageTexture.value, engine.videoTexture);
source.paused = undefined;
source.dispatchEvent(new Event('play'));
assert.equal(material.uniforms.uImageTexture.value, paired, 'unknown playback state keeps the safe paired source');
source.paused = false;
source.dispatchEvent(new Event('play'));
engine.setRealtimeVideoColor(false);
assert.equal(material.uniforms.uImageTexture.value, paired, 'flow opt-out retains paired RGB while playing');
source.dispatchEvent(new Event('pause'));
source.dispatchEvent(new Event('play'));
assert.equal(material.uniforms.uImageTexture.value, paired);
engine.setRealtimeVideoColor(true);
assert.equal(material.uniforms.uImageTexture.value, engine.videoTexture);
assert.equal(engine.imageColorTexture, paired, 'switching keeps paired color available to Gaussian and flow consumers');
assert.equal(disposed, 0, 'play/pause must not dispose the paired color texture');
const replacement = new VideoSource();
engine.setVideoSource(replacement);
let dispatches = 0;
const push = engine.pushSharedUniformsAll.bind(engine);
engine.pushSharedUniformsAll = () => { dispatches++; push(); };
source.dispatchEvent(new Event('pause'));
assert.equal(dispatches, 0, 'source replacement detaches old play/pause listeners');
replacement.dispatchEvent(new Event('play'));
assert.equal(dispatches, 1);
engine.setVideoSource(null);
dispatches = 0;
replacement.dispatchEvent(new Event('pause'));
assert.equal(dispatches, 0, 'clearing a source detaches its listeners');
const photo = new THREE.DataTexture(new Uint8Array([10, 20, 30, 255]), 1, 1);
photo.colorSpace = THREE.SRGBColorSpace;
engine.imageColorTexture = photo;
engine.pushSharedUniformsAll();
assert.equal(material.uniforms.uImageTexture.value, photo);
assert.equal(material.uniforms.uDecodeVideo.value, 0);
assert.deepEqual(material.uniforms.uSourceUvTransform.value.toArray(), [0, 0, 1, 1]);
// Disposal must detach source events before releasing renderer resources.
engine.setVideoSource(replacement);
const resource = () => ({ dispose() {} });
Object.assign(engine, {
  renderer: { setAnimationLoop() {}, dispose() {}, domElement: { remove() {} } },
  resizeObserver: { disconnect() {} }, controls: resource(),
  grainPass: resource(), composer: resource(), feedbackPass: resource(),
  chromaticPass: resource(), bloomPass: resource(), fxaaPass: resource(),
  outputPass: resource(), homeTexture: resource(), simulation: resource(),
  points: { geometry: resource() },
});
engine.dispose();
dispatches = 0;
replacement.dispatchEvent(new Event('pause'));
assert.equal(dispatches, 0, 'Engine disposal detaches play/pause listeners');
material.dispose();
console.log('OK realtime playing color, paused paired RGB, atomic decode/ROI, flow opt-out and source listener cleanup');
