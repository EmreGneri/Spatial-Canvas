import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
const { createVdaGpuSlots, vdaGpuOptions, vdaContext } = await import('../src/engine/vision/vdaGpu.ts');
const slots = createVdaGpuSlots();
const reference = (await import('../src/engine/vision/videoDepthAnything.ts'));
const history = reference.createVdaHistory();
for (let frame = 0; frame < 120; frame++) {
  const slot = slots.next();
  assert.ok(!slots.selected().includes(slot), 'Write must never overwrite an attended frame');
  slots.commit(slot);
  reference.advanceVdaHistory(history, slot);
  assert.deepEqual(slots.selected(), reference.selectVdaHistory(history), 'GPU slot indices preserve the official first2/latest29 schedule');
}
slots.reset();
assert.equal(slots.frames(), 0);
assert.deepEqual(slots.selected(), []);
assert.deepEqual(vdaGpuOptions('?vdaGpu=1&vdaCapture=1'), { enabled: true, capture: true });
assert.deepEqual(vdaGpuOptions(''), { enabled: false, capture: false });
assert.deepEqual(vdaGpuOptions('?vdaCapture=1'), { enabled: false, capture: false });
assert.deepEqual(vdaGpuOptions('?videoDerinlik=vda'), { enabled: true, capture: false });
assert.deepEqual(vdaGpuOptions('?videoDerinlik=vda&vdaGpu=0&vdaCapture=1'), { enabled: false, capture: false });
assert.equal(vdaContext('?vdaContext=16'), 16);
assert.equal(vdaContext('?vdaContext=7'), 32);
const short = createVdaGpuSlots(16), shortHistory = reference.createVdaHistory();
for (let frame = 0; frame < 120; frame++) {
  const slot = short.next(); short.commit(slot); reference.advanceVdaHistory(shortHistory, slot, 16);
  assert.equal(short.selected().length, 15);
  assert.deepEqual(short.selected(), reference.selectVdaHistory(shortHistory, 16));
}
console.log('verify-vda-gpu: GPU ring matches official cache schedule across 120 frames and reset');
