import assert from 'node:assert/strict';
import { startLiveDepthDriver } from '../src/engine/vision/liveDepth.ts';

const fault = new Error('renderer rejected depth');
let reported = null;
let unhandled = null;
const captureUnhandled = (error) => { unhandled = error; };
process.on('unhandledRejection', captureUnhandled);

const stop = startLiveDepthDriver({
  infer: async () => ({ data: new Float32Array([0.5]), width: 1, height: 1 }),
  onDepth: () => { throw fault; },
  onError: (error, count) => { reported = { error, count }; },
  maxErrors: 1,
});
await new Promise((resolve) => setTimeout(resolve, 40));
stop();
process.off('unhandledRejection', captureUnhandled);
assert.equal(unhandled, null, 'frame callback failure must be handled');
assert.deepEqual(reported, { error: fault, count: 1 });
console.log('OK live depth driver callback error');
