// Pure helper behind the optional measurement hook: merges extracted training
// frames with fixed held-out frames, guarding against name collisions.
import assert from 'node:assert/strict';
import { olcumKareleriniBirlestir } from '../src/engine/reconstruction/egitim3dgs.ts';

const blob = () => new Blob([new Uint8Array([1])]);
const cikan = [
  { source: blob(), name: 'frame_00001.jpg', t: 0 },
  { source: blob(), name: 'frame_00002.jpg', t: 1 },
];

// No held-out frames: same array reference back, default path untouched.
assert.equal(olcumKareleriniBirlestir(cikan, undefined), cikan, 'undefined ayrilan returns the same reference');
assert.equal(olcumKareleriniBirlestir(cikan, []), cikan, 'empty ayrilan returns the same reference');

// Merge order: extracted frames first, then held-out frames appended.
const ayrilan = [
  { source: blob(), name: 'olcum_t1.500.jpg', t: 1.5 },
  { source: blob(), name: 'olcum_t3.000.jpg', t: 3 },
];
const birlesik = olcumKareleriniBirlestir(cikan, ayrilan);
assert.deepEqual(birlesik.map((f) => f.name), [
  'frame_00001.jpg', 'frame_00002.jpg', 'olcum_t1.500.jpg', 'olcum_t3.000.jpg',
], 'extracted frames first, held-out frames appended in order');
assert.notEqual(birlesik, cikan, 'a real merge returns a new array');

// Duplicate names within ayrilan.
assert.throws(
  () => olcumKareleriniBirlestir(cikan, [
    { source: blob(), name: 'olcum_a.jpg', t: 0 },
    { source: blob(), name: 'olcum_a.jpg', t: 1 },
  ]),
  /olcum_a\.jpg/,
  'duplicate name within ayrilan throws',
);

// Collision with an extracted name.
assert.throws(
  () => olcumKareleriniBirlestir(cikan, [{ source: blob(), name: 'frame_00001.jpg', t: 0 }]),
  /frame_00001\.jpg/,
  'collision with an extracted name throws',
);

// Held-out name matching the extracted-frame pattern (even if not an actual collision).
assert.throws(
  () => olcumKareleriniBirlestir(cikan, [{ source: blob(), name: 'frame_00099.jpg', t: 0 }]),
  /frame_00099\.jpg/,
  'held-out name matching frame_#####.jpg throws',
);

console.log('olcum kancasi merge helper verified: order, passthrough, duplicate/collision/pattern errors');
