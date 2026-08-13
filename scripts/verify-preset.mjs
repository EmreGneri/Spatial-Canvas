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
const { FEEDBACK_PARAMS } = await import('../src/shaders/feedbackPass.ts');
const { CHROMATIC_PARAMS } = await import('../src/shaders/chromaticPass.ts');
const { BLOOM_PARAMS } = await import('../src/shaders/bloomPass.ts');
const { LOOK_PARAMS } = await import('../src/shaders/look.ts');
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
  const feedbackUniforms = makeUniforms(FEEDBACK_PARAMS);
  const chromaticUniforms = makeUniforms(CHROMATIC_PARAMS);
  const bloomUniforms = makeUniforms(BLOOM_PARAMS);
  const lookUniforms = makeUniforms(LOOK_PARAMS);
  const pointsUniforms = makeUniforms(POINTS_PARAMS);
  const asciiUniforms = makeUniforms(ASCII_PARAMS);
  const stub = {
    mediaType: 'synthetic',
    renderMode: 'points',
    currentGraph: createDefaultGraph(),
    simUniforms,
    grainUniforms,
    feedbackUniforms,
    chromaticUniforms,
    bloomUniforms,
    lookUniforms,
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
    selectRenderMode(mode) {
      const node = this.currentGraph.nodes.find((n) => n.type === 'renderer');
      if (node) node.params = { ...node.params, mode };
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
        else if (node.type === 'feedback') {
          applyParams(FEEDBACK_PARAMS, this.feedbackUniforms, node.params);
          applyParams(CHROMATIC_PARAMS, this.chromaticUniforms, node.params);
          applyParams(BLOOM_PARAMS, this.bloomUniforms, node.params);
          applyParams(GRAIN_PARAMS, this.grainUniforms, node.params);
        } else if (node.type === 'renderer') applyParams(POINTS_PARAMS, this.pointsUniforms, node.params);
      }
      // Gün A sözleşmesi: output (global look) AKTİFLİK GEREKTİRMEZ — zincir
      // kopsa da (output inaktif olsa da) kolları uygulanır.
      const outputNode = graph.nodes.find((n) => n.type === 'output');
      if (outputNode) applyParams(LOOK_PARAMS, this.lookUniforms, outputNode.params);
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
a.grainUniforms.uGrainAmount.value = 0.15;
a.feedbackUniforms.uFeedbackAmount.value = 0.42;
a.feedbackUniforms.uDecay.value = 0.95;
a.chromaticUniforms.uAmount.value = 0.005;
a.bloomUniforms.uBloomStrength.value = 1.2;
a.lookUniforms.uExposure.value = 1.6;
a.lookUniforms.uFogDensity.value = 0.07;
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
const feedback = preset.graph.nodes.find((n) => n.type === 'feedback');
assert.equal(feedback.params.uGrainAmount, 0.15, 'grain parametresi anlık değerle yazılmalı');
assert.equal(feedback.params.uFeedbackAmount, 0.42, 'feedback parametresi anlık değerle yazılmalı');
assert.equal(feedback.params.uDecay, 0.95);
assert.equal(feedback.params.uAmount, 0.005, 'chromatic parametresi feedback düğümünde serileşmeli');
assert.equal(feedback.params.uBloomStrength, 1.2, 'bloom parametresi feedback düğümünde serileşmeli');
const output = preset.graph.nodes.find((n) => n.type === 'output');
assert.equal(output.params.uExposure, 1.6, 'look exposure output düğümünde serileşmeli');
assert.equal(output.params.uFogDensity, 0.07, 'look sis output düğümünde serileşmeli');
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

// --- 2.5 Gün 8: mod takası graf params'ına yazılır (selectRenderMode) ---
// Gerçek akış sıralıdır: setPointsMaterial (renderModeName güncellenir) →
// selectRenderMode (graf renderer düğümünün params.mode'u güncellenir).
// Burada takas emülasyonu: stub.renderMode = Engine.renderModeName.
b.renderMode = 'ascii';
b.selectRenderMode('ascii');
let rn = b.currentGraph.nodes.find((n) => n.type === 'renderer');
assert.equal(rn.params.mode, 'ascii', 'ModeSelector takası renderer düğümüne yazılmalı');
// Editör sonraki herhangi bir parametre düzenlemesinde mevcut grafı gönderir —
// selectRenderMode'la yazılan mod bu graf takasında korunmalı.
b.setGraph({ ...b.currentGraph });
assert.equal(b.currentGraph.nodes.find((n) => n.type === 'renderer').params.mode, 'ascii');
// Kayıt: toPreset doğru modu taşır (renderMode'u okur), geri yüklenirken graf
// kupası aynı modla kurulur.
const preset2 = toPreset(b, 'mode-sync');
assert.equal(preset2.graph.nodes.find((n) => n.type === 'renderer').params.mode, 'ascii');
const modeSyncTarget = makeStub('mode-sync');
applyPreset(modeSyncTarget, preset2);
assert.equal(modeSyncTarget.currentGraph.nodes.find((n) => n.type === 'renderer').params.mode, 'ascii');
assert.equal(b.grainUniforms.uGrainAmount.value, 0.15, 'grain geri kurulmalı');
assert.equal(b.feedbackUniforms.uFeedbackAmount.value, 0.42, 'feedback geri kurulmalı');
assert.equal(b.feedbackUniforms.uDecay.value, 0.95);
assert.equal(b.chromaticUniforms.uAmount.value, 0.005, 'chromatic geri kurulmalı');
assert.equal(b.bloomUniforms.uBloomStrength.value, 1.2, 'bloom geri kurulmalı');
assert.equal(b.lookUniforms.uExposure.value, 1.6, 'look exposure geri kurulmalı');
assert.equal(b.lookUniforms.uFogDensity.value, 0.07, 'look sis geri kurulmalı');
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
// Gün A sözleşmesi: output inaktif olsa da look kolları uygulanır — editör
// değişikliği ve preset round-trip kopuk zincirde de çalışır.
const cut = makeStub('cut');
cut.setGraph(noFeedback);
cut.lookUniforms.uExposure.value = 2.2;
const presetCut = toPreset(cut, 'zincir-kopuk');
const outputCut = presetCut.graph.nodes.find((n) => n.type === 'output');
assert.equal(outputCut.params.uExposure, 2.2, 'kopuk zincirde look serileşir');
const cutTarget = makeStub('cutTarget');
applyPreset(cutTarget, presetCut);
assert.equal(cutTarget.lookUniforms.uExposure.value, 2.2, 'kopuk zincirde look geri kurulur (aktiflik gerektirmez)');

// --- 6. ascii modu da serileşir (charSet kapsam dışı, uniform'lar içeride) ---
const e = makeStub('e');
e.renderMode = 'ascii';
const presetAscii = toPreset(e, 'ascii');
const e2 = makeStub('e2');
applyPreset(e2, presetAscii);
assert.equal(presetAscii.graph.nodes.find((n) => n.type === 'renderer').params.mode, 'ascii');

console.log('OK · preset şeması v1 (round-trip, sürüm koruması, bilinmeyen alan toleransı, graf aktifliği)');
