import * as THREE from 'three';
import { POINTS_DEPTH_RANGE } from '../engine/buffers';
import type { ParamDef } from '../engine/params';

/**
 * POINT CLOUD MATERIAL — render katmanı. Sahiplik: Zeynep.
 *
 * `src/engine/points.ts` içindeki yer tutucu material'ın yerine geçer:
 *   engine.setPointsMaterial(createPointCloudMaterial())
 *
 * Sözleşme (ARCHITECTURE.md · Point Cloud Sözleşmesi):
 * - Konumlar CPU dizisinden değil, `uPositions` texture'ından okunur. Geometri
 *   yalnızca `aUv` grid'ini taşır; position attribute boş, frustumCulled = false
 *   (ikisini de points.ts kurar, burası ona dokunmaz).
 * - `uPositions` zorunlu. Ping-pong nedeniyle okunan texture her karede
 *   değiştiği için değerini **Engine yazar** — burada yalnızca tanımlanır.
 * - z orijine ortalıdır (−1..+1); renk rampası için `z / POINTS_DEPTH_RANGE + 0.5`.
 * - `w` kanalı parçacık başına OPASİTE'dir (α): Tur 11'den beri İKİ seviyeli
 *   — 1 = ön plan, BACKDROP_OPACITY (0.4) = arka plan noktası (tek buffer).
 *   Değeri veri katmanı yazar (sampler.ts, buffers.ts); shader burada alpha
 *   çarpanı olarak tüketir. Jitter tohumu artık aUv hash'iyle türetilir.
 * - RENK (Tur 11): `uImageTexture` varsa (uHasImage = 1) parçacık rengi
 *   fotoğraftan gelir — `texture2D(uImageTexture, vUv)`; vUv = aUv olduğu
 *   için texel (i,j) konumla birebir aynı fotoğraf pikselini okur. Değerini
 *   Engine.setPhoto yazar (fotoğraf setDepth'te aynı remap ile grid'e
 *   örneklenir). uHasImage = 0 iken (kamera/video) eski derinlik rampası.
 */

export interface PointCloudMaterialUniforms {
  /**
   * Simülasyonun ping-pong RT texture'ı. Değeri Engine her karede yazar;
   * material'ın kendisi asla atama yapmaz. İlk kare çizilmeden önce Engine
   * mutlaka yazdığı için başlangıçtaki null hiçbir draw call'a ulaşmaz.
   */
  uPositions: { value: THREE.Texture | null };
  /** 2..20 — birim mesafedeki nokta boyutu (piksel) */
  uPointSize: { value: number };
  /** 0..1 — aUv hash tohumuyla boyut saçılması; 0 = hepsi eşit boyutta */
  uSizeJitter: { value: number };
  /** derinlik rampasının yakın ucu (z = +1) */
  uNearColor: { value: THREE.Color };
  /** derinlik rampasının uzak ucu (z = −1) */
  uFarColor: { value: THREE.Color };
  /**
   * Fotoğraf renk texture'ı (Tur 11): 384×384 RGBA8, konum grid'iyle aynı
   * eşleme (sampler.ts sampleImageGrid). Değerini Engine.setPhoto yazar;
   * null iken (kamera/video) uHasImage = 0'dır ve derinlik rampası kullanılır.
   * Tur 12: video aktifken Engine buraya canlı VideoTexture bağlar.
   */
  uImageTexture: { value: THREE.Texture | null };
  /** 0 = fotoğraf yok (derinlik rampası), 1 = fotoğraf renkleri açık */
  uHasImage: { value: number };
  /**
   * Nesne ayırma (Tur 12 — şikayet 4): 1 → arka plan parçacıkları (w < 0.5)
   * tamamen atılır (beyaz kağıt/perde yok, yalnızca büst); 0 → tüm sahne
   * çizilir ve arka plan pikselleri parlayıp özneyi yutmasın diye karartılır.
   * Değerini Engine.setObjectSeparation yazar.
   */
  uObjectSeparation: { value: number };
  /**
   * Renk modu (Tur 12 — şikayet 3): 1 (varsayılan) → parçacık rengi doğrudan
   * görselin RGB dokusundan (uImageTexture); 0 → dokular yok sayılır, renk
   * uNearColor/uFarColor derinlik gradyanından türetilir. Değerini
   * Engine.setUseTextureColor yazar.
   */
  uUseTextureColor: { value: number };
  /** 0..1 — nokta kenarının yumuşaklığı; 0 = sert daire */
  uSoftness: { value: number };
  /** 0..3 — genel parlaklık çarpanı */
  uBrightness: { value: number };
}

/**
 * Parametre sözleşmesi (Gün 4): point cloud modunun preset'e giren kolları.
 * Renkler hex olarak serileştirilir (kind: 'color'). uPositions hesaplanır,
 * kullanıcı kolu değil — yok.
 */
export const POINTS_PARAMS: ParamDef[] = [
  { key: 'uPointSize', label: 'nokta boyutu', min: 2, max: 20, default: 6 },
  { key: 'uSizeJitter', label: 'boyut saçılması', min: 0, max: 1, default: 0.3 },
  { key: 'uNearColor', label: 'yakın rengi', min: 0, max: 1, default: 0, kind: 'color' },
  { key: 'uFarColor', label: 'uzak rengi', min: 0, max: 1, default: 0, kind: 'color' },
  { key: 'uSoftness', label: 'yumuşaklık', min: 0, max: 1, default: 0.5 },
  { key: 'uBrightness', label: 'parlaklık', min: 0, max: 3, default: 1 },
];

/** ShaderMaterial, uniform'ları tipli görünsün diye daraltılmış. */
export type PointCloudMaterial = THREE.ShaderMaterial & {
  uniforms: PointCloudMaterialUniforms;
};

const VERTEX = /* glsl */ `
  uniform sampler2D uPositions;
  uniform float uPointSize;
  uniform float uSizeJitter;

  attribute vec2 aUv;

  varying vec2 vUv;
  varying float vDepth;
  varying float vOpacity;

  void main() {
    vec4 pos = texture2D(uPositions, aUv);

    // Tur 11: renk, konumla aynı texel'i örnekler (uImageTexture grid ile
    // birebir eşleşir) — parçacık kendi fotoğraf pikselinin rengini alır.
    vUv = aUv;

    // z orijin etrafında ortalı (−RANGE/2 .. +RANGE/2) → rampa için 0..1'e geri.
    vDepth = clamp(pos.z / ${POINTS_DEPTH_RANGE.toFixed(1)} + 0.5, 0.0, 1.0);

    // w = parçacık opaklığı (α): 1 ön plan, 0.4 arka plan (Tur 11 — tek
    // buffer). Veri katmanı yazar, simülasyon korur.
    vOpacity = clamp(pos.w, 0.0, 1.0);

    // Tohum artık aUv hash'i: parçacık başına sabit, 0..1, boyut saçılması.
    float seed = fract(sin(aUv.x * 12.9898 + aUv.y * 78.233) * 43758.5453);

    vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);

    // Tohumla boyut saçılması. 1 etrafında simetrik: ortalama boyut sabit kalır,
    // uSizeJitter = 0 iken çarpan tam 1 olur (saçılma kapanır).
    float jitter = mix(1.0 - uSizeJitter, 1.0 + uSizeJitter, seed);

    // max() kırpması ZORUNLU: kameranın arkasına/üstüne düşen noktalarda
    // -mv.z ~ 0 olur, bölme patlar ve dev noktalar ekranı beyazlatır.
    gl_PointSize = uPointSize * jitter / max(-mv.z, 0.1);

    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uNearColor;
  uniform vec3 uFarColor;
  uniform sampler2D uImageTexture;
  uniform float uHasImage;
  uniform float uObjectSeparation;
  uniform float uUseTextureColor;
  uniform float uSoftness;
  uniform float uBrightness;

  varying vec2 vUv;
  varying float vDepth;
  varying float vOpacity;

  void main() {
    // Tur 12 (şikayet 4): nesne ayırma AÇIK iken arka plan parçacıkları
    // (w = BACKDROP_OPACITY < 0.5) tamamen atılır — ekranda beyaz kağıt/
    // perde kalmaz, yalnızca 3B büst görünür.
    if (uObjectSeparation > 0.5 && vOpacity < 0.5) discard;

    // Nokta merkezinden radyal mesafe, kenarda 1.0 olacak şekilde.
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;

    // Soft particle: sert daire yerine yumuşayan kenar. uSoftness = 0'da
    // smoothstep'in iki eşiği çakışıp tanımsız davranmasın diye alt sınır var.
    float soft = max(uSoftness, 0.001);
    float alpha = 1.0 - smoothstep(1.0 - soft, 1.0, r);

    // Opaklık (Tur 11): ön plan 1.0, arka plan noktaları 0.4 — iki katman
    // tek buffer'da, tek draw call; mantık hatası yok, w doğrudan alpha.
    alpha *= vOpacity;

    // Renk (Tur 12 — şikayet 3): uUseTextureColor AÇIK ve doku varsa parçacık
    // kendi pikselinin RGB'sini alır (fotoğraf grid'i ya da canlı video);
    // KAPALI ise doku yok sayılır, renk Near/Far derinlik gradyanından gelir.
    vec3 col = (uHasImage > 0.5 && uUseTextureColor > 0.5)
      ? texture2D(uImageTexture, vUv).rgb
      : mix(uFarColor, uNearColor, vDepth);
    // Tur 12 (şikayet 4): nesne ayırma KAPALI iken arka plan pikselleri
    // derinlikle karartılır (×0.4) — parlak duvar büstü yutmasın.
    if (uObjectSeparation < 0.5 && vOpacity < 0.5) col *= 0.4;
    col *= uBrightness;

    // AdditiveBlending (src = SrcAlpha, dst = One): ekrana eklenen katkı
    // col * alpha olur, yumuşak kenar doğal olarak sönümlenir.
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createPointCloudMaterial(): PointCloudMaterial {
  // Her material kendi uniform objesini alır; iki instance state paylaşmaz.
  const uniforms: PointCloudMaterialUniforms = {
    uPositions: { value: null },
    uPointSize: { value: 6 },
    uSizeJitter: { value: 0.3 },
    uNearColor: { value: new THREE.Color(0.85, 0.95, 1.0) },
    uFarColor: { value: new THREE.Color(0.06, 0.1, 0.28) },
    // Tur 11: fotoğraf bağlanana kadar kapalı — Engine.setPhoto açar.
    uImageTexture: { value: null },
    uHasImage: { value: 0 },
    // Tur 12: nesne ayırma kapalı (tüm sahne), renk modu açık (doku) —
    // değerleri Engine yönetir.
    uObjectSeparation: { value: 0 },
    uUseTextureColor: { value: 1 },
    uSoftness: { value: 0.5 },
    uBrightness: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    name: 'point-cloud',
    // ShaderMaterial index signature'lı bir uniform sözlüğü bekler; dışarıya
    // açtığımız katı arayüzü bozmamak için daraltma yalnızca burada.
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    // Additive bulutta derinlik yazılırsa arkadaki parçacıklar kırpılır ve
    // yığılma kaybolur; test açık kalır, yazma kapalı.
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // ShaderMaterial uniform'ları gevşek tipler; burada kurduğumuz obje birebir bu.
  return material as PointCloudMaterial;
}
