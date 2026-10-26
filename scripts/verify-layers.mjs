import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inferLayers, applyLayerGap, layerWeightAt } from '../src/engine/reconstruction/layers.ts';
import { sampleVolumePositions } from '../src/engine/reconstruction/sampler.ts';
import { buildShellMesh } from '../src/engine/reconstruction/mesh.ts';
const hash = a => createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const d = Float32Array.from({length:48*48},(_,i)=>0.1+0.8*(i%48)/47);
const layers = inferLayers(d,48,48);
assert.ok(layers.ratios.every(r=>r>0.2 && r<0.5));
const base = sampleVolumePositions(d,48,48,{gridSize:64});
assert.equal(hash(base),'6fe342eaacf3889b9c0fa31718755ffcccd8332bb079cf2b41c55cb0b4d1427d');
assert.deepEqual(sampleVolumePositions(d,48,48,{gridSize:64,layers,layerGap:0}),base);
const changed = sampleVolumePositions(d,48,48,{gridSize:64,layers,layerGap:0.25});
for(let j=0;j<64;j++) for(let i=0;i<64;i++) {
  const k=(j*64+i)*4, label=layers.labels[Math.min(47,Math.floor((j+.5)/64*48))*48+Math.min(47,Math.floor((i+.5)/64*48))];
  assert.ok(Math.abs(changed[k+2]-base[k+2]-(1-label)*0.25)<1e-6);
  assert.equal(changed[k],base[k]); assert.equal(changed[k+3],base[k+3]);
}
const shell=buildShellMesh(d,48,48,{gridSize:32});
assert.equal(hash(shell.positions),'8670653c15679af20385bcbedacaf422afad3cfb403bd5e6886e4c403c540395');
assert.deepEqual(buildShellMesh(d,48,48,{gridSize:32,layers,layerGap:0}).positions,shell.positions);
const shellGap=buildShellMesh(d,48,48,{gridSize:32,layers,layerGap:.25});
assert.ok(shellGap.indices.length<shell.indices.length,'katman arası perde üçgenleri çıkarılır');
for(let i=0;i<shellGap.indices.length;i+=3) {
  const ids=Array.from(shellGap.indices.slice(i,i+3),k=>layers.labels[
    Math.min(47,Math.floor((1-shellGap.uvs[k*2+1])*48))*48+Math.min(47,Math.floor(shellGap.uvs[k*2]*48))]);
  assert.equal(new Set(ids).size,1);
}
for(let i=0;i<shell.positions.length/3;i++) {
  const x=Math.min(47,Math.floor(shell.uvs[i*2]*48));
  const y=Math.min(47,Math.floor((1-shell.uvs[i*2+1])*48));
  assert.ok(Math.abs(shellGap.positions[i*3+2]-shell.positions[i*3+2]-(1-layers.labels[y*48+x])*.25)<1e-6);
}
const mask=Float32Array.from(d,v=>v>.7?1:0), masked=inferLayers(d,48,48,mask);
for(let k=0;k<d.length;k++) if(mask[k]) assert.equal(masked.labels[k],0);
assert.equal(layerWeightAt(masked,.99,.5,[0,1,1]),0);
assert.equal(layerWeightAt(masked,.99,.5,[1,1,1]),1);
for(let i=0;i<d.length;i++) assert.ok(Math.abs(layers.weights[i*3]+layers.weights[i*3+1]+layers.weights[i*3+2]-1)<1e-6);
const moved=Float32Array.from(d,v=>Math.min(1,v+.02));
const direct=inferLayers(moved,48,48), ema=inferLayers(moved,48,48,undefined,layers);
ema.thresholds.forEach((t,i)=>assert.ok(Math.abs(t-(layers.thresholds[i]*.9+direct.thresholds[i]*.1))<1e-9));
assert.ok(inferLayers(new Float32Array(9).fill(.5),3,3).labels.every(x=>x===1));
assert.throws(()=>inferLayers(new Float32Array(2),3,3),RangeError);
assert.throws(()=>applyLayerGap(base,64,layers,NaN),RangeError);
const video={gridSize:64,fullFrame:{cameraDistance:3.5}};
assert.deepEqual(sampleVolumePositions(d,48,48,{...video,layerGap:0}),sampleVolumePositions(d,48,48,video));
// Constructor kullanmayan GPU'suz fixture: görünürlük geometriyi yeniden üretmez.
const { registerHooks } = await import('node:module');
registerHooks({ resolve(specifier,context,next) {
  if(specifier.startsWith('.') && !/\.(?:ts|js|mjs|json)$/.test(specifier)) {
    try { return next(`${specifier}.ts`,context); } catch { /* Normal çözümleyici sürsün. */ }
  }
  return next(specifier,context);
} });
const { Engine } = await import('../src/engine/Engine.ts');
const { Vector3 } = await import('three');
const engine=Object.create(Engine.prototype);
Object.assign(engine,{layerGap:0,layerVisible:new Vector3(1,1,1),layers:null,layerTexture:null,
  layerTextureDirty:false,layerInput:{depth:d,width:48,height:48},gaussianSource:'point-cloud',
  pushSharedUniformsAll(){},setDepth(){throw new Error('Visibility must not resample geometry');}});
engine.setLayerVisible(0,false);
const first=Float32Array.from(engine.layerTexture.image.data);
engine.setLayerVisible(0,true);
engine.layerInput={depth:Float32Array.from(d,v=>1-v),width:48,height:48};
engine.updateLayers();
engine.setLayerVisible(0,false);
assert.notDeepEqual(engine.layerTexture.image.data,first,'yeniden gizleme güncel haritayı yükler');
assert.throws(()=>engine.setLayerGap(Infinity),RangeError);
const info=engine.getLayers(); info.ratios[0]=99;
assert.notEqual(engine.getLayers().ratios[0],99);
engine.layerTexture.dispose();
console.log('OK layers: HEAD fingerprints, zero identity, offsets, mask, visibility, video opt-in');
