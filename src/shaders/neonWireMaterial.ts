import * as THREE from 'three';
import { POSITION_TEXTURE_SIZE } from '../engine/buffers';
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
 * KONUM komşularının z'sine Sobel uygular ve kenar üzerinde değilse ELENİR.
 * Eleme vertex'te yapılır (fragment'ta discard etmek yerine): kenar dışı
 * parçacıklar hiç rasterleştirilmez. Sonuç 3B uzayda süzülen neon kenar
 * çizgileridir — kamera döndükçe çizgiler de gerçekten döner, ekran uzayında
 * yapışıp kalmaz.
 *
 * BAĞIMLILIK YOK (Gün C): kenarlar `uPositions`'tan türetildiği için material
 * dışarıdan depth beslemesi İSTEMEZ (eski `setDepthTexture`/`uDepth` kaldırıldı).
 * Sebep: depth texture'ı ham görüntü uzayındadır, konum grid'i ise önem
 * remap'iyle büküktür — depth'i grid uv'siyle okumak kenarları parçacıkların
 * bulunduğu yerden kaydırıyordu. Ek fayda: kenarlar fare deformasyonunu ve
 * video akışını da doğal olarak takip eder.
 */

export interface NeonWireMaterialUniforms {
  /**
   * Simülasyonun ping-pong RT texture'ı. Değerini Engine her karede yazar;
   * material asla atama yapmaz.
   */
  uPositions: { value: THREE.Texture | null };
  /** 1..10 — kenar noktalarının boyutu */
  uPointSize: { value: number };
  /** 0..1 — Sobel eşiği; düşükte çok çizgi, yüksekte az */
  uEdgeThreshold: { value: number };
  /** çizgi rengi */
  uNeonColor: { value: THREE.Color };
  /**
   * ORTAK UNIFORM'LAR (Engine sahipli). Engine.pushSharedUniforms bu dördünü
   * kayıtlı TÜM modlara duck-typing ile yazar; kapı `uImageTexture`'ın
   * varlığıdır. İsimler diğer iki modla birebir aynı olmak zorunda, yoksa
   * neon bu yolların dışında kalır ve modlar farklı davranır.
   */
  /** Fotoğraf grid'i ya da canlı video dokusu; konum grid'iyle aynı eşleme. */
  uImageTexture: { value: THREE.Texture | null };
  /** 0 = doku yok (uNeonColor), 1 = görsel dokusu bağlı */
  uHasImage: { value: number };
  /** 1 = arka plan parçacıkları atılır (yalnızca özne), 0 = çizilir ve karartılır */
  uObjectSeparation: { value: number };
  /** 1 = renk görselden, 0 = doku yok sayılır ve uNeonColor kullanılır */
  uUseTextureColor: { value: number };
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
  /** Gün A (fog) — global look köprüsünden (Engine.lookUniforms) yazılır. */
  uFogDensity: { value: number };
  uFogColor: { value: THREE.Color };
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

/** ShaderMaterial, uniform'ları tipli görünsün diye daraltılmış. */
export type NeonWireMaterial = THREE.ShaderMaterial & {
  uniforms: NeonWireMaterialUniforms;
};

const VERTEX = /* glsl */ `
  uniform sampler2D uPositions;
  uniform float uPointSize;
  uniform float uEdgeThreshold;
  uniform float uGlowRadius;

  attribute vec2 aUv;

  varying vec2 vUv;
  varying float vEdge;
  varying float vSeed;
  varying float vOpacity;
  varying float vViewDepth;

  /** Parçacık grid'inin texel adımı — komşu örneklemesi bu adımla yapılır. */
  const float TEX_STEP = 1.0 / ${POSITION_TEXTURE_SIZE.toFixed(1)};

  /**
   * Sobel'in tek kanallı örneği: KONUM texture'ının z'si (Gün C düzeltmesi).
   * Eskiden depth texture'ı GRID uv'siyle okunuyordu — iki farklı uzay: konum
   * grid'i önem remap'iyle büküktür (sampler.buildImportanceRemap), depth ise
   * ham görüntü uzayındadır. Kenarlar bu yüzden parçacıkların bulunduğu yerden
   * KAYIYORDU (ve texel adımı depth çözünürlüğünden alınıyordu, grid'den
   * değil). Konumun z'sini örneklemek hizayı tanım gereği garanti eder; ayrıca
   * Engine→material depth besleme bağımlılığı (setDepthTexture) tamamen düşer
   * ve kenarlar fare deformasyonunu da takip eder.
   */
  float zAt(vec2 uv) {
    return texture2D(uPositions, clamp(uv, 0.0, 1.0)).z;
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

    // Renk, konumla AYNI texel'den okunur: uImageTexture konum grid'iyle
    // birebir eşlenir (sampler.ts sampleImageGrid), diğer iki modla aynı.
    vUv = aUv;

    // 3×3 Sobel, parçacığın kendi grid UV'si etrafında; komşu mesafesi GRID
    // texel'i (konum texture'ının adımı).
    vec2 t = vec2(TEX_STEP);
    float tl = zAt(aUv + vec2(-t.x,  t.y));
    float tm = zAt(aUv + vec2( 0.0,  t.y));
    float tr = zAt(aUv + vec2( t.x,  t.y));
    float ml = zAt(aUv + vec2(-t.x,  0.0));
    float mr = zAt(aUv + vec2( t.x,  0.0));
    float bl = zAt(aUv + vec2(-t.x, -t.y));
    float bm = zAt(aUv + vec2( 0.0, -t.y));
    float br = zAt(aUv + vec2( t.x, -t.y));

    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * tm + tr) - (bl + 2.0 * bm + br);

    // 0.125 normalizasyonu: z ±1 sözleşmesinde tam basamak
    // (komşu farkı ~1) |g| = 8 verir; 8·0.125 = 1 → uEdgeThreshold'un anlamı
    // ve varsayılanı (0.1) bu ölçekle korunur.
    float edge = length(vec2(gx, gy)) * 0.125;
    vEdge = clamp(edge, 0.0, 1.0);

    // Kenar değilse ELE: nokta merkezi clip hacminin dışına atılır ve boyutu
    // sıfırlanır. Fragment aşamasına hiç gelmez — discard'dan ucuz.
    if (edge < uEdgeThreshold) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);
    vViewDepth = -mv.z;

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
  uniform sampler2D uImageTexture;
  uniform float uHasImage;
  uniform float uObjectSeparation;
  uniform float uUseTextureColor;
  uniform float uFogDensity;
  uniform vec3 uFogColor;

  varying vec2 vUv;
  varying float vEdge;
  varying float vSeed;
  varying float vOpacity;
  varying float vViewDepth;

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
    // Nesne ayırma AÇIK: arka plan parçacıkları (w < 0.5) tamamen atılır —
    // yalnızca özne kalır. pointCloudMaterial/asciiMaterial ile aynı eşik.
    if (uObjectSeparation > 0.5 && vOpacity < 0.5) discard;

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

    // -- taban renk: görsel dokusu ya da neon rengi --
    // Diğer iki moddaki koşulun aynısı: doku bağlıysa VE renk modu açıksa
    // parçacık kendi fotoğraf pikselini alır, değilse uNeonColor.
    vec3 base = (uHasImage > 0.5 && uUseTextureColor > 0.5)
      ? texture2D(uImageTexture, vUv).rgb
      : uNeonColor;

    // -- ton sapması: taban rengin etrafında, parçacık tohumuna göre --
    // Sapma miktarı uColorVariance ile çarpıldığı için 0'da kayma tam sıfırdır
    // ve hsv gidiş-dönüşü birim dönüşüm olur: tam olarak taban renk çıkar.
    vec3 hsv = rgb2hsv(base);
    hsv.x = fract(hsv.x + (vSeed - 0.5) * uColorVariance * HUE_SPAN);
    vec3 tint = hsv2rgb(hsv);

    // -- titreşim: tohum fazı kaydırır, parçacıklar birlikte yanıp sönmez --
    // uFlickerSpeed = 0 → dalga durur, parçacık başına sabit bir parlaklık
    // sapması kalır (grain'in uGrainSpeed = 0 davranışıyla aynı mantık).
    float wave = sin(uTime * uFlickerSpeed + vSeed * TAU) * 0.5 + 0.5;
    float flicker = mix(1.0, wave, uFlickerIntensity);

    // Nesne ayırma KAPALI: arka plan pikselleri karartılır (×0.4) — parlak
    // duvar özneyi yutmasın. Diğer iki moddaki çarpanın aynısı.
    if (uObjectSeparation < 0.5 && vOpacity < 0.5) tint *= 0.4;

// Kenar şiddeti rengi süzer: zayıf kenarlar sönük, keskin kenarlar parlak.
    // vOpacity (pos.w): arka plan parçacıkları 0.4 ile sınırlanır — diğer iki
    // mod da w'yi alpha çarpanı olarak tükettiği için modlar arası tutarlı.
    vec3 neon = tint * uGlowIntensity * vEdge * flicker;

    // Gün A (fog): kamera uzaklığıyla üstel sis — uFogDensity = 0 iken
    // görünüm hiç değişmez. Uzak kenarlar arka rengine yığılır.
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
    neon = mix(neon, uFogColor, fogF);

    gl_FragColor = vec4(neon, shape * vOpacity);
  }
`;

export function createNeonWireMaterial(): NeonWireMaterial {
  // Her material kendi uniform objesini alır; iki instance state paylaşmaz.
  const uniforms: NeonWireMaterialUniforms = {
    uPositions: { value: null },
    uPointSize: { value: 3 },
    uEdgeThreshold: { value: 0.1 },
    uNeonColor: { value: new THREE.Color(0.2, 1.0, 0.85) },
    // Varsayılanlar pointCloudMaterial/asciiMaterial ile aynı; Engine ilk
    // setPhoto/setObjectSeparation çağrısında üzerine yazar.
    uImageTexture: { value: null },
    uHasImage: { value: 0 },
    uObjectSeparation: { value: 0 },
    uUseTextureColor: { value: 1 },
    // Yarıçap 0: sprite büyümez, hale yok — eski uGlow davranışıyla aynı.
    uGlowRadius: { value: 0 },
    uGlowIntensity: { value: 1.5 },
    uTime: { value: 0 },
    uFlickerSpeed: { value: 2 },
    // İkisi de 0: efekt varsayılan olarak kapalı, mevcut görünüm değişmez.
    uFlickerIntensity: { value: 0 },
    uColorVariance: { value: 0 },
    // Gün A (fog): kapalı başlar — Engine.lookUniforms her karede işler.
    uFogDensity: { value: 0 },
    uFogColor: { value: new THREE.Color(0.02, 0.03, 0.07) },
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

  return neon;
}
