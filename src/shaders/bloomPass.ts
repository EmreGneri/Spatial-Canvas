import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { ParamDef } from '../engine/params';

/**
 * BLOOM PASS — render katmanı. Sahiplik: Zeynep.
 *
 * UnrealBloomPass'in ince bir sarmalayıcısı: parametre sözleşmesine göre
 * (Gün 4) preset/UI uniform adlarını BİLMEZ — uniform sözlüğü üzerinden
 * okur/yazar. Bloom'un kendi parametreleri (strength/radius/threshold)
 * pasın özellikleri, uniform değil; `update(time)` kancasında (TickablePass)
 * sözlükten içeri senkron edilir. Engine her karede kancayı çağırır.
 *
 * Zincirdeki yeri (ARCHITECTURE.md · Pass Zinciri):
 *   RenderPass → FXAA → Feedback → ChroAber → Bloom → Grain → Output
 *
 * `feedback` graf düğümünün yönettiği post-pass grubunun parçasıdır:
 * düğümün giriş kenarı kesilince `pass.enabled = false` ile kapanır
 * (Engine.setGraph — grain removePass ile, diğerleri enabled ile).
 */

export interface BloomPassUniforms {
  /** 0..3 — parlaklık hacmi. 0 = kapalı (eski görünüm bit-birebir korunur). */
  uBloomStrength: { value: number };
  /** 0..2 — haleli yayılma yarıçapı. */
  uBloomRadius: { value: number };
  /** 0..1 — parlaklık eşiği (üstünde kalan pikseller ışımaya başlar). */
  uBloomThreshold: { value: number };
}

/**
 * TEK DOĞRULUK KAYNAĞI (SSOT): sarmalayıcı da BLOOM_PARAMS da buradan okur.
 * Güç 0'dır — bloom anahtarı olmayan eski preset'ler varsayılan görünümünü
 * korur (Gün A "görünüm değişmez" kuralı, CHANGELOG).
 */
export const BLOOM_DEFAULTS = {
  uBloomStrength: 0,
  uBloomRadius: 0.5,
  uBloomThreshold: 0.85,
} as const;

/** Parametre sözleşmesi (Gün 4): bloom'un preset'e giren kolları. */
export const BLOOM_PARAMS: ParamDef[] = [
  { key: 'uBloomStrength', label: 'parlama', min: 0, max: 3, default: BLOOM_DEFAULTS.uBloomStrength },
  { key: 'uBloomRadius', label: 'parlama yarıçapı', min: 0, max: 2, default: BLOOM_DEFAULTS.uBloomRadius },
  { key: 'uBloomThreshold', label: 'parlama eşiği', min: 0, max: 1, default: BLOOM_DEFAULTS.uBloomThreshold },
];

/** ShaderPass benzeri: uniform'ları tipli, kanca kapsanmış. */
export type BloomPass = UnrealBloomPass & {
  uniforms: BloomPassUniforms;
  /**
   * Zincir kolu (graf 'feedback' düğümü). `enabled` BUNDAN ve parlama
   * gücünden türetilir — Engine artık enabled'a doğrudan yazmaz.
   */
  chainEnabled: boolean;
  /** Pass sözleşmesi: Engine her karede çağırır, sözlük → iç parametreler. */
  update: (time: number) => void;
};

export function createBloomPass(): BloomPass {
  // Her pass kendi sözlüğünü alır; iki instance state paylaşmaz. resolution
  // değeri geçicidir, setSize ile hemen gelir. Başlangıç tek kaynaktan
  // (BLOOM_DEFAULTS) — elle sabit yazılmaz, kayma riski yok.
  const uniforms: BloomPassUniforms = {
    uBloomStrength: { value: BLOOM_DEFAULTS.uBloomStrength },
    uBloomRadius: { value: BLOOM_DEFAULTS.uBloomRadius },
    uBloomThreshold: { value: BLOOM_DEFAULTS.uBloomThreshold },
  };

  const pass = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    BLOOM_DEFAULTS.uBloomStrength,
    BLOOM_DEFAULTS.uBloomRadius,
    BLOOM_DEFAULTS.uBloomThreshold,
  ) as BloomPass;
  pass.uniforms = uniforms;

  const origSetSize = pass.setSize.bind(pass);
  pass.setSize = (width: number, height: number) => {
    pass.resolution.set(width, height);
    origSetSize(width, height);
  };

  // Kanca: sözlükteki değerleri iç parametrelere senkronla. UnrealBloomPass
  // parametre geçişini copyUniforms üzerinden yapar; değerleri doğrudan
  // yazmak (copyUniforms.value = ...) kompozisyonlar arası doğru sıralanmaz
  // diye render öncesi güncellenir — zaten Engine her karede çağırıyor.
  pass.chainEnabled = true;
  pass.update = () => {
    pass.strength = uniforms.uBloomStrength.value;
    pass.radius = uniforms.uBloomRadius.value;
    pass.threshold = uniforms.uBloomThreshold.value;
    // GÜN C (FPS, kalite kaybı YOK): güç 0 iken bloom matematiksel olarak
    // kimliktir ama UnrealBloomPass tüm mip zincirini (5 downsample + 5
    // upsample + luminosity) yine çizer. Varsayılan görünüm gücü 0 olduğu
    // için bu her karede bedava olmayan bir hiçlik. Güç 0 → pass atlanır.
    pass.enabled = pass.chainEnabled && uniforms.uBloomStrength.value > 0.001;
  };

  return pass;
}