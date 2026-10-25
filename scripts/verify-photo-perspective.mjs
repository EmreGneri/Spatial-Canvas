import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
registerHooks({ resolve(s,c,next) { if (s.startsWith('.') && !/\.(ts|js|mjs|json)$/.test(s)) { try { return next(s+'.ts',c); } catch {} } return next(s,c); } });
const { photoPerspectiveEnabled, selectPhotoIntrinsics, relativePhotoGeometry, photoReferenceCamera } = await import('../src/engine/reconstruction/photoPerspective.ts');
const { createMetricPhotoProjection, cropMetricPhotoGeometry } = await import('../src/engine/reconstruction/metricPhotoGeometry.ts');
assert.equal(photoPerspectiveEnabled(''), false);
assert.equal(photoPerspectiveEnabled('?izdusum=perspektif'), true);
assert.equal(photoPerspectiveEnabled('?izdusum=ortografik'), false);
const K = Float64Array.from([.8,0,.45,0,1.2,.55,0,0,1]);
assert.deepEqual(selectPhotoIntrinsics(600,400,{intrinsics:K,focal35:28}).intrinsics,K);
const exif=selectPhotoIntrinsics(600,400,{focal35:28});
assert.equal(exif.source,'exif');
assert.ok(Math.abs(exif.intrinsics[0]-28*Math.hypot(600,400)/43.27/600)<1e-9);
assert.equal(selectPhotoIntrinsics(600,400,{focal35:NaN}).source,'default');
const W=48,H=32;
const disparity=Float32Array.from({length:W*H},(_,i)=>1/(2+.2*(i%W)/W));
const g=relativePhotoGeometry(disparity,W,H,{intrinsics:K});
const display=new Float32Array(W*H).fill(.8), mask=new Float32Array(W*H).fill(1);
const p=createMetricPhotoProjection(g,display,mask);
// Aynı ölçüm ışınına geri projeksiyon: farklı derinlik, oran ve kırpımda <1 px hata.
for (const aspect of [.7,1,1.8]) for (const rect of [null,{x0:4,y0:3,x1:44,y1:29}]) {
 const geo=rect?cropMetricPhotoGeometry(g,rect):g;
 const proj=rect?createMetricPhotoProjection(geo,new Float32Array(geo.width*geo.height).fill(.8),new Float32Array(geo.width*geo.height).fill(1)):p;
 const cfg=photoReferenceCamera(proj,geo,aspect);
 const cam=new THREE.PerspectiveCamera(cfg.fov,aspect,.001,100);
 cam.position.set(...cfg.position);cam.lookAt(...cfg.target);
 cam.setViewOffset(aspect*1000,1000,cfg.offsetX*aspect*1000,cfg.offsetY*1000,aspect*1000,1000);
 cam.updateMatrixWorld();
 for(const [u,v] of [[.2,.3],[.5,.5],[.8,.7]]) {
  const out=new Float32Array(4);proj.project(u,v,out,0);assert.ok(out[3]);
  const xy=new THREE.Vector3(...out.slice(0,3)).project(cam);
  assert.ok(Math.abs((xy.x+1)/2-(.5+(u-.5)*cfg.frameWidth))*1000<.05);
  assert.ok(Math.abs((1-xy.y)/2-(.5+(v-.5)*cfg.frameHeight))*1000<.05);
 }
}
const broken=Float32Array.from(disparity);broken[0]=0;broken[1]=NaN;broken[2]=Infinity;
const safe=relativePhotoGeometry(broken,W,H,{});
assert.ok(safe.depth.every(Number.isFinite));assert.equal(safe.validMask[1],0);
assert.throws(()=>relativePhotoGeometry(new Float32Array(2),W,H,{}),RangeError);
// Üretim Engine'in gerçek kamera geçişi; WebGL gerektirmeyen durum sözleşmesi.
const { Engine } = await import('../src/engine/Engine.ts');
const engine=Object.create(Engine.prototype);
engine.camera=new THREE.PerspectiveCamera(60,1,.1,100);
engine.controls=new OrbitControls(engine.camera,null);
engine.cameraHome={pos:new THREE.Vector3(0,0,3.5),target:new THREE.Vector3()};
engine.controls.minDistance=1;engine.controls.maxDistance=15;
engine.configurePhotoCamera({projection:p,geometry:g});
assert.notEqual(engine.camera.fov,60);
engine.camera.aspect=.7;engine.updatePhotoCameraLens();
assert.equal(engine.camera.aspect,.7);
engine.configurePhotoCamera(null);
assert.equal(engine.camera.fov,60);assert.equal(engine.camera.near,.1);
assert.deepEqual(engine.camera.position.toArray(),[0,0,3.5]);
assert.equal(engine.camera.view.enabled,false);
const wideGeo=relativePhotoGeometry(disparity,W,H,{focal35:8});
engine.configurePhotoCamera({projection:createMetricPhotoProjection(wideGeo,display,mask),geometry:wideGeo});
const aligned=engine.camera.position.clone();engine.controls.update();
assert.ok(engine.camera.position.distanceTo(aligned)<1e-8,'orbit sınırı kalibre pozu değiştirmez');
engine.configurePhotoCamera(null);
assert.equal(engine.controls.minDistance,1);assert.equal(engine.controls.maxDistance,15);
console.log('verify-photo-perspective OK: flag, focal priority, rays, crop, camera reprojection, invalid depth');
