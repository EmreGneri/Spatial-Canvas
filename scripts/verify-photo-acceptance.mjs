// Gerçek ölçüm dosyalarından güvenli varsayılan kararı; eksik/NaN kanıt başarı sayılmaz.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

export function photoAcceptance(evidence) {
  const checks=[];
  const range=(name,value,lo,hi=Infinity)=>checks.push({name,value:value??null,passed:Number.isFinite(value)&&value>=lo&&value<=hi});
  const front=evidence?.front,hs=evidence?.hs,d93=evidence?.d93;
  range('front torso >=1.655',front?.torso_z_p10p90_over_faceW,1.655);
  range('front head 1.31 +/-10%',front?.head_z_p10p90_over_faceW,1.31*.9,1.31*1.1);
  range('selfie1 torso >=2.3',hs?.torso_z_p10p90_over_faceW,2.3);
  range('selfie1 neck <=.30',hs?.neck_dz_over_faceW,-Infinity,.30);
  range('selfie1 arm >=.6',hs?.arm_gain2ndHalf_over_1stHalf,.6);
  range('selfie2 torso/face 3.05 +/-10%',d93?.torso_width_over_faceW,3.05*.9,3.05*1.1);
  range('selfie2 head/torso <=.70',d93?.head_med_minus_torso_med_z_over_faceW,-Infinity,.70);
  range('selfie2 neck <=.45',d93?.neck_dz_over_faceW,-Infinity,.45);
  for(const key of ['hs','d93','front','human','scene']) {
    const current=evidence?.apps?.[key],previous=evidence?.appBaselines?.[key];
    range(`${key} reprojection <=2px`,current?.maxPixelError,0,2);
    range(`${key} reprojection samples`,current?.checked,100);
    range(`${key} nonfinite points`,current?.nonFinite,0,0);
    checks.push({name:`${key} all points scanned`,passed:Number.isFinite(current?.count)&&current.count>0&&current.finiteScanCount===current.count});
    range(`${key} point count delta`,current && previous?Math.abs(current.count-previous.count):NaN,0,0);
    const median=values=>Array.isArray(values)&&values.length?values.toSorted((a,b)=>a-b)[values.length>>1]:NaN;
    // Kısa örneklemenin %5 oynama payı; gizli sekme ve boş örnek geçerli değildir.
    const fps=median(current?.fps),before=median(previous?.fps);
    range(`${key} FPS >=95% baseline`,before>0?fps/before:NaN,.95);
    checks.push({name:`${key} visible real splat`,passed:current?.visibility==='visible'&&current?.renderMode==='splat'&&current?.splatReady===true});
    checks.push({name:`${key} actual DA3 comparison`,passed:current?.sourceModel==='da3-mono'&&previous?.sourceModel==='da3-mono'});
    checks.push({name:`${key} visual review`,passed:current?.visualConfirmed===true});
  }
  return {makeDefault:checks.every(c=>c.passed),checks};
}

if(process.argv[2]) {
  console.log(JSON.stringify(photoAcceptance(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));
} else {
  assert.equal(photoAcceptance({}).makeDefault,false,'eksik ölçüm kapıyı açmaz');
  const evidence={front:{torso_z_p10p90_over_faceW:1.7,head_z_p10p90_over_faceW:1.31},hs:{torso_z_p10p90_over_faceW:2.5,neck_dz_over_faceW:.2,arm_gain2ndHalf_over_1stHalf:.8},d93:{torso_width_over_faceW:3,head_med_minus_torso_med_z_over_faceW:.6,neck_dz_over_faceW:.3},apps:{},appBaselines:{}};
  for(const key of ['hs','d93','front','human','scene']) {
    evidence.apps[key]={sourceModel:'da3-mono',visualConfirmed:true,maxPixelError:1,checked:500,nonFinite:0,count:147456,finiteScanCount:147456,fps:[60,61,59],visibility:'visible',renderMode:'splat',splatReady:true};
    evidence.appBaselines[key]={sourceModel:'da3-mono',count:147456,fps:[60,60,60]};
  }
  assert.equal(photoAcceptance(evidence).makeDefault,true);
  evidence.d93.neck_dz_over_faceW=-.04;
  assert.equal(photoAcceptance(evidence).makeDefault,true,'imzalı derinlik için yalnız üst sınır istendi');
  evidence.hs.neck_dz_over_faceW=NaN;
  assert.equal(photoAcceptance(evidence).makeDefault,false,'geçersiz boyun değeri başarı değildir');
  evidence.hs.neck_dz_over_faceW=.2;evidence.apps.scene.maxPixelError=3;
  assert.equal(photoAcceptance(evidence).makeDefault,false,'sahne kayması kapıyı kapatır');
  evidence.apps.scene.maxPixelError=1;evidence.apps.hs.sourceModel='v2-small';
  assert.equal(photoAcceptance(evidence).makeDefault,false,'V2 fallback DA3 karşılaştırması değildir');
  console.log('verify-photo-acceptance OK: all criteria required, missing/nonfinite evidence rejected');
}
