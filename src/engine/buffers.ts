import * as THREE from 'three';
import { sampleAoGrid, sampleImageGrid, sampleVolumePositions } from './reconstruction/index.ts';

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
 * 2.5D hacim bükme (veri katmanı): sahne yana döndürüldüğünde "düz kart"
 * görüntüsünü engellemek için ön plan öznesine (yüz/gövde) hafif elipsoit
 * kavis kazandırılır; arka plan düz kalır (w_fg ≈ 0). Yüksek α yüzü topa
 * çevirir ve arkada devasa boş çanak bırakır — düşük tutulur; kapalı hacim
 * rekonstrüksiyonu (sampler: ön/arka yüz + yan duvarlar) boşluğu kapatır.
 * z aralığı sözleşmesi değişmez: sonuç her zaman [-1, +1]'e kırpılır.
 */
export const VOLUME_CURVATURE = 0.1;

/**
 * Önem tabanlı örnekleme güvenlik sınırları: arka plan yoğunluğu ortalamanın
 * %15'inin altına düşmez, ön plan (yüz) yoğunluğu standart gridin en fazla
 * 2.5 katı olur. Yoğunluk = önem / ortalama önem; clamp birebir bunu uygular.
 */
export const SAMPLE_MIN_DENSITY = 0.15;
export const SAMPLE_MAX_DENSITY = 2.5;

/**
 * Home: RGBA32F, 384×384. xyz = dinlenme konumu (parçacık buraya yaylanır),
 * w = ön plan opaklığı (α, fillPositionsFromDepth yazar; 0 = arka plan).
 * Gün 3: positionTexture artık ping-pong RT texture'ı; simülasyon her karede
 * onu üzerine yazar, home CPU'dan bir kez doldurulur. Jitter tohumu artık
 * shader'larda aUv hash'iyle türetilir (w artık seed taşımaz).
 */
export function createHomeTexture(): THREE.DataTexture {
  const n = POSITION_TEXTURE_SIZE * POSITION_TEXTURE_SIZE;
  const data = new Float32Array(n * 4);
  // w ilk değeri rastgele olabilir; fillPositionsFromDepth üzerine α yazar.
  for (let i = 0; i < n; i++) {
    data[i * 4 + 3] = Math.random();
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

export interface PositionFillOptions {
  /** Elipsoit kavis şiddeti (α). 0 = kapalı (düz kart). Varsayılan VOLUME_CURVATURE. */
  curvature?: number;
  /**
   * Ön plan nesne maskesi (0..1, depth ile aynı çözünürlük): siluete AND
   * edilir (segmentation.ts → resample → Engine). Opsiyonel.
   */
  foregroundMask?: Float32Array;
  /**
   * Önem tabanlı UV örneklemesi: örnekleme noktaları yüz/ön plan bölgesine
   * yoğunlaşır (kısıtlar: SAMPLE_MIN/MAX_DENSITY). false = eski doğrusal grid.
   * Varsayılan açık.
   */
  importanceSampling?: boolean;
  /**
   * GÜN 6 (video 3D — madde 4): home texture güncelleme yumuşaklığı (0..1).
   * 1 = toptan yaz (varsayılan), <1 = eski home verisiyle karıştır: yeni =
   * eski·(1−blend) + yeni·blend. xyz blendlenir; w (iki seviyeli opaklık)
   * aynen yazılır — ara opaklık değeri üretilmez. Video modunda home her
   * karede değişir; toptan yazılırsa yay kuvveti parçacığı sürekli dürter
   * (atiyoloji kaybı, titreme). 0.8 parçacık ataletini korurken videoyu takip
   * eder.
   */
  blend?: number;
}

/**
 * Depth çıktısından home texture'ı doldurur (dinlenme konumları). Kapalı
 * hacim rekonstrüksiyonu rekonstrüksiyon katmanında yapılır (sampler.ts);
 * bu fonksiyon yalnızca GPU sözleşmesini üstlenir: aUv grid yazımı, y-flip
 * (upload'da) ve w = α (ön plan opaklığı) yazımı. Arka plan texel'leri
 * ÖLÜDÜR (Tur 9): sampler maske = 0'da nokta üretmez, (x, y, 0, 0) yazar —
 * GPU sözleşmesi gereği texel yine de yazılır, shader α = 0 ile söner.
 */
export function fillPositionsFromDepth(
  tex: THREE.DataTexture,
  depth: Float32Array,
  depthWidth: number,
  depthHeight: number,
  opts: PositionFillOptions = {},
) {
  const n = POSITION_TEXTURE_SIZE;
  const data = tex.image.data as Float32Array;
  const xyz = sampleVolumePositions(depth, depthWidth, depthHeight, {
    gridSize: n,
    worldHeight: POINTS_WORLD_HEIGHT,
    depthRange: POINTS_DEPTH_RANGE,
    curvature: opts.curvature ?? VOLUME_CURVATURE,
    foregroundMask: opts.foregroundMask,
    importanceSampling: opts.importanceSampling !== false,
  });
  const blend = opts.blend ?? 1;
  if (blend >= 1) {
    for (let o = 0, k = 0; o < data.length; o += 4, k += 4) {
      data[o] = xyz[k];
      data[o + 1] = xyz[k + 1];
      data[o + 2] = xyz[k + 2];
      data[o + 3] = xyz[k + 3];
    }
  } else {
    // GÜN 6 (madde 4): yeni konum eskiyle karışır — w iki seviyeli opaklık
    // aynen yazılır (ara değer üretilmez; aksi halde shader'lar nesne ayırmayı
    // yarı-opak sanar).
    const keep = 1 - blend;
    for (let o = 0, k = 0; o < data.length; o += 4, k += 4) {
      data[o] = data[o] * keep + xyz[k] * blend;
      data[o + 1] = data[o + 1] * keep + xyz[k + 1] * blend;
      data[o + 2] = data[o + 2] * keep + xyz[k + 2] * blend;
      data[o + 3] = xyz[k + 3];
    }
  }
  tex.needsUpdate = true;
}

/**
 * GÖRSEL RENK TEXTURE'U (Tur 11): RGBA8, 384×384, home texture'ı ile aynı
 * grid düzeni. xyz değil — RGB piksel rengi (a = 255). Render shader'ları
 * bunu uImageTexture adıyla aUv'de okur: her parçacık, konumunun örneklediği
 * FOTOĞRAF pikselinin rengini taşır (varsayılan mavi derinlik rampası
 * yerine). fillImageColorTexture konumlarla BİREBİR aynı remap'i kullandığı
 * için renkler asla parçacıklardan kaymaz.
 */
export function createImageColorTexture(): THREE.DataTexture {
  const n = POSITION_TEXTURE_SIZE;
  const data = new Uint8Array(n * n * 4);
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.flipY = true; // v=1 → üst satır (y-flip politikası: yalnızca burada)
  tex.colorSpace = THREE.SRGBColorSpace; // sRGB enkode fotoğraf → doğru ton
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export interface ImageColorFillOptions {
  /** Önem tabanlı örnekleme — fillPositionsFromDepth ile AYNI ayar. Varsayılan açık. */
  importanceSampling?: boolean;
  /**
   * Ön plan maskesi — fillPositionsFromDepth ile AYNI girdi (hizalama): renk
   * grid'i konum grid'iyle birebir aynı remap'i kurmalıdır, aksi halde
   * renkler parçacıklardan kayar. Opsiyonel.
   */
  foregroundMask?: Float32Array;
}

/**
 * Renk texture'ını fotoğraf RGB'sinden doldurur (sampler.ts sampleImageGrid):
 * grid texel'i (i,j), konum texel'inin örneklediği aynı depth pikselini
 * fotoğrafta bilinear örnekler. `depth` remap'in kaynağıdır (konum katmanı
 * ile hizalama buradan gelir); rgb fotoğraf pikselleri 0..1'dir.
 */
export function fillImageColorTexture(
  tex: THREE.DataTexture,
  rgb: Float32Array,
  imgWidth: number,
  imgHeight: number,
  depth: Float32Array,
  depthWidth: number,
  depthHeight: number,
  opts: ImageColorFillOptions = {},
) {
  const n = POSITION_TEXTURE_SIZE;
  const data = tex.image.data as Uint8Array;
  const sampleOpts = {
    gridSize: n,
    importanceSampling: opts.importanceSampling !== false,
    foregroundMask: opts.foregroundMask,
  };
  const grid = sampleImageGrid(rgb, imgWidth, imgHeight, depth, depthWidth, depthHeight, sampleOpts);
  // ALPHA = bakılı oklüzyon (Gün C): aynı remap, aynı hizalama. Render
  // shader'ları .a'yı AO çarpanı olarak tüketir (uAoStrength); ek texture yok.
  const ao = sampleAoGrid(depth, depthWidth, depthHeight, sampleOpts);
  for (let o = 0, k = 0, a = 0; o < data.length; o += 4, k += 3, a++) {
    data[o] = Math.round(grid[k] * 255);
    data[o + 1] = Math.round(grid[k + 1] * 255);
    data[o + 2] = Math.round(grid[k + 2] * 255);
    data[o + 3] = Math.round(Math.min(1, Math.max(0, ao[a])) * 255);
  }
  tex.needsUpdate = true;
}
