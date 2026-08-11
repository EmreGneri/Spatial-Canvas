/**
 * PROSEDÜREL KALINLIK VE ARKA YÜZEY HESABI (veri katmanı).
 *
 * Tek fotoğraftan görünmeyen arka yüzey üretilemez; bu modül arka yüzeyi
 * prosedürel bir kalınlık modeliyle yaklaştırır: ön yüzey depth'i (D),
 * foreground maskesi (M) ve normalize kenar mesafesi üzerinden local
 * thickness türetilir. KAPALI MESH / SIDE-WALL ÜRETMEZ — yalnızca front
 * yüzey, back yüzey ve kalınlık haritaları. Shell geometry bir sonraki
 * reconstruction aşamasında bu haritalar üzerinden kurulacak.
 *
 * Sözleşme: zFront, ARCHITECTURE.md'nin point cloud koordinat kuralıyla
 * birebirdir (z = (d − 0.5) · POINTS_DEPTH_RANGE, [-1, +1]'e kırpılır).
 * y-flip, aUv grid, positionTexture burada yoktur — CPU'da yalnızca
 * Float32Array üretilir, GPU transferi bu aşamanın işi değildir.
 *
 * Background kuralı: mask = 0 olan piksellerde kalınlık KESİNLİKLE sıfırdır
 * (zFront/zBack yine hesaplanır ama background'u geometry olarak üretmek
 * downstream reconstruction'un sorumluluğudur — yalnızca foreground maskesi
 * bulunan pikselleri kullanır).
 */

export interface VolumeCalculationOptions {
  /** z aralığı (POINTS_DEPTH_RANGE sözleşmesi). Varsayılan 2.0. */
  pointsDepthRange?: number;
  /** Foreground merkezindeki (mask=1, edge=0) maksimum kalınlık. Varsayılan 0.50. */
  tMax?: number;
}

export interface VolumeMaps {
  /** Ön yüzey: (depth − 0.5) · range, [-1, +1]. */
  zFrontMap: Float32Array;
  /** Arka yüzey: zFront − thickness, [-1, +1]. */
  zBackMap: Float32Array;
  /** Local kalınlık: tMax · sqrt(mask) · (1 − edge), ≥ 0. */
  thicknessMap: Float32Array;
}

export function calculateVolumeMaps(
  depthMap: Float32Array,
  maskMap: Float32Array,
  edgeDistanceMap: Float32Array,
  width: number,
  height: number,
  options: VolumeCalculationOptions = {},
): VolumeMaps {
  const count = width * height;
  // Boyut güvenliği: uyumsuz girdi sessizce yanlış sonuç üretmesin.
  if (
    depthMap.length !== count ||
    maskMap.length !== count ||
    edgeDistanceMap.length !== count
  ) {
    throw new RangeError(
      `volume haritaları boyut uyumsuz: beklenen ${count} (${width}x${height}) — ` +
        `depth=${depthMap.length}, mask=${maskMap.length}, edge=${edgeDistanceMap.length}`,
    );
  }
  const range = options.pointsDepthRange ?? 2.0;
  const tMax = options.tMax ?? 0.5;

  const zFrontMap = new Float32Array(count);
  const zBackMap = new Float32Array(count);
  const thicknessMap = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // NaN/Infinity geometriye sızmasın: geçersiz girdi 0 kabul edilir.
    const d = Number.isFinite(depthMap[i]) ? depthMap[i] : 0;
    const m = Number.isFinite(maskMap[i]) ? maskMap[i] : 0;
    const e = Number.isFinite(edgeDistanceMap[i]) ? edgeDistanceMap[i] : 0;

    const clampedMask = Math.max(0, Math.min(1, m));
    const clampedEdge = Math.max(0, Math.min(1, e));

    const zFront = Math.max(-1, Math.min(1, (d - 0.5) * range));

    // Background: kalınlık sıfır — foreground kenarına yaklaştıkça da
    // kademeli söner (edge = 1 → 0).
    const thickness =
      clampedMask === 0 ? 0 : tMax * Math.sqrt(clampedMask) * (1 - clampedEdge);

    const zBack = Math.max(-1, Math.min(1, zFront - thickness));

    zFrontMap[i] = zFront;
    zBackMap[i] = zBack;
    thicknessMap[i] = thickness;
  }

  return { zFrontMap, zBackMap, thicknessMap };
}
