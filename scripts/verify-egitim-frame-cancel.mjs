import assert from 'node:assert/strict';
import { Session } from '../src/vendor/splat.js/session.js';

const originalBitmap = globalThis.createImageBitmap;
const controller = new AbortController();
let decoded = 0, closed = 0;

try {
  globalThis.createImageBitmap = async () => {
    decoded++;
    controller.abort();
    return { width: 16, height: 16, close() { closed++; } };
  };
  const session = new Session({});
  await assert.rejects(
    session.load([{ source: {}, name: 'first' }, { source: {}, name: 'second' }], { signal: controller.signal }),
    { name: 'AbortError' },
    'closing during image decode must cancel the remaining frames',
  );
  assert.equal(decoded, 1, 'the next frame must not start decoding');
  assert.equal(closed, 1, 'the decoded bitmap must be released');
  console.log('3DGS frame decode cancellation: OK');
} finally {
  if (originalBitmap === undefined) delete globalThis.createImageBitmap;
  else globalThis.createImageBitmap = originalBitmap;
}
