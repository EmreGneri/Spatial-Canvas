// Crystal preset testi (GPU gerekmez, saf CPU) — Gün 4, Zeynep.
//
// Bir mod, preset'e girmeden "shipped" sayılmaz: kullanıcı ayarını
// kaydedemiyorsa ve embed linkiyle paylaşamıyorsa mod yarım kalmıştır.
// Burada üç şey denetlenir:
//   1. Hazır preset'ler TÜM crystal knob'larını taşıyor (eksik knob sessizce
//      varsayılana düşerdi — preset "yüklendi" der, görünüm başka olur).
//   2. serialize → apply → serialize round-trip'i BİREBİR aynı.
//   3. Bilinmeyen/eksik alan preset'i çökertmiyor (eski kayıt uyumu).
//   node scripts/verify-crystal-preset.mjs
import assert from 'node:assert/strict';
// Node'un yerleşik TS desteği uzantısız importları çözmez (src içindeki
// modüller birbirini uzantısız import ediyor) — verify-preset.mjs ile aynı
// çözüm: register() önce, modüller sonra dinamik import ile.
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);

const { CRYSTAL_PARAMS, createCrystalMaterial } = await import('../src/shaders/crystalMaterial.ts');
const { BUILT_IN_PRESETS } = await import('../src/shaders/presets.ts');
const { applyRenderState, serializeRenderState } = await import('../src/shaders/renderPreset.ts');
const { Color, Vector3 } = await import('three');

// DİĞER MODLAR İÇİN SAHTE HEDEFLER: gerçek material'lar DOM ister
// (asciiMaterial atlas'ı canvas'a rasterleştiriyor) — suite CPU-only ve
// DOM'suz kalmalı. serialize/apply yalnızca `.uniforms.<ad>.value` okuyup
// yazdığı için bu kadarı yeterli; test zaten CRYSTAL grubunu ölçüyor.
const num = (v) => ({ value: v });
const col = (hex) => ({ value: new Color(hex) });
const stubPoints = () => ({ uniforms: {
  uPointSize: num(6), uSizeJitter: num(0.3), uExtrusionDepth: num(0), uSoftness: num(0.5),
  uBrightness: num(1), uNearColor: col('#edf9ff'), uFarColor: col('#455990'),
  uLightStrength: num(0.45), uLightDir: { value: new Vector3(0.4, 0.7, 0.6) },
  uFresnelStrength: num(0.35), uNormalScale: num(0.8), uAoStrength: num(0.6),
} });
// Diğer modların hangi uniform'ları okuduğunu tek tek listelemek testi
// onların şemasına bağlar (ve her eklemede kırar). Proxy, istenen her adı
// talep anında `{ value }` olarak üretir — bu test yalnız CRYSTAL'ı ölçüyor.
// grain/feedback/chromatic hedefleri MATERIAL değil, doğrudan uniform
// sözlüğüdür — ayrı bir proxy.
const stubUniforms = () =>
  new Proxy({}, {
    get(u, key) {
      if (!(key in u)) u[key] = { value: String(key).toLowerCase().includes('color') ? new Color('#000000') : 0 };
      return u[key];
    },
    has: () => true,
  });

const stubGeneric = () =>
  new Proxy(
    { uniforms: {} },
    {
      get(target, prop) {
        // setCharSet gibi metotlar: no-op fonksiyon döndür.
        if (prop !== 'uniforms') return target[prop] ?? (() => {});
        return new Proxy(target.uniforms, {
          get(u, key) {
            if (!(key in u)) u[key] = { value: key.toLowerCase().includes('color') ? new Color('#000000') : 0 };
            return u[key];
          },
          has: () => true,
        });
      },
    },
  );

const KEYS = CRYSTAL_PARAMS.map((d) => d.key);

// --- 1. Üç hazır crystal preset'i var ve TÜM knob'ları taşıyor ---
{
  const crystalPresets = BUILT_IN_PRESETS.filter((p) => p.state.mode === 'crystal');
  assert.ok(
    crystalPresets.length >= 3,
    `en az 3 crystal preset (bulunan: ${crystalPresets.length})`,
  );
  for (const p of crystalPresets) {
    assert.ok(p.state.crystal, `'${p.name}' crystal grubu taşıyor`);
    for (const k of KEYS) {
      assert.ok(
        k in p.state.crystal,
        `'${p.name}' preset'inde '${k}' var (eksik knob sessizce varsayılana düşerdi)`,
      );
    }
  }
  // Üçü BİRBİRİNDEN farklı olmalı — aynı değerlerse "üç preset" bir yanılsama.
  const imza = (p) => KEYS.map((k) => String(p.state.crystal[k])).join('|');
  const imzalar = new Set(crystalPresets.map(imza));
  assert.equal(imzalar.size, crystalPresets.length, 'her crystal preset gerçekten farklı');
}

// --- 2. Round-trip: apply → serialize BİREBİR aynı değerleri döndürür ---
{
  const targets = {
    mode: 'crystal',
    points: stubPoints(),
    ascii: stubGeneric(),
    neon: stubGeneric(),
    solid: stubGeneric(),
    crystal: createCrystalMaterial(),
    grain: stubUniforms(),
    feedback: stubUniforms(),
    chromatic: stubUniforms(),
  };
  for (const p of BUILT_IN_PRESETS.filter((x) => x.state.mode === 'crystal')) {
    applyRenderState(targets, p.state);
    const out = serializeRenderState(targets);
    assert.ok(out.crystal, `'${p.name}' serileştirmede crystal grubu var`);
    for (const k of KEYS) {
      const want = p.state.crystal[k];
      const got = out.crystal[k];
      if (typeof want === 'number') {
        assert.ok(
          Math.abs(got - want) < 1e-6,
          `'${p.name}' · ${k}: ${got} ≈ ${want} (round-trip)`,
        );
      } else {
        assert.equal(
          String(got).toLowerCase(),
          String(want).toLowerCase(),
          `'${p.name}' · ${k} rengi round-trip'te korunuyor`,
        );
      }
    }
  }
}

// --- 3. Eksik / bilinmeyen alan ÇÖKERTMEZ (eski kayıt uyumu) ---
{
  const targets = {
    mode: 'crystal',
    points: stubPoints(),
    ascii: stubGeneric(),
    neon: stubGeneric(),
    solid: stubGeneric(),
    crystal: createCrystalMaterial(),
    grain: stubUniforms(),
    feedback: stubUniforms(),
    chromatic: stubUniforms(),
  };
  const base = BUILT_IN_PRESETS.find((p) => p.state.mode === 'crystal').state;

  // (a) crystal grubu HİÇ yok (v1 öncesi kayıt) → çökmez, crystal dokunulmaz
  const oncekiFacet = targets.crystal.uniforms.uFacetScale.value;
  const { crystal: _atilan, ...crystalsiz } = base;
  applyRenderState(targets, crystalsiz);
  assert.equal(
    targets.crystal.uniforms.uFacetScale.value,
    oncekiFacet,
    'crystal grubu yoksa crystal uniformlarına DOKUNULMAZ',
  );

  // (b) bilinmeyen anahtar → atlanır, diğerleri uygulanır
  const fazladan = {
    ...base,
    crystal: { ...base.crystal, uOlmayanKol: 123, uFacetScale: 17 },
  };
  applyRenderState(targets, fazladan);
  assert.equal(targets.crystal.uniforms.uFacetScale.value, 17, 'bilinen anahtar uygulandı');
  assert.equal(
    targets.crystal.uniforms.uOlmayanKol,
    undefined,
    'bilinmeyen anahtar uniform yaratmadı',
  );

  // (c) tür uyuşmazlığı (renk yerine sayı) → atlanır, renk bozulmaz
  const oncekiTint = `#${targets.crystal.uniforms.uTintColor.value.getHexString()}`;
  applyRenderState(targets, { ...base, crystal: { ...base.crystal, uTintColor: 42 } });
  assert.equal(
    `#${targets.crystal.uniforms.uTintColor.value.getHexString()}`,
    oncekiTint,
    'renk alanına sayı gelirse ATLANIR (renk bozulmaz)',
  );
}

// --- 4. Preset değerleri ParamDef aralıklarının İÇİNDE ---
// Aralık dışı bir preset slider'ı ilk açılışta uca yapıştırır.
{
  const byKey = Object.fromEntries(CRYSTAL_PARAMS.map((d) => [d.key, d]));
  for (const p of BUILT_IN_PRESETS.filter((x) => x.state.mode === 'crystal')) {
    for (const k of KEYS) {
      const def = byKey[k];
      if (def.kind === 'color') {
        assert.match(String(p.state.crystal[k]), /^#[0-9a-fA-F]{6}$/, `'${p.name}' · ${k} hex renk`);
        continue;
      }
      const v = p.state.crystal[k];
      assert.ok(
        v >= def.min && v <= def.max,
        `'${p.name}' · ${k} = ${v}, [${def.min}, ${def.max}] içinde`,
      );
    }
  }
}

console.log(
  `OK · crystal preset (${BUILT_IN_PRESETS.filter((p) => p.state.mode === 'crystal').length} hazır preset, tüm knob'lar kapsandı, round-trip birebir, eksik/bilinmeyen/tür-uyuşmaz alan toleransı, ParamDef aralıkları)`,
);
