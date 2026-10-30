// 'maskeyi göster': video shows the APPLIED mask (what the engine got), photo unchanged; no cost when off.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
const { maskeOverlayKaynagi } = await import('../src/ui/maskOverlay.ts');

const vm = { data: new Float32Array(4), width: 2, height: 2 }, photo = new Float32Array(6);
// 1. Source selection.
assert.equal(maskeOverlayKaynagi({ video: true, videoMask: vm, photoMask: photo, photoSize: { width: 3, height: 2 } }).mask, vm,
  'video: the applied video mask, never the stale photo mask');
assert.match(maskeOverlayKaynagi({ video: true, videoMask: null, photoMask: photo, photoSize: { width: 3, height: 2 } }).mesaj,
  /video maskesi yok/, 'video without an applied mask: a message, not an empty box');
assert.deepEqual(maskeOverlayKaynagi({ video: false, videoMask: vm, photoMask: photo, photoSize: { width: 3, height: 2 } }).mask,
  { data: photo, width: 3, height: 2 }, 'photo: engine foreground mask as before');
assert.equal(maskeOverlayKaynagi({ video: false, videoMask: null, photoMask: null, photoSize: null }), null, 'photo without mask: cleared as before');

// 2. App wiring.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const apply = app.slice(app.indexOf('const applyDepth = '), app.indexOf('statsFrames++; totalFrames++;'));
assert.match(apply, /appliedVideoMaskRef\.current = mask \?\? null;/, 'the same object setDepth got (after the tracker shift)');
assert.match(apply, /if \(maskOverlayOnRef\.current && \(mask\?\.data \?\? null\) !== drawnOverlayMaskRef\.current\) drawMaskOverlay\(\);/,
  'off: one boolean test per depth frame; on: redraw only for a new or moved mask');
assert.equal((apply.match(/drawMaskOverlay\(\)/g) ?? []).length, 1);
// Stale: source teardown (video switch / photo / camera) clears it; a seek or cut clears videoMask, so the next frame applies null.
assert.match(app, /videoRef\.current = null;\s*\}\s*appliedVideoMaskRef\.current = null;\s*if \(maskOverlayOnRef\.current\) drawMaskOverlay\(\);/);
assert.match(app, /if \(reason !== 'loop' && !cutTooSoon\) \{\s*maskRevision\+\+;\s*videoMask = null;/);
const draw = app.slice(app.indexOf('function drawMaskOverlay()'), app.indexOf('async function toggleCamera'));
assert.match(draw, /maskeOverlayKaynagi\(\{ video: !!videoRef\.current, videoMask: appliedVideoMaskRef\.current,/);
assert.match(draw, /const cap = 256;/, 'same 256 px cap');
console.log('verify-mask-overlay OK');
