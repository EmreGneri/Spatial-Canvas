// Frame stabilizer on top of the reference pipeline live output (liveDepth.ts · kareStabilize):
// flicker on static pixels drops, moving content is taken at once (no trail),
// persistent global scale changes are followed, state resets, and it can be disabled.
import assert from 'node:assert/strict';
import { kareStabilize, kareStabilDurumu, kareStabilAcik, KARE_STABIL_VARSAYILAN } from '../src/engine/vision/liveDepth.ts';

const W = 40, H = 30, N = W * H;
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
const scene = Float32Array.from({ length: N }, (_, i) => 0.2 + 0.6 * ((i % W) / W));
const lum = Float32Array.from({ length: N }, (_, i) => 0.3 + 0.4 * (((i % W) * 3 + Math.floor(i / W)) % 7) / 7);
const noisy = () => Float32Array.from(scene, (v) => v + 0.05 * rnd());
const meanAbs = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

// [1] Static scene, per-pixel model noise: frame-to-frame change drops clearly.
const state = kareStabilDurumu();
let prevRaw = null, prevOut = null, rawFlicker = 0, outFlicker = 0;
for (let t = 0; t < 20; t++) {
  const raw = noisy();
  const out = kareStabilize(raw, W, H, lum, state);
  if (prevRaw && t > 5) { rawFlicker += meanAbs(raw, prevRaw); outFlicker += meanAbs(out, prevOut); }
  prevRaw = raw; prevOut = out;
}
console.log(`[1] static flicker raw ${rawFlicker.toFixed(4)} -> stabilized ${outFlicker.toFixed(4)}`);
assert.ok(outFlicker < 0.6 * rawFlicker, 'static flicker must drop by at least 40%');

// [2] A region whose luminance changes (it moved) takes the new depth at once.
const movedLum = Float32Array.from(lum);
const movedDepth = Float32Array.from(scene);
for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) { movedLum[y * W + x] = 0.95 - lum[y * W + x] * 0.5; movedDepth[y * W + x] = 0.95; }
const moved = kareStabilize(movedDepth, W, H, movedLum, state, null, { ...KARE_STABIL_VARSAYILAN, hizalama: 0 });
assert.ok(Math.abs(moved[15 * W + 15] - 0.95) < 1e-6, `moving pixel lagged: ${moved[15 * W + 15]}`);

// [3] A persistent global scale change is followed within a few frames (no lock-in).
const s2 = kareStabilDurumu();
kareStabilize(scene, W, H, lum, s2);
const scaled = Float32Array.from(scene, (v) => 0.8 * v + 0.1);
let out;
for (let t = 0; t < 25; t++) out = kareStabilize(scaled, W, H, lum, s2);
assert.ok(meanAbs(out, scaled) < 0.01, `stabilizer locked to the old scale: ${meanAbs(out, scaled)}`);

// [4] A fresh state (reset) passes the first frame through unchanged; input is not mutated.
const fresh = kareStabilDurumu();
const input = noisy(), copy = Float32Array.from(input);
assert.deepEqual(kareStabilize(input, W, H, lum, fresh), copy);
assert.deepEqual(input, copy);

// [5] Switch: on by default, ?titremeFiltresi=0 restores the raw reference pipeline output.
assert.equal(kareStabilAcik(''), true);
assert.equal(kareStabilAcik('?titremeFiltresi=0'), false);
const src = (await import('node:fs')).readFileSync(new URL('../src/engine/vision/liveDepth.ts', import.meta.url), 'utf8');
assert.match(src, /canliStabil\.zamansal = zamansalDurumAc\(\);/, 'resetLiveDepthState (seek, loop, cut, size) clears the stabilizer');

console.log('OK frame stabilizer: flicker down, no trail, follows scale, resets, switchable');
