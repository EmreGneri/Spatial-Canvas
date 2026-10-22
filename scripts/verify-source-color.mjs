import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./ts-extension-loader.mjs',import.meta.url);
const T=await import('three');
const {Engine}=await import('../src/engine/Engine.ts');
const {createAsciiMaterial}=await import('../src/shaders/asciiMaterial.ts');
const {createPointCloudMaterial}=await import('../src/shaders/pointCloudMaterial.ts');
const {createSolidMaterial}=await import('../src/shaders/solidMaterial.ts');
const {createCrystalMaterial}=await import('../src/shaders/crystalMaterial.ts');
const {createNeonWireMaterial}=await import('../src/shaders/neonWireMaterial.ts');
const originalDocument=globalThis.document;
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},fillText(){}})})};
// Atlas rasterization is the only browser dependency; texture ownership and
// source switching run through the real production materials and Engine.
try {
 const video=new T.VideoTexture({});video.colorSpace=T.SRGBColorSpace;
 const photo=new T.DataTexture(new Uint8Array([128,64,32,128]),1,1);photo.colorSpace=T.SRGBColorSpace;
 const linear=new T.VideoTexture({});linear.colorSpace=T.LinearSRGBColorSpace;
 const e=Object.create(Engine.prototype);
 Object.assign(e,{objectSeparation:true,useTextureColor:true,neonCropDensity:1,currentDpr:1,initialDpr:1,videoAspect:1,videoWorldHeight:2,viewportPx:new T.Vector2(640,480),composer:{readBuffer:{texture:new T.Texture()}}});
 for(const create of [createAsciiMaterial,createPointCloudMaterial,createSolidMaterial,createCrystalMaterial,createNeonWireMaterial]) {
  const material=create();
  assert.match(material.vertexShader+material.fragmentShader,/decodeSourceColor\(texture2D\(uImageTexture,/,'The bound decode flag must reach the actual image sample');
  for(const [source,expected] of [[video,1],[photo,0],[linear,0],[video,1],[null,0],[photo,0]]) {
   e.videoTexture=source?.isVideoTexture?source:null;
   e.imageColorTexture=source?.isDataTexture?source:null;
   e.pushSharedUniforms(material);
   console.log(`${create.name}: ${source?.isVideoTexture?'video':source?'photo':'none'} decode=${material.uniforms.uDecodeVideo?.value}`);
   assert.equal(material.uniforms.uDecodeVideo?.value,expected,'Decode sRGB video once; never decode photo/linear/missing sources again');
   assert.equal(material.uniforms.uImageTexture.value,source);
   assert.equal(material.uniforms.uHasImage.value,source?1:0);
  }
  // Solid: duvar şeridi AO almaz (renk-olcum, 2026-10-22: AO 0,2'de duvar 27,6 -> 11,1 kararıyordu).
  if(create===createSolidMaterial)assert.match(material.fragmentShader,/aoMix = uAoStrength \* \(1\.0 - wallAmt\)/,'Wall band must not take photo AO');
  material.dispose();
 }
 for(const texture of [video,photo,linear])texture.dispose();
 e.composer.readBuffer.texture.dispose();
}finally{if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
console.log('OK source color: 5 real materials, video/photo/linear/missing source transitions');
