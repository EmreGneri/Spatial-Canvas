import assert from 'node:assert/strict';
import { computeOpticalFlow, FLOW_HEIGHT, FLOW_WIDTH } from '../src/engine/vision/flow.ts';
import { makeFlowTexture, panTexture } from '../src/engine/vision/lab.ts';

const { isLiveDepthResultStale, stabilizeLiveDepthPair } = await import('../src/engine/vision/liveDepthFlow.ts');
assert.equal(isLiveDepthResultStale(1, 1.5), false, 'fresh inference result is kept');
assert.equal(isLiveDepthResultStale(1, 1.8), true, 'old inference result is dropped');
const width = FLOW_WIDTH;
const height = FLOW_HEIGHT;
const n = width * height;
const lum0 = makeFlowTexture(width, height);
const dx = 2.2;
const dy = 0.8;
const lum1 = panTexture(lum0, width, height, dx, dy);
const depthBase = Float32Array.from({ length: n }, (_, i) => {
  const x = i % width;
  const y = Math.floor(i / width);
  return 0.45 + 0.12 * Math.sin(x * 0.05) * Math.sin(y * 0.07);
});
const raw = panTexture(depthBase, width, height, dx, dy);
for (let i = 0; i < n; i++) raw[i] += 0.025 * Math.sin(i * 0.17);
const toFrame = (luma) => {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const value = Math.round(luma[i] * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
};
const prevFrame = toFrame(lum0);
const currFrame = toFrame(lum1);
const flow = computeOpticalFlow(lum0, lum1, width, height).filter((point) => point.status === 1);
assert.ok(flow.length > 300, `synthetic pan has enough tracks (${flow.length})`);
const result = stabilizeLiveDepthPair(depthBase, raw, prevFrame, currFrame, width, height);
const rmse = (a, b) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);
assert.ok(result.coverage > 0.25, `motion tracks provide useful coverage (${result.coverage})`);
assert.ok(rmse(result.depth, panTexture(depthBase, width, height, dx, dy)) < rmse(raw, panTexture(depthBase, width, height, dx, dy)) * 0.95,
  'flow-compensated depth reduces error over the new raw estimate');

const cutFrame = toFrame(Float32Array.from(lum1, (value) => 1 - value));
const cut = stabilizeLiveDepthPair(depthBase, raw, prevFrame, cutFrame, width, height);
assert.equal(cut.coverage, 0, 'scene cuts disable historical flow');
assert.deepEqual(cut.depth, raw, 'scene cuts keep the current model estimate');

const wrongSize = stabilizeLiveDepthPair(depthBase, raw, prevFrame,
  { data: new Uint8ClampedArray(4), width: 1, height: 1 }, width, height);
assert.equal(wrongSize.coverage, 0, 'dimension changes disable historical flow');
assert.deepEqual(wrongSize.depth, raw, 'dimension changes keep the current model estimate');
console.log('OK live depth flow integration: motion compensation, scene-cut and size guards');
