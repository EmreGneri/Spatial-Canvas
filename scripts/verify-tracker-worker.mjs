import assert from 'node:assert/strict';

const messages = [];
let worker;

globalThis.OffscreenCanvas = class {};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { locks: { request: async (_name, task) => task() } },
});
globalThis.Worker = class {
  constructor() { worker = this; }
  postMessage(message) { messages.push(message); }
  terminate() { this.terminated = true; }
};
globalThis.document = {
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
    };
  },
};
globalThis.createImageBitmap = async (canvas) => ({
  width: canvas.width,
  height: canvas.height,
  close() {},
});

const { TrackerClient } = await import('../src/engine/vision/trackerClient.ts');
const client = new TrackerClient();
assert.equal(messages[0].type, 'init');

const source = { width: 640, height: 420 };
client.step(source);
client.step(source);
client.step(source);
await new Promise(setImmediate);
const firstFrame = messages.find((message) => message.type === 'frame');
assert.deepEqual([firstFrame.frame.width, firstFrame.frame.height], [128, 72]);

const target = { id: 7, x: 4, y: 5, w: 8, h: 8 };
worker.onmessage({ data: {
  type: 'result', generation: 0, targets: [target],
  status: { phase: 'ready', error: null },
} });
assert.deepEqual(client.step(source), [target]);

client.reset();
assert.deepEqual(client.step(source), []);
worker.onmessage({ data: {
  type: 'result', generation: 0, targets: [target],
  status: { phase: 'ready', error: null },
} });
assert.deepEqual(client.step(source), [], 'old-generation result must not return');

client.setMod('nesne');
client.step(source);
await new Promise(setImmediate);
const lastFrame = messages.filter((message) => message.type === 'frame').at(-1);
assert.deepEqual([lastFrame.frame.width, lastFrame.frame.height], [384, 252]);
client.dispose();
assert.equal(worker.terminated, true);

delete globalThis.navigator.locks;
const withoutCrossRealmLock = new TrackerClient();
assert.equal(withoutCrossRealmLock.status.phase, 'idle');
assert.equal(messages.filter((message) => message.type === 'init').length, 1,
  'without Web Locks the tracker must stay on the main thread');
withoutCrossRealmLock.dispose();

console.log('OK · tracker worker transport, reduced capture, stale-result guard, GPU lock fallback');
