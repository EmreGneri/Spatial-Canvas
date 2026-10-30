/** Three uploads sRGB video into a linear-format GPU texture, so custom
 * shaders must decode it explicitly. Photo textures are decoded by sampling
 * their sRGB GPU format already. Keep alpha (AO/coverage) unchanged. */
export const SOURCE_COLOR_GLSL = /* glsl */ `
  uniform float uDecodeVideo;
  uniform vec4 uSourceUvTransform;
  vec2 sourceColorUv(vec2 uv) {
    // Standalone materials without Engine keep identity UVs.
    return uSourceUvTransform.z > 0.0 && uSourceUvTransform.w > 0.0
      ? uv * uSourceUvTransform.zw + uSourceUvTransform.xy : uv;
  }
  vec4 decodeSourceColor(vec4 texel) {
    if (uDecodeVideo > 0.5) {
      texel.rgb = mix(
        pow((texel.rgb + vec3(0.055)) / 1.055, vec3(2.4)),
        texel.rgb / 12.92,
        vec3(lessThanEqual(texel.rgb, vec3(0.04045)))
      );
    }
    return texel;
  }
`;
