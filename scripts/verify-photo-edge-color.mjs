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
// Plumbing (Engine.setDepth): the colour mask is cropped with the SAME rect as the geometry mask and
// handed to the colour fill. Pure helpers only (an Engine needs WebGL); Engine wiring is source-asserted.
{
  const { dilateAndFeatherMask } = await import('../src/engine/reconstruction/silhouette.ts');
  const { applySeparationCrop } = await import('../src/engine/reconstruction/crop.ts');
  const { readFileSync } = await import('node:fs');
  const n=64,raw=new Float32Array(n*n),rgb=new Float32Array(n*n*3).fill(1),d=new Float32Array(n*n).fill(.6);
  for(let y=20;y<44;y++)for(let x=26;x<38;x++){raw[y*n+x]=1;rgb.fill(.1,(y*n+x)*3,(y*n+x)*3+3);}
  const geo=dilateAndFeatherMask(raw,n,n);
  const base={depth:d,depthWidth:n,depthHeight:n,mask:geo,rgb,rgbWidth:n,rgbHeight:n};
  const plainCrop=applySeparationCrop(base,true);
  assert.ok(!('colorMask' in plainCrop),'no colour mask in -> no colorMask key out (previous crop result)');
  const cc=applySeparationCrop({...base,colorMask:raw},true);
  assert.ok(cc.depthWidth<n&&cc.depthHeight<n,'fixture actually crops');
  assert.equal(cc.colorMask.length,cc.mask.length,'colour mask cropped to the mask size');
  assert.deepEqual(cc.mask,plainCrop.mask,'geometry mask unchanged by the extra channel');
  assert.deepEqual(cc.depth,plainCrop.depth);
  assert.equal(applySeparationCrop({...base,colorMask:raw},false).colorMask,raw,'separation off: input passed through');
  const o={gridSize:n,importanceSampling:false,foregroundMask:cc.mask};
  const run=(extra)=>sampleImageGrid(cc.rgb,cc.rgbWidth,cc.rgbHeight,cc.depth,cc.depthWidth,cc.depthHeight,{...o,...extra});
  const eski=run({}),yeni=run({foregroundColorMask:cc.colorMask});
  // band = first geometry column outside the real subject, in cropped texels
  let band=-1;const cw=cc.depthWidth,row=Math.floor(cc.depthHeight/2);
  for(let x=0;x<cw;x++)if(cc.mask[row*cw+x]>=.5&&cc.colorMask[row*cw+x]<.5){band=x;break;}
  assert.ok(band>=0,'dilated band exists in the cropped grid');
  const g=(a,x)=>a[((row*n/cc.depthHeight|0)*n+Math.floor((x+.5)*n/cw))*3];
  console.log(`crop plumbing: band texel ${band}/${cw}, RGB ${g(eski,band).toFixed(4)} -> ${g(yeni,band).toFixed(4)}`);
  assert.ok(g(eski,band)>.1+1e-3,'before: band is wall-tinted');
  assert.ok(Math.abs(g(yeni,band)-.1)<1e-3,'after: band takes subject colour');
  assert.deepEqual(run({foregroundColorMask:undefined}),eski,'no colour mask = bit-identical');
  const eng=readFileSync(new URL('../src/engine/Engine.ts',import.meta.url),'utf8');
  assert.match(eng,/colorConfidence\?: Float32Array/,'setDepth takes the optional colour confidence');
  assert.match(eng,/resampleBilinear\(colorConfidence/,'resampled like the mask');
  assert.match(eng,/mask,\s+colorMask: this\.objectSeparation \? colorMask : undefined,\s+rgb: this\.photoData/,'cropped with the mask');
  assert.match(eng,/foregroundColorMask: crop\.colorMask/,'handed to the photo colour fill');
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(app,/maskConfidence = seg\.confidence/,'photo path keeps the confidence');
  assert.match(app,/maskW, maskH, undefined, undefined, maskConfidence\)/,'photo path passes it to setDepth');
  assert.match(app,/seg\.height, undefined, undefined, seg\.confidence\)/,'toggleSegment passes it to setDepth');
  assert.match(eng,/colorMask: this\.objectSeparation \? colorMask : undefined/,'only with separation on');
}
console.log('OK photo edge colors: mask-aware edge, unchanged interior/background, empty/full mask, dilated band.');
