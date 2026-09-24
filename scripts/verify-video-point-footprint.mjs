import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./ts-extension-loader.mjs', import.meta.url);

const { createPointCloudMaterial } = await import('../src/shaders/pointCloudMaterial.ts');

const material = createPointCloudMaterial();
assert.equal(material.uniforms.uVideoFootprint.value, 0,
  'photo and synthetic sources must keep the original point size');
assert.equal(material.uniforms.uViewportHeightPx.value, 0,
  'video footprint must use the real drawing-buffer height supplied by Engine');
assert.equal(material.uniforms.uVideoReferenceDistance.value, 3.5,
  'the full-frame sampler and shader must share the reference camera distance');
assert.equal(material.uniforms.uVideoWorldHeight.value, 2,
  'the projected grid footprint must use the sampler world height');
assert.equal(material.uniforms.uVideoAspect.value, 1,
  'non-video materials have a harmless square-aspect default');

// The actual material is the contract: Engine changes these uniforms as its
// source and DPR change, while all old presets leave the opt-in disabled.
material.uniforms.uVideoFootprint.value = 1;
material.uniforms.uViewportHeightPx.value = 834;
assert.equal(material.uniforms.uVideoFootprint.value, 1);
assert.equal(material.uniforms.uViewportHeightPx.value, 834);

assert.match(material.vertexShader, /uniform float uVideoFootprint;/);
assert.match(material.vertexShader, /uniform float uViewportHeightPx;/);
assert.match(material.vertexShader, /uniform float uVideoReferenceDistance;/);
assert.match(material.vertexShader, /uniform float uVideoWorldHeight;/);
assert.match(material.vertexShader, /uniform float uVideoAspect;/);
assert.match(material.vertexShader, /max\(1\.0, uVideoAspect\)/,
  'wide video must size points for its larger horizontal grid spacing');
assert.match(material.vertexShader, /projectionMatrix\[1\]\[1\]/,
  'grid coverage must track perspective projection and drawing-buffer pixels');
assert.match(material.fragmentShader, /uVideoFootprint/,
  'video mask background should render without a brightness jump');

// A 2.07:1 frame fitted into a 633×417 viewport has approximately 1.54
// physical pixels between horizontal grid samples. The old vertical-only
// footprint measured 0.75px and visibly left stripes in this fixture.
const videoAspect = 2.07;
const viewportHeight = 417;
const viewportAspect = 633 / viewportHeight;
const worldHeight = 2 * 3.5 * Math.tan(Math.PI / 6)
  * Math.min(1, viewportAspect / videoAspect) * 0.94;
const horizontalPitch = viewportHeight * Math.sqrt(3)
  * worldHeight * videoAspect / (2 * 384 * 3.5);
assert.ok(horizontalPitch > 1.5 && horizontalPitch < 1.6,
  'regression fixture must expose a wide-video horizontal spacing above 1.5px');
const overlapRule = material.vertexShader.match(
  /(\d+(?:\.\d+)?) \* projectedGridPitchPx \* mix\(1\.0, jitter, (\d+(?:\.\d+)?)\)/,
);
assert.ok(overlapRule, 'video size must cover projected grid spacing');
const smallestJitter = 0.7; // uSizeJitter=0.3 at its low seed extreme
const dampedJitter = 1 + (smallestJitter - 1) * Number(overlapRule[2]);
const minimumVideoDiameter = Math.max(2.5,
  horizontalPitch * Number(overlapRule[1]) * dampedJitter);
assert.ok(minimumVideoDiameter >= 4.0 && minimumVideoDiameter <= 4.6,
  `default wide-video point diameter ${minimumVideoDiameter.toFixed(2)}px must close the sky stripes`);

material.dispose();
console.log('OK · video point footprint follows viewport and preserves photo defaults');
