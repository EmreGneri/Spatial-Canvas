import * as THREE from 'three';
import type { ParamDef } from '../engine/params';

/**
 * NEON WIREFRAME MATERIAL — render katmanı, üçüncü render modu. Sahiplik: Zeynep.
 *
 *   engine.setPointsMaterial(createNeonWireMaterial())
 *
 * Sözleşme `pointCloudMaterial.ts` / `asciiMaterial.ts` ile birebir aynı
 * (ARCHITECTURE.md · Point Cloud Sözleşmesi): konumlar `uPositions`
 * texture'ından okunur, geometri yalnızca `aUv` taşır, z orijine ortalıdır
 * (−1..+1), `w` parçacık tohumudur ve `gl_PointSize` bölmesinde
 * `max(-mv.z, 0.1)` kırpması korunur.
 *
 * Fark: post-process kenar bulma DEĞİL. Her parçacık vertex shader'da kendi
 * depth komşularına Sobel uygular ve kenar üzerinde değilse ELENİR. Eleme
 * vertex'te yapılır (fragment'ta discard etmek yerine): kenar dışı parçacıklar
 * hiç rasterleştirilmez. Sonuç 3B uzayda süzülen neon kenar çizgileridir —
 * kamera döndükçe çizgiler de gerçekten döner, ekran uzayında yapışıp kalmaz.
 *
 * BAĞIMLILIK: Engine yalnızca `uPositions`'ı yazar. `uDepth` ve ondan türeyen
 * `uTexelSize` bu material'ın dışarıdan beslenmesini ister —
 * `setDepthTexture(engine.depthTexture)` her `setDepth()` sonrası çağrılmalı.
 * Beslenmezse (depth henüz yok) hiçbir şey çizilmez, hata da vermez.
 */

export interface NeonWireMaterialUniforms {
  /**
   * Simülasyonun ping-pong RT texture'ı. Değerini Engine her karede yazar;
   * material asla atama yapmaz.
   */
  uPositions: { value: THREE.Texture | null };
  /** Depth haritası (R32F, 0 = uzak, 1 = yakın). setDepthTexture() besler. */
  uDepth: { value: THREE.Texture | null };
  /** Komşu örnekleme mesafesi = 1 / depth çözünürlüğü. setDepthTexture() türetir. */
  uTexelSize: { value: THREE.Vector2 };
  /** 0 veya 1 — depth bağlı mı. 0'da tüm parçacıklar elenir (boş kare). */
  uHasDepth: { value: number };
  /** 1..10 — kenar noktalarının boyutu */
  uPointSize: { value: number };
  /** 0..1 — Sobel eşiği; düşükte çok çizgi, yüksekte az */
  uEdgeThreshold: { value: number };
  /** çizgi rengi */
  uNeonColor: { value: THREE.Color };
  /**
   * 0..1 — parlamanın çapı. Sprite'ı büyütür ve fazla alanı haleye ayırır;
   * 0'da sprite eski boyutunda kalır ve görünüm bu efekt eklenmeden önceki
   * haliyle birebir aynıdır.
   */
  uGlowRadius: { value: number };
  /** 0..3 — parlamanın parlaklık çarpanı; additive olduğu için üst üste binince patlar */
  uGlowIntensity: { value: number };
  /**
   * Saniye cinsinden zaman — titreşimi sürer. Engine material'lara zaman
   * geçirmiyor (`tickPasses` yalnızca composer pass'lerini gezer), bu yüzden
   * material kendi rAF'ıyla yazar. Kullanıcı kolu değil, PARAMS'ta yok.
   */
  uTime: { value: number };
  /** 0..10 — titreşim hızı; 0'da dalga donar, parçacık başına sabit sapma kalır */
  uFlickerSpeed: { value: number };
  /** 0..1 — titreşim derinliği; 0 = titreşim yok, parlaklık sabit */
  uFlickerIntensity: { value: number };
  /** 0..1 — tohumdan gelen ton sapması; 0 = tam olarak seçili renk */
  uColorVariance: { value: number };
}

/** Parametre sözleşmesi (Gün 4): neon modunun preset'e giren kolları. */
export const NEON_PARAMS: ParamDef[] = [
  { key: 'uPointSize', label: 'çizgi kalınlığı', min: 1, max: 10, default: 3 },
  { key: 'uEdgeThreshold', label: 'kenar eşiği', min: 0, max: 1, default: 0.1 },
  { key: 'uNeonColor', label: 'neon rengi', min: 0, max: 1, default: 0, kind: 'color' },
  { key: 'uGlowRadius', label: 'Glow Radius', min: 0, max: 1, default: 0 },
  { key: 'uGlowIntensity', label: 'Glow Intensity', min: 0, max: 3, default: 1.5 },
  { key: 'uFlickerSpeed', label: 'Flicker Speed', min: 0, max: 10, default: 2 },
  { key: 'uFlickerIntensity', label: 'Flicker Intensity', min: 0, max: 1, default: 0 },
  { key: 'uColorVariance', label: 'Color Variance', min: 0, max: 1, default: 0 },
];

/** ShaderMaterial, uniform'ları tipli görünsün ve depth beslemesi kapsansın diye. */
export type NeonWireMaterial = THREE.ShaderMaterial & {
  uniforms: NeonWireMaterialUniforms;
  /**
   * Depth haritasını bağlar ve `uTexelSize`'ı çözünürlüğünden türetir.
   * `null` (ya da boyutsuz texture) → `uHasDepth = 0`, hiçbir şey çizilmez.
   * Engine `setDepth()` boyut aynıysa aynı texture nesnesini yerinde
   * günceller, değişince yenisini üretir — bu yüzden her seferinde çağrılır.
   */
  setDepthTexture: (texture: THREE.Texture | null) => void;
};

const VERTEX = /* glsl */ `
  uniform sampler2D uPositions;
  uniform sampler2D uDepth;
  uniform vec2 uTexelSize;
  uniform float uHasDepth;
  uniform float uPointSize;
  uniform float uEdgeThreshold;
  uniform float uGlowRadius;

  attribute vec2 aUv;

  varying float vEdge;
  varying float vSeed;
  varying float vOpacity;

  /** Sobel'in tek kanallı depth örneği (R32F: 0 = uzak, 1 = yakın). */
  float depthAt(vec2 uv) {
    return texture2D(uDepth, clamp(uv, 0.0, 1.0)).r;
  }

  void main() {
    vec4 pos = texture2D(uPositions, aUv);
    // SÖZLEŞME DEĞİŞTİ (ARCHITECTURE.md): pos.w artık tohum DEĞİL, opaklık —
    // 1 = ön plan, 0.4 = arka plan (tek buffer). Tohum aUv hash'inden türetilir;
    // formül pointCloudMaterial/asciiMaterial ile birebir aynı tutulur ki üç
    // mod aynı parçacıkta aynı rastgeleliği görsün.
    // w'yi tohum sanmak titreşimi ve ton sapmasını iki değere çökertirdi:
    // tüm ön plan aynı anda yanıp söner, tüm arka plan aynı tonda kalırdı.
    vSeed = fract(sin(aUv.x * 12.9898 + aUv.y * 78.233) * 43758.5453);
    vOpacity = clamp(pos.w, 0.0, 1.0);

    // 3×3 Sobel, parçacığın kendi grid UV'si etrafında. Komşu mesafesi depth
    // texel'i kadar: uTexelSize depth çözünürlüğünden gelir, parçacık
    // grid'inden değil, yoksa kenarlar çözünürlük değişince kayar.
    vec2 t = uTexelSize;
    float tl = depthAt(aUv + vec2(-t.x,  t.y));
    float tm = depthAt(aUv + vec2( 0.0,  t.y));
    float tr = depthAt(aUv + vec2( t.x,  t.y));
    float ml = depthAt(aUv + vec2(-t.x,  0.0));
    float mr = depthAt(aUv + vec2( t.x,  0.0));
    float bl = depthAt(aUv + vec2(-t.x, -t.y));
    float bm = depthAt(aUv + vec2( 0.0, -t.y));
    float br = depthAt(aUv + vec2( t.x, -t.y));

    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * tm + tr) - (bl + 2.0 * bm + br);

    // 0.25 normalizasyonu: tam siyah→beyaz basamakta |g| = 4 olur, bölünce
    // gradyan ~0..1 aralığına oturur ve uEdgeThreshold anlamlı bir aralık olur.
    float edge = length(vec2(gx, gy)) * 0.25 * uHasDepth;
    vEdge = clamp(edge, 0.0, 1.0);

    // Kenar değilse ELE: nokta merkezi clip hacminin dışına atılır ve boyutu
    // sıfırlanır. Fragment aşamasına hiç gelmez — discard'dan ucuz.
    if (edge < uEdgeThreshold) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);

    // Hale sprite'ın DIŞINA taşamaz; parlama çapı büyüdükçe sprite da büyür,
    // yoksa uGlowRadius yalnızca noktanın içini bulanıklaştırırdı. Fragment
    // çekirdeği aynı oranda küçülterek çizgi kalınlığını sabit tutar.
    float spriteScale = 1.0 + uGlowRadius * 2.0;

    // max() kırpması ZORUNLU: kameranın arkasına/üstüne düşen noktalarda
    // -mv.z ~ 0 olur, bölme patlar ve dev noktalar ekranı beyazlatır.
    gl_PointSize = uPointSize * spriteScale / max(-mv.z, 0.1);

    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uNeonColor;
  uniform float uGlowRadius;
  uniform float uGlowIntensity;
  uniform float uTime;
  uniform float uFlickerSpeed;
  uniform float uFlickerIntensity;
  uniform float uColorVariance;

  varying float vEdge;
  varying float vSeed;
  varying float vOpacity;

  const float TAU = 6.28318530718;
  /** Ton sapmasının tam genişliği (HSV turu). 0.3 → ±54°, komşu renklere ulaşır. */
  const float HUE_SPAN = 0.3;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    // Nokta merkezinden radyal mesafe, kenarda 1.0.
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;

    // Parlama iki parçaya ayrılır:
    //   çekirdek — çizginin kendisi. Sprite uGlowRadius ile büyüdüğü için
    //     çekirdek aynı oranda içeri sıkıştırılır: çizgi kalınlığı
    //     (uPointSize) parlama çapından bağımsız kalır.
    //   hale     — sprite'ın tamamına yayılan yumuşak düşüş, ağırlığı
    //     doğrudan uGlowRadius.
    // uGlowRadius = 0'da coreFrac = 1 ve hale ağırlığı 0 olur; ifade tam
    // olarak eski (1-r)² çekirdeğine iner, görünüm birebir korunur.
    float coreFrac = 1.0 / (1.0 + uGlowRadius * 2.0);
    float coreR = clamp(1.0 - r / coreFrac, 0.0, 1.0);
    float core = coreR * coreR;
    float haloR = 1.0 - r;
    float halo = haloR * haloR;
    float shape = clamp(core + halo * uGlowRadius, 0.0, 1.0);

    // -- ton sapması: ana rengin etrafında, parçacık tohumuna göre --
    // Sapma miktarı uColorVariance ile çarpıldığı için 0'da kayma tam sıfırdır
    // ve hsv gidiş-dönüşü birim dönüşüm olur: tam olarak uNeonColor çıkar.
    vec3 hsv = rgb2hsv(uNeonColor);
    hsv.x = fract(hsv.x + (vSeed - 0.5) * uColorVariance * HUE_SPAN);
    vec3 tint = hsv2rgb(hsv);

    // -- titreşim: tohum fazı kaydırır, parçacıklar birlikte yanıp sönmez --
    // uFlickerSpeed = 0 → dalga durur, parçacık başına sabit bir parlaklık
    // sapması kalır (grain'in uGrainSpeed = 0 davranışıyla aynı mantık).
    float wave = sin(uTime * uFlickerSpeed + vSeed * TAU) * 0.5 + 0.5;
    float flicker = mix(1.0, wave, uFlickerIntensity);

    // Kenar şiddeti rengi süzer: zayıf kenarlar sönük, keskin kenarlar parlak.
    // vOpacity (pos.w): arka plan parçacıkları 0.4 ile sönümlenir — diğer iki
    // mod da w'yi alpha çarpanı olarak tükettiği için modlar arası tutarlı.
    gl_FragColor = vec4(tint * uGlowIntensity * vEdge * flicker, shape * vOpacity);
  }
`;

export function createNeonWireMaterial(): NeonWireMaterial {
  // Her material kendi uniform objesini alır; iki instance state paylaşmaz.
  const uniforms: NeonWireMaterialUniforms = {
    uPositions: { value: null },
    uDepth: { value: null },
    uTexelSize: { value: new THREE.Vector2(1 / 512, 1 / 512) },
    uHasDepth: { value: 0 },
    uPointSize: { value: 3 },
    uEdgeThreshold: { value: 0.1 },
    uNeonColor: { value: new THREE.Color(0.2, 1.0, 0.85) },
    // Yarıçap 0: sprite büyümez, hale yok — eski uGlow davranışıyla aynı.
    uGlowRadius: { value: 0 },
    uGlowIntensity: { value: 1.5 },
    uTime: { value: 0 },
    uFlickerSpeed: { value: 2 },
    // İkisi de 0: efekt varsayılan olarak kapalı, mevcut görünüm değişmez.
    uFlickerIntensity: { value: 0 },
    uColorVariance: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    name: 'neon-wire',
    // ShaderMaterial index signature'lı bir uniform sözlüğü bekler; dışarıya
    // açtığımız katı arayüzü bozmamak için daraltma yalnızca burada.
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const neon = material as NeonWireMaterial;

  // ZAMAN KAYNAĞI. Engine yalnızca pass'lere update(time) geçiyor
  // (Engine.tickPasses → composer.passes); material'lara zaman ulaşmıyor ve
  // sahnede tek yazdığı şey uPositions. Titreşimin ilerlemesi için uTime'ı
  // material kendi sürüyor. Kaynak: sayfa açılışına göre geçen saniye.
  if (typeof requestAnimationFrame === 'function') {
    const started = performance.now();
    let frame = requestAnimationFrame(function tick() {
      uniforms.uTime.value = (performance.now() - started) / 1000;
      frame = requestAnimationFrame(tick);
    });
    // Material bırakılınca döngü de durmalı, yoksa sayfa boyunca sürer.
    neon.addEventListener('dispose', () => cancelAnimationFrame(frame));
  }

  neon.setDepthTexture = (texture: THREE.Texture | null) => {
    const image = texture?.image as { width?: number; height?: number } | undefined;
    const width = image?.width ?? 0;
    const height = image?.height ?? 0;
    if (!texture || width <= 0 || height <= 0) {
      // Depth yok: sampler'ı boş bırak, eleme bayrağını indir. Vertex'te
      // edge = 0 olur, hiçbir parçacık geçmez — boş kare, hata yok.
      uniforms.uDepth.value = null;
      uniforms.uHasDepth.value = 0;
      return;
    }
    uniforms.uDepth.value = texture;
    uniforms.uTexelSize.value.set(1 / width, 1 / height);
    uniforms.uHasDepth.value = 1;
  };

  return neon;
}
