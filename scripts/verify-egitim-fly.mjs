// Free-fly (WASD) camera for the trained 3DGS view — no GPU.
import assert from 'node:assert/strict';
import { flyAxes, flyStep, lookAround, flyRadius } from '../src/ui/egitimControls.ts';
import { kameraMerkezi, sahneYaricapi } from '../src/engine/reconstruction/egitim3dgs.ts';

const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);
const up = [0, -1, 0]; // COLMAP: y points down
// Camera at origin looking +z, x right, y down.
const k0 = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], f: 500, cx: 320, cy: 240, w: 640, h: 480 };
const pivot = [0, 0, 5];

// Held keys -> axes; opposite keys cancel, unknown keys ignored.
assert.deepEqual(flyAxes(new Set(['KeyW'])), { forward: 1, right: 0, vertical: 0 });
assert.deepEqual(flyAxes(new Set(['KeyS', 'KeyA', 'KeyQ'])), { forward: -1, right: -1, vertical: -1 });
assert.deepEqual(flyAxes(new Set(['KeyW', 'KeyS', 'KeyD', 'KeyE', 'KeyX'])), { forward: 0, right: 1, vertical: 1 });

// W moves along the view direction, D along the camera right axis, E along world up.
let k = flyStep(k0, { forward: 1, right: 0, vertical: 0 }, 2, pivot, 100, up);
assert.deepEqual(kameraMerkezi(k).map((v) => v + 0), [0, 0, 2]);
assert.deepEqual(k.R, k0.R, 'moving never rotates the camera');
k = flyStep(k0, { forward: 0, right: 1, vertical: 1 }, 1, pivot, 100, up);
const c = kameraMerkezi(k);
near(c[0], Math.SQRT1_2, 'strafe right'); near(c[1], -Math.SQRT1_2, 'rise along world up'); near(c[2], 0, 'no forward drift');

// Diagonal input is normalised so it is not faster than a single key.
near(Math.hypot(...kameraMerkezi(flyStep(k0, { forward: 1, right: 1, vertical: 0 }, 1, pivot, 100, up))), 1, 'diagonal speed');

// Movement is clamped to a sphere around the pivot; no fly-away into the void.
k = flyStep(k0, { forward: -1, right: 0, vertical: 0 }, 1000, pivot, 10, up);
near(Math.hypot(...kameraMerkezi(k).map((v, i) => v - pivot[i])), 10, 'bounded by radius');
assert.equal(flyStep(k0, { forward: 0, right: 0, vertical: 0 }, 5, pivot, 10, up), k0, 'no input, same camera');

// Look-around rotates in place: the centre does not move, yaw turns the view.
k = lookAround(k0, up, 0.3, 0);
kameraMerkezi(k).forEach((v) => near(v, 0, 'look keeps position'));
near(Math.abs(k.R[6]), Math.sin(0.3), 'yaw turns the view direction');
// Pitch is clamped short of straight up/down so the view never flips.
k = k0;
for (let i = 0; i < 100; i++) k = lookAround(k, up, 0, 0.05);
const elevation = Math.asin(k.R[6] * up[0] + k.R[7] * up[1] + k.R[8] * up[2]);
assert.ok(Math.abs(elevation) < 1.5 && Math.abs(elevation) > 1.3, `pitch clamped (${elevation})`);
assert.ok(-(k.R[3] * up[0] + k.R[4] * up[1] + k.R[5] * up[2]) > 0, 'camera up still points up');

// Scene radius ignores far outliers; fly radius stays inside the orbit zoom range.
const pts = [...Array.from({ length: 95 }, (_, i) => [i / 95, 0, 0]), ...Array.from({ length: 5 }, () => [1000, 0, 0])];
assert.ok(sahneYaricapi(pts, [0, 0, 0]) <= 1, 'outliers do not inflate the scene radius');
assert.equal(sahneYaricapi([], [0, 0, 0]), 0);
assert.equal(flyRadius(2, 1), 4, 'at least twice the start distance');
assert.equal(flyRadius(2, 10), 15, 'covers the reconstructed extent');
assert.equal(flyRadius(2, 1000), 60, 'never beyond the orbit zoom-out limit');
console.log('3DGS free-fly camera: OK');
