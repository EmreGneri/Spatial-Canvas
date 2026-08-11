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
 *
 * Depth örneklemesi bilinear: nearest bir grid hücresini tek piksele
 * indirirken yüz hatları gibi ince geçişlerde aliasing yapıyordu (kenarın
 * bir tarafı tüm hücreyi ezdiriyordu). Bilinear komşu 4 pikseli ağırlıkla
 * karıştırır — 384 grid'ine inerken detayı kaybetmeden pürüzsüz kalır.
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
    // Texel merkezini depth grid koordinatına çevir (−0.5: piksel 0'ın merkezi).
    const y = ((j + 0.5) / n) * depthHeight - 0.5;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const x = ((i + 0.5) / n) * depthWidth - 0.5;
      const o = (j * n + i) * 4;
      data[o] = (u - 0.5) * 2 * halfW;
      data[o + 1] = (v - 0.5) * POINTS_WORLD_HEIGHT;
      data[o + 2] = (sampleBilinear(depth, depthWidth, depthHeight, x, y) - 0.5) * POINTS_DEPTH_RANGE;
      // o+3: seed korunur
    }
  }
  tex.needsUpdate = true;
}

/** Bilinear örnekleme; grid dışı taşmalar kenara kelepçelenir. */
function sampleBilinear(
  depth: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0));
  const ty = Math.min(1, Math.max(0, y - y0));
  const top = depth[y0 * w + x0] * (1 - tx) + depth[y0 * w + x1] * tx;
  const bot = depth[y1 * w + x0] * (1 - tx) + depth[y1 * w + x1] * tx;
  return top * (1 - ty) + bot * ty;
}
