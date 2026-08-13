import * as THREE from 'three';
import {
  POSITION_TEXTURE_SIZE,
  POINTS_DEPTH_RANGE,
} from './buffers';

/**
 * Point cloud (veri katmanı — Emre). KRİTİK kural (ARCHITECTURE.md):
 * vertex konumları CPU dizisinden DEĞİL, uPositions texture'ından shader'da
 * okunur. Gün 3'ten beri bu texture bir render target texture'ıdır
 * (THREE.Texture) — simülasyon her karede üzerine yazar. Geometri yalnızca
 * grid UV'leri taşır (aUv); position attribute boştur, frustum culling
 * kapatılmıştır.
 *
 * Buradaki material YER TUTUCUDUR: Zeynep'in Point Cloud shader'ı
 * `engine.setPointsMaterial(mat)` ile bunun yerine geçer.
 */

const POINT_VERTEX = /* glsl */ `
  uniform sampler2D uPositions;
  uniform float uPointSize;
  attribute vec2 aUv;
  varying float vDepth;
  void main() {
    vec4 pos = texture2D(uPositions, aUv);
    // z, orijin etrafında ortalı (−1..+1) → renk rampası 0..1.
    vDepth = pos.z / ${POINTS_DEPTH_RANGE.toFixed(1)} + 0.5;
    vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);
    // Kameranın arkasına/üstüne düşen noktalarda -mv.z ~ 0 → dev nokta boyutu.
    gl_PointSize = uPointSize / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  varying float vDepth;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    vec3 col = mix(vec3(0.05, 0.06, 0.10), vec3(0.92, 0.94, 0.98), vDepth);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface PointsCloudUniforms {
  uPositions: { value: THREE.Texture };
  uPointSize: { value: number };
}

export function createPointsCloud(
  positionTexture: THREE.Texture,
): THREE.Points {
  const n = POSITION_TEXTURE_SIZE;
  const count = n * n;

  const positions = new Float32Array(count * 3); // dolu değil; konum texture'dan
  const aUv = new Float32Array(count * 2);
  let k = 0;
  for (let j = 0; j < n; j++) {
    const v = 1 - (j + 0.5) / n; // v=1 → üst satır (flip tek yerde: buffers.ts)
    for (let i = 0; i < n; i++) {
      aUv[k++] = (i + 0.5) / n;
      aUv[k++] = v;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aUv', new THREE.BufferAttribute(aUv, 2));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPositions: { value: positionTexture },
      uPointSize: { value: 6 },
    },
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // konumlar GPU'da texture'dan gelir
  return points;
}
