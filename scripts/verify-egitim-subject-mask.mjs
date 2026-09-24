import assert from 'node:assert/strict';
import { prepareSubjectFrames } from '../src/engine/reconstruction/subjectTrainingMasks.ts';
import { processSource } from '../src/vendor/splat.js/io/frames.js';

const originalDocument = globalThis.document;
const originalBitmap = globalThis.createImageBitmap;
const originalOffscreenCanvas = globalThis.OffscreenCanvas;
const canvases = [];
let closedBitmaps = 0;

function canvas() {
  const target = { width: 0, height: 0, pixels: null };
  target.getContext = () => ({
    drawImage() {},
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(image) { target.pixels = image.data; },
  });
  canvases.push(target);
  return target;
}

try {
  globalThis.document = { createElement: () => canvas() };
  globalThis.createImageBitmap = async () => ({
    width: 8, height: 4, close() { closedBitmaps++; },
  });
  const frames = Array.from({ length: 10 }, (_, i) => ({
    source: new Blob([String(i)]), name: `frame_${i}.jpg`, t: i / 2,
  }));
  const progress = [];
  const segment = async () => ({
    width: 2, height: 2,
    mask: Float32Array.of(0, 1, 0.5, 0),
  });
  const prepared = await prepareSubjectFrames(frames, segment, undefined,
    (done, total, skipped) => progress.push([done, total, skipped]));
  assert.deepEqual(progress, Array.from({ length: 11 }, (_, done) => [done, 10, 0]));
  assert.equal(prepared.frames.length, 10);
  assert.equal(prepared.skipped, 0);
  assert.equal(prepared.frames[0].source, frames[0].source);
  assert.equal(prepared.frames[0].name, frames[0].name);
  assert.equal(prepared.frames[0].t, frames[0].t);
  assert.equal(prepared.frames[0].mask.width, 2);
  assert.deepEqual([...prepared.frames[0].mask.pixels.slice(0, 8)], [0, 0, 0, 255, 255, 255, 255, 255]);
  assert.deepEqual([...prepared.frames[0].mask.pixels.slice(8, 12)], [128, 128, 128, 255],
    'soft matte values must survive conversion into the vendored training target');
  assert.equal(closedBitmaps, 10);
  prepared.release();
  assert.equal(prepared.frames[0].mask.width, 0);
  assert.equal(prepared.frames[1].mask.height, 0);

  const skippedProgress = [];
  let attempted = 0;
  const withSkips = await prepareSubjectFrames(frames, async () => {
    const isInvalid = attempted === 2 || attempted === 5;
    attempted++;
    return { width: 2, height: 2,
      mask: isInvalid ? new Float32Array(4) : Float32Array.of(0, 1, 1, 0) };
  }, undefined, (done, total, skipped) => skippedProgress.push([done, total, skipped]));
  assert.equal(withSkips.frames.length, 8);
  assert.equal(withSkips.skipped, 2);
  assert.deepEqual(withSkips.frames.map((f) => f.name),
    frames.filter((_, i) => i !== 2 && i !== 5).map((f) => f.name),
    'isolated bad mattes drop only their own frame, preserving order and metadata');
  assert.deepEqual(skippedProgress.filter((p) => p[2] > 0).at(-1), [10, 10, 2]);
  withSkips.release();

  let frameIndex = 0;
  const firstMaskCanvas = canvases.length + 1;
  await assert.rejects(
    prepareSubjectFrames(frames, async () => {
      frameIndex++;
      return frameIndex === 1
        ? { width: 2, height: 2, mask: Float32Array.of(0, 1, 1, 0) }
        : { width: 2, height: 2, mask: new Float32Array(4) };
    }),
    /insufficient reliable subject masks/i,
  );
  assert.equal(canvases[firstMaskCanvas].width, 0,
    'failure in a later frame releases masks already prepared');

  const abort = new AbortController();
  let attempts = 0;
  await assert.rejects(
    prepareSubjectFrames(frames, async () => {
      attempts++;
      abort.abort();
      return { width: 2, height: 2, mask: Float32Array.of(0, 1, 1, 0) };
    }, abort.signal),
    { name: 'AbortError' },
  );
  assert.equal(attempts, 1, 'cancellation prevents another GPU inference');

  class TrainingCanvas {
    constructor(width, height) { this.width = width; this.height = height; this.pixels = new Uint8ClampedArray(width * height * 4); }
    getContext() {
      return {
        canvas: this,
        drawImage: (source) => { this.pixels.set(source.pixels); },
        getImageData: () => ({ data: this.pixels }),
      };
    }
  }
  globalThis.OffscreenCanvas = TrainingCanvas;
  const photo = new TrainingCanvas(4, 4);
  const matte = new TrainingCanvas(4, 4);
  for (let p = 0; p < 16; p++) {
    photo.pixels.set([20, 40, 60, 255], p * 4);
    const subject = p === 5 || p === 6 || p === 9 || p === 10;
    matte.pixels.set([subject ? 255 : 0, 0, 0, 255], p * 4);
  }
  const scene = processSource(photo, 4, 4, 'frame', 4, { featMaxDim: 4 });
  const subject = processSource(photo, 4, 4, 'frame', 4,
    { featMaxDim: 4, mask: matte, maskGuard: 0 });
  assert.equal(scene.alpha, null);
  assert.equal(subject.alpha[5], 255);
  assert.equal(subject.alpha[0], 0);
  assert.deepEqual([...subject.gray], [...scene.gray],
    'the subject mask must not remove full-scene features used to solve camera poses');
  assert.deepEqual([...subject.rgb], [...scene.rgb],
    'the subject mask must be a separate alpha, not baked into the photograph');
  console.log('3DGS subject-mask preparation and cancellation: OK');
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalBitmap === undefined) delete globalThis.createImageBitmap;
  else globalThis.createImageBitmap = originalBitmap;
  if (originalOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
  else globalThis.OffscreenCanvas = originalOffscreenCanvas;
}
