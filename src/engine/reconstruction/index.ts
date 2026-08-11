/**
 * Rekonstrüksiyon pipeline'ı (veri katmanı, CPU): depth → parçacık bulutu.
 * GPU transferi buradan yapılmaz — buffers.ts üstlenir.
 */
export { calculateVolumeMaps, type VolumeMaps, type VolumeCalculationOptions } from './volume.ts';
export {
  sampleVolumePositions,
  sampleImageGrid,
  type VolumeSampleOptions,
  type ImageSampleOptions,
  VOLUME_GRID_SIZE,
  EDGE_WALL_Z,
  THIN_SHELL_Z,
  BACKDROP_OPACITY,
} from './sampler.ts';
export {
  buildSilhouette,
  dilateAndFeatherMask,
  SILHOUETTE_BIN_LO,
  MASK_DILATE_RADIUS,
  MASK_FEATHER_RADIUS,
} from './silhouette.ts';
