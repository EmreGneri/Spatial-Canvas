// Photo flatness regression ("basik ve yayik" bust).
//
// The importance remap bent the SAMPLING coordinate while world xy stayed on
// the uniform grid, so the high-importance subject was magnified in x/y
// (~1.8x on a 16:9 bust) but not in z: the bust read wide and flat in every
// render mode. This script checks the library default AND the real app call
// site (Engine.setDepth photo path), where positions and colors must share
// one remap setting or colors drift off their particles.
//   node scripts/verify-photo-geometry.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.(?:ts|js|mjs|json)$/.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { /* Keep original resolution. */ }
    }
    return nextResolve(specifier, context);
  },
});

const { Engine } = await import('../src/engine/Engine.ts');
const { createHomeTexture, createImageColorTexture, fillPositionsFromDepth } =
  await import('../src/engine/buffers.ts');

// Scene: 518x291 (1919x1079 letterboxed), centered waist-up bust (torso 34%
// of width, head + torso down to the bottom edge), brick-pattern background,
// clean subject mask. Truth = the mask's own world bbox.
const W = 518;
const H = 291;
const depth = new Float32Array(W * H);
const mask = new Float32Array(W * H);
const cx = W / 2;
const headR = 0.11 * H;
const headCy = 0.53 * H;
const tHalf = (0.34 * W) / 2;
let mx0 = W;
let mx1 = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const inHead = (x - cx) ** 2 + (y - headCy) ** 2 < headR ** 2;
    const inTorso = y > headCy + headR * 0.8 && Math.abs(x - cx) < tHalf;
    depth[i] = 0.2 + 0.05 * (((x >> 3) + (y >> 3)) & 1);
    if (inHead || inTorso) {
      mask[i] = 1;
      const dx = (x - cx) / (inTorso ? tHalf : headR);
      depth[i] = 0.55 + 0.35 * Math.sqrt(Math.max(0, 1 - dx * dx));
      mx0 = Math.min(mx0, x);
      mx1 = Math.max(mx1, x);
    }
  }
}
const trueX = ((mx1 + 1 - mx0) / W) * 2 * (W / H);

function assertBust(xyz, label) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let k = 0; k < xyz.length / 4; k++) {
    if (xyz[k * 4 + 3] < 1) continue;
    x0 = Math.min(x0, xyz[k * 4]);
    x1 = Math.max(x1, xyz[k * 4]);
    z0 = Math.min(z0, xyz[k * 4 + 2]);
    z1 = Math.max(z1, xyz[k * 4 + 2]);
  }
  const spanX = x1 - x0;
  const zx = (z1 - z0) / spanX;
  assert.ok(Math.abs(spanX - trueX) / trueX < 0.05,
    `${label}: bust world width matches its silhouette (${spanX.toFixed(3)} vs ${trueX.toFixed(3)})`);
  assert.ok(zx > 0.35, `${label}: bust is not flat, z/x = ${zx.toFixed(3)} (> 0.35)`);
  return { spanX, zx };
}

// [1] Library default (fillPositionsFromDepth → sampleVolumePositions).
{
  const tex = createHomeTexture();
  fillPositionsFromDepth(tex, depth, W, H, { foregroundMask: mask });
  assertBust(tex.image.data, 'buffers default');
}

// [2] Real app path: Engine.setDepth for a photo (no video texture). The
// photo's red channel encodes its own source column, so each particle's
// color says which pixel it was painted from; that must be the pixel under
// the particle's world x (positions and colors on the same remap).
{
  const engine = Object.create(Engine.prototype);
  engine.homeTexture = createHomeTexture();
  engine.videoTexture = null;
  engine.camera = { fov: 60, aspect: 1.5 };
  engine.currentDepthTexture = null;
  engine.dynamicHome = false;
  engine.seeded = false;
  engine.renderModeName = 'points';
  engine.simulation = { seedFrom() {}, setHome() {} };
  engine.refreshGaussians = () => {};
  engine.setShellGeometry = () => {};
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) rgb[(y * W + x) * 3] = (x + 0.5) / W;
  }
  engine.photoData = rgb;
  engine.photoWidth = W;
  engine.photoHeight = H;
  engine.imageColorTexture = createImageColorTexture();
  engine.setDepth(depth, W, H, mask, W, H);

  const pos = engine.homeTexture.image.data;
  const { spanX, zx } = assertBust(pos, 'Engine photo setDepth');
  const col = engine.imageColorTexture.image.data;
  const halfW = W / H;
  let fg = 0;
  let drift = 0;
  for (let k = 0; k < pos.length / 4; k++) {
    if (pos[k * 4 + 3] < 1) continue;
    fg++;
    const uFromPos = (pos[k * 4] / halfW + 1) / 2;
    const uFromColor = col[k * 4] / 255;
    // 1 source px + 8-bit quantization is the honest tolerance.
    if (Math.abs(uFromPos - uFromColor) > 1 / W + 1 / 255) drift++;
  }
  assert.ok(fg > 1000, `photo subject has particles (${fg})`);
  assert.equal(drift, 0, `photo colors sit on their own particles (${drift}/${fg} drifted)`);
  console.log(`  Engine photo path: width ${spanX.toFixed(3)} vs silhouette ${trueX.toFixed(3)}, ` +
    `z/x ${zx.toFixed(3)}, color drift ${drift}/${fg}`);
}

console.log('OK · photo geometry (bust width = silhouette, not flat; Engine photo positions + colors share one remap)');
