// Sıfırlama sözleşme testi (GPU gerekmez, WebGL YOK).
//
// NEDEN: efekt kollarıyla oynadıktan sonra başlangıç noktasına dönüş yoktu;
// graf sıfırlaması yalnız düğümleri geri alıyor, material/pass uniform'larına
// dokunmuyordu. Yeni bir görsele geçildiğinde de eski ayarlar devam ediyordu.
//
// Engine'i WebGL olmadan kuramayız; bu yüzden sıfırlamanın ÇEKİRDEK MANTIĞI
// (`collectParams` ile anlık görüntü → `applyParams` ile geri yükleme)
// doğrudan params.ts üzerinde test edilir. Kritik olan, ParamDef.default'tan
// DEĞİL, kayıt anındaki GERÇEK değerden sıfırlanması: renk kolları
// (kind: 'color') ParamDef'te `default: 0` taşır ve oradan sıfırlamak rengi
// siyaha çevirirdi.
//   node scripts/verify-reset.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyParams, collectParams } from '../src/engine/params.ts';

/** Gerçek dünyadaki karışım: sayı kolları + bir renk kolu. */
const DEFS = [
  { key: 'uPointSize', label: 'nokta boyutu', min: 2, max: 20, default: 6 },
  { key: 'uSoftness', label: 'yumuşaklık', min: 0, max: 1, default: 0.5 },
  { key: 'uNearColor', label: 'yakın rengi', min: 0, max: 1, default: 0, kind: 'color' },
];

function freshUniforms() {
  return {
    uPointSize: { value: 6 },
    uSoftness: { value: 0.5 },
    uNearColor: { value: new THREE.Color('#edf9ff') },
  };
}

// --- 1. Anlık görüntü → oynat → geri yükle: BİREBİR başlangıç ---
{
  const u = freshUniforms();
  const snapshot = collectParams(DEFS, u);

  // Kullanıcı kolları oynatıyor.
  u.uPointSize.value = 19;
  u.uSoftness.value = 0.03;
  u.uNearColor.value.set('#ff0000');

  applyParams(DEFS, u, snapshot);
  assert.equal(u.uPointSize.value, 6, 'sayı kolu başlangıca döndü');
  assert.equal(u.uSoftness.value, 0.5, 'ikinci sayı kolu başlangıca döndü');
  assert.equal(
    `#${u.uNearColor.value.getHexString()}`,
    '#edf9ff',
    'RENK kolu başlangıca döndü (ParamDef.default olsaydı siyaha giderdi)',
  );
}

// --- 2. REGRESYON: ParamDef.default'tan sıfırlamak rengi BOZAR ---
// Bu test, "neden anlık görüntü kullanıyoruz" sorusunun kanıtı. Biri gelip
// sıfırlamayı default'lardan türetmeye kalkarsa bu satır ne kaybedileceğini
// gösteriyor.
{
  const u = freshUniforms();
  const naifDefaults = Object.fromEntries(DEFS.map((d) => [d.key, d.default]));
  applyParams(DEFS, u, naifDefaults);
  // Sayılar doğru döner…
  assert.equal(u.uPointSize.value, 6, 'naif yol sayıları doğru getirir');
  // …ama renk için `default: 0` anlamsızdır: applyParams tür uyuşmazlığında
  // ATLADIĞI için renk DEĞİŞMEDEN kalır — yani naif yol rengi sıfırlayamaz.
  assert.equal(
    `#${u.uNearColor.value.getHexString()}`,
    '#edf9ff',
    'naif yol renge dokunamaz (default sayı, kind color) — anlık görüntü şart',
  );
}

// --- 3. Anlık görüntü rengi STRING olarak taşır (serileştirilebilir) ---
{
  const u = freshUniforms();
  const snap = collectParams(DEFS, u);
  assert.equal(typeof snap.uNearColor, 'string', 'renk anlık görüntüde hex string');
  assert.equal(snap.uNearColor, '#edf9ff', 'hex değeri doğru');
  assert.equal(typeof snap.uPointSize, 'number', 'sayı anlık görüntüde number');
}

// --- 4. Eksik/fazla anahtar sıfırlamayı ÇÖKERTMEZ ---
// Bir mod uniform'unu silerse ya da yeni kol eklerse eski anlık görüntü hâlâ
// uygulanabilmeli (applyParams bilinmeyeni atlar sözleşmesi).
{
  const u = freshUniforms();
  const snap = collectParams(DEFS, u);
  snap.uOlmayanKol = 42; // fazladan
  delete snap.uSoftness; // eksik
  u.uPointSize.value = 1;
  u.uSoftness.value = 0.99;
  const applied = applyParams(DEFS, u, snap);
  assert.equal(u.uPointSize.value, 6, 'var olan kol geri geldi');
  assert.equal(u.uSoftness.value, 0.99, 'anlık görüntüde olmayan kol DOKUNULMADI');
  assert.ok(applied >= 1, `uygulanan kol sayısı raporlanıyor (${applied})`);
}

// --- 5. Engine sıfırlama yüzeyi: metod var ve medyaya dokunmadığı yazılı ---
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../src/engine/Engine.ts', import.meta.url)), 'utf8');
  assert.ok(/resetRenderParams\s*\(/.test(src), 'Engine.resetRenderParams tanımlı');
  // Anlık görüntüler kayıt/kurulum anında alınmalı.
  assert.ok(/paramDefaults\.set\(/.test(src), 'mod kaydında parametre anlık görüntüsü alınıyor');
  assert.ok(/passDefaults\s*=\s*\{/.test(src), 'pass/look/sim anlık görüntüsü alınıyor');
  // Feedback birikimi temizlenmeli, yoksa eski efektin izi ekranda kalır.
  assert.ok(/requestClear\(\)/.test(src), 'sıfırlama feedback birikimini temizliyor');
  // MEDYA SİLİNMEMELİ: sıfırlama setDepth/setPhoto/releasePhoto çağırmamalı.
  const body = src.slice(src.indexOf('resetRenderParams('), src.indexOf('activeRenderParams('));
  for (const forbidden of ['releasePhoto', 'setDepth(', 'setPhoto(', 'setGaussians(']) {
    assert.ok(
      !body.includes(forbidden),
      `sıfırlama medyaya dokunmuyor (${forbidden} çağrılmıyor)`,
    );
  }
}

console.log(
  'OK · sıfırlama (anlık görüntü → geri yükleme, renk kolu korunur, naif default yolu rengi sıfırlayamaz, eksik/fazla anahtar toleransı, medya silinmiyor)',
);
