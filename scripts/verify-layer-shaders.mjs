// GPU olmadan gerçek malzemelerde katman görünürlüğü ve eksiksiz geri dönüş.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
const THREE = await import('three');
const { attachLayerVisibility } = await import('../src/shaders/layerVisibility.ts');
const { createPointCloudMaterial } = await import('../src/shaders/pointCloudMaterial.ts');
const { createAsciiMaterial } = await import('../src/shaders/asciiMaterial.ts');
const { createNeonWireMaterial } = await import('../src/shaders/neonWireMaterial.ts');
const { createSolidMaterial } = await import('../src/shaders/solidMaterial.ts');
const { createSplatMaterial } = await import('../src/shaders/splatMaterial.ts');
const { createCrystalMaterial, createCrystalSplatMaterial } = await import('../src/shaders/crystalMaterial.ts');
const originalDocument = globalThis.document;
globalThis.document = { createElement: () => ({ width: 0, height: 0,
  getContext: () => ({ fillRect() {}, fillText() {} }),
}) };
const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
const visible = new THREE.Vector3(0, 1, 1);
try {
  const crystal = createCrystalMaterial();
  const materials = [createPointCloudMaterial(), createAsciiMaterial(), createNeonWireMaterial(),
    createSolidMaterial(), createSplatMaterial(), crystal, createCrystalSplatMaterial(crystal)];
  for (const material of materials) {
    const original = { vertex: material.vertexShader, fragment: material.fragmentShader,
      version: material.version, transparent: material.transparent, depthWrite: material.depthWrite,
      uniforms: Object.keys(material.uniforms) };
    attachLayerVisibility(material, texture, visible, false);
    assert.equal(material.vertexShader, original.vertex, 'varsayılan vertex birebir kalmalı');
    assert.equal(material.fragmentShader, original.fragment, 'varsayılan fragment birebir kalmalı');
    assert.equal(material.version, original.version, 'kapalı özellik yeniden derleme istememeli');
    assert.deepEqual(Object.keys(material.uniforms), original.uniforms);

    attachLayerVisibility(material, texture, visible, true);
    const patched = { vertex: material.vertexShader, fragment: material.fragmentShader, version: material.version };
    assert.notEqual(patched.fragment, original.fragment, 'etkin görünürlük fragmente uygulanmalı');
    assert.match(patched.fragment, /dot\(texture2D\(uLayerVisibilityTexture, vLayerUv\)\.rgb, uLayerVisibilityMask\)/);
    assert.match(patched.fragment, /if \(layerVisibilityFactor <= 0\.001\) discard;/);
    assert.match(patched.fragment, /gl_FragColor\.a \*= layerVisibilityFactor;/);
    assert.equal((patched.vertex.match(/void main\s*\(/g) ?? []).length, 1);
    assert.equal((patched.fragment.match(/void main\s*\(/g) ?? []).length, 1);
    // Fragment sarmalayıcısı çıktıyı orijinal main tamamlandıktan sonra çarpar.
    assert.match(patched.fragment, /layerVisibilityOriginalMain\(\);\s*gl_FragColor\.a \*= layerVisibilityFactor;/);
    const sourceUv = original.vertex.includes('splatUv(aSplatIndex)') ? 'vec2(uv.x, 1.0 - uv.y)'
      : original.vertex.includes('attribute vec2 aUv') ? 'aUv' : 'uv';
    assert.ok(patched.vertex.includes(`vLayerUv = ${sourceUv};`), 'kare/quad UV yerine kaynak görüntü UV kullanılır');
    assert.equal(material.uniforms.uLayerVisibilityTexture.value, texture);
    assert.equal(material.uniforms.uLayerVisibilityMask.value, visible);
    if (material.blending === THREE.CustomBlending && material.blendSrc === THREE.OneFactor) {
      assert.match(patched.fragment, /gl_FragColor\.rgb \*= layerVisibilityFactor;/, 'premultiplied renk de sönmeli');
    }
    const nextVisible = new THREE.Vector3(1, 0, 1);
    attachLayerVisibility(material, texture, nextVisible, true);
    assert.equal(material.uniforms.uLayerVisibilityMask.value, nextVisible);
    assert.equal(material.vertexShader, patched.vertex);
    assert.equal(material.fragmentShader, patched.fragment);
    assert.equal(material.version, patched.version, 'yalnız uniform değişimi shader derletmez');
    assert.equal(material.transparent, original.transparent);
    assert.equal(material.depthWrite, original.depthWrite);

    for (let i = 0; i < 3; i++) {
      attachLayerVisibility(material, texture, visible, false);
      assert.equal(material.vertexShader, original.vertex);
      assert.equal(material.fragmentShader, original.fragment);
      assert.deepEqual(Object.keys(material.uniforms), original.uniforms);
      attachLayerVisibility(material, texture, visible, true);
      assert.equal(material.vertexShader, patched.vertex, 'tekrarlanan açma kaynak kodu çoğaltmamalı');
      assert.equal(material.fragmentShader, patched.fragment);
    }
    attachLayerVisibility(material, null, visible, true);
    assert.equal(material.vertexShader, original.vertex, 'katman dokusu yoksa özellik kapalı');
    assert.equal(material.fragmentShader, original.fragment);
    material.dispose();
  }
} finally {
  texture.dispose();
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
console.log('verify-layer-shaders OK (7 gerçek malzeme/varyant)');
