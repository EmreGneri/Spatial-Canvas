import { Vector2, type Texture } from 'three';
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
 *
 * Fragment sırası: kontrast → doygunluk → grain → vignette.
 */

export interface GrainPassUniforms {
  tDiffuse: { value: Texture | null };
  uTime: { value: number };
  /** 0..0.3 — grain şiddeti */
  uGrainAmount: { value: number };
  /** 0..5 — 0 iken grain zamandan bağımsız, sabit doku */
  uGrainSpeed: { value: number };
  /** 0..1.5 — vignette koyuluğu */
  uVignette: { value: number };
  /** 0.5..2 — 0.5 merkezli kontrast, 1 = nötr */
  uContrast: { value: number };
  /** 0..1.5 — luminance'a lerp, 1 = nötr */
  uSaturation: { value: number };
  /** drawing buffer boyutu (piksel) — resize'da güncellenir */
  uResolution: { value: Vector2 };
}

/** ShaderPass, uniform'ları tipli görünsün diye daraltılmış. */
export type GrainPass = ShaderPass & { uniforms: GrainPassUniforms };

export function createGrainPass(): GrainPass {
  // Her pass kendi uniform objesini alır; iki pass instance'ı state paylaşmaz.
  const uniforms: GrainPassUniforms = {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrainAmount: { value: 0.3 },
    uGrainSpeed: { value: 0 },
    uVignette: { value: 1.5 },
    uContrast: { value: 2 },
    uSaturation: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
  };

  const pass = new ShaderPass({
    name: 'grain-vignette',
    uniforms,
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
      uniform float uGrainAmount;
      uniform float uGrainSpeed;
      uniform float uVignette;
      uniform float uContrast;
      uniform float uSaturation;
      uniform vec2 uResolution;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec4 col = texture2D(tDiffuse, vUv);

        // -- renk grading: önce kontrast, sonra doygunluk --
        col.rgb = (col.rgb - 0.5) * uContrast + 0.5;

        float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
        col.rgb = mix(vec3(luma), col.rgb, uSaturation);

        // -- grain: piksel ölçeği uResolution'dan, uGrainSpeed = 0 → sabit doku --
        float g = hash(vUv * uResolution + uTime * uGrainSpeed * 24.0);
        col.rgb += (g - 0.5) * uGrainAmount;

        // -- vignette --
        float d = distance(vUv, vec2(0.5));
        col.rgb *= 1.0 - smoothstep(0.35, 0.85, d) * uVignette;

        gl_FragColor = col;
      }
    `,
  });
  // ShaderPass uniform'ları gevşek tipler; burada kurduğumuz obje birebir bu.
  return pass as GrainPass;
}
