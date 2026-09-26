// Free-fly (WASD) camera for the trained 3DGS view — no GPU.
import assert from 'node:assert/strict';
import { flyAxes, flyStep, lookAround, flySiniri, FLY_PAY } from '../src/ui/egitimControls.ts';
import { kameraMerkezi } from '../src/engine/reconstruction/egitim3dgs.ts';

const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);
const up = [0, -1, 0]; // COLMAP: y points down
// Camera at origin looking +z, x right, y down.
const k0 = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], f: 500, cx: 320, cy: 240, w: 640, h: 480 };
const pivot = [0, 0, 5];
// Wide open bound for the pure movement cases: a far camera fan around the rig.
const open = flySiniri([[-100, 0, -100], [100, 0, -100]], [0, 0, 100]);

// Held keys -> axes; opposite keys cancel, unknown keys ignored.
assert.deepEqual(flyAxes(new Set(['KeyW'])), { forward: 1, right: 0, vertical: 0 });
assert.deepEqual(flyAxes(new Set(['KeyS', 'KeyA', 'KeyQ'])), { forward: -1, right: -1, vertical: -1 });
assert.deepEqual(flyAxes(new Set(['KeyW', 'KeyS', 'KeyD', 'KeyE', 'KeyX'])), { forward: 0, right: 1, vertical: 1 });

// W moves along the view direction, D along the camera right axis, E along world up.
let k = flyStep(k0, { forward: 1, right: 0, vertical: 0 }, 2, open, up);
assert.deepEqual(kameraMerkezi(k).map((v) => v + 0), [0, 0, 2]);
assert.deepEqual(k.R, k0.R, 'moving never rotates the camera');
k = flyStep(k0, { forward: 0, right: 1, vertical: 1 }, 1, open, up);
const c = kameraMerkezi(k);
near(c[0], Math.SQRT1_2, 'strafe right'); near(c[1], -Math.SQRT1_2, 'rise along world up'); near(c[2], 0, 'no forward drift');

// Diagonal input is normalised so it is not faster than a single key.
near(Math.hypot(...kameraMerkezi(flyStep(k0, { forward: 1, right: 1, vertical: 0 }, 1, open, up))), 1, 'diagonal speed');

// Bound = the training-camera volume: triangles (cam_i, cam_i+1, pivot) plus a margin.
// Two cameras 2 apart looking at a pivot 5 ahead; margin 0.5 and scale 5 for readable numbers.
const rig = { ...flySiniri([[-1, 0, 0], [1, 0, 0]], pivot), pay: 0.5, olcek: 5 };
const at = (x, y, z) => ({ ...k0, t: [-x, -y, -z] }); // identity R: centre = -t
const pos = (m) => kameraMerkezi(m).map((v) => v + 0);
const eq3 = (a, b, msg) => a.forEach((v, i) => near(v, b[i], `${msg}[${i}]`, 1e-6));
eq3(pos(flyStep(k0, { forward: 1, right: 0, vertical: 0 }, 2, rig, up)), [0, 0, 2], 'inside the camera volume: free');
eq3(pos(flyStep(k0, { forward: -1, right: 0, vertical: 0 }, 10, rig, up)), [0, 0, -0.5], 'behind the cameras: stops at the margin');
eq3(pos(flyStep(at(0, 0, 2), { forward: 0, right: 0, vertical: 1 }, 10, rig, up)), [0, -0.3, 2], 'above the fan 3 from the pivot: margin tapers to 0.3');
eq3(pos(flyStep(at(0, 0, 5), { forward: 0, right: 0, vertical: -1 }, 10, rig, up)), [0, 0.05, 5], 'at the pivot (on the subject): only 10% margin, no sinking in');
eq3(pos(flyStep(at(0, 0, 4), { forward: 0, right: 1, vertical: 0 }, 0.1, rig, up)), [0.1, 0, 4], 'near the pivot: sideways is free');
assert.equal(flyStep(k0, { forward: 0, right: 0, vertical: 0 }, 5, rig, up), k0, 'no input, same camera');
// Entering fly mode after an orbit zoom-out (3 outside the volume) must not snap inward;
// moving further out is blocked, moving back in is free.
const out = at(0, 0, -3);
eq3(pos(flyStep(out, { forward: 1, right: 0, vertical: 0 }, 1, rig, up)), [0, 0, -2], 'outside: step in, no snap');
eq3(pos(flyStep(out, { forward: -1, right: 0, vertical: 0 }, 1, rig, up)), [0, 0, -3], 'outside: cannot go further out');
const side = pos(flyStep(out, { forward: 0, right: 1, vertical: 0 }, 1, rig, up));
assert.ok(Math.hypot(side[1], side[2]) <= 3 + 1e-9 && Math.abs(side[0]) <= 1, 'outside: strafe does not escape');
// A single registered camera still bounds to its sight line toward the pivot.
eq3(pos(flyStep(k0, { forward: 0, right: 1, vertical: 0 }, 3, { ...flySiniri([[0, 0, 0]], pivot), pay: 0.5, olcek: 5 }, up)), [0.5, 0, 0], 'one camera: segment bound');
// Margin and speed scale follow the median camera-to-pivot distance (outlier-robust).
const b = flySiniri([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, -1000]], [0, 0, 10]);
assert.equal(b.olcek, 9, 'median camera distance');
near(b.pay, FLY_PAY * 9, 'margin scales with the rig');
assert.equal(b.ucgenler.length, 3, 'one triangle per consecutive camera pair');

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

console.log('3DGS free-fly camera: OK');
