// Exercise the actual custom element with deferred image/model boundaries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register, stripTypeScriptTypes } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
const { assertPreset } = await import('../src/engine/preset.ts');

const source = readFileSync(new URL('../src/embed.ts', import.meta.url), 'utf8')
  .replace(/^import\b[\s\S]*?;\r?\n/gm, '')
  .replace('export { SpatialCanvasElement };', '')
  .replace("import('./depth')", 'Promise.resolve(globalThis.__embedDepthTest)');
const saved = Object.fromEntries(['HTMLElement', 'customElements', 'Image', 'window', '__embedDepthTest'].map(k => [k, globalThis[k]]));
const images = [], calls = [];
let inference;
globalThis.HTMLElement = class {};
globalThis.customElements = { get: () => null, define() {} };
globalThis.Image = class { set src(name) { this.name = name; images.push(this); } };
const depth = { data: new Float32Array([0.5]), width: 1, height: 1 };
globalThis.__embedDepthTest = { FOTO_KALITE: {}, estimateDepth: async () => inference ? inference : depth };
try {
  const Element = new Function('EMBED_CHROME_CSS', 'assertPreset', `${stripTypeScriptTypes(source)}; return SpatialCanvasElement;`)('', assertPreset);
  const element = new Element();
  const engine = name => ({
    setPhoto(image) { calls.push(`${name}:${image.name}`); },
    setMetricPhotoGeometry() {}, setDepth() {}, dispose() {},
  });
  element.engine = engine('first');
  const a = element.loadSource('A'), b = element.loadSource('B');
  images[1].onload(); await b;
  images[0].onload(); await a;
  assert.deepEqual(calls, ['first:B'], 'a slow old source cannot replace the latest source');

  const cancelled = element.loadSource('cancelled');
  await element.loadSource(null);
  images[2].onload(); await cancelled;
  assert.deepEqual(calls, ['first:B'], 'removing src invalidates its pending source');

  let completeInference;
  inference = new Promise(resolve => { completeInference = resolve; });
  let startedInference;
  const started = new Promise(resolve => { startedInference = resolve; });
  globalThis.__embedDepthTest.estimateDepth = () => { startedInference(); return inference; };
  const oldLifetime = element.loadSource('old lifetime');
  images[3].onload(); await started;
  element.disconnectedCallback();
  element.engine = engine('reconnected');
  completeInference(depth); await oldLifetime;
  assert.deepEqual(calls, ['first:B'], 'a previous connection cannot write into the new engine');

  let urlLoads = 0;
  globalThis.window = { location: { search: '?src=example.jpg' } };
  const attributes = new Map();
  element.getAttribute = key => attributes.get(key) ?? null;
  element.setAttribute = (key, value) => {
    const old = element.getAttribute(key);
    attributes.set(key, value);
    element.attributeChangedCallback(key, old, value);
  };
  element.loadSource = async () => { urlLoads++; };
  element.applyUrlParams();
  assert.equal(urlLoads, 1, 'the observed src attribute owns the URL source load');

  let graphWrites = 0;
  element.engine.setGraph = () => { graphWrites++; };
  const savedError = console.error;
  try {
    console.error = () => {};
    element.applyPreset(JSON.stringify({ version: 1, graph: { nodes: [], edges: [] } }));
  } finally { console.error = savedError; }
  assert.equal(graphWrites, 0, 'embed presets must also validate before changing the graph');
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
}
console.log('embed source: OK');
