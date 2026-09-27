import assert from 'node:assert/strict';
import { aciklik, aciklikAt, bosAlanKur, durum, serbestAdim } from '../src/engine/reconstruction/bosAlan.ts';
import { bosAlanSiniri, flySiniri, flyStepBirlesik } from '../src/ui/egitimControls.ts';
import { kameraMerkezi } from '../src/engine/reconstruction/egitim3dgs.ts';

const makeGrid = (size, voxel, status = 'bos') => {
  const n = size ** 3;
  const grid = {
    min: [0, 0, 0], boyut: [size, size, size], voksel: voxel,
    bos: new Uint16Array(n), bosKare: new Uint16Array(n), dolu: new Uint16Array(n), enAzKare: 2,
  };
  if (status === 'bos') { grid.bos.fill(3); grid.bosKare.fill(3); }
  return grid;
};
const at = (g, x, y, z) => x + g.boyut[0] * (y + g.boyut[1] * z);
const block = (g, x, y, z) => { g.bos[at(g,x,y,z)] = 0; g.bosKare[at(g,x,y,z)] = 0; g.dolu[at(g,x,y,z)] = 3; };

// A sub-voxel one-pixel obstacle can be phase-missed at 4-pixel sampling.
// Production uses two-pixel, per-frame phase-shifted sampling; one surface hit
// is enough to deny free-space even when other views have free-ray votes.
{
  const camera = { R: [1,0,0, 0,1,0, 0,0,1], t: [0,0,0], f: 6, cx: 3, cy: 0.5, w: 6, h: 1 };
  const depth = new Float32Array([4, 1.5, 4, 4, 4, 4]);
  const frames = Array.from({ length: 2 }, () => ({ kamera: camera, derinlik: depth }));
  const options = { voksel: 1, sinir: { min: [-2,-1,0], max: [2,1,5] }, yukari: [0,-1,0] };
  const hiddenThin = [-0.375, 0, 1.5];
  const coarse = bosAlanKur(frames, { ...options, adimPx: 4 });
  assert.equal(durum(coarse, hiddenThin), 'bos', 'coarse fixed-phase rays can miss a sub-voxel obstacle');
  const sampled = bosAlanKur(frames, { ...options, adimPx: 2 });
  assert.notEqual(durum(sampled, hiddenThin), 'bos', 'phase-shifted production rays observe the thin surface');
  const through = serbestAdim(sampled, aciklik(sampled), [-0.4,0,1.2], [-0.4,0,1.8], 0);
  assert.ok(through[2] <= 1.5,
    'the swept path stops before the observed sub-voxel obstacle');
}

// Unknown space must not permit a long flat-clearance/tangential recovery.
{
  const grid = makeGrid(20, 1, 'unknown');
  const start = [5, 5, 5], target = [15, 5, 5];
  const result = serbestAdim(grid, aciklik(grid), start, target, 1);
  assert.deepEqual(result, start, 'unknown flat-clearance volume stops rather than allowing a tangent escape');

  const camera = { R: [1,0,0, 0,1,0, 0,0,1], t: [-5,-5,-5], f: 100, cx: 50, cy: 50, w: 100, h: 100 };
  const volume = flySiniri([[5,5,5],[15,5,5]], [10,10,10], 'yol');
  const freeBound = bosAlanSiniri(grid, 10, 0.01);
  const moved = flyStepBirlesik(camera, { forward: 0, right: 1, vertical: 0 }, 4, volume, [0,1,0], freeBound);
  assert.deepEqual(kameraMerkezi(moved), start, 'combined UI controller cannot bypass unknown-space stop with the camera-volume bound');
}

// A diagonal segment grazing a single occupied voxel must not tunnel through it.
{
  const grid = makeGrid(10, 1);
  block(grid, 5, 5, 5);
  const start = [4.02, 5.99, 5.5], target = [6.02, 3.99, 5.5];
  // Ground truth: an obstacle only 2 cm wide, far thinner than the 1 m voxel.
  const thinObstacle = [5.005, 5.005, 5.5], thinRadius = 0.01;
  const delta = target.map((v, i) => v - start[i]);
  const t = Math.max(0, Math.min(1, start.reduce((dot, v, i) => dot + (thinObstacle[i] - v) * delta[i], 0)
    / delta.reduce((sum, v) => sum + v * v, 0)));
  const segmentDistance = Math.hypot(...start.map((v, i) => v + delta[i] * t - thinObstacle[i]));
  assert.ok(thinRadius < grid.voksel && segmentDistance < thinRadius,
    'trajectory intersects a sub-voxel-width obstacle');
  const result = serbestAdim(grid, aciklik(grid), start, target, 0.01);
  assert.notDeepEqual(result, target, 'swept movement stops at a diagonally crossed occupied voxel');
  const cell = (p) => p.map((x) => Math.floor(x));
  assert.notDeepEqual(cell(result), cell(target), 'returned endpoint remains before the occupied cell');
}

console.log('free-space navigation safety: unknown tangents and diagonal voxel tunneling blocked');
