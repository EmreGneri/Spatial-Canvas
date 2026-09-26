import assert from 'node:assert/strict';
import { createGaussianBendController } from '../src/engine/reconstruction/egitim3dgs.ts';
import { Session } from '../src/vendor/splat.js/session.js';
import { klipKareleri } from '../src/ui/klipRender.ts';

// Mock only GPU transport: exercise the real controller, clip restore and PLY exporter.
const original = new Float32Array([
  -0.8, 0, 0, -2, -2, -2, 1, 0, 0, 0, 0.8, 0.2, 0.1, 2, -0, 0,
  0.8, 0, 0, -2, -2, -2, 1, 0, 0, 0, 0.1, 0.8, 0.2, 1, 0, 0,
  2, 0, 0, -2, -2, -2, 1, 0, 0, 0, 0.2, 0.1, 0.8, 0.4, 0, 0,
]);
let gpu = original.slice(), writes = 0, reads = 0, ready = true, failWrite = false;
const session = new Session();
session.trainer = {
  device: { queue: { writeBuffer(_buffer, offset, data) {
    assert.equal(offset, 0);
    if (failWrite) throw new Error('GPU write failed');
    gpu = data.slice(); writes++;
  } } }, bufParams: {}, camMeta: [], dcMode: 'linear',
  async readGaussians() { reads++; return { data: gpu.slice(), n: 3, sh: null, shK: 0 }; },
};
const controller = createGaussianBendController(session, () => ready, () => {});
assert.equal(typeof controller.gaussianlar, 'function', 'BASE Gaussian inspection API must exist');
assert.equal(typeof controller.temizle, 'function', 'BASE cleanup API must exist');
const bytes = (data) => Buffer.from(data.buffer, data.byteOffset, data.byteLength);
const ply = async () => {
  const blob = await session.exportPlyBlob();
  return { count: Number((await blob.text()).match(/element vertex (\d+)/)[1]), size: blob.size };
};
const before = await ply();
const copy = await controller.gaussianlar();
assert.equal(copy.n, 3);
assert.equal(copy.stride, 16);
assert.deepEqual(bytes(copy.data), bytes(original));
copy.data.fill(999);
assert.deepEqual(bytes((await controller.gaussianlar()).data), bytes(original), 'returned copy cannot mutate BASE');
await controller.apply(0.3, 2, undefined, 1.5);
assert.deepEqual(bytes((await controller.gaussianlar()).data), bytes(original), 'inspection returns BASE while effects are active');
const activeBefore = gpu.slice();
const writeBefore = writes;
const undo = await controller.temizle([1, 1]);
assert.equal(writes, writeBefore + 1, 'cleanup applies active deform and fade with exactly one GPU write');
assert.deepEqual(gpu.slice(0, 29), activeBefore.slice(0, 29), 'cleanup preserves active geometry and other splats');
assert.ok(gpu[29] < Math.log(1 / 254), 'cleaned alpha is below real export cut');
assert.equal((await ply()).count, 2, 'real PLY export excludes cleaned splat');
assert.ok((await ply()).size < before.size);
const cleaned = original.slice(); cleaned[29] = (await controller.gaussianlar()).data[29];
await controller.apply(0);
assert.deepEqual(bytes(gpu), bytes(cleaned), 'zero restores cleaned BASE bit exactly');
let strength = 0, fade = false;
const clip = {
  deform: async (s) => { strength = s.strength; await controller.apply(strength, 2, undefined, fade ? 1.5 : Infinity); },
  fade: async (enabled) => { fade = enabled; await controller.apply(strength, 2, undefined, fade ? 1.5 : Infinity); },
};
for (const kind of ['yok', 'yana']) {
  await klipKareleri(clip, kind, 0.3, 4, { deform: { kind: 'bend', strength: 0 }, fade: false }, async () => {
    assert.ok(gpu[29] < Math.log(1 / 254), 'clip frames never resurrect cleaned splats');
  });
  assert.deepEqual(bytes(gpu), bytes(cleaned), `${kind} clip restore keeps cleaned BASE`);
}
await undo.geriAl();
assert.deepEqual(bytes(gpu), bytes(original), 'undo restores all bits including signed zero');
assert.equal((await ply()).count, 3);
await undo.geriAl();
assert.deepEqual(bytes(gpu), bytes(original), 'repeated undo is harmless');
for (const bad of [[-1], [3], [0.5], [NaN], [0, 99]]) {
  await assert.rejects(controller.temizle(bad), /index/i);
  assert.deepEqual(bytes((await controller.gaussianlar()).data), bytes(original), 'invalid selection is atomic');
}
const first = await controller.temizle([0]);
const second = await controller.temizle([0, 2]);
await assert.rejects(first.geriAl(), /order/i, 'overlapping undo must be last-in-first-out');
await second.geriAl();
assert.ok(gpu[13] < Math.log(1 / 254));
await first.geriAl();
assert.deepEqual(bytes(gpu), bytes(original));
failWrite = true;
await assert.rejects(controller.temizle([0]), /GPU write failed/);
failWrite = false;
assert.deepEqual(bytes((await controller.gaussianlar()).data), bytes(original), 'failed write rolls back BASE');
const continuedUndo = await controller.temizle([2]);
await controller.apply(0.3);
controller.restoreForTraining();
assert.ok(gpu[45] < Math.log(1 / 254), 'continuation receives cleaned BASE');
await assert.rejects(continuedUndo.geriAl(), /expired/i, 'old index tokens expire before trainer relocation');
ready = false;
await assert.rejects(controller.gaussianlar(), /finished/);
await assert.rejects(controller.temizle([0]), /finished/);
ready = true;
const newBase = await controller.gaussianlar();
assert.ok(newBase.data[45] < Math.log(1 / 254));
const disposedUndo = await controller.temizle([0]);
controller.dispose();
await assert.rejects(disposedUndo.geriAl(), /expired/i);
console.log('egitim cleanup verified: BASE copy, single-write composition, real PLY cut, clip/zero restore, exact undo, validation, lifecycle');
