import assert from 'node:assert/strict';
import { sampleImageGrid } from '../src/engine/reconstruction/sampler.ts';

// A dark subject on a white background. The final grid samples one quarter
// pixel outside the last foreground texel's center, but still inside its mask.
const w=8,h=8,depth=new Float32Array(w*h).fill(.6),mask=new Float32Array(w*h),rgb=new Float32Array(w*h*3).fill(1);
for(let y=0;y<h;y++)for(let x=2;x<6;x++){
  mask[y*w+x]=1;rgb.fill(.1,(y*w+x)*3,(y*w+x)*3+3);
}
const opts={gridSize:16,importanceSampling:false,foregroundMask:mask};
const plain=sampleImageGrid(rgb,w,h,depth,w,h,{...opts,foregroundMask:undefined});
const isolated=sampleImageGrid(rgb,w,h,depth,w,h,opts);
const at=(a,x,y=8)=>a[(y*16+x)*3];
console.log(`foreground edge RGB: ${at(isolated,11).toFixed(6)}; source=.100000; unmasked=${at(plain,11).toFixed(6)}`);
assert.ok(Math.abs(at(isolated,11)-.1)<1e-6,'Foreground interpolation must not mix the white background into the dark silhouette.');
assert.equal(at(isolated,8),at(plain,8),'Interior colors must remain bit-identical.');
assert.equal(at(isolated,0),at(plain,0),'Background is still available when separation is off.');
assert.deepEqual(sampleImageGrid(rgb,w,h,depth,w,h,{...opts,foregroundColorIsolation:false}),plain,'Live color-grid sampling must be able to retain the original filter.');
assert.deepEqual(sampleImageGrid(rgb,w,h,depth,w,h,{...opts,foregroundMask:new Float32Array(w*h).fill(1)}),plain,'A full-frame foreground preserves the original filter.');
assert.deepEqual(sampleImageGrid(rgb,w,h,depth,w,h,{...opts,foregroundMask:new Float32Array(w*h)}),plain,'An empty mask cannot blacken the image.');
console.log('OK photo edge colors: mask-aware edge, unchanged interior/background, empty/full mask.');
