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

/** Position: RGBA32F, 384×384. xyz = konum (shader uzayı), w = seed (0..1). */
export function createPositionTexture(): THREE.DataTexture {
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
