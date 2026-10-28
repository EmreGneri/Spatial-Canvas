import assert from 'node:assert/strict';
import { makeFlowTexture, panTexture } from '../src/engine/vision/lab.ts';
const { propagateMaskInterval, maskKeyFrames } = await import('../src/engine/vision/videoMaskTrack.ts');

assert.deepEqual(maskKeyFrames(0, 50, 24), [0, 24, 48, 49]);
assert.deepEqual(maskKeyFrames(10, 11, 24), [10]);
assert.deepEqual(maskKeyFrames(0, 48, 24), [0, 24, 47]);

const width = 112, height = 80, n = width * height;
const base = makeFlowTexture(width, height);
const toFrame = (luma) => ({ width, height, data: Uint8ClampedArray.from({ length: n * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : Math.round(luma[Math.floor(i / 4)] * 255)) });
const square = (dx) => Float32Array.from({ length: n }, (_, i) => {
  const x = i % width, y = Math.floor(i / width);
  return x >= 40 + dx && x < 70 + dx && y >= 25 && y < 55 ? 1 : 0;
});
// Camera pans 1 px per frame: the subject mask must follow it, not erode or stay put.
const steps = 8;
const frames = Array.from({ length: steps + 1 }, (_, k) => toFrame(panTexture(base, width, height, k, 0)));
const truth = Array.from({ length: steps + 1 }, (_, k) => panTexture(square(0), width, height, k, 0));
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < n; k++) { const p = a[k] >= 0.5, q = b[k] >= 0.5; if (p && q) i++; if (p || q) u++; } return i / u; };
const forwardOnly = await propagateMaskInterval(frames, truth[0], null, width, height);
assert.equal(forwardOnly.length, steps + 1);
assert.ok(iou(forwardOnly[steps], truth[steps]) > iou(truth[0], truth[steps]), 'forward flow moves the mask with the scene');
assert.ok(iou(forwardOnly[steps], truth[steps]) > 0.75, `forward chain keeps the subject (IoU ${iou(forwardOnly[steps], truth[steps]).toFixed(2)})`);
const both = await propagateMaskInterval(frames, truth[0], truth[steps], width, height);
assert.deepEqual(Array.from(both[0]), Array.from(truth[0]), 'start keyframe is exact');
assert.deepEqual(Array.from(both[steps]), Array.from(truth[steps]), 'end keyframe is exact');
const mid = steps / 2;
assert.ok(iou(both[mid], truth[mid]) > 0.8, `bidirectional middle frame IoU ${iou(both[mid], truth[mid]).toFixed(2)}`);
// Textureless frames: nothing trusted, the mask is carried unchanged (never erased).
const flat = Array.from({ length: 4 }, () => toFrame(new Float32Array(n).fill(0.5)));
const carried = await propagateMaskInterval(flat, truth[0], null, width, height);
assert.deepEqual(Array.from(carried[3]), Array.from(truth[0]));
// Distinct anchors must never contribute to the opposite side of a cut.
const black = toFrame(new Float32Array(n)), white = toFrame(new Float32Array(n).fill(1));
const start = new Float32Array(n), end = new Float32Array(n);
start[20] = 1; end[n - 20] = 1;
const split = await propagateMaskInterval([black, black, white, white], start, end, width, height);
assert.deepEqual(split[1], start, 'pre-cut frame uses only its start anchor');
assert.deepEqual(split[2], end, 'post-cut frame uses only its end anchor');
assert.deepEqual(split[0], start, 'cut interval preserves its start endpoint');
assert.deepEqual(split[3], end, 'cut interval preserves its end endpoint');
const noEnd = await propagateMaskInterval([black, black, white, white], start, null, width, height);
assert.deepEqual(noEnd[1], start, 'reachable start scene retains its mask');
assert.ok(noEnd[2].every(v => v === 1), 'unanchored scene preserves all pixels instead of inventing a subject');
assert.ok(noEnd[3].every(v => v === 1), 'unanchored fallback persists within its scene');
const multi = await propagateMaskInterval([black, black, white, white, black, black], start, end, width, height);
assert.deepEqual(multi[1], start, 'first scene remains tied to the start anchor');
assert.ok(multi[2].every(v => v === 1) && multi[3].every(v => v === 1), 'internal scene has no reachable anchor');
assert.deepEqual(multi[4], end, 'last scene remains tied to the end anchor');
const noCut = await propagateMaskInterval(flat, start, end, width, height);
assert.equal(noCut[1][20], Math.fround(2 / 3), 'no-cut forward blend keeps its original weight');
assert.equal(noCut[1][n - 20], Math.fround(1 / 3), 'no-cut backward blend keeps its original weight');
assert.deepEqual(await propagateMaskInterval([], start, end, width, height), []);
assert.deepEqual((await propagateMaskInterval([black], start, end, width, height))[0], start);
split[1][20] = 0; split[2][n - 20] = 0; noEnd[2][0] = 0;
assert.equal(start[20], 1, 'scene-local output owns its buffer independently of the start mask');
assert.equal(end[n - 20], 1, 'scene-local output owns its buffer independently of the end mask');
assert.equal(split[0][20], 1, 'adjacent scene-local outputs do not share storage');
assert.equal(noEnd[3][0], 1, 'unanchored fallback outputs do not share storage');
console.log('OK video mask track: key frames, flow-following chains, no-cut blend, scene-local anchors, unanchored fallback, ownership');
