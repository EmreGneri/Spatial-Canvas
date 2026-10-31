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

// Audit 2026-10-31 item 9: the 4 px dilation makes x=8 geometry although the wall is there.
// With the original confidence given as the colour mask, the band takes the subject colour.
{
  const { dilateAndFeatherMask } = await import('../src/engine/reconstruction/silhouette.ts');
  const n=32,raw=new Float32Array(n*n),col=new Float32Array(n*n*3).fill(1),d=new Float32Array(n*n).fill(.6);
  for(let y=0;y<n;y++)for(let x=10;x<22;x++){raw[y*n+x]=1;col.fill(.1,(y*n+x)*3,(y*n+x)*3+3);}
  const geo=dilateAndFeatherMask(raw,n,n),o={gridSize:n,importanceSampling:false,foregroundMask:geo};
  const eski=sampleImageGrid(col,n,n,d,n,n,o),yeni=sampleImageGrid(col,n,n,d,n,n,{...o,foregroundColorMask:raw});
  const c=(a,x)=>a[(16*n+x)*3];
  console.log(`dilated band x=8: mask ${raw[16*n+8]}->${geo[16*n+8]}, RGB ${c(eski,8)} -> ${c(yeni,8)}`);
  for(const x of [6,7,8,9])assert.ok(Math.abs(c(yeni,x)-.1)<1e-6,`band x=${x} takes the subject colour (${c(yeni,x)})`);
  for(const x of [2,15])assert.equal(c(yeni,x),c(eski,x),`x=${x} unchanged`);
  assert.deepEqual(sampleImageGrid(col,n,n,d,n,n,{...o,foregroundColorMask:geo}),eski,'same mask as colour mask = previous result');
}
console.log('OK photo edge colors: mask-aware edge, unchanged interior/background, empty/full mask, dilated band.');
