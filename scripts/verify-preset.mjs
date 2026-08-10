// Preset şeması v1'in regresyon kontrolü (GPU gerekmez).
// Gün 4 kanıtı: toPreset → applyPreset = sahne birebir geri gelir.
// WebGL'siz test edebilmek için preset yalnızca dar bir yüzeye (PresetSource)
// dokunur; burada sahte engine ile doldurulur. Gerçek engine aynı yüzeyi
// sunduğu için tarayıcıda da aynı kod çalışır.
//   node scripts/verify-preset.mjs
import assert from 'node:assert/strict';
// Node'un yerleşik TS desteği uzantısız importları çözmez (src içindeki
// './buffers' yazımı Vite içindir). Loader ÖNCE kaydedilir; src modülleri
// aşağıda dinamik import ile yüklenir ki register() zaten çalışmış olsun.
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);

const { Color } = await import('three');
const { POSITION_TEXTURE_SIZE } = await import('../src/engine/buffers.ts');
const { toPreset, applyPreset, PRESET_VERSION } = await import('../src/engine/preset.ts');
const {
  createDefaultGraph,
  activeNodes,
  validateGraph,
  topologicalOrder,
} = await import('../src/engine/graph.ts');
const { collectParams, applyParams } = await import('../src/engine/params.ts');
const { SIM_PARAMS } = await import('../src/engine/simulation.ts');
const { GRAIN_PARAMS } = await import('../src/shaders/grainPass.ts');
const { POINTS_PARAMS } = await import('../src/shaders/pointCloudMaterial.ts');
const { ASCII_PARAMS } = await import('../src/shaders/asciiMaterial.ts');

// --- sahte engine: preset'in dokunduğu yüzeyin aynısı ---
function makeUniforms(defs, overrides = {}) {
  const uniforms = {};
  for (const def of defs) {
    uniforms[def.key] = { value: def.kind === 'color' ? new Color(0xffffff) : def.default };
  }
  Object.assign(uniforms, overrides);
  return uniforms;
}

function makeStub(name) {
  const simUniforms = makeUniforms(SIM_PARAMS);
  const grainUniforms = makeUniforms(GRAIN_PARAMS);
  const pointsUniforms = makeUniforms(POINTS_PARAMS);
  const asciiUniforms = makeUniforms(ASCII_PARAMS);
  const stub = {
    mediaType: 'synthetic',
    renderMode: 'points',
    currentGraph: createDefaultGraph(),
    simUniforms,
    grainUniforms,
    cameraPose: { position: [0, 0, 3.5], target: [0, 0, 0] },
    getCameraPose() {
      return this.cameraPose;
    },
    setCameraPose(pose) {
      this.cameraPose = pose;
    },
    activeRenderParams() {
      return collectParams(POINTS_PARAMS, pointsUniforms);
    },
    setGraph(graph) {
      this.currentGraph = graph;
      const active = activeNodes(graph);
      const warnings = validateGraph(graph);
      // Engine sözleşmesiyle birebir: aktif düğümün parametreleri uniform'lara
      // yazılır (gerçek Engine'de aynı mantık setGraph içinde durur).
      for (const node of graph.nodes) {
        if (!active.has(node.id)) continue;
        if (node.type === 'particles') applyParams(SIM_PARAMS, this.simUniforms, node.params);
        else if (node.type === 'feedback') applyParams(GRAIN_PARAMS, this.grainUniforms, node.params);
        else if (node.type === 'renderer') applyParams(POINTS_PARAMS, this.pointsUniforms, node.params);
      }
      return { active, warnings };
    },
    pointsUniforms,
  };
  return stub;
}

// --- 1. toPreset anlık durumu yakalar ---
const a = makeStub('a');
a.simUniforms.uStiffness.value = 0.21;
a.simUniforms.uForceMode.value = 2;
a.pointsUniforms.uPointSize.value = 11;
a.pointsUniforms.uNearColor.value = new Color('#ff4400');
a.mediaType = 'upload';
a.cameraPose = { position: [1.5, 0.25, -2], target: [0.1, 0.2, 0.3] };

const preset = toPreset(a, 'test');
assert.equal(preset.version, PRESET_VERSION);
assert.equal(preset.gridSize, POSITION_TEXTURE_SIZE);
assert.deepEqual(preset.camera, a.cameraPose, 'kamera duruşu yakalanmalı');
assert.equal(preset.mediaType, 'upload');
const particles = preset.graph.nodes.find((n) => n.type === 'particles');
assert.equal(particles.params.uStiffness, 0.21, 'sim parametresi anlık değerle yazılmalı');
assert.equal(particles.params.uForceMode, 2);
const renderer = preset.graph.nodes.find((n) => n.type === 'renderer');
assert.equal(renderer.params.mode, 'points');
assert.equal(renderer.params.uPointSize, 11, 'material parametresi anlık değerle yazılmalı');
assert.equal(renderer.params.uNearColor, '#ff4400', 'renk hex olarak serileştirilmeli');

// --- 2. applyPreset sahneyi birebir geri kurar ---
const b = makeStub('b'); // farklı varsayılanlarla dolu hedef
const { applied, warnings } = applyPreset(b, preset);
// Preset 'upload' ile kaydedilmiş, hedefte 'synthetic' var: medya gömülmediği
// için tek uyarı beklenir, graf/parametre tarafı sessiz olmalı.
assert.equal(warnings.length, 1, `yalnızca medya uyarısı beklenir: ${JSON.stringify(warnings)}`);
assert.match(warnings[0], /medya preset'e gömülmez/);
assert.equal(applied.length, 6, 'varsayılan grafta 6 düğüm aktif olmalı');
assert.equal(b.simUniforms.uStiffness.value, 0.21);
assert.equal(b.simUniforms.uForceMode.value, 2);
assert.equal(b.pointsUniforms.uPointSize.value, 11);
assert.equal(b.pointsUniforms.uNearColor.value.getHexString(), 'ff4400');
assert.deepEqual(b.cameraPose, a.cameraPose, 'kamera geri kurulmalı');
// mediaType KOPYALANMAZ: medya geri yüklenmediği için motorun kaynak türü
// olduğu gibi kalır, yoksa ekranda sentetik dururken 'upload' yazardı ve bir
// sonraki kayıt yanlış türü yazardı.
assert.equal(b.mediaType, 'synthetic', 'preset medya türünü ezmemeli');
assert.equal(b.currentGraph.nodes.length, 6, 'graf geri kurulmalı');

// --- 3. bilinmeyen alanlar atlasılır, asla patlamaz ---
const c = makeStub('c');
const n = applyParams(POINTS_PARAMS, c.pointsUniforms, {
  uPointSize: 13,
  uSilinmisUniform: 7, // eski preset'te uniform artık yoksa / yeni alan eklendiyse
  mode: 'ascii',
});
assert.equal(n, 1, 'yalnızca bilinen anahtar uygulanmalı (uPointSize)');
assert.equal(c.pointsUniforms.uPointSize.value, 13);

// --- 4. sürüm koruması: bilinmeyen sürüm açılmaz, sahneye dokunulmaz ---
const d = makeStub('d');
assert.throws(() => applyPreset(d, { ...preset, version: 99 }), /sürümü uyuşmuyor/);
assert.equal(d.simUniforms.uStiffness.value, SIM_PARAMS[0].default, 'hata sonrası sahne değişmemeli');

// --- 5. graf: aktiflik ve sıralama ---
const def = createDefaultGraph();
assert.deepEqual(validateGraph(def), [], 'varsayılan graf temiz olmalı');
assert.equal(activeNodes(def).size, 6, 'varsayılan grafta herkes aktif');
const order = topologicalOrder(def);
assert.ok(
  order.indexOf('media') < order.indexOf('renderer') &&
    order.indexOf('renderer') < order.indexOf('feedback'),
  'topolojik sıra: renderer feedback\'ten önce',
);
const noFeedback = {
  ...def,
  edges: def.edges.filter((e) => e.from !== 'renderer' || e.to !== 'feedback'),
};
const activeNoFeedback = activeNodes(noFeedback);
assert.equal(activeNoFeedback.size, 4, 'feedback kenarı kesilince feedback devre dışı');
assert.ok(!activeNoFeedback.has('feedback'), 'feedback düğümü artık aktif değil');
assert.ok(!activeNoFeedback.has('output'), 'zincir koptuğu için output da aktif değil');

// --- 6. ascii modu da serileşir (charSet kapsam dışı, uniform'lar içeride) ---
const e = makeStub('e');
e.renderMode = 'ascii';
const presetAscii = toPreset(e, 'ascii');
const e2 = makeStub('e2');
applyPreset(e2, presetAscii);
assert.equal(presetAscii.graph.nodes.find((n) => n.type === 'renderer').params.mode, 'ascii');

console.log('OK · preset şeması v1 (round-trip, sürüm koruması, bilinmeyen alan toleransı, graf aktifliği)');
