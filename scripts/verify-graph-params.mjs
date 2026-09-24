// Graph editor / ControlPanel parameter ownership (no GPU, no WebGL).
//
// WHY: the graph editor re-applied stored node params on every setGraph while
// ControlPanel wrote uniforms directly, so cutting an edge snapped panel edits
// back; renderer params leaked into another mode's material; applyParams
// swapped color objects out from under ColorInput; and deleting a selected
// node silently deleted its edges. This runs the REAL Engine.setGraph (on a
// WebGL-free instance, like verify-live-engine-integration) with the same
// graph-building helpers the editor uses.
//   node scripts/verify-graph-params.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Color } from 'three';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.(?:ts|js|mjs|json)$/.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { /* Keep original resolution. */ }
    }
    return nextResolve(specifier, context);
  },
});

const { applyParams, collectParams } = await import('../src/engine/params.ts');
const { Engine } = await import('../src/engine/Engine.ts');
const { createDefaultGraph } = await import('../src/engine/graph.ts');
const { SIM_PARAMS } = await import('../src/engine/simulation.ts');
const { GRAIN_PARAMS } = await import('../src/shaders/grainPass.ts');
const { FEEDBACK_PARAMS } = await import('../src/shaders/feedbackPass.ts');
const { CHROMATIC_PARAMS } = await import('../src/shaders/chromaticPass.ts');
const { BLOOM_PARAMS } = await import('../src/shaders/bloomPass.ts');
const { LOOK_PARAMS } = await import('../src/shaders/look.ts');
const { POINTS_PARAMS } = await import('../src/shaders/pointCloudMaterial.ts');
const { ASCII_PARAMS } = await import('../src/shaders/asciiMaterial.ts');
const { SOLID_PARAMS } = await import('../src/shaders/solidMaterial.ts');

function makeUniforms(defs, colors = {}) {
  const uniforms = {};
  for (const def of defs) {
    uniforms[def.key] = {
      value: def.kind === 'color' ? new Color(colors[def.key] ?? '#ffffff') : def.default,
    };
  }
  return uniforms;
}

/** Engine without a renderer: only what setGraph / toPreset touch. */
function makeEngine() {
  const engine = Object.create(Engine.prototype);
  const materials = {
    points: { uniforms: makeUniforms(POINTS_PARAMS, { uNearColor: '#aabbcc' }) },
    ascii: { uniforms: makeUniforms(ASCII_PARAMS) },
    solid: { uniforms: makeUniforms(SOLID_PARAMS, { uNearColor: '#0f1c47' }) },
  };
  engine.renderModes = new Map([
    ['points', { material: materials.points, params: POINTS_PARAMS }],
    ['ascii', { material: materials.ascii, params: ASCII_PARAMS }],
    ['solid', { material: materials.solid, params: SOLID_PARAMS }],
  ]);
  engine.pointsMaterial = materials.points;
  engine.renderModeName = 'points';
  engine.graph = createDefaultGraph();
  // Material swap / visibility / composer surgery need WebGL; setGraph only
  // has to pick the right mode, so the swap is reduced to its bookkeeping.
  engine.setPointsMaterial = function (material) {
    this.pointsMaterial = material;
    for (const [name, entry] of this.renderModes) if (entry.material === material) this.renderModeName = name;
  };
  engine.syncRenderVisibility = () => {};
  engine.setPostPassEnabled = () => {};
  engine.simulation = { uniforms: makeUniforms(SIM_PARAMS) };
  engine.grainPass = { uniforms: makeUniforms(GRAIN_PARAMS) };
  engine.feedbackPass = { uniforms: makeUniforms(FEEDBACK_PARAMS) };
  engine.chromaticPass = { uniforms: makeUniforms(CHROMATIC_PARAMS) };
  engine.bloomPass = { uniforms: makeUniforms(BLOOM_PARAMS) };
  engine.fxaaPass = {};
  engine.look = makeUniforms(LOOK_PARAMS);
  engine.camera = { position: { x: 0, y: 0, z: 3.5 } };
  engine.controls = { target: { x: 0, y: 0, z: 0 } };
  return { engine, materials };
}

// --- 1. applyParams writes colors IN PLACE (ColorInput holds that object) ---
{
  const defs = [{ key: 'uTint', label: 'renk', default: 0, kind: 'color' }];
  const uniforms = { uTint: { value: new Color('#000000') } };
  const heldByPanel = uniforms.uTint.value;
  assert.equal(applyParams(defs, uniforms, { uTint: '#ff8800' }), 1);
  assert.equal(uniforms.uTint.value, heldByPanel, 'color uniform keeps the same THREE.Color object');
  assert.equal(heldByPanel.getHexString(), 'ff8800', 'the held object carries the new value');
  // A later panel edit on the held object must reach the uniform.
  heldByPanel.set('#00ff00');
  assert.equal(collectParams(defs, uniforms).uTint, '#00ff00', 'panel edits after apply still land');
}

// --- 2. setGraph never applies renderer params to a different mode ---
{
  const { engine, materials } = makeEngine();
  const graph = createDefaultGraph();
  graph.nodes.find((n) => n.type === 'renderer').params = { mode: 'kayip-mod', uPointSize: 3 };
  const { warnings } = engine.setGraph(graph);
  assert.ok(warnings.some((w) => /render modu bilinmiyor/.test(w)), 'unknown mode is reported');
  assert.equal(engine.renderMode, 'points', 'current mode kept');
  assert.equal(materials.points.uniforms.uPointSize.value, POINTS_PARAMS[0].default,
    'params captured for an unknown mode do not land on the current material');
}

const { liveGraph, setParam, toRfNodes } = await import('../src/ui/nodeGraphSync.ts');

/** Editor edit exactly as NodeGraphEditor.setNodeParam does it. */
function editorParam(engine, nodeId, key, value) {
  const graph = liveGraph(engine);
  assert.ok(setParam(graph, nodeId, key, value), `node ${nodeId} exists`);
  engine.setGraph(graph);
}

/** Editor edge change exactly as NodeGraphEditor.syncToEngine does it. */
function editorEdges(engine, edges) {
  engine.setGraph({ ...liveGraph(engine), edges });
}

// --- 3. Brief scenario: editor 0.5 → panel 0 → cut/connect keeps 0 ---
{
  const { engine } = makeEngine();
  editorParam(engine, 'feedback', 'uFeedbackAmount', 0.5);
  assert.equal(engine.feedbackUniforms.uFeedbackAmount.value, 0.5, 'editor edit applied');

  engine.feedbackUniforms.uFeedbackAmount.value = 0; // ControlPanel writes the uniform directly
  engine.lookUniforms.uFogColor.value.set('#334455'); // ColorInput mutates in place

  const all = engine.currentGraph.edges.map((e) => ({ ...e }));
  const cut = all.filter((e) => !(e.from === 'feedback' && e.to === 'output'));
  editorEdges(engine, cut);
  assert.equal(engine.feedbackUniforms.uFeedbackAmount.value, 0, 'edge cut keeps the panel value');
  assert.equal(engine.lookUniforms.uFogColor.value.getHexString(), '334455', 'edge cut keeps panel color');
  const feedbackNode = engine.currentGraph.nodes.find((n) => n.id === 'feedback');
  assert.equal(feedbackNode.params.uFeedbackAmount, 0, 'graph node params agree with the panel');

  editorEdges(engine, all);
  assert.equal(engine.feedbackUniforms.uFeedbackAmount.value, 0, 'edge connect keeps the panel value');

  engine.feedbackUniforms.uFeedbackAmount.value = 0.2;
  editorParam(engine, 'particles', 'uStiffness', 0.3);
  assert.equal(engine.feedbackUniforms.uFeedbackAmount.value, 0.2, 'editing another node keeps panel value');
  assert.equal(engine.simUniforms.uStiffness.value, 0.3);
}

// --- 4. Renderer params stay with their mode across mode switches ---
{
  const { engine, materials } = makeEngine();
  editorParam(engine, 'renderer', 'uNearColor', '#ff0000');
  editorParam(engine, 'renderer', 'uPointSize', 19);
  assert.equal(materials.points.uniforms.uNearColor.value.getHexString(), 'ff0000');

  // Mode switch from the editor: the new material keeps its own values.
  editorParam(engine, 'renderer', 'mode', 'solid');
  assert.equal(engine.renderMode, 'solid');
  assert.equal(materials.solid.uniforms.uNearColor.value.getHexString(), '0f1c47',
    'points color does not leak into solid on editor mode switch');
  assert.equal(materials.points.uniforms.uNearColor.value.getHexString(), 'ff0000', 'points keeps its color');

  // Mode switch from ModeSelector (material swap + selectRenderMode), then an
  // edge change in the editor: stored renderer params are points values
  // labelled 'ascii' — they must not reach the ascii material.
  engine.setPointsMaterial(materials.points);
  engine.selectRenderMode('points');
  editorParam(engine, 'renderer', 'uPointSize', 19);
  engine.setPointsMaterial(materials.ascii);
  engine.selectRenderMode('ascii');
  editorEdges(engine, engine.currentGraph.edges.map((e) => ({ ...e })));
  assert.equal(materials.ascii.uniforms.uPointSize.value, ASCII_PARAMS[0].default,
    'points size does not leak into ascii after a ModeSelector switch');
  const renderer = engine.currentGraph.nodes.find((n) => n.type === 'renderer');
  assert.equal(renderer.params.mode, 'ascii');
  assert.equal(renderer.params.uPointSize, ASCII_PARAMS[0].default, 'renderer node now mirrors ascii');
}

// --- 5. toRfNodes: nodes are not deletable, edges are ---
{
  const graph = createDefaultGraph();
  const nodes = toRfNodes(graph);
  assert.deepEqual(nodes.map((n) => n.id), graph.nodes.map((n) => n.id));
  for (const node of nodes) assert.equal(node.deletable, false, `${node.id} is not deletable`);

  // xyflow's own delete-key resolution: a selected node takes its edges along
  // unless it is marked deletable: false.
  const { getElementsToRemove } = await import('@xyflow/system');
  const edges = graph.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to }));
  const renderer = nodes.find((n) => n.id === 'renderer');
  const nodeDelete = await getElementsToRemove({ nodesToRemove: [renderer], edgesToRemove: [], nodes, edges });
  assert.deepEqual(nodeDelete, { nodes: [], edges: [] }, 'deleting a node removes nothing');
  const edgeDelete = await getElementsToRemove({ nodesToRemove: [], edgesToRemove: [edges[3]], nodes, edges });
  assert.deepEqual(edgeDelete.edges.map((e) => e.id), ['e3'], 'a selected edge is still deletable');
}

console.log('OK · graph params (in-place color, mode isolation, panel→graph sync, non-deletable nodes)');
