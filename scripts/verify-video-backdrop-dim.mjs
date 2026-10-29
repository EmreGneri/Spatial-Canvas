// Video: outside-mask pixels are DIMMED, not discarded; photo keeps the discard.
// Attenuation lives in ONE place (sampler w = VIDEO_BACKDROP_OPACITY, shader
// multiplies by vOpacity once, no extra constant, no col *= 0.4 for video).
// Separation hysteresis: on at >= 8 %, off at < 4 %, no flapping in between.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) };
const { BACKDROP_OPACITY, VIDEO_BACKDROP_OPACITY, sampleVolumePositions } =
  await import('../src/engine/reconstruction/sampler.ts');
const { createPointCloudMaterial } = await import('../src/shaders/pointCloudMaterial.ts');
const { createAsciiMaterial } = await import('../src/shaders/asciiMaterial.ts');
const { createNeonWireMaterial } = await import('../src/shaders/neonWireMaterial.ts');
const { AYIRMA_ACMA_ORANI, AYIRMA_KAPATMA_ORANI, videoAyirmaDurumu } = await import('../src/ui/maskeKarari.ts');

// 1. Constants: named, dims (not hides), photo value untouched.
assert.equal(BACKDROP_OPACITY, 0.4, 'photo backdrop stays 0.4');
assert.ok(VIDEO_BACKDROP_OPACITY > 0 && VIDEO_BACKDROP_OPACITY < 0.5);

// 2. Sampler (video path) writes the single dim value outside the mask, 1 inside.
const N = 8, W = 8, H = 8;
const depth = new Float32Array(W * H).fill(0.5);
const mask = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) mask[y * W + x] = 1;
const video = sampleVolumePositions(depth, W, H, { gridSize: N, importanceSampling: false,
  fullFrame: { cameraDistance: 3.5 }, foregroundMask: mask });
const ws = new Set(); for (let i = 3; i < video.length; i += 4) ws.add(video[i]);
assert.deepEqual([...ws].sort(), [Math.fround(VIDEO_BACKDROP_OPACITY), 1].sort(), 'video w in {dim, 1}');

// 3. Shaders: no discard for video, photo keeps it, attenuation applied once.
const gl = (m) => m.fragmentShader;
const mats = { pointCloud: createPointCloudMaterial(), ascii: createAsciiMaterial(), neon: createNeonWireMaterial() };
for (const [name, m] of Object.entries(mats)) {
  const f = gl(m);
  assert.ok(m.uniforms.uVideoFootprint, `${name} knows the video flag`);
  assert.match(f, /uniform float uVideoFootprint;/, `${name} fragment declares the flag`);
  assert.match(f, /if \(uVideoFootprint < 0\.5 && uObjectSeparation > 0\.5 && vOpacity < 0\.5\) discard;/,
    `${name}: outside-mask discard is photo-only`);
  assert.doesNotMatch(f, /(^|\n)\s*if \(uObjectSeparation > 0\.5 && vOpacity < 0\.5\) discard;/,
    `${name}: no unconditional discard left`);
  assert.match(f, /uVideoFootprint < 0\.5 && uObjectSeparation < 0\.5 && vOpacity < 0\.5\) (col|tint) \*= 0\.4/,
    `${name}: the x0.4 darkening is photo-only (would stack with the video dim)`);
  assert.doesNotMatch(f, /0\.2\b.*vOpacity|vOpacity\s*\*\s*0\.\d/, `${name}: no second opacity constant`);
  m.dispose();
}
const pc = gl(createPointCloudMaterial());
assert.equal((pc.match(/vOpacity/g) ?? []).filter(Boolean).length > 0, true);
assert.equal((pc.match(/alpha \*= vOpacity;|alpha = uObjectSeparation < 0\.5 \? 1\.0 : vOpacity;/g) ?? []).length >= 1, true);
assert.doesNotMatch(pc, /(vOpacity|alpha)\s*\*=?\s*0\.\d|0\.\d+\s*\*\s*vOpacity/, 'shader holds no backdrop constant; sampler value is the only one');

// 4. Hysteresis 8 on / 4 off (personal clip A IS-Net coverages, docs/benchmarks/video-mask-refresh.md).
assert.equal(AYIRMA_ACMA_ORANI, 0.08);
assert.equal(AYIRMA_KAPATMA_ORANI, 0.04);
assert.ok(AYIRMA_KAPATMA_ORANI < AYIRMA_ACMA_ORANI, 'off below on (hysteresis)');
assert.equal(videoAyirmaDurumu(0.079, false), false, 'off stays off below 8 %');
assert.equal(videoAyirmaDurumu(0.08, false), true, 'turns on at 8 %');
assert.equal(videoAyirmaDurumu(0.04, true), true, 'on stays on at 4 %');
assert.equal(videoAyirmaDurumu(0.039, true), false, 'turns off below 4 %');
// Recorded personal clip A frames: two dancers at 12.1 / 13.5 % and one dancer at 4.5-6.5 % are valid people.
assert.equal(videoAyirmaDurumu(0.121, false), true, 'two-dancer frame (12.1 %) enables');
for (const c of [0.045, 0.051, 0.058, 0.065]) assert.equal(videoAyirmaDurumu(c, true), true, `valid single dancer ${c} keeps it on`);
for (const c of [0.009, 0.029, 0.037]) assert.equal(videoAyirmaDurumu(c, true), false, `body fragment ${c} turns it off`);
let on = false, flips = 0;
for (const c of [0.07, 0.05, 0.06, 0.065, 0.055, 0.07, 0.05]) { const n = videoAyirmaDurumu(c, on); flips += n !== on; on = n; }
assert.equal(flips, 0, 'no flapping around 6 % (off side)');
on = true;
for (const c of [0.07, 0.05, 0.06, 0.065, 0.055, 0.07, 0.05]) { const n = videoAyirmaDurumu(c, on); flips += n !== on; on = n; }
assert.equal(flips, 0, 'no flapping around 6 % (on side)');

// 5. App wiring: live path and keyframe capture share the constants; user latch + 92 % gate kept.
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(app, /videoAyirmaDurumu\(coverage, segmentRef\.current\)/);
assert.match(app, /ayirma && segmentKapaliRef\.current/, 'user-off latch respected');
assert.match(app, /coverage < AYIRMA_KAPATMA_ORANI \|\| coverage >= 0\.92/, 'keyframe capture shares the constant');
assert.match(app, /foreground === 0 \|\| coverage > 0\.92/, 'empty / >92 % gate kept');
assert.doesNotMatch(app, /coverage >= 0\.08|coverage < 0\.08/);
console.log('OK video backdrop dims (single attenuation), photo discard kept, 8/4 hysteresis');
