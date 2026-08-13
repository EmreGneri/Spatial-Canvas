import * as THREE from 'three';
import { POINTS_DEPTH_RANGE } from '../engine/buffers';
import type { ParamDef } from '../engine/params';

/**
 * SOLID MESH MATERIAL (Gün B — 'solid' render modu, fotoğraf-only).
 *
 * `engine.setPointsMaterial(createSolidMaterial())` — mod takasının diğer
 * modlarla aynı kapısından girer; nokta bulutu solid modda gizlenir, GEOMETRİ
 * `Engine.setShellGeometry` (buildShellMesh çıktısı) ile yüklenen BufferMesh
 * olur. Aynı material hem Points.visible = false iken mesh üzerinde çalışır.
 *
 * Ortak sözleşmeler (points/ascii/neon ile birebir):
 * - uImageTexture/uHasImage/uObjectSeparation/uUseTextureColor → Engine'in
 *   pushSharedUniforms köprüsünden canlı işlenir (fotoğraf grid'i ya da video).
 * - uFogDensity/uFogColor → pushLookUniforms köprüsü (Gün A global look).
 * - UV'ler grid uzayındadır (aUv sözleşmesi, y-flip üstte) — mesh material'ı
 *   doku grid'ini (sampleImageGrid çıktısı) LINEAR filtreyle örnekler:
 *   köşe uv'si 4 texel merkezinin tam ortasında kalır, bilinear = köşe rengi.
 * - Işık/fresnel/sis formülleri pointCloudMaterial ile AYNI aileden: diffuse
 *   (n·l) + kenar parlaması + üstel sis. Normaller GPU'da değil, geometri
 *   üzerinde (computeVertexNormals) üretilir.
 * - Solid: opak, depthWrite açık, DoubleSide (k1/k2 kıvrım emniyeti).
 */

export interface SolidMaterialUniforms {
  /** Fotoğraf renk grid'i ya da canlı video dokusu — Engine yazar. */
  uImageTexture: { value: THREE.Texture | null };
  /** 0 = fotoğraf yok (derinlik rampası), 1 = fotoğraf renkleri açık */
  uHasImage: { value: number };
  /** Engine.pushSharedUniforms uyumu (solid mesh arka plan taşımaz). */
  uObjectSeparation: { value: number };
  /** 1 = görsel dokusu; 0 = Near/Far derinlik gradyanı. */
  uUseTextureColor: { value: number };
  /** derinlik rampasının yakın ucu (z = +1) */
  uNearColor: { value: THREE.Color };
  /** derinlik rampasının uzak ucu (z = −1) */
  uFarColor: { value: THREE.Color };
  /** 0..3 — genel parlaklık çarpanı */
  uBrightness: { value: number };
  /** 0..1 ışık şiddeti (diffuse, point cloud ile aynı formül). */
  uLightStrength: { value: number };
  /** Işık yönü (dünya uzayı, normalize) — n·light diffuse. */
  uLightDir: { value: THREE.Vector3 };
  /** 0..1 — siluet kenarlarında fresnel halka. */
  uFresnelStrength: { value: number };
  /**
   * GÜN C — bakılı oklüzyon şiddeti (0..1). Oklüzyon haritası renk grid'inin
   * ALPHA kanalında taşınır (buffers.fillImageColorTexture → sampler
   * computeAoMap): çukurlar (göz boşluğu, çene altı, saç sınırı) kararır.
   * Ayrı texture/bant genişliği yok; video dokusunda alpha = 1 → etkisiz.
   */
  uAoStrength: { value: number };
  /**
   * GÜN C — Blinn spekülar şiddeti (0..1): tek parlak vurgu yüzeyin katı ve
   * kavisli olduğunu okutur (mat plastik büst). 0 = kapalı.
   */
  uSpecular: { value: number };
  /**
   * Duvar/arka kapak rengi (Gün B temizlik): UV sünmesi olmasın diye fotoğraf
   * dokusu yalnızca ÖN yüzeye bindirilir; dikey duvar şeritleri (normal z ≈ 0)
   * ve arka kapak (normal z < 0) bu koyu mat renge karışır — ışık/fresnel
   * üstünde çalışır, plastik büst kenarı hissi verir.
   */
  uWallColor: { value: THREE.Color };
  /** Gün A (fog) — global look köprüsünden yazılır. */
  uFogDensity: { value: number };
  uFogColor: { value: THREE.Color };
}

/** Parametre sözleşmesi (Gün 4): solid modunun preset'e giren kolları. */
export const SOLID_PARAMS: ParamDef[] = [
  { key: 'uBrightness', label: 'parlaklık', min: 0, max: 3, default: 1 },
  { key: 'uLightStrength', label: 'ışık gölgesi', min: 0, max: 1, default: 0.55 },
  { key: 'uFresnelStrength', label: 'kenar parlaması', min: 0, max: 1, default: 0.35 },
  { key: 'uAoStrength', label: 'oklüzyon (AO)', min: 0, max: 1, default: 0.7 },
  { key: 'uSpecular', label: 'parlak vurgu', min: 0, max: 1, default: 0.15 },
  { key: 'uNearColor', label: 'yakın rengi', min: 0, max: 1, default: 0, kind: 'color' },
  { key: 'uFarColor', label: 'uzak rengi', min: 0, max: 1, default: 0, kind: 'color' },
  { key: 'uWallColor', label: 'duvar rengi', min: 0, max: 1, default: 0, kind: 'color' },
];

/** ShaderMaterial, uniform'ları tipli görünsün diye daraltılmış. */
export type SolidMaterial = THREE.ShaderMaterial & {
  uniforms: SolidMaterialUniforms;
};

const VERTEX = /* glsl */ `
  // position/normal/uv attribute'ları, modelViewMatrix/projectionMatrix ve
  // cameraPosition three.js'in ShaderMaterial vertex önekinde zaten bildirilir —
  // burada YENİDEN bildirmek derleme hatasıdır (redefinition). Yalnızca üçünün
  // görmediği aUv gibi özel attribute'lar elle bildirilir.
  // aShell: 1 = ön yüz köşesi, 0 = arka kapak (duvar şeridinde interpolasyon).
  attribute float aShell;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vViewDepth;
  varying float vDepth;
  varying float vShell;

  void main() {
    vUv = uv;
    vShell = aShell;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Point cloud ile aynı aile: ışık/fresnel dünya uzayı normali + görüş
    // yönüyle hesaplanır; nesne döndürülmediği için object == world.
    vNormal = normal;
    vViewDir = normalize(cameraPosition - position);
    vViewDepth = -mv.z;
    // z orijin etrafında ortalı (−RANGE/2 .. +RANGE/2) → rampa için 0..1.
    vDepth = clamp(position.z / ${POINTS_DEPTH_RANGE.toFixed(1)} + 0.5, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uImageTexture;
  uniform float uHasImage;
  uniform float uObjectSeparation;
  uniform float uUseTextureColor;
  uniform vec3 uNearColor;
  uniform vec3 uFarColor;
  uniform float uBrightness;
  uniform vec3 uLightDir;
  uniform float uLightStrength;
  uniform float uFresnelStrength;
  uniform float uAoStrength;
  uniform float uSpecular;
  uniform vec3 uWallColor;
  uniform float uFogDensity;
  uniform vec3 uFogColor;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vViewDepth;
  varying float vDepth;
  varying float vShell;

  void main() {
    // uObjectSeparation uniform uyum için mevcut; solid'de KULLANILMAZ —
    // mesh geometrisi zaten silüet/maskeyle kesilmiştir, atılacak texel yok.
    // (Eskiden burada discard vardı; otomatik segmentasyonda objectSeparation
    // hep AÇIK gelince mesh tamamen siliniyordu — Gün B temizlik düzeltmesi.)

    // Renk: fotoğraf grid'i (uImageTexture) ya da Near/Far derinlik rampası.
    // Grid uzayı köşe uv'leri texel merkezlerinin tam ortasındadır; LINEAR
    // filtre köşe rengini 4 komşu texelin bilinear'ı olarak verir (mesh
    // ön yüzü parçacık yüzeyiyle birebir hizalıdır — Gün B kararı).
    // ALPHA kanalı = bakılı oklüzyon (Gün C, computeAoMap); doku yokken 1.
    vec4 img = uHasImage > 0.5 ? texture2D(uImageTexture, vUv) : vec4(0.0, 0.0, 0.0, 1.0);
    vec3 col = (uHasImage > 0.5 && uUseTextureColor > 0.5)
      ? img.rgb
      : mix(uFarColor, uNearColor, vDepth);

    // GÜN C — duvar/kapak sınıflaması KABUK KİMLİĞİNDEN (aShell) yapılır:
    // ön yüz köşesi 1, arka kapak 0, duvar şeridi ikisini paylaştığı için
    // fragment'te 1→0 arası interpolasyon verir. Eski yol (normal.z tahmini)
    // iki yönden bozuktu: sarım içe dönük olduğu için ön yüzü TAMAMEN duvar
    // sayıyordu, düzeltilse bile dik yüzeyleri (burun kanadı, çene profili)
    // duvar sanıyordu. Fotoğraf dokusu ön yüzde kalır, kenar bandında koyu
    // kaide rengine yumuşak geçer (UV sünmesi yok).
    float wallAmt = 1.0 - smoothstep(0.6, 0.95, vShell);
    col = mix(col, uWallColor, wallAmt);

    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);

    // BAKILI OKLÜZYON: çukurlar (göz boşluğu, çene altı, saç sınırı) kararır —
    // düz gölgeleme tek başına yüzeyi kabartma gibi göstermiyordu. uAoStrength
    // = 0 iken çarpan tam 1 (görünüm değişmez).
    col *= mix(1.0, img.a, uAoStrength);

    // DİFFUSE IŞIK — point cloud ile aynı formül ailesi: düz yüzey tam
    // aydınlık, ışığa yönelen kavisler gölgelenir. 0.5 tabanı zift siyahı
    // önler (ışık kapanmaz, yüzey kararmaz).
    vec3 l = normalize(uLightDir);
    if (uLightStrength > 0.001) {
      float ndl = dot(n, l);
      float diffuse = 0.5 + 0.5 * ndl;
      col *= mix(1.0, diffuse, uLightStrength);
    }

    // SPEKÜLAR (Blinn) — tek parlak vurgu: katı, kavisli yüzey okuması.
    // Oklüzyonla çarpılır ki çukurda vurgu doğmasın.
    if (uSpecular > 0.001) {
      vec3 h = normalize(l + v);
      float spec = pow(max(dot(n, h), 0.0), 32.0);
      col += vec3(spec * uSpecular * mix(1.0, img.a, uAoStrength));
    }

    // FRESNEL — siluet kenarlarında (n·view → 0) parlak halka; profilde
    // katı kütle hissi verir (same olarak point cloud).
    if (uFresnelStrength > 0.001) {
      float nv = clamp(abs(dot(n, v)), 0.0, 1.0);
      float fres = pow(1.0 - nv, 1.0 + uFresnelStrength * 5.0);
      col += vec3(fres * uFresnelStrength * 2.0);
    }

    col *= uBrightness;

    // Gün A (fog): kamera uzaklığıyla üstel sis — uFogDensity = 0 iken
    // çarpan tam 1 (görünüm değişmez).
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
    col = mix(col, uFogColor, fogF);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSolidMaterial(): SolidMaterial {
  const uniforms: SolidMaterialUniforms = {
    uImageTexture: { value: null },
    uHasImage: { value: 0 },
    uObjectSeparation: { value: 0 },
    uUseTextureColor: { value: 1 },
    uNearColor: { value: new THREE.Color(0.85, 0.95, 1.0) },
    uFarColor: { value: new THREE.Color(0.06, 0.1, 0.28) },
    uBrightness: { value: 1 },
    uLightStrength: { value: 0.55 },
    uLightDir: { value: new THREE.Vector3(0.45, 0.75, 0.6).normalize() },
    uFresnelStrength: { value: 0.35 },
    uAoStrength: { value: 0.7 },
    uSpecular: { value: 0.15 },
    uWallColor: { value: new THREE.Color('#23262e') },
    uFogDensity: { value: 0 },
    uFogColor: { value: new THREE.Color(0.02, 0.03, 0.07) },
  };

  const material = new THREE.ShaderMaterial({
    name: 'solid-mesh',
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // Opak katı yüzey: depthWrite açık — bloom/sis karışımı arkayı yutmaz.
    transparent: false,
    depthWrite: true,
    // GÜN C: kabuk artık DIŞA yönlü (mesh.ts sarım düzeltmesi + verify-mesh
    // yön testi) — arka yüzler çizilmez, solid modun fragment maliyeti yarıya
    // iner. DoubleSide yalnızca sarımın yanlış olduğu dönemde zorunluydu.
    side: THREE.FrontSide,
  });

  return material as SolidMaterial;
}