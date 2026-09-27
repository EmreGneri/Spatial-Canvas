import assert from 'node:assert/strict';
import { gezinmeDerinligiHazirla } from '../src/engine/reconstruction/gezinmeDerinligi.ts';
import { durum } from '../src/engine/reconstruction/bosAlan.ts';
import { engelUzakligi, gtDerinlik, yolPozu, YUKARI } from '../src/bench/sentetikSahne.ts';
import { tekGozBenzetimi } from '../src/bench/tekGozBenzetimi.ts';
import { kameraMerkezi } from '../src/engine/reconstruction/egitim3dgs.ts';

const W = 240, H = 135;
const cameras = Array.from({ length: 24 }, (_, i) => ({ ...yolPozu(i / 23), imgIdx: i }));
const frames = cameras.map((_, i) => ({ name: `frame_${String(i).padStart(5, '0')}.jpg`,
  fw: cameras[i].w, fh: cameras[i].h, tw: W, th: H, rgb: null }));

// Back-project exact synthetic surfaces to provide the sparse SfM anchors.
const points = [];
for (const camera of cameras) {
  const depth = gtDerinlik(camera, W, H);
  const C = kameraMerkezi(camera);
  const fx = camera.f * W / camera.w, fy = (camera.fy ?? camera.f) * H / camera.h;
  const cx = camera.cx * W / camera.w, cy = camera.cy * H / camera.h;
  for (let y = 6; y < H; y += 10) for (let x = 6; x < W; x += 10) {
    const z = depth[y * W + x];
    if (!Number.isFinite(z) || !(z > 0)) continue;
    const p = [((x + 0.5 - cx) / fx) * z, ((y + 0.5 - cy) / fy) * z, z];
    points.push([
      C[0] + camera.R[0] * p[0] + camera.R[3] * p[1] + camera.R[6] * p[2],
      C[1] + camera.R[1] * p[0] + camera.R[4] * p[1] + camera.R[7] * p[2],
      C[2] + camera.R[2] * p[0] + camera.R[5] * p[1] + camera.R[8] * p[2],
    ]);
  }
}

const result = await gezinmeDerinligiHazirla(frames, cameras, points, YUKARI,
  async (camera) => {
    const z = gtDerinlik(camera, W, H);
    const data = Float32Array.from(z, (v) => Number.isFinite(v) && v > 0 ? 1 / v : 0);
    return { data, width: W, height: H };
  }, new Map());
assert.equal(result.hizaliKare, 24);
assert.ok(result.gecerliPiksel > W * H, 'multi-view filter retains visible surfaces');
assert.equal(frames.filter((f) => f.depth?.length === W * H).length, 24);
assert.equal(durum(result.alan, kameraMerkezi(cameras[12])), 'bos', 'recorded path is free');
const distorted = await gezinmeDerinligiHazirla(frames, cameras, points, YUKARI,
  async (camera, name) => {
    const seed = [...name].reduce((acc, ch) => (Math.imul(acc, 31) + ch.charCodeAt(0)) | 0, 0x5eed);
    return { data: tekGozBenzetimi(gtDerinlik(camera, W, H), W, H, seed), width: W, height: H };
  }, new Map());
let free = 0, collisions = 0, belowFloor = 0;
const area = distorted.alan, [nx, ny, nz] = area.boyut;
for (let i = 0; i < nx * ny * nz; i += 17) {
  const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
  const p = [area.min[0] + (x + 0.5) * area.voksel,
    area.min[1] + (y + 0.5) * area.voksel, area.min[2] + (z + 0.5) * area.voksel];
  if (durum(area, p) !== 'bos') continue;
  free++;
  if (engelUzakligi(p) < -area.voksel) { collisions++; if (p[1] > 1.6 + area.voksel) belowFloor++; }
}
console.log(`distorted source: ${collisions}/${free} raw free voxels overlap GT obstacles (${belowFloor} below floor)`);
console.log('verify-gezinme-derinligi: OK');
