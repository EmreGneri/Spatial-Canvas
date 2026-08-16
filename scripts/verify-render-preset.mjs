// Render preset (src/shaders/renderPreset.ts) regresyon kontrolü (GPU gerekmez).
// 1) splat grubu serileştirilir (önceden sessizce düşüyordu)
// 2) round-trip: serialize → apply = splat uniform'ları birebir geri gelir
// 3) geriye dönük: splat alanı OLMAYAN eski kayıt güvenle uygulanır
// 4) splat sis formülü üstel olmalı (flat mix'e geri dönüş kilidi)
//   node scripts/verify-render-preset.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);

const { Color, Vector3 } = await import('three');
const {
  serializeRenderState,
  applyRenderState,
  RENDER_PRESET_VERSION,
} = await import('../src/shaders/renderPreset.ts');
const { createSplatMaterial } = await import('../src/shaders/splatMaterial.ts');
const { POINTS_PARAMS } = await import('../src/shaders/pointCloudMaterial.ts');
const { ASCII_PARAMS } = await import('../src/shaders/asciiMaterial.ts');
const { NEON_PARAMS } = await import('../src/shaders/neonWireMaterial.ts');
const { SOLID_PARAMS } = await import('../src/shaders/solidMaterial.ts');
const { GRAIN_PARAMS } = await import('../src/shaders/grainPass.ts');

// --- sahte hedefler: yalnızca splat gerçek material; diğerleri stub (node güvenli) ---
function makeUniforms(defs, overrides = {}) {
  const uniforms = {};
  for (const def of defs) {
    uniforms[def.key] = { value: def.kind === 'color' ? new Color(0xffffff) : def.default };
  }
  Object.assign(uniforms, overrides);
  return uniforms;
}

const SPLAT_KEYS = ['uSplatScale', 'uSplatOpacity', 'uMaxScreenRadius', 'uBrightness', 'uLightStrength', 'uAoStrength'];

// serialize'in dokunduğu vektör/renk/opsiyonel uniform'lar ParamDef'te yoktur
// (slider değildir) — serileştirici çökmesin diye elle eklenir.
const POINTS_EXTRA = {
  uNearColor: { value: new Color(0xffffff) },
  uFarColor: { value: new Color(0x000000) },
  uLightDir: { value: new Vector3(0.4, 0.7, 0.6).normalize() },
  uAoStrength: { value: 0.3 },
};
const SOLID_EXTRA = {
  uNearColor: { value: new Color(0xffffff) },
  uFarColor: { value: new Color(0x000000) },
  uWallColor: { value: new Color(0x333344) },
  uAoStrength: { value: 0.5 },
  uSpecular: { value: 0.2 },
};

function makeTargets() {
  const splat = createSplatMaterial();
  const ascii = {
    uniforms: makeUniforms(ASCII_PARAMS),
    charSet: ' abc',
    setCharSet() {},
  };
  return {
    mode: 'splat',
    points: { uniforms: { ...makeUniforms(POINTS_PARAMS), ...POINTS_EXTRA } },
    ascii,
    neon: { uniforms: makeUniforms(NEON_PARAMS) },
    solid: { uniforms: { ...makeUniforms(SOLID_PARAMS), ...SOLID_EXTRA } },
    splat,
    grain: makeUniforms(GRAIN_PARAMS),
  };
}

let group = 1;

// [1] splat grubu serileştirmede OLMALI (Gün 8 bulgusu: sessizce düşüyordu).
{
  const targets = makeTargets();
  const state = serializeRenderState(targets);
  assert.equal(state.version, RENDER_PRESET_VERSION, `[${group}] sürüm`);
  assert.ok(state.splat, `[${group}] state.splat eksik`);
  for (const key of SPLAT_KEYS) {
    assert.equal(typeof state.splat[key], 'number', `[${group}] ${key} sayı değil`);
  }
  console.log(`[${group}] splat grubu serileştiriliyor ✓`);
}
group++;

// [2] round-trip: uniform'ları kurcala → serialize → taze material'a uygula.
{
  const src = makeTargets();
  const values = { uSplatScale: 2.5, uSplatOpacity: 0.3, uMaxScreenRadius: 42, uBrightness: 1.7, uLightStrength: 0.8, uAoStrength: 0.1 };
  for (const [key, v] of Object.entries(values)) src.splat.uniforms[key].value = v;
  const state = serializeRenderState(src);
  const dst = makeTargets();
  const { warnings } = applyRenderState(dst, state);
  assert.deepEqual(warnings, [], `[${group}] uyarı çıkmamalı: ${warnings.join('; ')}`);
  for (const key of SPLAT_KEYS) {
    assert.equal(dst.splat.uniforms[key].value, values[key], `[${group}] ${key} round-trip`);
  }
  console.log(`[${group}] round-trip (${SPLAT_KEYS.join(', ')}) ✓`);
}
group++;

// [3] geriye dönük: splat alanı yok → hata yok, uniform'lar fabrika değerinde kalır.
{
  const targets = makeTargets();
  const legacy = serializeRenderState(targets);
  delete legacy.splat;
  const fresh = makeTargets();
  const { warnings } = applyRenderState(fresh, legacy);
  assert.ok(!warnings.some((w) => w.includes('splat')), `[${group}] splat uyarısı olmamalı: ${warnings.join('; ')}`);
  for (const key of SPLAT_KEYS) {
    assert.equal(
      fresh.splat.uniforms[key].value,
      targets.splat.uniforms[key].value,
      `[${group}] ${key} eski kayıtta korunmalı`,
    );
  }
  console.log(`[${group}] eski kayıt (splat'sız) güvenle uygulanıyor ✓`);
}
group++;

// [4] splat sis üstel formül kilidi (flat mix'e geri dönüş regresyonu).
{
  const { createSplatMaterial } = await import('../src/shaders/splatMaterial.ts');
  const frag = createSplatMaterial().fragmentShader;
  assert.ok(
    frag.includes('1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth)'),
    `[${group}] üstel sis formülü kayboldu`,
  );
  assert.ok(!frag.includes('clamp(uFogDensity'), `[${group}] eski flat mix geri gelmiş`);
  console.log(`[${group}] üstel sis formülü ✓`);
}

console.log('verify-render-preset: 4 grup, 0 hata');