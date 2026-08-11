import type { Texture } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { ParamDef } from '../engine/params';

/**
 * CHROMATIC ABERRATION PASS — render katmanı. Sahiplik: Zeynep.
 *
 * Lens kırılması: R, G, B kanalları UV merkezinden farklı miktarlarda
 * kaydırılarak örneklenir. G merkezde kalır (referans kanal), R dışa,
 * B içe kayar — gerçek bir lensteki kırılma sırası bu.
 *
 * Zincirdeki yeri (ARCHITECTURE.md · Pass Zinciri):
 *   RenderPass → Feedback → ChroAber → Grain/Vignette → Output
 *
 * Pass kancası: `update(time)` sunar (TickablePass), Engine her karede çağırır.
 */

export interface ChromaticPassUniforms {
  /** Zincirden gelen kare — composer yazar. */
  tDiffuse: { value: Texture | null };
  /** 0..0.02 — kayma miktarı (UV birimi); 0 = efekt kapalı, çıkış girişe eşit */
  uAmount: { value: number };
  /** 0..1 — 0 = sabit yönlü kayma (uAngle), 1 = merkezden uzaklaştıkça artan radyal */
  uRadial: { value: number };
  /** 0..6.28 — sabit kayma modunda yön (radyan) */
  uAngle: { value: number };
}

/** Parametre sözleşmesi (Gün 4): chromatic'in preset'e giren kolları. */
export const CHROMATIC_PARAMS: ParamDef[] = [
  { key: 'uAmount', label: 'kayma miktarı', min: 0, max: 0.02, default: 0 },
  { key: 'uRadial', label: 'radyallik', min: 0, max: 1, default: 1 },
  { key: 'uAngle', label: 'kayma yönü', min: 0, max: 6.28, default: 0 },
];

/** ShaderPass, uniform'ları tipli görünsün ve kanca kapsansın diye. */
export type ChromaticPass = ShaderPass & {
  uniforms: ChromaticPassUniforms;
  /** Pass sözleşmesi: Engine her karede çağırır. */
  update: (time: number) => void;
};

export function createChromaticPass(): ChromaticPass {
  // Her pass kendi uniform objesini alır; iki pass instance'ı state paylaşmaz.
  const uniforms: ChromaticPassUniforms = {
    tDiffuse: { value: null },
    uAmount: { value: 0 },
    uRadial: { value: 1 },
    uAngle: { value: 0 },
  };

  const pass = new ShaderPass({
    name: 'chromatic-aberration',
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
      uniform float uAmount;
      uniform float uRadial;
      uniform float uAngle;

      varying vec2 vUv;

      void main() {
        vec2 toCenter = vUv - 0.5;

        // Sabit yön: birim vektör, kare boyunca aynı kayma.
        vec2 fixedDir = vec2(cos(uAngle), sin(uAngle));
        // Radyal yön: merkezde sıfır, köşelere doğru büyür (×2 → kenarda ~1).
        vec2 radialDir = toCenter * 2.0;

        vec2 offset = mix(fixedDir, radialDir, uRadial) * uAmount;

        // clamp: kayma UV'yi kare dışına taşırsa örnekleme kenar pikseline
        // sabitlenir. ÖLÇÜLDÜ: kaynak ClampToEdge iken kenardan sızma sıfır.
        // (Kaynak REPEAT ile sarılırsa tam u = 1.0 başa döner ve karşı kenardan
        // renk sızar — composer render target'ları ClampToEdge olduğu için bu
        // durum oluşmaz. Zincire farklı sarma modlu bir texture girerse burası
        // yarım teksel içeri kırpılmalı.)
        vec2 uvR = clamp(vUv + offset, 0.0, 1.0);
        vec2 uvB = clamp(vUv - offset, 0.0, 1.0);

        // G merkezde: referans kanal. uAmount = 0 iken üç örnek de aynı
        // noktaya düşer, çıkış girişe bit-birebir eşittir.
        vec4 center = texture2D(tDiffuse, vUv);
        float r = texture2D(tDiffuse, uvR).r;
        float b = texture2D(tDiffuse, uvB).b;

        gl_FragColor = vec4(r, center.g, b, center.a);
      }
    `,
  });

  const chromatic = pass as ChromaticPass;
  // Pass zamandan bağımsız (kayma yalnızca uniform'lardan gelir). Kancayı yine
  // de sunar: Engine zinciri tek tip gezer, ileride nefes alan bir aberasyon
  // istenirse bağlanacak yer burası.
  chromatic.update = () => {};

  return chromatic;
}
