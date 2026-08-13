import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Vector2 } from 'three';

/**
 * FXAA PASS — render katmanı. Sahiplik: Zeynep.
 *
 * Renderer `antialias: false` kurulur (composer render target'larına MSAA
 * yazmaz); nokta bulutu kenarları ona göre pırıldar. FXAA bu pırıltıyı iki
 * yumuşak geçişle keser. YERİ kritiktir: RenderPass'ten HEMEN SONRA — zincirin
 * alt kısmında (feedback/aberasyon/grain sonrası) durursa effect'lerin kendi
 * kenar yapılarını da yumuşatıp bulanıklaştırırdı.
 *
 * Parametre sözleşmesindeki YOKTUR (listeye girmez, preset'e girmez): kalite
 * kolu değil, her zaman açık. `feedback` graf düğümünün post-pass grubuyla
 * birlikte kapanır (Engine.setGraph: `pass.enabled`).
 */

export type FxaaPass = ShaderPass & {
  /** Pass sözleşmesi: Engine her karede çağırır. */
  update: (time: number) => void;
};

export function createFxaaPass(): FxaaPass {
  const pass = new ShaderPass(FXAAShader) as FxaaPass;
  const origSetSize = pass.setSize.bind(pass);
  // FXAAShader texel boyutunu uniform'dan alır; ShaderPass setSize bunu
  // otomatik yazmaz — boyut değişiminde kırpma/bozukluk olmasın diye elle.
  pass.setSize = (width: number, height: number) => {
    const resolution = pass.uniforms['resolution'] as { value: Vector2 } | undefined;
    if (resolution?.value) resolution.value.set(1 / width, 1 / height);
    origSetSize(width, height);
  };
  pass.update = () => {};
  return pass;
}