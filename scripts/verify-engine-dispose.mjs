// Engine dispose + material zaman kaynağı testi (GPU gerekmez, saf CPU)
// — Gün 1, render şeridi (Zeynep).
//
// İKİ HATA, İKİ TEST:
//   1. GRAIN DISPOSE BAYRAĞI TERSTİ. Eski kod grain'i yalnızca composer'da
//      DEĞİLKEN bırakıyordu; oysa `EffectComposer.dispose()` yalnızca
//      renderTarget1/2 + copyPass'i bırakır, PASS'LERE DOKUNMAZ (three.js
//      kaynağı). Yani normal durumda (grain zincirdeyken) grain'in render
//      target'ı her remount'ta sızıyordu.
//   2. NEON KENDİ requestAnimationFrame'İNİ SÜRÜYORDU. Mod kapalıyken bile
//      tikliyor, Engine saatinden ayrı ikinci bir zaman kaynağı oluşturuyordu.
//
// Bu testler WebGL AÇMADAN çalışır: (1) three.js'in gerçek EffectComposer
// dispose davranışını doğrular, (2) Engine.ts ve neonWireMaterial.ts KAYNAK
// METNİ üzerinde statik kontrol yapar (WebGL bağlamı olmadan Engine örneği
// kurulamaz — bu yüzden davranış değil, koda dair değişmez denetlenir).
//   node scripts/verify-engine-dispose.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// --- 1. three.js sözleşmesi: composer.dispose() PASS'leri bırakmaz ---
// Bu, 1. hatanın kök varsayımıdır. three.js bir gün pass'leri de bırakmaya
// başlarsa bu test kırmızı olur ve Engine'deki koşulsuz dispose'u gözden
// geçirmemiz gerektiğini söyler (çift dispose riski).
{
  const src = read('../node_modules/three/examples/jsm/postprocessing/EffectComposer.js');
  const body = src.slice(src.indexOf('\tdispose() {'));
  const end = body.indexOf('\n\t}');
  const disposeBody = body.slice(0, end);
  assert.ok(disposeBody.includes('renderTarget1.dispose'), 'composer kendi RT1\'ini bırakır');
  assert.ok(disposeBody.includes('renderTarget2.dispose'), 'composer kendi RT2\'sini bırakır');
  assert.ok(
    !/this\.passes/.test(disposeBody),
    'composer.dispose() PASS\'lere DOKUNMAZ — grain\'i Engine bırakmak zorunda',
  );
}

// --- 2. Engine grain'i KOŞULSUZ bırakıyor ---
{
  const src = read('../src/engine/Engine.ts');
  const disposeStart = src.indexOf('  dispose() {');
  assert.ok(disposeStart > 0, 'Engine.dispose() bulundu');
  const disposeBody = src.slice(disposeStart, disposeStart + 3000);
  assert.ok(
    /this\.grainPass\.dispose\(\)/.test(disposeBody),
    'grain dispose çağrısı var',
  );
  // TERS BAYRAK REGRESYONU: grain dispose'u bir composer.passes.indexOf
  // koşuluna bağlanmış olmamalı.
  assert.ok(
    !/indexOf\(this\.grainPass\)\s*===\s*-1\)\s*this\.grainPass\.dispose/.test(disposeBody),
    'grain dispose ARTIK "composer\'da değilse" koşuluna bağlı DEĞİL (ters bayrak düzeltildi)',
  );
}

// --- 3. neon kendi rAF'ını sürmüyor; uTime dışarıdan geliyor ---
{
  const src = read('../src/shaders/neonWireMaterial.ts');
  // ÇAĞRI ara, kelime değil: dosyanın başındaki hata-geçmişi yorumu kelimeyi
  // bilerek içeriyor (neden kaldırıldığını anlatıyor) — onu yakalamak testi
  // yorum yazımına bağlar, davranışa değil.
  assert.ok(
    !/requestAnimationFrame\s*\(/.test(src),
    'neonWireMaterial requestAnimationFrame ÇAĞIRMIYOR',
  );
  assert.ok(
    !/cancelAnimationFrame\s*\(/.test(src),
    'neonWireMaterial cancelAnimationFrame ÇAĞIRMIYOR',
  );
  // uTime uniform'u DURMALI — yalnızca sürücüsü değişti, sözleşme değil.
  assert.ok(/uTime/.test(src), 'uTime uniform\'u yerinde (sürücüsü Engine oldu)');
}

// --- 4. Engine material'lara uTime işliyor (tek zaman kaynağı) ---
{
  const src = read('../src/engine/Engine.ts');
  const tickStart = src.indexOf('private tickPasses(');
  assert.ok(tickStart > 0, 'tickPasses bulundu');
  const tickBody = src.slice(tickStart, src.indexOf('\n  }', tickStart));
  assert.ok(
    /uTime/.test(tickBody),
    'tickPasses kayıtlı material\'lara uTime yazıyor (neon\'un eski rAF\'ının yerine)',
  );
  assert.ok(
    /renderModes/.test(tickBody),
    'uTime TÜM kayıtlı render modlarına işleniyor (yalnız neon\'a özel dal değil)',
  );
}

console.log(
  'OK · engine dispose + zaman kaynağı (composer pass\'leri bırakmaz → grain koşulsuz dispose; neon rAF kaldırıldı, uTime tek kaynaktan)',
);
