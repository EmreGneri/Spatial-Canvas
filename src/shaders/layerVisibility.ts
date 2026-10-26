import * as THREE from 'three';

interface LayerShaderState {
  vertex: string;
  fragment: string;
  patchedVertex: string;
  patchedFragment: string;
  enabled: boolean;
}

const states = new WeakMap<THREE.ShaderMaterial, LayerShaderState>();
const MAIN = /\bvoid\s+main\s*\(\s*\)\s*\{/;

/** Kapalıyken kaynaklar birebir geri yüklenir; görünürlük değişimi yalnız uniform günceller. */
export function attachLayerVisibility(
  material: THREE.ShaderMaterial, texture: THREE.Texture | null,
  visible: THREE.Vector3, enabled: boolean,
): void {
  const active = enabled && texture !== null;
  let state = states.get(material);
  if (!active && !state?.enabled) return;
  if (!state) {
    const vertex = material.vertexShader, fragment = material.fragmentShader;
    if (!MAIN.test(vertex) || !MAIN.test(fragment)) throw new Error('Layer visibility requires shader main functions');
    let patchedVertex: string;
    if (/vec2\s+uv\s*=\s*splatUv\(aSplatIndex\)\s*;/.test(vertex)) {
      // Splat dizisi flipY=false; görüntü katman dokusunda üst satır v=1'dir.
      patchedVertex = vertex.replace(/vec2\s+uv\s*=\s*splatUv\(aSplatIndex\)\s*;/,
        '$&\n    vLayerUv = vec2(uv.x, 1.0 - uv.y);');
    } else {
      const uv = /attribute\s+vec2\s+aUv\s*;/.test(vertex) ? 'aUv' : 'uv';
      patchedVertex = vertex.replace(MAIN, `$&\n    vLayerUv = ${uv};`);
    }
    patchedVertex = `varying vec2 vLayerUv;\n${patchedVertex}`;
    // Ayrı main sarmalayıcısı, orijinal shader'daki erken return'leri de korur.
    const premultiplied = material.blending === THREE.CustomBlending && material.blendSrc === THREE.OneFactor;
    const patchedFragment = `
uniform sampler2D uLayerVisibilityTexture;
uniform vec3 uLayerVisibilityMask;
varying vec2 vLayerUv;
${fragment.replace(MAIN, 'void layerVisibilityOriginalMain() {')}
void main() {
  float layerVisibilityFactor = clamp(dot(texture2D(uLayerVisibilityTexture, vLayerUv).rgb, uLayerVisibilityMask), 0.0, 1.0);
  if (layerVisibilityFactor <= 0.001) discard;
  layerVisibilityOriginalMain();
  gl_FragColor.a *= layerVisibilityFactor;
  ${premultiplied ? 'gl_FragColor.rgb *= layerVisibilityFactor;' : ''}
}
`;
    state = { vertex, fragment, patchedVertex, patchedFragment, enabled: false };
    states.set(material, state);
  }
  if (active) {
    material.uniforms.uLayerVisibilityTexture ??= { value: texture };
    material.uniforms.uLayerVisibilityMask ??= { value: visible };
    material.uniforms.uLayerVisibilityTexture.value = texture;
    material.uniforms.uLayerVisibilityMask.value = visible;
  } else {
    delete material.uniforms.uLayerVisibilityTexture;
    delete material.uniforms.uLayerVisibilityMask;
  }
  if (state.enabled === active) return;
  material.vertexShader = active ? state.patchedVertex : state.vertex;
  material.fragmentShader = active ? state.patchedFragment : state.fragment;
  state.enabled = active;
  material.needsUpdate = true;
}
