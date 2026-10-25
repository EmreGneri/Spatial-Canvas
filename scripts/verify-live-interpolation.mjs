import assert from 'node:assert/strict';
import { makeFlowTexture, panTexture } from '../src/engine/vision/lab.ts';
import * as flow from '../src/engine/vision/liveDepthFlow.ts';

assert.equal(typeof flow.propagateLiveDepth, 'function', 'live flow must generate depth between model frames');
const width = 112, height = 80, n = width * height;
const luminance = makeFlowTexture(width, height);
const toFrame = (luma) => ({ width, height, data: Uint8ClampedArray.from({ length: n * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : Math.round(luma[Math.floor(i / 4)] * 255)) });
const oldDepth = Float32Array.from({ length: n }, (_, i) => 0.35 + 0.2 * Math.sin((i % width) * 0.08));
const nextFrame = toFrame(panTexture(luminance, width, height, 2, 1));
const propagated = flow.propagateLiveDepth(oldDepth, toFrame(luminance), nextFrame, width, height);
assert.ok(propagated.coverage > 0.2, 'textured motion has usable confidence');
const target = panTexture(oldDepth, width, height, 2, 1);
let rawError = 0, warpedError = 0;
for (let i = 0; i < n; i++) if (propagated.confidence[i] > 0.5) {
  rawError += (oldDepth[i] - target[i]) ** 2;
  warpedError += (propagated.depth[i] - target[i]) ** 2;
}
assert.ok(warpedError < rawError * 0.15, 'flow moves depth with RGB before another model result');
assert.equal(propagated.confidence[0], 0, 'newly exposed border has no invented correspondence');
const cut = flow.propagateLiveDepth(oldDepth, toFrame(luminance), toFrame(luminance.map(v => 1 - v)), width, height);
assert.equal(cut.coverage, 0, 'scene cut invalidates propagation');
const hardCut = flow.propagateLiveDepth(oldDepth, toFrame(luminance), toFrame(new Float32Array(n)), width, height);
assert.equal(hardCut.sceneCut, true, 'scene cuts are distinguished from insufficient flow tracks');
assert.ok(cut.confidence.every(v => v === 0));
assert.equal(flow.shouldPresentLiveDepth(1.5, 1.6), false, 'late model completion cannot rewind a displayed flow frame');
assert.equal(flow.shouldPresentLiveDepth(1.7, 1.6), true, 'a later frame can be displayed');
assert.equal(flow.shouldPresentLiveDepth(Number.NaN, 1.6), false, 'invalid media timestamps cannot be displayed');
const flatFrame = toFrame(new Float32Array(n).fill(0.5));
const flatMask = new Float32Array(n).fill(0.7);
assert.equal(typeof flow.isLiveFrameUnchanged, 'function', 'unchanged frames support textureless mask propagation');
assert.equal(flow.isLiveFrameUnchanged(flatFrame, flatFrame), true);
const quantizedFrame = { ...flatFrame, data: Uint8ClampedArray.from(flatFrame.data, (v, i) => i % 4 === 3 ? v : v + 2) };
assert.equal(flow.isLiveFrameUnchanged(flatFrame, quantizedFrame), true, 'two levels of RGB quantization are tolerated');
const localChange = { ...flatFrame, data: new Uint8ClampedArray(flatFrame.data) };
localChange.data[100] += 4;
assert.equal(flow.isLiveFrameUnchanged(flatFrame, localChange), false, 'a local change cannot disappear in a frame average');
const staticResult = flow.propagateLiveDepth(oldDepth, flatFrame, quantizedFrame, width, height, flatMask);
assert.equal(staticResult.coverage, 1, 'unchanged textureless RGB needs no optical-flow tracks');
assert.deepEqual(staticResult.depth, oldDepth);
assert.deepEqual(staticResult.mask, flatMask);
assert.notEqual(staticResult.mask, flatMask, 'mask history owns its buffer');
const drifted = Float32Array.from(target, v => v * 1.2 + 0.06);
const aligned = flow.stabilizeLiveDepthPair(oldDepth, drifted, toFrame(luminance), nextFrame, width, height);
let alignedError = 0;
for (let i = 0; i < n; i++) if (propagated.confidence[i] > 0.5) alignedError += (aligned.depth[i] - target[i]) ** 2;
assert.ok(alignedError < rawError * 0.2, 'fresh model scale and shift align to the propagated depth');
assert.ok(Math.abs(aligned.depth[0] - target[0]) < 0.01,
  'global model alignment also applies to newly exposed pixels without blending historical depth');

const { LiveDepthFlowClient } = await import('../src/engine/vision/liveDepthFlowClient.ts');
class FakeWorker {
  requests = [];
  postMessage(message) { this.requests.push(message); }
  terminate() { this.terminated = true; }
  finish(index = this.requests.length - 1) {
    const request = this.requests[index];
    this.onmessage({ data: { id: request.id, generation: request.generation,
      result: { depth: oldDepth, confidence: new Float32Array(n).fill(1), coverage: 1 } } });
  }
}
const worker = new FakeWorker(), results = [];
const client = new LiveDepthFlowClient((result, input) => results.push(input.mediaTime), () => worker);
const submit = mediaTime => client.submit({ depth: oldDepth, previousFrame: toFrame(luminance), currentFrame: nextFrame,
  width, height, mediaTime });
submit(1); submit(2); submit(3);
assert.equal(worker.requests.length, 1, 'one worker job is in flight');
worker.finish();
assert.equal(worker.requests.length, 2, 'one replacement frame is sent after completion');
assert.equal(worker.requests[1].input.mediaTime, 3, 'pending frame is replaced with the latest camera frame');
client.reset();
worker.finish();
assert.deepEqual(results, [1], 'reset drops in-flight results from the previous source');
submit(4);
client.dispose();
worker.finish();
assert.deepEqual(results, [1], 'dispose prevents late publication');
assert.equal(worker.terminated, true);
// F12: a failed worker restarts with backoff instead of disabling interpolation forever.
{
  let clock = 0; const workers = []; const got = [];
  const restarting = new LiveDepthFlowClient((r, input) => got.push(input.mediaTime), () => { const w = new FakeWorker(); workers.push(w); return w; }, () => clock);
  const send = t => restarting.submit({ depth: oldDepth, previousFrame: toFrame(luminance), currentFrame: nextFrame, width, height, mediaTime: t });
  send(1); workers[0].onerror();
  assert.equal(workers[0].terminated, true);
  send(2); assert.equal(workers.length, 1, 'no restart before the backoff');
  clock = 1001; send(3); assert.equal(workers.length, 2, 'worker restarts after backoff');
  workers[1].finish(); assert.deepEqual(got, [3]);
  for (let k = 0; k < 3; k++) { workers.at(-1).onerror(); clock += 10_000; send(10 + k); }
  assert.equal(workers.length, 4, 'restart budget is bounded');
  workers.at(-1).onerror(); clock += 10_000; send(20);
  assert.equal(workers.length, 4, 'interpolation stays off after repeated failures');
  restarting.dispose();
}

let response;
globalThis.self = { postMessage(value) { response = value; } };
await import('../src/engine/vision/liveDepthFlowWorker.ts');
const request = (id, currentFrame, mask, generation = 1) => {
  self.onmessage({ data: { id, generation, input: { depth: oldDepth, previousFrame: toFrame(luminance),
    currentFrame, width, height, mediaTime: id, mask } } });
  return response.result;
};
const firstMask = { data: new Float32Array(n).fill(0.4), width, height, mediaTime: 0, colorFrame: toFrame(luminance) };
const first = request(1, nextFrame, firstMask);
assert.ok(first.mask?.some(v => Math.abs(v - 0.4) < 0.001), 'captured segmentation RGB transports a delayed mask');
const frame2 = toFrame(panTexture(luminance, width, height, 3, 1));
const freshMask = { data: new Float32Array(n).fill(0.8), width, height, mediaTime: 2, colorFrame: frame2 };
const second = request(2, frame2, freshMask);
assert.ok(second.mask?.some(v => v > 0.5 && v < 0.75), 'fresh and historical masks blend after motion alignment');
const cutMask = request(3, toFrame(luminance.map(v => 1 - v)), freshMask);
assert.equal(cutMask.mask, undefined, 'scene cuts clear historical mask flow');
delete globalThis.self;
// F5: interpolation is capped (~12 Hz), never at every presented video frame.
const due24 = [], due30 = [];
for (const [fps, out] of [[24, due24], [30, due30]]) {
  let shown = 0;
  for (let k = 1; k <= fps; k++) if (flow.isLiveInterpolationDue(k / fps, shown)) { shown = k / fps; out.push(k); }
}
assert.ok(due24.length >= 10 && due24.length <= 12, `24 fps -> ${due24.length} interpolations/s`);
assert.ok(due30.length >= 9 && due30.length <= 12, `30 fps -> ${due30.length} interpolations/s`);
assert.equal(flow.liveInterpolationEnabled(''), false, 'interpolation is opt-in (default live path stays as fast as before)');
assert.equal(flow.liveInterpolationEnabled('?araKare=1'), true);
assert.equal(flow.isLiveInterpolationDue(1 + 1 / 24, 1), false, 'the frame right after a model frame is skipped');
console.log('OK live interpolation: motion, occlusion, scene cuts, affine alignment, single flight, resets');
