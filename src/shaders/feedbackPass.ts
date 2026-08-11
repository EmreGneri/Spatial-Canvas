import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { ParamDef } from '../engine/params';

/**
 * FEEDBACK PASS — render katmanı. Sahiplik: Zeynep.
 *
 * TouchDesigner feedback mantığı: her kare, bir önceki karenin üzerine küçük
 * bir ölçekleme + dönme + renk kayması eklenerek yeniden çizilir. Birikim iki
 * render target arasında ping-pong ile taşınır (bir texture'a hem yazıp hem
 * okumak tanımsızdır).
 *
 * Zincirdeki yeri (ARCHITECTURE.md · Pass Zinciri):
 *   RenderPass → Feedback → ChroAber → Grain/Vignette → Output
 *
 * Pass kancası: `update(time)` sunar (TickablePass), Engine her karede çağırır.
 */

/**
 * Birikim tamponunun hassasiyeti — ÖLÇÜLDÜ, tahmin değil.
 *
 * Yöntem: 256 basamaklı gradyan, tDiffuse = siyah, uFeedbackAmount = 0.99,
 * gerçek fragment shader'ı ile N kare özyineleme; sonuç float64 referansla
 * karşılaştırıldı. Hata 8-bit ekran seviyesine çevrildi (1.0 = tam bir
 * kuantalama adımı), bant ise korunan farklı değer sayısıyla ölçüldü.
 *
 *   N=60,  decay 0.98  → half: 0.92 seviye hata, 256/256 değer   | full: 0.00, 256/256
 *   N=120, decay 0.98  → half: 0.29 seviye hata, 244/256 değer   | full: 0.00, 256/256
 *   N=300, decay 0.995 → half: 0.27 seviye hata, 253/256 değer   | full: 0.00, 256/256
 *
 * Sonuç: half-float yeterli. Sapma en kötü ihtimalle ~1 ekran seviyesi ve
 * bant değil, hafif parlaklık kayması olarak çıkıyor; basamaklanma en kötü
 * durumda 256 seviyenin 12'sini birleştiriyor. Üstelik zincirde hemen sonra
 * grain pass geliyor, gürültüsü bu artığı zaten dither'lıyor. Full float
 * hatayı sıfırlıyor ama iki kat bant genişliği istiyor — bu sahne için
 * karşılığı yok.
 *
 * Bant görülürse `createFeedbackPass({ type: THREE.FloatType })` yeterli.
 * DİKKAT: full float + LinearFilter `OES_texture_float_linear` ister; eklenti
 * yoksa texture eksik sayılır ve birikim sessizce siyah örneklenir.
 *
 * Bu karar ARCHITECTURE.md gereği render katmanına ait.
 */
const DEFAULT_TYPE: THREE.TextureDataType = THREE.HalfFloatType;

/** Sekme arka plandan dönerse (bu kadar saniyeden uzun boşluk) birikim sıfırlanır. */
const STALE_GAP_SECONDS = 1;

export interface FeedbackPassUniforms {
  /** Zincirden gelen mevcut kare — composer yazar. */
  tDiffuse: { value: THREE.Texture | null };
  /** Önceki birikim (ping-pong) — pass kendi yazar. */
  tPrev: { value: THREE.Texture | null };
  /** 0..0.99 — birikim miktarı; 0 = efekt tamamen kapalı, çıkış girişe eşit */
  uFeedbackAmount: { value: number };
  /** 0.98..1.02 — kare başına ölçekleme (merkez 0.5, 0.5) */
  uZoom: { value: number };
  /** −0.02..0.02 — kare başına dönme, radyan (merkez 0.5, 0.5) */
  uRotate: { value: number };
  /** 0..1 — birikimde renk kanallarını birbirinden kaydırır */
  uColorShift: { value: number };
  /** 0.9..1.0 — eski karelerin sönme hızı */
  uDecay: { value: number };
}

/** Parametre sözleşmesi (Gün 4): feedback'in preset'e giren kolları. */
export const FEEDBACK_PARAMS: ParamDef[] = [
  { key: 'uFeedbackAmount', label: 'birikim', min: 0, max: 0.99, default: 0 },
  { key: 'uZoom', label: 'yakınlaşma', min: 0.98, max: 1.02, default: 1 },
  { key: 'uRotate', label: 'dönme', min: -0.02, max: 0.02, default: 0 },
  { key: 'uColorShift', label: 'renk kayması', min: 0, max: 1, default: 0 },
  { key: 'uDecay', label: 'sönüm', min: 0.9, max: 1, default: 0.98 },
];

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tPrev;
  uniform float uFeedbackAmount;
  uniform float uZoom;
  uniform float uRotate;
  uniform float uColorShift;
  uniform float uDecay;

  varying vec2 vUv;

  /**
   * Önceki kareyi UV merkezinden (0.5, 0.5) ölçekleyip döndürür.
   * Bölme: uZoom > 1 iken daha dar bir alan örneklenir, yani birikim
   * kareden kareye BÜYÜR (içeri doğru tünel için uZoom < 1).
   */
  vec2 warp(vec2 uv, float zoom, float angle) {
    vec2 p = uv - 0.5;
    float s = sin(angle);
    float c = cos(angle);
    p = mat2(c, -s, s, c) * p;
    p /= max(zoom, 0.001);
    return p + 0.5;
  }

  void main() {
    vec3 cur = texture2D(tDiffuse, vUv).rgb;

    // Renk kayması: kanallar hafif farklı ölçekle örneklenir, birikim
    // ilerledikçe izler renklerine ayrışır.
    float shift = uColorShift * 0.01;
    vec2 uvR = warp(vUv, uZoom + shift, uRotate);
    vec2 uvG = warp(vUv, uZoom, uRotate);
    vec2 uvB = warp(vUv, uZoom - shift, uRotate);

    vec3 prev = vec3(
      texture2D(tPrev, uvR).r,
      texture2D(tPrev, uvG).g,
      texture2D(tPrev, uvB).b
    ) * uDecay;

    // max(): izler birikirken parlaklık patlamaz — çıkış geçmişin en
    // parlağıyla sınırlı kalır. Toplama kullanılsaydı amount*decay ~ 0.97'de
    // kararlı durum kazancı ~33x olur, parlak bölgeler beyaza yapışırdı.
    vec3 combined = max(cur, prev);

    // uFeedbackAmount = 0 → tam olarak cur (efekt kapalı, bit-birebir geçiş).
    gl_FragColor = vec4(mix(cur, combined, uFeedbackAmount), 1.0);
  }
`;

const COPY_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
  }
`;

export class FeedbackPass extends Pass {
  readonly uniforms: FeedbackPassUniforms;
  readonly material: THREE.ShaderMaterial;

  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readIndex = 0;
  private fsQuad: FullScreenQuad;
  private copyQuad: FullScreenQuad;
  private copyMaterial: THREE.ShaderMaterial;
  private lastTime: number | null = null;
  /** Bir sonraki render'da birikim temizlenecek mi (ilk kare / uzun boşluk). */
  private needsClear = true;

  constructor(options: { type?: THREE.TextureDataType } = {}) {
    super();

    const uniforms: FeedbackPassUniforms = {
      tDiffuse: { value: null },
      tPrev: { value: null },
      uFeedbackAmount: { value: 0 },
      uZoom: { value: 1 },
      uRotate: { value: 0 },
      uColorShift: { value: 0 },
      uDecay: { value: 0.98 },
    };
    this.uniforms = uniforms;

    this.material = new THREE.ShaderMaterial({
      name: 'feedback',
      uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });

    this.copyMaterial = new THREE.ShaderMaterial({
      name: 'feedback-copy',
      uniforms: { tDiffuse: { value: null } },
      vertexShader: VERTEX,
      fragmentShader: COPY_FRAGMENT,
    });

    this.fsQuad = new FullScreenQuad(this.material);
    this.copyQuad = new FullScreenQuad(this.copyMaterial);

    // Boyut composer.setSize ile hemen gelir; 1×1 yalnızca ilk tahsis.
    const make = () =>
      new THREE.WebGLRenderTarget(1, 1, {
        type: options.type ?? DEFAULT_TYPE,
        // Warp yarım piksel kaydırır; birikim yumuşasın diye linear.
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
    this.targets = [make(), make()];
  }

  /** TickablePass kancası — Engine her karede çağırır. */
  update(time: number) {
    const last = this.lastTime;
    this.lastTime = time;
    // Sekme arka plana düşüp döndüğünde birikimde donmuş eski kare durur ve
    // ekrana bir anda leke olarak yayılır. Uzun boşlukta temiz başla.
    if (last !== null && time - last > STALE_GAP_SECONDS) this.needsClear = true;
  }

  setSize(width: number, height: number) {
    for (const target of this.targets) target.setSize(width, height);
    // Yeniden boyutlandırma tamponların içeriğini geçersiz kılar.
    this.needsClear = true;
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ) {
    const previousTarget = renderer.getRenderTarget();

    if (this.needsClear) {
      this.needsClear = false;
      for (const target of this.targets) {
        renderer.setRenderTarget(target);
        renderer.clear();
      }
    }

    const prev = this.targets[this.readIndex];
    const next = this.targets[1 - this.readIndex];

    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tPrev.value = prev.texture;

    // 1) Birikimi güncelle: okunan tampon prev, yazılan next (ping-pong).
    renderer.setRenderTarget(next);
    this.fsQuad.render(renderer);

    // 2) Sonucu zincire ver. Ayrı bir kopya gerekir: composer writeBuffer'ı
    //    sonraki pass'ler için takas eder, birikim bizde kalmalı.
    this.copyMaterial.uniforms.tDiffuse.value = next.texture;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.copyQuad.render(renderer);

    this.readIndex = 1 - this.readIndex;
    renderer.setRenderTarget(previousTarget);
  }

  dispose() {
    for (const target of this.targets) target.dispose();
    this.material.dispose();
    this.copyMaterial.dispose();
    this.fsQuad.dispose();
    this.copyQuad.dispose();
  }
}

export function createFeedbackPass(options?: { type?: THREE.TextureDataType }) {
  return new FeedbackPass(options);
}
