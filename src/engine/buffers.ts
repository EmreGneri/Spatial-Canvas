import * as THREE from 'three';

/**
 * Texture sözleşmesi — ARCHITECTURE.md ile birebir.
 *
 * y-flip politikası: tek yerde çözülür, o da burası. Texture upload'larında
 * flipY=true → v=1 = görselin ÜSTÜ. Başka hiçbir yerde (shader, UV, CPU)
 * flip yoktur.
 */

export const POSITION_TEXTURE_SIZE = 384; // 384×384 = 147.456 parçacık

/** Depth: R32F, tek kanal, 0 = uzak / 1 = yakın. Satır 0 = görselin üstü. */
export function createDepthTexture(
  data: Float32Array,
  width: number,
  height: number,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.FloatType);
  tex.flipY = true; // v=1 → üst satır
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Point cloud dünya boyutları (Gün 2): yükseklik 2 birim, depth 0..1 → z -1..+1.
 * z ORİJİN ETRAFINDA ORTALANIR: OrbitControls hedefi (0,0,0) bulutun ortasına
 * denk gelsin diye. Ortalanmazsa yörünge bulutun arka yüzeyi etrafında döner.
 */
export const POINTS_WORLD_HEIGHT = 2;
export const POINTS_DEPTH_RANGE = 2;

/**
 * Home: RGBA32F, 384×384. xyz = dinlenme konumu (parçacık buraya yaylanır),
 * w = seed (0..1). Gün 3: positionTexture artık ping-pong RT texture'ı;
 * simülasyon her karede onu üzerine yazar, home CPU'dan bir kez doldurulur.
 */
export function createHomeTexture(): THREE.DataTexture {
  const n = POSITION_TEXTURE_SIZE * POSITION_TEXTURE_SIZE;
  const data = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4 + 3] = Math.random(); // Day 3 GPGPU seed kaynağı
  }
  const tex = new THREE.DataTexture(
    data,
    POSITION_TEXTURE_SIZE,
    POSITION_TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.flipY = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Depth çıktısından home texture'ı doldurur (dinlenme konumları). Grid
 * yazımı, points shader'ının okuduğu aUv grid'iyle birebir aynı formülden
 * üretilir: u = (i+0.5)/N, v = 1-(j+0.5)/N  (v=1 → üst satır, y-flip tek
 * yerde). w (seed) korunur.
 */
export function fillPositionsFromDepth(
  tex: THREE.DataTexture,
  depth: Float32Array,
  depthWidth: number,
  depthHeight: number,
) {
  const n = POSITION_TEXTURE_SIZE;
  const data = tex.image.data as Float32Array;
  const halfW = (depthWidth / depthHeight) * (POINTS_WORLD_HEIGHT / 2);
  const halfH = POINTS_WORLD_HEIGHT / 2;
  for (let j = 0; j < n; j++) {
    const v = 1 - (j + 0.5) / n;
    const depthRow = Math.min(depthHeight - 1, Math.floor((j / n) * depthHeight));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const depthCol = Math.min(depthWidth - 1, Math.floor((i / n) * depthWidth));
      const o = (j * n + i) * 4;
      data[o] = (u - 0.5) * 2 * halfW;
      data[o + 1] = (v - 0.5) * POINTS_WORLD_HEIGHT;
      data[o + 2] = (depth[depthRow * depthWidth + depthCol] - 0.5) * POINTS_DEPTH_RANGE;
      // o+3: seed korunur
    }
  }
  tex.needsUpdate = true;
}
