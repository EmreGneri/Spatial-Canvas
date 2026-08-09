import type { Texture } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * PASS ZİNCİRİ — render katmanının kalbi. Sahiplik: Zeynep.
 *
 * Sıra (bugün):
 *   RenderPass (depth quad) → Grain/Vignette → (Zeynep: Feedback → Chromatic
 *   Aberration → Neon Wireframe) → Output
 *
 * Bu dosya seam'dir: Gün 1'deki grain/vignette, zincirin çalıştığını kanıtlayan
 * ilk pass. Zeynep'in pass'leri bu sıraya eklenir, sahibi o.
 */

export const grainPassUniforms = {
  tDiffuse: { value: null as Texture | null },
  uTime: { value: 0 },
};

export function createGrainPass(): ShaderPass {
  return new ShaderPass({
    name: 'grain-vignette',
    uniforms: grainPassUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec4 col = texture2D(tDiffuse, vUv);

        float g = hash(vUv * vec2(1920.0, 1080.0) + uTime * 24.0);
        col.rgb += (g - 0.5) * 0.03;

        float d = distance(vUv, vec2(0.5));
        col.rgb *= 1.0 - smoothstep(0.35, 0.85, d) * 0.45;

        gl_FragColor = col;
      }
    `,
  });
}
