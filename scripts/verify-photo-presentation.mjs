import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const original = app.match(/await (new Promise<void>\(resolve => requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => resolve\(\)\)\)\))/);
if (original) {
  // Exercise the actual original expression with a background-tab scheduler that never fires.
  const wait = new Function('requestAnimationFrame', `return ${original[1].replace('<void>', '')};`);
  const status = await Promise.race([wait(() => 1).then(() => 'settled'), new Promise(r => setTimeout(() => r('blocked'), 40))]);
  assert.notEqual(status, 'blocked', 'background rAF must not suspend final photo processing indefinitely');
} else {
  const { waitForPhotoPresentation } = await import('../src/engine/photoPresentation.ts');
  assert.match(app, /await waitForPhotoPresentation\(\)/, 'App must use the bounded presentation helper');
  const queue = [], cancelled = [];
  let settled = false;
  const p = waitForPhotoPresentation(100, f => { queue.push(f); return queue.length; }, id => cancelled.push(id), false).then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  queue.shift()(0); await Promise.resolve(); assert.equal(settled, false);
  queue.shift()(16); await p; assert.equal(settled, true, 'visible tab keeps two frame opportunities');
  const started = performance.now();
  await waitForPhotoPresentation(20, () => 7, id => cancelled.push(id), false);
  assert.ok(performance.now() - started < 200, 'lost rAF has a finite deadline');
  assert.ok(cancelled.includes(7), 'outstanding callbacks are cancelled');
  let scheduled = 0;
  await waitForPhotoPresentation(100, () => { scheduled++; return 1; }, () => {}, true);
  assert.equal(scheduled, 0, 'hidden tabs continue without waiting for a presentation');
  await waitForPhotoPresentation(20, () => { throw Error('scheduler unavailable'); }, () => {}, false);
  console.log('PASS photo presentation: two visible frames, hidden/no-rAF deadline, callbacks cleaned');
}
