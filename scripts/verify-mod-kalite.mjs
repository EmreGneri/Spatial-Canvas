import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  girisDegerleri, KALITE_GRUPLARI, MOD_KALITE, profilEtkili, profiliCoz,
} from '../src/shaders/modKalite.ts';

/** ParamDef listelerinin `default` alanları (tek doğruluk kaynağının kopyası). */
const VARSAYILAN = {
  bloom: { uBloomStrength: 0, uBloomRadius: 0.5, uBloomThreshold: 0.85 },
  chromatic: { uAmount: 0, uRadial: 1, uAngle: 0 },
  grain: { uGrainAmount: 0, uGrainSpeed: 1, uVignette: 0.45, uContrast: 1.05, uSaturation: 1 },
  look: { uExposure: 1, uFogDensity: 0 },
};
const MODLAR = ['points', 'ascii', 'neon', 'solid', 'splat', 'crystal'];

// Altı modun HEPSİNİN profili olmalı — bu dosyanın var olma sebebi "bazı
// modlar hiç ayarlanmamış"tı.
for (const m of MODLAR) {
  assert.ok(MOD_KALITE[m], `${m}: profil yok`);
  assert.ok(profilEtkili(MOD_KALITE[m], VARSAYILAN), `${m}: profil kod varsayılanından farksız — mod hâlâ ayarlanmamış`);
}
assert.equal(Object.keys(MOD_KALITE).length, MODLAR.length, 'profil tablosunda fazla/eksik mod var');

// ── KONTRAST 1'İN ÜSTÜNE ÇIKMAMALI ─────────────────────────────────────────
// İki ölçülmüş sebep: (1) kontrast LİNEER uzayda 0.5 etrafında dönüyor,
// sahnenin siyahı eksiye düşüyor ve sRGB pow'u tanımsız sonuç veriyordu;
// (2) kelepçeden sonra bile kontrast > 1 SÖNÜK KONU piksellerini siyaha
// düşürüp konu kapsamını azaltıyor (Point Cloud 0.0060 → 0.0049).
for (const m of MODLAR) {
  const c = MOD_KALITE[m].grain?.uContrast;
  assert.ok(c === undefined || c <= 1, `${m}: kontrast ${c} — 1'in üstü konu kapsamını düşürüyor`);
}
// Kelepçe shader'da DURMALI; kalkarsa eksi ışık geri gelir.
const grain = readFileSync(new URL('../src/shaders/grainPass.ts', import.meta.url), 'utf8');
const sira = grain.indexOf('uContrast + 0.5');
assert.ok(sira > 0, 'kontrast satırı bulunamadı');
assert.ok(grain.indexOf('max(col.rgb, 0.0)') > sira, 'negatif ışık kelepçesi kontrasttan SONRA değil');

// ── PROFİL SINIRLARI ParamDef ARALIĞINDA ───────────────────────────────────
const SINIR = {
  uBloomStrength: [0, 3], uBloomRadius: [0, 2], uBloomThreshold: [0, 1],
  uAmount: [0, 0.02], uRadial: [0, 1], uAngle: [0, 6.28],
  uGrainAmount: [0, 0.3], uGrainSpeed: [0, 5], uVignette: [0, 1.5], uContrast: [0.5, 2], uSaturation: [0, 1.5],
  uExposure: [0.2, 3], uFogDensity: [0, 0.06],
};
for (const m of MODLAR) {
  for (const g of KALITE_GRUPLARI) {
    for (const [k, v] of Object.entries(MOD_KALITE[m][g] ?? {})) {
      const s = SINIR[k];
      assert.ok(s, `${m}.${g}.${k}: bilinmeyen kol`);
      assert.ok(v >= s[0] && v <= s[1], `${m}.${g}.${k} = ${v}, ParamDef aralığı ${s} dışında`);
    }
  }
}

// ── MOD KARAKTERİ ──────────────────────────────────────────────────────────
// ASCII'de bloom KAPALI kalmalı: 0.2'de bile harf kenarları birbirine akıyor,
// modun tek görsel dayanağı glif keskinliği.
assert.equal(MOD_KALITE.ascii.bloom?.uBloomStrength, 0, 'ASCII’ye bloom girmiş — harfler okunmaz olur');
assert.ok((MOD_KALITE.ascii.grain?.uSaturation ?? 1) < 1, 'ASCII doygunluğu düşürülmemiş (terminal dili)');
// NEON: BLOOM VAR AMA KADRAJI BEYAZLATMAYACAK KADAR. Bu sınır iki ölçümün
// ortak sonucu ve ikisi de tersini denedi:
//   1. tur — nesne ayırma kırpması neon kenarlarını siluetin içine yayıyordu,
//      mod kendi başına taşıyordu (kapsam 0.610, kırpılan %0.350). Güçlü
//      bloom (1.15/0.28) kadrajı beyazlattı: kapsam 0.915, kırpılan %0.402.
//   2. tur — veri katmanı Sobel eşiğini kırpmanın alan oranıyla telafi etti
//      (uCropDensity). Mod tel kafese döndü: ham kapsam 0.0114, kırpılan %0.
//      Dizginlemenin sebebi kalktı, eşik yeniden açıldı.
// Çekirdek bandı (L>0.30) ölçümü, thumbnail.jpg, kırpma açık:
//      kapali  cekirdek 0.0060 doyg 0.340
//      0.40    cekirdek 0.0083 doyg 0.462
//      0.70    cekirdek 0.0140 doyg 0.427   (sevk edilen)
//      1.00    cekirdek 0.0290 doyg 0.398   — alan buyuyor, renk duzlesiyor
// Ust sinir 0.9: 1.00 ve ustunde cekirdek doygunlugu ham modun kazancini
// yemeye basliyor. Alt esik 0.45: daha dusugu bloom'u anlamsiz kiliyor.
assert.ok(MOD_KALITE.neon.bloom.uBloomStrength <= 0.9,
  `Neon bloom ${MOD_KALITE.neon.bloom.uBloomStrength} — 0.9 ustu cekirdek rengini duzlestiriyor (olculdu)`);
assert.ok(MOD_KALITE.neon.bloom.uBloomStrength >= 0.45,
  `Neon bloom ${MOD_KALITE.neon.bloom.uBloomStrength} — modun esprisi bloom, bu kadari gorunmez`);
assert.ok(MOD_KALITE.neon.bloom.uBloomThreshold >= 0.45,
  `Neon bloom esigi ${MOD_KALITE.neon.bloom.uBloomThreshold} — cok dusuk esik sonuk kenarlari da yakiyor`);
assert.ok((MOD_KALITE.neon.look?.uExposure ?? 1) <= 1.05,
  'Neon pozlamasi yuksek — mod parlak, pozlama onu kirpmaya tasir');
// Chromatic YALNIZ cam/tup karakteri olan iki modda: sus degil, dispersiyon.
for (const m of MODLAR) {
  const c = MOD_KALITE[m].chromatic?.uAmount ?? 0;
  assert.equal(c > 0, m === 'neon' || m === 'crystal', `${m}: chromatic karari yanlis (${c})`);
}
// Sis YALNIZ solid'de: gerçek bir hacim gösteren tek mod o.
for (const m of MODLAR) {
  const f = MOD_KALITE[m].look?.uFogDensity ?? 0;
  assert.equal(f > 0, m === 'solid', `${m}: sis kararı yanlış (${f})`);
}

// ── PROFİLİ ÇÖZME: yazılmayan kol KOD VARSAYILANINA döner ──────────────────
// "Olduğu gibi bırak" olsaydı önceki modun ayarı sonrakine sızardı (Neon'dan
// çıkınca chromatic açık kalması).
{
  const cozulmus = profiliCoz(MOD_KALITE.points, VARSAYILAN);
  assert.equal(cozulmus.chromatic.uAmount, 0, 'points profilinde yazılmayan chromatic sızıyor');
  assert.equal(cozulmus.look.uFogDensity, 0, 'points profilinde yazılmayan sis sızıyor');
  assert.equal(cozulmus.bloom.uBloomStrength, MOD_KALITE.points.bloom.uBloomStrength);
  // Her grup TAM olmalı: eksik anahtar = uygulanmayan kol = sızıntı.
  for (const g of KALITE_GRUPLARI) {
    assert.deepEqual(Object.keys(cozulmus[g]).sort(), Object.keys(VARSAYILAN[g]).sort(), `${g}: kol eksik`);
  }
}
// Neon'dan çıkıp points'e geçince chromatic KAPANMALI (gerçek sızıntı senaryosu).
{
  const neon = profiliCoz(MOD_KALITE.neon, VARSAYILAN);
  assert.ok(neon.chromatic.uAmount > 0);
  assert.equal(profiliCoz(MOD_KALITE.points, VARSAYILAN).chromatic.uAmount, 0);
}

// ── KULLANICININ AYARI KAYBOLMAZ ───────────────────────────────────────────
{
  const hafiza = { neon: { ...profiliCoz(MOD_KALITE.neon, VARSAYILAN) } };
  hafiza.neon.bloom = { ...hafiza.neon.bloom, uBloomStrength: 2.4 }; // kullanıcı çevirdi
  assert.equal(girisDegerleri('neon', hafiza, VARSAYILAN).bloom.uBloomStrength, 2.4,
    'moda dönünce kullanıcının ayarı profille eziliyor');
  // Hafızası olmayan mod profili alır.
  assert.equal(girisDegerleri('crystal', hafiza, VARSAYILAN).bloom.uBloomStrength,
    MOD_KALITE.crystal.bloom.uBloomStrength);
}

// ── KABLO: App çıkarken YAZAR, girerken OKUR (sıra önemli) ─────────────────
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const govde = app.slice(app.indexOf('function changeMode('), app.indexOf('changeModeRef.current = changeMode'));
const yazIdx = govde.indexOf('modHafizaYaz(mode)');
const uygulaIdx = govde.indexOf('modKaliteUygula(next)');
assert.ok(yazIdx > 0, 'moddan çıkarken hafızaya yazılmıyor — kullanıcının ayarı kaybolur');
assert.ok(uygulaIdx > yazIdx, 'profil, eski modun değerleri kaydedilmeden uygulanıyor');
// Hafıza ESKİ mod adıyla yazılmalı; `next` ile yazmak yanlış modu kaydeder.
assert.ok(!/modHafizaYaz\(next\)/.test(govde), 'hafıza yanlış moda yazılıyor');
// Başlangıç modu da profilini almalı.
assert.match(app, /modKaliteUygula\('points'\)/, 'başlangıç modu profilsiz açılıyor');

console.log('verify-mod-kalite: OK · 6 profil, kontrast tavanı, sızıntı yok, kullanıcı ayarı korunuyor');
