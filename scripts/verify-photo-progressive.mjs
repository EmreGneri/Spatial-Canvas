import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Exercise the real depth orchestration without loading models or a GPU.
const source = await readFile(new URL('../src/depth.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function estimateDepth(');
const end = source.indexOf('\n/** DAViD ön plan maskesi', start);
const code = stripTypeScriptTypes(source.slice(start, end).replace('export async', 'async'));
const events = [];
const raw = Float32Array.from([.1, .3, .7, .9]);
const mask = { data: new Float32Array(4).fill(1), width: 2, height: 2 };
let calls = 0;
const bindings = {
  currentPhotoMeasurement: () => null,
  loadDepthModel: async () => ({}), sidecarEstimators: new WeakSet(),
  tarayiciCihazi: 'webgpu', depthDevice: 'webgpu',
  loadTransformers: async () => ({ RawImage: { fromCanvas: async () => ({}) } }),
  toCanvas: x => x, scaleCanvasTo: x => x, MODEL_INPUT_SIZE: 518,
  DETAIL_STRENGTH_DEFAULT: 0, FOREGROUND_STRETCH_DEFAULT: false,
  SOBEL_RELIEF_DEFAULT: 0, DEPTH_SMOOTHING_DEFAULT: false,
  runPhotoModel: async () => { calls++; events.push('infer'); return {
    predicted_depth: { data: raw, dims: [1, 2, 2] }, photoModel: 'v2-small', photoShift: 0,
  }; },
  normalizeDepth: data => Float32Array.from(data),
  mergeSubjectDetail: async data => { events.push('subject'); data[0] += .01; },
  limitDepthSlope: data => Float32Array.from(data), MAX_SLOPE_PER_PX: .1,
  mergeHeadDetail: async () => { events.push('head'); },
  applyDavidMask: async () => { events.push('david'); return { maske: mask.data, tani: { arkaUc: 'webgpu', sureMs: 1 } }; },
};
const estimate = new Function(...Object.keys(bindings), `${code}; return estimateDepth;`)(...Object.values(bindings));
const options = { aspect: 'distort', model: 'v2-small', detailStrength: 0, foregroundStretch: false,
  sobelRelief: 0, depthSmoothing: false, insanMaskesi: 'otomatik' };
const baseline = await estimate({}, { ...options, subjectMask: mask });
events.length = 0; calls = 0;
let preview;
const result = await estimate({}, { ...options,
  onPreview: async value => { events.push('preview'); preview = value; value.data.fill(0); },
  prepareSubjectMask: async () => { events.push('mask'); return mask; },
});
assert.deepEqual(events, ['infer', 'preview', 'mask', 'subject', 'head', 'david']);
assert.equal(calls, 1, 'preview must reuse the final pipeline inference');
assert.deepEqual(result, baseline, 'final quality must match the existing pipeline');
assert.notEqual(preview.data, raw, 'preview must not alias model or final buffers');
events.length = 0;
const cancelled = new Error('source changed');
await assert.rejects(estimate({}, { ...options, onPreview: () => { throw cancelled; },
  prepareSubjectMask: async () => { events.push('mask'); return mask; },
}), error => error === cancelled);
assert.deepEqual(events, ['infer'], 'cancelled source must not start heavy refinement');
console.log('PASS progressive photo: early preview, one inference, identical final result, cancellation');

