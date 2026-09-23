import assert from 'node:assert/strict';
import { moveBoxWithFlow } from '../src/engine/vision/tracker.ts';

const box = { id: 1, x: 10, y: 10, w: 10, h: 10, label: 'person' };

// Flow coordinates refer to the previous frame. The point leaving the box
// belongs to the object; the point entering it did not belong to it.
const moved = moveBoxWithFlow(box, [
  { x: 15, y: 15, u: 10, v: 0, status: 1 },
  { x: 5, y: 15, u: 10, v: 0, status: 1 },
]);
assert.equal(moved.x, 20, 'source-frame point moves the box even if it leaves');
assert.equal(moved.y, 10);

const ignored = moveBoxWithFlow(box, [
  { x: 5, y: 15, u: 10, v: 0, status: 1 },
]);
assert.equal(ignored.x, 10, 'a point entering from outside must not move the box');

// Async detection boxes need the flows that happened after their capture.
const advanced = [
  [{ x: 15, y: 15, u: 3, v: 0, status: 1 }],
  [{ x: 18, y: 15, u: 4, v: 0, status: 1 }],
].reduce(moveBoxWithFlow, box);
assert.equal(advanced.x, 17, 'two later flow steps advance a delayed detection');

console.log('OK object tracker flow: source-frame membership and delayed boxes');
