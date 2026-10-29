import * as THREE from 'three';
import { createPointCloudMaterial } from '../shaders/pointCloudMaterial.ts';

/**
 * EXPERIMENT, default off (docs/benchmarks/video-side-view-occlusion.md).
 * Live video draws soft additive sprites without depth writes, so orbit and
 * side views show surfaces through each other. A pre-pass over the same
 * geometry fills the depth buffer first; the unchanged additive pass is then
 * depth-tested against it (three's default LessEqual), hiding back surfaces.
 *   ?videoOrtme=1  depth-only pre-pass (no colour)
 *   ?videoOrtme=2  opaque-core pre-pass (colour + depth, NormalBlending)
 * Pre-pass sprites are shrunk to the opaque core and pushed BIAS world units
 * away from the camera, so a surface does not cull its own soft sprites.
 */
export type VideoOcclusionMode = 0 | 1 | 2;
export interface VideoOcclusionTuning { bias: number; core: number }
export const VIDEO_OCCLUSION_DEFAULTS: Readonly<VideoOcclusionTuning> = { bias: 0.03, core: 0.5 };

export function videoOcclusionMode(search: string): VideoOcclusionMode {
  const value = new URLSearchParams(search).get('videoOrtme');
  return value === '1' ? 1 : value === '2' ? 2 : 0;
}

const POSITION_ANCHOR = 'gl_Position = projectionMatrix * mv;';
const COLOR_ANCHOR = 'gl_FragColor = vec4(col, alpha);';
const DEPTH_ONLY_FRAGMENT = /* glsl */ `
  void main() {
    if (length(gl_PointCoord - 0.5) > 0.5) discard;
    gl_FragColor = vec4(0.0);
  }
`;

/**
 * Pre-pass material sharing `uniforms` BY REFERENCE with the live point-cloud
 * material, so every Engine uniform push (positions, size, colour) reaches it.
 * Bias/core are defines: the shared uniform object is never extended.
 */
export function createVideoOcclusionMaterial(
  uniforms: Record<string, THREE.IUniform>, mode: 1 | 2, tuning: VideoOcclusionTuning,
): THREE.ShaderMaterial {
  const source = createPointCloudMaterial();
  const { vertexShader: vs, fragmentShader: fs } = source;
  source.dispose();
  if (!vs.includes(POSITION_ANCHOR) || !fs.includes(COLOR_ANCHOR)) {
    throw new Error('videoOrtme: point-cloud shader anchors changed');
  }
  const material = new THREE.ShaderMaterial({
    name: `video-occlusion-${mode}`,
    uniforms,
    defines: { VIDEO_OCCLUSION_BIAS: tuning.bias.toFixed(4), VIDEO_OCCLUSION_CORE: tuning.core.toFixed(4) },
    vertexShader: vs.replace(POSITION_ANCHOR,
      `gl_PointSize *= VIDEO_OCCLUSION_CORE;\n    mv.z -= VIDEO_OCCLUSION_BIAS;\n    ${POSITION_ANCHOR}`),
    fragmentShader: mode === 1 ? DEPTH_ONLY_FRAGMENT : fs.replace(COLOR_ANCHOR, 'gl_FragColor = vec4(col, 1.0);'),
    transparent: false, // opaque list: drawn before the transparent additive cloud
    depthWrite: true,
    depthTest: true,
    colorWrite: mode === 2,
    blending: THREE.NormalBlending,
  });
  return material;
}
