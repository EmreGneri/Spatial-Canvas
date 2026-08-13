/**
 * Rekonstrüksiyon pipeline'ı (veri katmanı, CPU): depth → parçacık bulutu.
 * GPU transferi buradan yapılmaz — buffers.ts üstlenir.
 */
export {
  sampleVolumePositions,
  sampleImageGrid,
  sampleAoGrid,
  computeAoMap,
  buildImportanceRemap,
  computeBodyGeometry,
  type VolumeSampleOptions,
  type ImageSampleOptions,
  type UvRemap,
  type BodyGeometry,
  VOLUME_GRID_SIZE,
  EDGE_WALL_Z,
  THIN_SHELL_Z,
  BACKDROP_OPACITY,
} from './sampler.ts';
export {
  buildShellMesh,
  type ShellMeshData,
  type ShellMeshOptions,
  MESH_GRID_SIZE,
  MESH_MIN_WALL_Z,
} from './mesh.ts';
export {
  buildSilhouette,
  dilateAndFeatherMask,
  SILHOUETTE_BIN_LO,
  MASK_DILATE_RADIUS,
  MASK_FEATHER_RADIUS,
} from './silhouette.ts';
