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
 * - `w` kanalı parçacık başına sabit tohum (0..1) — boyut rastgeleliği buradan.
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
  /** 0..1 — w tohumuyla boyut saçılması; 0 = hepsi eşit boyutta */
  uSizeJitter: { value: number };
  /** derinlik rampasının yakın ucu (z = +1) */
  uNearColor: { value: THREE.Color };
  /** derinlik rampasının uzak ucu (z = −1) */
  uFarColor: { value: THREE.Color };
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

  varying float vDepth;

  void main() {
    vec4 pos = texture2D(uPositions, aUv);

    // z orijin etrafında ortalı (−RANGE/2 .. +RANGE/2) → rampa için 0..1'e geri.
    vDepth = clamp(pos.z / ${POINTS_DEPTH_RANGE.toFixed(1)} + 0.5, 0.0, 1.0);

    // w = parçacık başına sabit tohum (0..1) — sözleşme gereği simülasyon korur.
    float seed = pos.w;

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
  uniform float uSoftness;
  uniform float uBrightness;

  varying float vDepth;

  void main() {
    // Nokta merkezinden radyal mesafe, kenarda 1.0 olacak şekilde.
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;

    // Soft particle: sert daire yerine yumuşayan kenar. uSoftness = 0'da
    // smoothstep'in iki eşiği çakışıp tanımsız davranmasın diye alt sınır var.
    float soft = max(uSoftness, 0.001);
    float alpha = 1.0 - smoothstep(1.0 - soft, 1.0, r);

    vec3 col = mix(uFarColor, uNearColor, vDepth) * uBrightness;

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
