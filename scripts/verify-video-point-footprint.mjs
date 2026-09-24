import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./ts-extension-loader.mjs', import.meta.url);

const { createPointCloudMaterial, POINTS_PARAMS } = await import('../src/shaders/pointCloudMaterial.ts');
const { createNeonWireMaterial } = await import('../src/shaders/neonWireMaterial.ts');
// The ASCII atlas is drawn with canvas2d; a no-op canvas is enough to build
// the material and read its shader.
globalThis.document = {
  createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }),
};
const { createAsciiMaterial } = await import('../src/shaders/asciiMaterial.ts');

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

// --- Adaptive DPR must not resize sprites mid-session ---
// Photo, ASCII and neon sizes are physical pixels, so they scale with the
// renderer pixel ratio relative to startup. Default 1 keeps materials used
// outside Engine unchanged. The video footprint is already derived from the
// drawing-buffer height and must not be scaled twice.
assert.equal(material.uniforms.uDprScale.value, 1, 'startup look stays unchanged');
assert.match(material.vertexShader, /uniform float uDprScale;/);
assert.match(material.vertexShader,
  /float legacySize = uPointSize \* jitter \* uDprScale \/ max\(-mv\.z, 0\.1\);/,
  'photo point size must follow the renderer pixel ratio');
assert.equal(material.vertexShader.match(/uDprScale/g).length, 2,
  'only the declaration and the photo path may use uDprScale; video is in physical pixels already');
const ascii = createAsciiMaterial();
assert.equal(ascii.uniforms.uDprScale.value, 1);
assert.match(ascii.vertexShader,
  /gl_PointSize = uPointSize \* jitter \* uDprScale \/ max\(-mv\.z, 0\.1\);/,
  'ASCII glyph size must follow the renderer pixel ratio');
ascii.dispose();
const neon = createNeonWireMaterial();
assert.equal(neon.uniforms.uDprScale.value, 1);
assert.match(neon.vertexShader,
  /gl_PointSize = max\(uPointSize \* spriteScale \* uDprScale \/ max\(-mv\.z, 0\.1\), 1\.5\);/,
  'neon line width must follow the renderer pixel ratio');
neon.dispose();

// --- Live video writes depth; the alpha cutoff must not reopen gaps ---
// A fragment that writes depth hides later, farther fragments at that pixel,
// so a see-through fringe would let the clear colour through. Video therefore
// drops fragments below the cutoff and draws the rest opaque. The kept disc
// must still cover every screen point, i.e. reach half the diagonal of one
// projected grid cell (vertical pitch 1, horizontal pitch = video aspect).
const frag = material.fragmentShader;
assert.match(frag, /float soft = max\(uSoftness, 0\.001\);/,
  'coverage proof below mirrors this softness floor');
assert.match(frag, /float alpha = 1\.0 - smoothstep\(1\.0 - soft, 1\.0, r\);/,
  'coverage proof below mirrors this falloff');
const cutoffMatch = frag.match(/const float VIDEO_ALPHA_CUTOFF = (\d+(?:\.\d+)?);/);
assert.ok(cutoffMatch, 'video fragments need a named alpha cutoff');
const cutoff = Number(cutoffMatch[1]);
assert.match(frag,
  /if \(uVideoFootprint > 0\.5\) \{\s*if \(alpha < VIDEO_ALPHA_CUTOFF\) discard;\s*alpha = 1\.0;\s*\}/,
  'only video cuts its edge, and kept fragments must be opaque because they write depth');

const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};
const falloff = (r, softness) => 1 - smoothstep(1 - Math.max(softness, 0.001), 1, r);
// Alpha falls monotonically from the centre (1) to the rim (0); bisect the
// normalized radius where it crosses the cutoff.
function keptRadius(softness) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (falloff(mid, softness) >= cutoff) lo = mid; else hi = mid;
  }
  return lo;
}
const overlap = Number(overlapRule[1]);
const damping = Number(overlapRule[2]);
/** Kept radius / half cell diagonal, in vertical-pitch units; >= 1 closes the grid. */
function coverage(softness, sizeJitter, aspect) {
  const smallestSeedJitter = 1 - sizeJitter;
  const diameter = overlap * Math.max(1, aspect) * (1 + (smallestSeedJitter - 1) * damping);
  return (keptRadius(softness) * diameter / 2) / (Math.hypot(aspect, 1) / 2);
}
const param = (key) => POINTS_PARAMS.find((p) => p.key === key);
const defaultSoftness = param('uSoftness').default;
assert.equal(material.uniforms.uSoftness.value, defaultSoftness);
const defaultKept = keptRadius(defaultSoftness);
assert.ok(defaultKept > 0.5 && defaultKept < 1,
  `kept radius ${defaultKept.toFixed(3)} must sit inside the soft edge at default softness`);
const aspects = [9 / 16, 1, 4 / 3, 16 / 9, videoAspect, 21 / 9];
for (const aspect of aspects) {
  const c = coverage(defaultSoftness, param('uSizeJitter').default, aspect);
  assert.ok(c >= 1, `default video at aspect ${aspect.toFixed(2)} leaves gaps: coverage ${c.toFixed(3)}`);
}
// The cutoff also holds across the whole softness and jitter slider range.
for (let s = param('uSoftness').min; s <= param('uSoftness').max + 1e-9; s += 0.05) {
  for (const j of [param('uSizeJitter').min, param('uSizeJitter').default, param('uSizeJitter').max]) {
    for (const aspect of aspects) {
      const c = coverage(s, j, aspect);
      assert.ok(c >= 1,
        `softness ${s.toFixed(2)} jitter ${j} aspect ${aspect.toFixed(2)} leaves gaps: coverage ${c.toFixed(3)}`);
    }
  }
}
// Same proof in real pixels on the wide-frame regression fixture.
const verticalPitch = horizontalPitch / videoAspect;
const keptRadiusPx = defaultKept * minimumVideoDiameter / 2;
assert.ok(keptRadiusPx >= Math.hypot(horizontalPitch, verticalPitch) / 2,
  `kept radius ${keptRadiusPx.toFixed(2)}px must reach the ${horizontalPitch.toFixed(2)}x${verticalPitch.toFixed(2)}px cell corner`);

material.dispose();
console.log('OK · video point footprint follows viewport, DPR scale and depth cutoff close the grid');
