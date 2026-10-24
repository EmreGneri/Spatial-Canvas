// CPU contract: calibrated camera Z must survive as one Euclidean shape.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.(?:ts|js|mjs|json)$/.test(specifier)) { try { return nextResolve(`${specifier}.ts`, context); } catch {} }
  return nextResolve(specifier, context);
} });
assert.ok(existsSync(new URL('../src/engine/reconstruction/metricPhotoGeometry.ts', import.meta.url)), 'calibrated photo geometry implementation exists');
const { cropMetricPhotoGeometry, createMetricPhotoProjection, sampleMetricPhotoPositions, buildMetricPhotoShell, updateMetricPhotoSplatGeometry } = await import('../src/engine/reconstruction/metricPhotoGeometry.ts');
const { createHomeTexture, createImageColorTexture, fillPositionsFromDepth } = await import('../src/engine/buffers.ts');
const near = (a,b,e=2e-6) => assert.ok(Math.abs(a-b)<e, `${a} ≈ ${b}`);
const W=32,H=32, display=new Float32Array(W*H).fill(.8), mask=new Float32Array(W*H).fill(1);
const fixture = (fn=()=>2,fx=1) => ({width:W,height:H,depth:Float32Array.from({length:W*H},(_,i)=>fn((i%W+.5)/W,(Math.floor(i/W)+.5)/H)),intrinsics:new Float64Array([fx,0,.5,0,1,.5,0,0,1]),validMask:new Uint8Array(W*H).fill(1)});
const plane=fixture(), p=createMetricPhotoProjection(plane,display,mask);
const at=(q,u,v)=>{const out=new Float32Array(4);q.project(u,v,out,0);return out;};
const a=at(p,.25,.25), b=at(p,.75,.75);
near(a[0],-16/31);near(a[1],16/31);near(a[2],0);near(b[0],16/31);assert.equal(a[3],1);
// A tilted plane's equation survives unprojection and global similarity.
const slant=fixture((u)=>2/(1-.4*(u-.5)));
const q=createMetricPhotoProjection(slant,display,mask);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const pos=at(q,(x+.5)/W,(y+.5)/H);
  const X=pos[0]/q.scale+q.center[0], Z=pos[2]/q.scale+q.center[2];
  near(-Z-.4*X,2);
}
// Changing focal length changes X relative to Y, never independently scales Z.
const narrow=createMetricPhotoProjection(fixture(()=>2,2),display,mask);
near(at(narrow,.75,.75)[0],b[0]/2);near(at(narrow,.75,.75)[1],b[1]);
const scaled=fixture((u,v)=>slant.depth[Math.min(H-1,Math.floor(v*H))*W+Math.min(W-1,Math.floor(u*W))]*13);
const qs=createMetricPhotoProjection(scaled,display,mask);
for(const [u,v] of [[.2,.3],[.5,.5],[.8,.7]])at(q,u,v).forEach((n,i)=>near(n,at(qs,u,v)[i]));
// Sphere ray intersections must remain spherical after fitting.
const sphere=fixture((u,v)=>{const x=u-.5,y=v-.5,A=x*x+y*y+1,D=36-4*A*8;return D>0?(6-Math.sqrt(D))/(2*A):NaN;});
const sp=createMetricPhotoProjection(sphere,display,mask);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const pos=at(sp,(x+.5)/W,(y+.5)/H);if(!pos[3])continue;
  const X=pos[0]/sp.scale+sp.center[0],Y=pos[1]/sp.scale+sp.center[1],Z=pos[2]/sp.scale+sp.center[2];near(Math.hypot(X,Y,Z+3),1,2e-5);
}
const cropped=cropMetricPhotoGeometry(plane,{x0:8,y0:4,x1:24,y1:28});
assert.equal(cropped.width,16);assert.equal(cropped.height,24);near(cropped.intrinsics[0],2);near(cropped.intrinsics[4],4/3);near(cropped.intrinsics[2],.5);near(cropped.intrinsics[5],.5);
assert.equal(cropped.depth[0],plane.depth[4*W+8]);
const cp=createMetricPhotoProjection(cropped,new Float32Array(16*24).fill(.8),new Float32Array(16*24).fill(1));
for(const [u,v] of [[.25,.25],[.75,.75]]){
  const local=at(cp,u,v),full=at(p,(8+u*16)/W,(4+v*24)/H);
  for(let k=0;k<3;k++)near(local[k]/cp.scale+cp.center[k],full[k]/p.scale+p.center[k]);
}
const bad=fixture();for(const [i,d] of [NaN,Infinity,-1,0].entries())bad.depth[i]=d;bad.validMask[4]=0;
const bp=createMetricPhotoProjection(bad,display,mask);
for(let x=0;x<5;x++){const v=at(bp,(x+.5)/W,.5/H);assert.equal(v[3],0);assert.ok(v.every(Number.isFinite));}
// Mask-edge pixels with background depth must not shrink the subject framing.
const flying=fixture();for(let x=0;x<W;x++)flying.depth[x]=20;
const fp=createMetricPhotoProjection(flying,display,mask);
assert.ok(fp.scale>.5*p.scale,'flying pixels ignored for framing');
// Background metres behind the subject is softly capped to ARKA_PLAN_PAYI world units behind it.
{ const { ARKA_PLAN_PAYI }=await import('../src/engine/reconstruction/metricPhotoGeometry.ts');
  const fgMask=Float32Array.from({length:W*H},(_,i)=>{const x=i%W,y=Math.floor(i/W);return x>8&&x<24&&y>8&&y<24?1:0;});
  const deep=fixture((u,v)=>(u>.28&&u<.75&&v>.28&&v<.75)?2:30);
  const dp=createMetricPhotoProjection(deep,display,fgMask);
  const fgZ=at(dp,.5,.5)[2], bgZ=at(dp,.05,.05)[2];
  assert.ok(bgZ<fgZ,'background stays behind subject');
  assert.ok(fgZ-bgZ<=ARKA_PLAN_PAYI+1e-4,`background gap capped (${(fgZ-bgZ).toFixed(3)})`);
  // Steep (but continuous) surfaces: radius never exceeds 3x the screen-plane footprint.
  const steep=sampleMetricPhotoPositions(createMetricPhotoProjection(fixture((u)=>2/(1-1.6*(u-.5))),display,mask),32), sn=new Float32Array(steep.length);
  updateMetricPhotoSplatGeometry(steep,32,sn);
  for(let y=1;y<31;y++)for(let x=1;x<31;x++){const o=(y*32+x)*4;const iz=.5*Math.max(...[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>{const j=((y+dy)*32+x+dx)*4;return Math.hypot(steep[j]-steep[o],steep[j+1]-steep[o+1]);}));assert.ok(sn[o+3]<=3*iz+1e-6,'radius capped');}
}
let metricFaceRelief;
// Face relief on metric depth: nose (centre) comes toward the camera, far outside untouched.
{ const { metrikYuzRolyefi }=await import('../src/engine/reconstruction/metricPhotoGeometry.ts');
  const { yuzRolyefHaritasi, YUZ_OVAL }=await import('../src/engine/reconstruction/yuzRolyef.ts');
  const pts=Array.from({length:478},()=>({x:.5,y:.5,z:0})), ov=new Set(YUZ_OVAL);
  YUZ_OVAL.forEach((idx,k)=>{const a=k/YUZ_OVAL.length*Math.PI*2;pts[idx]={x:.5+.2*Math.sin(a),y:.5-.2*Math.cos(a),z:0};});
  let sd=1;const rnd=()=>((sd=(sd*16807)%2147483647)/2147483647);
  for(let i=0;i<478;i++){if(ov.has(i))continue;const r=.19*Math.sqrt(rnd()),a=rnd()*Math.PI*2,x=.5+r*Math.cos(a),y=.5+r*Math.sin(a);pts[i]={x,y,z:-.1*(1-((x-.5)**2+(y-.5)**2)/.04)};}
  const rol=yuzRolyefHaritasi(pts,W,H);
  metricFaceRelief=rol;
  const g=fixture(), out=metrikYuzRolyefi(g,rol);
  const c=(H>>1)*W+(W>>1);
  assert.ok(out.depth[c]<g.depth[c],`face centre nearer (${out.depth[c].toFixed(3)} < 2)`);
  assert.equal(out.depth[0],g.depth[0],'far corner unchanged');
  assert.ok(out.depth.every(z=>z>0&&Number.isFinite(z)),'metric depth stays positive');
  assert.notEqual(out.depth,g.depth,'relief must not mutate the cached model depth');
  assert.ok(g.depth.every(z=>z===2),'cached metric depth remains unchanged');
  assert.deepEqual(metrikYuzRolyefi(g,rol).depth,out.depth,'rebuilding applies relief once');
}
const grid=sampleMetricPhotoPositions(p,16);assert.equal(grid.length,16*16*4);
assert.equal(typeof updateMetricPhotoSplatGeometry,'function','metric splats use measured XYZ neighbors');
const tiltedGrid=sampleMetricPhotoPositions(q,32), splatNormals=new Float32Array(tiltedGrid.length);
updateMetricPhotoSplatGeometry(tiltedGrid,32,splatNormals);
for(let y=1;y<31;y++)for(let x=1;x<31;x++){
  const i=(y*32+x)*4;near(splatNormals[i],.4/Math.hypot(.4,1),1e-5);near(splatNormals[i+1],0,1e-5);near(splatNormals[i+2],1/Math.hypot(.4,1),1e-5);assert.ok(splatNormals[i+3]>0);
}
const shell=buildMetricPhotoShell(p,16);assert.ok(shell.indices.length>0);
for(let i=0;i<shell.shell.length;i++)if(shell.shell[i]===1){const expected=at(p,shell.uvs[i*2],1-shell.uvs[i*2+1]);for(let k=0;k<3;k++)near(shell.positions[i*3+k],expected[k]);}
assert.ok(shell.positions.every(Number.isFinite));assert.ok(shell.normals.every(Number.isFinite));
const directedEdges=new Map();
for(let i=0;i<shell.indices.length;i+=3){const [a,b,c]=shell.indices.subarray(i,i+3);for(const [u,v] of [[a,b],[b,c],[c,a]]){const key=`${u},${v}`;directedEdges.set(key,(directedEdges.get(key)??0)+1);}}
for(const [key,count] of directedEdges){assert.equal(count,1,'shell edge occurs once per direction');assert.equal(directedEdges.get(key.split(',').reverse().join(',')),1,'shell remains closed');}
const tiltedShell=buildMetricPhotoShell(q,16);
// Linear Z interpolation approximates a perspective plane between measured texels.
for(let i=0;i<tiltedShell.shell.length;i++)if(tiltedShell.shell[i]){near(tiltedShell.normals[i*3],.4/Math.hypot(.4,1),.002);near(tiltedShell.normals[i*3+2],1/Math.hypot(.4,1),.002);}
// CPU buffer integration and explicit-null fallback are real API paths.
const home=createHomeTexture();fillPositionsFromDepth(home,display,W,H,{foregroundMask:mask,metricProjection:p});
near(home.image.data[0],at(p,.5/384,.5/384)[0]);
const old=createHomeTexture(),fallback=createHomeTexture();fillPositionsFromDepth(old,display,W,H);fillPositionsFromDepth(fallback,display,W,H,{metricProjection:null});assert.deepEqual(old.image.data,fallback.image.data);
const { Engine }=await import('../src/engine/Engine.ts');
assert.equal(typeof Engine.prototype.setMetricPhotoGeometry,'function','engine accepts photo-only metric geometry');
const engine=Object.create(Engine.prototype);
Object.assign(engine,{homeTexture:createHomeTexture(),videoTexture:null,photoData:new Float32Array(W*H*3).fill(.5),photoWidth:W,photoHeight:H,imageColorTexture:createImageColorTexture(),simulation:{seedFrom(){},setHome(){}},refreshGaussians(){},updatePhotoBackdrop(){},setShellGeometry(data){this.shellData=data;}});
engine.setMetricPhotoGeometry(plane);
engine.setDepth(display,W,H,mask,W,H);
assert.deepEqual(engine.homeTexture.image.data,home.image.data,'engine consumes calibrated rays');
assert.ok(engine.shellData.indices.length>0,'engine creates calibrated shell');
const before=engine.homeTexture.image.data.slice();
engine.setDepth(display,W,H,mask,W,H);assert.deepEqual(engine.homeTexture.image.data,before,'internal photo resampling retains metric metadata');
engine.dynamicHome=true;engine.homeTexture.image.data.fill(0);
engine.setDepth(display,W,H,mask,W,H);assert.ok(Buffer.from(engine.homeTexture.image.data.buffer).equals(Buffer.from(before.buffer)),'calibrated home must align with its shell even after a dynamic source');
engine.yuzRolyefi={rel:new Float32Array(W*H).fill(1),agirlik:new Float32Array(W*H).fill(1)};
engine.setDepth(display,W,H,mask,W,H);assert.deepEqual(engine.homeTexture.image.data,before,'constant relief does not change calibrated shape');
engine.yuzRolyefi=metricFaceRelief;
engine.setDepth(display,W,H,mask,W,H);
const faceHome=engine.homeTexture.image.data.slice(), faceShell=engine.shellData.positions.slice();
assert.notDeepEqual(faceHome,before,'engine applies metric face relief to splats');
assert.ok(faceHome.every(Number.isFinite)&&faceShell.every(Number.isFinite),'relief geometry remains finite');
engine.setDepth(display,W,H,mask,W,H);
assert.deepEqual(engine.homeTexture.image.data,faceHome,'rebuild does not accumulate face relief');
assert.deepEqual(engine.shellData.positions,faceShell,'solid and splat rebuilds share the same relief');
engine.yuzRolyefi=null;
engine.setDepth(display,W,H,mask,W,H);
assert.deepEqual(engine.homeTexture.image.data,before,'disabling relief restores calibrated geometry');
const partialMask=new Float32Array(W*H);
for(let y=8;y<24;y++)for(let x=10;x<22;x++)partialMask[y*W+x]=1;
engine.setDepth(display,W,H,partialMask,W,H);
const uncroppedHome=engine.homeTexture.image.data.slice();
engine.pushSharedUniformsAll=()=>{};
engine.setObjectSeparation(true);
assert.equal(engine.metricPhotoGeometry,plane,'mask toggle retains original uncropped calibration');
assert.notDeepEqual(engine.homeTexture.image.data,uncroppedHome,'mask toggle crops calibrated surface');
engine.setObjectSeparation(false);
assert.deepEqual(engine.homeTexture.image.data,uncroppedHome,'disabling crop restores original calibrated rays');
engine.videoTexture={};engine.camera={fov:60,aspect:1};engine.photoData=null;
engine.setDepth(display,W,H,mask,W,H);
assert.equal(engine.metricPhotoGeometry,null,'video clears photo calibration');
console.log('PASS calibrated photo planes, sphere, focal length, scale, crop, invalid pixels, shell alignment, and legacy fallback');
