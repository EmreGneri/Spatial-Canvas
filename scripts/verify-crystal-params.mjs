// crystal modu ParamDef/preset sözleşme testi (GPU gerekmez, WebGL YOK)
// — Gün 2, render şeridi (Zeynep).
//
// NEDEN STATİK: shader'ı derlemek WebGL bağlamı ister; suite CPU-only ve
// deterministik kalmalı (repo kuralı). Bunun yerine ParamDef listesi ile
// SHADER KAYNAĞI ve PRESET ŞEMASI arasındaki tutarlılık denetlenir — pratikte
// en sık kırılan üç bağ:
//   1. ParamDef'e knob eklenir, shader'a uniform eklenmez → slider hiçbir şey
//      yapmaz (sessiz).
//   2. default, [min,max] dışında kalır → ControlPanel slider'ı ilk açılışta
//      sıçrar.
//   3. Preset grubuna knob eklenmez → kaydet/yükle o knob'u sessizce düşürür.
//   node scripts/verify-crystal-params.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CRYSTAL_PARAMS } from '../src/shaders/crystalMaterial.ts';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const crystalSrc = read('../src/shaders/crystalMaterial.ts');
const presetSrc = read('../src/shaders/renderPreset.ts');

// --- 1. ParamDef listesi boş değil ve anahtarlar tekil ---
{
  assert.ok(CRYSTAL_PARAMS.length >= 10, `crystal knob sayısı (${CRYSTAL_PARAMS.length}) ≥ 10`);
  const keys = CRYSTAL_PARAMS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length, 'ParamDef anahtarları tekil');
}

// --- 2. Her ParamDef adı shader'da UNIFORM olarak tanımlı ---
// Fragment ya da vertex'te `uniform <tip> <ad>;` satırı aranır. Yalnızca adın
// dosyada geçmesi YETMEZ (yorumda da geçebilir) — uniform bildirimi şart.
{
  for (const def of CRYSTAL_PARAMS) {
    const re = new RegExp(`uniform\\s+\\w+\\s+${def.key}\\s*;`);
    assert.ok(
      re.test(crystalSrc),
      `'${def.key}' shader'da uniform olarak tanımlı (slider ölü knob değil)`,
    );
  }
}

// --- 3. Her knob material'ın uniforms sözlüğünde başlangıç değeriyle var ---
{
  for (const def of CRYSTAL_PARAMS) {
    const re = new RegExp(`${def.key}\\s*:\\s*\\{\\s*value\\s*:`);
    assert.ok(re.test(crystalSrc), `'${def.key}' uniforms sözlüğünde başlatılmış`);
  }
}

// --- 4. default değerler [min, max] içinde (renk knob'ları hariç) ---
{
  for (const def of CRYSTAL_PARAMS) {
    if (def.kind === 'color') continue;
    assert.equal(typeof def.default, 'number', `'${def.key}' default sayı`);
    assert.ok(typeof def.min === 'number', `'${def.key}' min tanımlı`);
    assert.ok(typeof def.max === 'number', `'${def.key}' max tanımlı`);
    assert.ok(def.min < def.max, `'${def.key}' min < max`);
    assert.ok(
      def.default >= def.min && def.default <= def.max,
      `'${def.key}' default (${def.default}) [${def.min}, ${def.max}] içinde`,
    );
  }
}

// --- 5. Etiketler Türkçe/anlaşılır (boş ya da anahtar adının kopyası değil) ---
{
  for (const def of CRYSTAL_PARAMS) {
    assert.ok(def.label && def.label.length > 2, `'${def.key}' etiketi dolu`);
    assert.notEqual(def.label, def.key, `'${def.key}' etiketi anahtarın kopyası değil`);
  }
}

// --- 6. PRESET KAPSAMI: her knob CrystalState'te, serialize'da ve apply'da ---
// Üçü ayrı ayrı denetlenir; biri unutulursa preset o knob'u sessizce düşürür.
{
  const stateBlock = presetSrc.slice(
    presetSrc.indexOf('export interface CrystalState {'),
    presetSrc.indexOf('export interface FeedbackState {'),
  );
  assert.ok(stateBlock.length > 0, 'CrystalState arayüzü bulundu');
  for (const def of CRYSTAL_PARAMS) {
    assert.ok(
      new RegExp(`\\b${def.key}\\b`).test(stateBlock),
      `'${def.key}' CrystalState arayüzünde`,
    );
    assert.ok(
      new RegExp(`crystal\\.uniforms\\.${def.key}\\b`).test(presetSrc),
      `'${def.key}' serialize ediliyor`,
    );
    assert.ok(
      new RegExp(`state\\.crystal\\.${def.key}\\b`).test(presetSrc),
      `'${def.key}' apply ediliyor`,
    );
  }
}

// --- 7. Gün 5/6'da bağlanacak knob'lar BUGÜN kimlik değerinde ---
// Kırılma/dispersiyon/parıltı henüz fragment'te kullanılmıyor; varsayılanları
// 0 olmazsa mod ilk açılışta "bozuk" görünürdü.
{
  const byKey = Object.fromEntries(CRYSTAL_PARAMS.map((d) => [d.key, d]));
  for (const k of ['uRefractStrength', 'uDispersion', 'uSparkleAmount']) {
    assert.equal(byKey[k].default, 0, `'${k}' varsayılanı 0 (henüz bağlı değil — Gün 5/6)`);
  }
}

// --- 8. Normal kaynağı ENUM aralığı: 0 mesh / 1 splat / 2 depth türevi ---
{
  const n = CRYSTAL_PARAMS.find((d) => d.key === 'uNormalKaynak');
  assert.equal(n.min, 0, 'uNormalKaynak min 0 (mesh)');
  assert.equal(n.max, 2, 'uNormalKaynak max 2 (depth türevi)');
  // Shader üç kolu da tanımalı: mesh/splat ortak dal + türev dalı.
  assert.ok(/dFdx\s*\(/.test(crystalSrc), 'depth türevi kolu (dFdx) shader\'da var');
  assert.ok(/dFdy\s*\(/.test(crystalSrc), 'depth türevi kolu (dFdy) shader\'da var');
}

console.log(
  `OK · crystal ParamDef sözleşmesi (${CRYSTAL_PARAMS.length} knob: shader uniform'u ✓, uniforms sözlüğü ✓, default aralığı ✓, preset state/serialize/apply ✓, Gün 5/6 knob'ları kimlikte ✓)`,
);
