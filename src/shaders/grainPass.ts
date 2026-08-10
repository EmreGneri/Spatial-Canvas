import { Vector2, type Texture } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { ParamDef } from '../engine/params';

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

/**
 * Parametre sözleşmesi (Gün 4): grain/vignette pass'inin preset'e giren
 * kolları. uTime ve uResolution hesaplanır, kullanıcı kolu değil — yoklar.
 */
export const GRAIN_PARAMS: ParamDef[] = [
  { key: 'uGrainAmount', label: 'grain', min: 0, max: 0.3, default: 0.06 },
  { key: 'uGrainSpeed', label: 'grain hızı', min: 0, max: 5, default: 1 },
  { key: 'uVignette', label: 'vignette', min: 0, max: 1.5, default: 0.45 },
  { key: 'uContrast', label: 'kontrast', min: 0.5, max: 2, default: 1.05 },
  { key: 'uSaturation', label: 'doygunluk', min: 0, max: 1.5, default: 1 },
];

/** ShaderPass, uniform'ları tipli görünsün diye daraltılmış. */
export type GrainPass = ShaderPass & {
  uniforms: GrainPassUniforms;
  /** Pass sözleşmesi: Engine her karede update(time)'ı çağırır; uTime'a doğrudan yazmaz. */
  update: (time: number) => void;
};

export function createGrainPass(): GrainPass {
  // Her pass kendi uniform objesini alır; iki pass instance'ı state paylaşmaz.
  const uniforms: GrainPassUniforms = {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    // Başlangıç = nötre yakın bir bakış. Slider aralıklarının uçları (kontrast 2,
    // doygunluk 0, vignette 1.5) sahneyi gri ve ezik gösterir; uçlar denemek için,
    // varsayılan için değil. Görsel dil netleşince buradan sabitlenir.
    uGrainAmount: { value: 0.06 },
    uGrainSpeed: { value: 1 },
    uVignette: { value: 0.45 },
    uContrast: { value: 1.05 },
    uSaturation: { value: 1 },
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
  const grain = pass as GrainPass;
  grain.update = (time: number) => {
    grain.uniforms.uTime.value = time;
  };
  return grain;
}
