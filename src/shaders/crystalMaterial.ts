import * as THREE from 'three';
import type { ParamDef } from '../engine/params';

/**
 * CRYSTAL MATERIAL (6. render modu) — render katmanı. Sahiplik: Zeynep.
 *
 * Sahneyi cam/kristal olarak çizer: fasetli yüzey, fresnel kenar parlaması,
 * speküler vurgular, kalınlığa bağlı absorpsiyon. Kırılma + dispersiyon
 * Gün 5'te, parıltı Gün 6'da eklenecek — knob'ları BUGÜN tanımlı, o gün
 * bağlanacak (ParamDef listesi ve preset şeması sonradan değişmesin).
 *
 * ── HANGİ GEOMETRİ ─────────────────────────────────────────────────────────
 * Kendi geometrisi YOKTUR: mevcut çizim nesnelerine takılır.
 *   - solid kabuk mesh'i → gerçek 2-manifold yüzey + `normal` attribute'u
 *   - splat instanced quad'ı → `gSplatB.xyz` normali
 * Her ikisi de BUGÜN mevcuttur; veri katmanından yeni bir şey beklemez.
 *
 * ── NORMAL KAYNAĞI (uNormalKaynak) ─────────────────────────────────────────
 *   0 = mesh `normal` attribute'u (ShellMeshData.normals)
 *   1 = splat normali (gSplatB.xyz — GaussianBufferData.b.xyz)
 *   2 = depth türevi (view-space pozisyon rekonstrüksiyonu + dFdx/dFdy)
 * Üç kaynak var, bu yüzden bool DEĞİL enum: bool ikisini ifade edemez.
 * 2. yol WebGL2'de nativedir (türev fonksiyonları çekirdekte, eklenti yok) ve
 * diğer ikisi yoksa her koşulda çalışan emniyet yoludur.
 *
 * ── NEDEN FRESNEL TEK BAŞINA YETMEZ ────────────────────────────────────────
 * Cam algısının çoğu SPEKÜLER vurgudan gelir; fresnel yalnızca siluet
 * kenarını aydınlatır ve tek başına "parlak kenarlı mat yüzey" verir.
 * Bu yüzden iki sabit yönlü ışık (key + fill) ve ayrı `uSpecStrength`
 * kolu var — fresnel'e fazla yüklenmek yerine.
 *
 * ── ABSORPSİYON ────────────────────────────────────────────────────────────
 * Beer-Lambert benzeri `exp(-uDensity · d)`: kalın/uzak yerler daha doygun
 * ve koyu. Gerçek hacim izleme değil (tek yüzey çizim), ama kalınlık hissini
 * ücretsiz veren yaklaşık — d olarak görüş-uzayı derinliği kullanılır.
 */

export interface CrystalMaterialUniforms {
  /** Fotoğraf/video renk grid'i — diğer modlarla aynı sözleşme (Engine yazar). */
  uImageTexture: { value: THREE.Texture | null };
  uHasImage: { value: number };
  /**
   * Arkadaki sahne rengi (Gün 5 kırılması). Değerini ENGINE yazar; Gün 2'de
   * bağlanır ama fragment henüz kullanmaz.
   */
  uSceneColor: { value: THREE.Texture | null };
  /** Normal kaynağı: 0 = mesh, 1 = splat, 2 = depth türevi. */
  uNormalKaynak: { value: number };
  /** Normal kuantizasyon çözünürlüğü — kırık cam yüzey boyutu. */
  uFacetScale: { value: number };
  uFresnelStrength: { value: number };
  uFresnelPower: { value: number };
  uSpecStrength: { value: number };
  uSpecPower: { value: number };
  uTintColor: { value: THREE.Color };
  /** Absorpsiyon katsayısı (Beer-Lambert benzeri). */
  uDensity: { value: number };
  /** Gün 6 — parıltı yoğunluğu. */
  uSparkleAmount: { value: number };
  /** Gün 5 — ekran-uzayı kırılma miktarı. */
  uRefractStrength: { value: number };
  /** Gün 5 — kromatik ayrışma. */
  uDispersion: { value: number };
  /** Engine tick'inden gelen saat (neon ile aynı sözleşme). */
  uTime: { value: number };
  /** Gün A global look köprüsü — Engine yazar. */
  uFogDensity: { value: number };
  uFogColor: { value: THREE.Color };
}

/**
 * Gün 2 — preset/ControlPanel sözleşmesi. `uImageTexture`, `uSceneColor`,
 * `uTime`, `uFogDensity/Color` HESAPLANAN değerlerdir (Engine yazar),
 * kullanıcı kolu değildir → listede YOKTUR.
 */
export const CRYSTAL_PARAMS: ParamDef[] = [
  { key: 'uNormalKaynak', label: 'normal kaynağı (0 mesh/1 splat/2 depth)', min: 0, max: 2, default: 0 },
  // ÖLÇÜLDÜ (2026-08-16, gl.readPixels, sentetik görsel + kabuk mesh'i):
  // scale=64 taban alındığında değişen piksel sayısı — 2: 8353, 4: 5704,
  // 8: 4402, 12: 3675, 24: 2462, 1: 1008 (1'de erken çıkış → faset KAPALI).
  // Yani etki 2–24 bandında; 24 üstü ihmal edilebilir, 64'e kadar slider
  // uzatmak yarısını ölü aralık yapıyordu. Max 32'ye çekildi, varsayılan
  // 12 → 6 (mod açılışında faset GÖRÜNÜR olsun). Küçük değer = İRİ kırık yüz.
  { key: 'uFacetScale', label: 'faset iriliği (küçük = iri yüzler, 1 = kapalı)', min: 1, max: 32, default: 6 },
  { key: 'uFresnelStrength', label: 'kenar parlaması', min: 0, max: 2, default: 0.9 },
  { key: 'uFresnelPower', label: 'kenar sertliği', min: 1, max: 8, default: 3 },
  { key: 'uSpecStrength', label: 'speküler şiddeti', min: 0, max: 2, default: 0.8 },
  { key: 'uSpecPower', label: 'vurgu keskinliği', min: 8, max: 256, default: 64 },
  { key: 'uTintColor', label: 'cam rengi', min: 0, max: 1, default: 0, kind: 'color' },
  { key: 'uDensity', label: 'yoğunluk (absorpsiyon)', min: 0, max: 4, default: 0.8 },
  { key: 'uSparkleAmount', label: 'parıltı', min: 0, max: 1, default: 0 },
  { key: 'uRefractStrength', label: 'kırılma', min: 0, max: 1, default: 0 },
  { key: 'uDispersion', label: 'kromatik ayrışma', min: 0, max: 0.05, default: 0 },
];


/**
 * ORTAK CAM AYDINLATMA ÇEKİRDEĞİ (GLSL).
 *
 * İki material bunu paylaşır: kabuk mesh'i (fotoğraf) ve splat (video).
 * Kopyalamak yerine paylaşmanın sebebi, Gün 5/6'da kırılma ve parıltı
 * eklenince İKİ yerde birden düzeltme yapma zorunluluğunu ortadan kaldırmak —
 * bu tür ikizlerde biri hep geride kalır.
 *
 * `crystalShade` GÖRÜŞ UZAYINDA çalışır: N ve V görüş uzayı vektörleridir,
 * kamera orijindedir.
 */
export const CRYSTAL_SHADING_GLSL = /* glsl */ `
  /**
   * FASET: normali kaba bir yön ızgarasına yuvarlar. Düz yüzey yerine kırık
   * cam yüzleri üretir — geometriyi değiştirmeden, yalnız gölgelemeyle.
   * uFacetScale KÜÇÜLDÜKÇE faset İRİLEŞİR (1 = kapalı).
   */
  vec3 facetNormal(vec3 n, float scale) {
    if (scale <= 1.0) return n;
    return normalize(floor(n * scale + 0.5) / scale);
  }

  /**
   * Cam gölgelemesi. base = taban renk (doku × tint), d = görüş-uzayı
   * derinliği (absorpsiyon için).
   */
  vec3 crystalShade(vec3 N, vec3 V, vec3 base, float d) {
    // Absorpsiyon (Beer-Lambert benzeri): kalın/uzak yerler daha doygun.
    vec3 col = base * exp(-uDensity * d * 0.25);

    // Speküler: iki sabit yönlü ışık (key + fill). Cam parlaklığının ÇOĞU
    // buradan gelir; fresnel yalnız kenarı aydınlatır.
    vec3 key = normalize(vec3(0.5, 0.8, 0.6));
    vec3 fill = normalize(vec3(-0.6, 0.2, 0.4));
    float spec = pow(max(dot(N, normalize(key + V)), 0.0), uSpecPower)
               + 0.35 * pow(max(dot(N, normalize(fill + V)), 0.0), uSpecPower);
    float diff = 0.5 + 0.5 * max(dot(N, key), 0.0);

    // Fresnel (Schlick).
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uFresnelPower) * uFresnelStrength;

    col *= diff;
    col += vec3(spec) * uSpecStrength;
    col += vec3(fres);
    return col;
  }
`;

/**
 * Cam knob'larının GLSL bildirimleri — iki material de aynı uniform adlarını
 * kullanır (uniform NESNELERİ de paylaşılır: tek slider, iki material).
 */
export const CRYSTAL_UNIFORM_GLSL = /* glsl */ `
  uniform float uNormalKaynak;
  uniform float uFacetScale;
  uniform float uFresnelStrength;
  uniform float uFresnelPower;
  uniform float uSpecStrength;
  uniform float uSpecPower;
  uniform vec3 uTintColor;
  uniform float uDensity;
  uniform float uFogDensity;
  uniform vec3 uFogColor;

  // GÜN 5/6'DA BAĞLANACAK — bugün BİLEREK tanımlı ama kullanılmıyor.
  // ParamDef listesi, preset şeması ve uniform sözleşmesi Gün 2'de dondu
  // (verify-crystal-params denetliyor); o günler geldiğinde yalnız fragment
  // gövdesi değişecek, arayüz değil.
  uniform sampler2D uSceneColor;   // Gün 5: ekran-uzayı kırılma kaynağı
  uniform float uRefractStrength;  // Gün 5
  uniform float uDispersion;       // Gün 5: kromatik ayrışma
  uniform float uSparkleAmount;    // Gün 6: parıltı
  uniform float uTime;             // Gün 6: Engine tick'inden
`;

const CRYSTAL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewPos;
  varying vec3 vViewNormal;

  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    // normalMatrix three.js tarafından sağlanır (modelView'in ters-transpozu).
    // Mesh yolunda normal attribute'u ShellMeshData.normals'tan gelir.
    vViewNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

const CRYSTAL_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D uImageTexture;
  uniform float uHasImage;
${CRYSTAL_UNIFORM_GLSL}

  varying vec2 vUv;
  varying vec3 vViewPos;
  varying vec3 vViewNormal;

${CRYSTAL_SHADING_GLSL}

  void main() {
    // --- normal kaynağı ---
    vec3 N;
    if (uNormalKaynak < 1.5) {
      // 0 = mesh attribute, 1 = splat normali (mesh yolunda ikisi de vViewNormal)
      N = normalize(vViewNormal);
    } else {
      // 2 = depth türevi: görüş-uzayı pozisyonundan yüzey normali.
      // WebGL2'de dFdx/dFdy çekirdektedir — eklenti gerekmez.
      N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
    }
    N = facetNormal(N, uFacetScale);
    vec3 V = normalize(-vViewPos);
    if (dot(N, V) < 0.0) N = -N; // arka yüzler ters normal taşıyabilir

    vec3 base = uHasImage > 0.5 ? texture2D(uImageTexture, vUv).rgb : vec3(0.55, 0.62, 0.72);
    base *= uTintColor;

    vec3 col = crystalShade(N, V, base, max(0.0, -vViewPos.z));
    col = mix(col, uFogColor, clamp(uFogDensity, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * SPLAT VARYANTI (video kaynağı) — Gün 3.
 *
 * Kabuk mesh'i yalnız FOTOĞRAF yolunda kurulur; video → 3B sonucu splat
 * bulutudur. Crystal modunun "hem fotoğraf hem video" ölçütünü karşılaması
 * için splat geometrisinde de çizmesi gerekir.
 *
 * Vertex tarafı splatMaterial'ın EWA izdüşümüyle AYNI matematiktir (elips
 * ekseni = Σ₂ özvektörleri); fragment tarafı ortak `crystalShade` çekirdeğini
 * çağırır ve alfayı Gauss düşüşünden alır. Normal `gSplatB.xyz`ten gelir
 * (dünya çerçevesi) ve görüş uzayına taşınır.
 */
const CRYSTAL_SPLAT_VERTEX = /* glsl */ `
  precision highp float;

  uniform sampler2D uSplatA;
  uniform sampler2D uSplatB;
  uniform sampler2D uSplatC;
  uniform float uSplatGrid;
  uniform vec2 uViewport;
  uniform float uSplatScale;
  uniform float uMaxScreenRadius;

  attribute vec2 aCorner;
  attribute float aSplatIndex;

  varying vec2 vQuad;
  varying vec3 vColorRgb;
  varying float vOpacity;
  varying vec3 vViewNormal;
  varying float vViewDepth;

  vec2 splatUv(float index) {
    float x = mod(index, uSplatGrid);
    float y = floor(index / uSplatGrid);
    return (vec2(x, y) + 0.5) / uSplatGrid;
  }

  mat3 basisFromNormal(vec3 n) {
    vec3 up = abs(n.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 t = normalize(cross(up, n));
    return mat3(t, cross(n, t), n);
  }

  void main() {
    vec2 uv = splatUv(aSplatIndex);
    vec4 A = texture2D(uSplatA, uv);
    vec4 B = texture2D(uSplatB, uv);
    vColorRgb = texture2D(uSplatC, uv).rgb;
    vOpacity = A.w;

    vec3 nW = normalize(B.xyz);
    vViewNormal = normalize(mat3(modelViewMatrix) * nW);
    float s = max(B.w, 1e-5) * uSplatScale;

    mat3 R = basisFromNormal(nW);
    vec3 sc = vec3(s, s, s * 0.1);
    mat3 M = mat3(R[0] * sc.x, R[1] * sc.y, R[2] * sc.z);
    mat3 W = mat3(modelViewMatrix);
    mat3 MV = W * M;
    mat3 cov3 = MV * transpose(MV);

    vec4 viewPos = modelViewMatrix * vec4(A.xyz, 1.0);
    vViewDepth = -viewPos.z;
    if (viewPos.z > -0.01) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vQuad = vec2(0.0);
      return;
    }

    float fx = projectionMatrix[0][0] * uViewport.x * 0.5;
    float fy = projectionMatrix[1][1] * uViewport.y * 0.5;
    float invZ = 1.0 / -viewPos.z;
    float invZ2 = invZ * invZ;
    mat2x3 J = mat2x3(
      vec3(fx * invZ, 0.0, fx * viewPos.x * invZ2),
      vec3(0.0, fy * invZ, fy * viewPos.y * invZ2)
    );
    vec3 c0 = cov3 * J[0];
    vec3 c1 = cov3 * J[1];
    float a = dot(J[0], c0) + 0.3;
    float b = dot(J[0], c1);
    float d = dot(J[1], c1) + 0.3;

    float tr = a + d;
    float det = a * d - b * b;
    float disc = sqrt(max(tr * tr * 0.25 - det, 0.0));
    float l1 = tr * 0.5 + disc;
    float l2 = max(tr * 0.5 - disc, 0.1);
    // Köşegen dalda eksen seçimi (splatMaterial'daki hata geçmişinin aynısı).
    vec2 e1 = abs(b) > 1e-6
      ? normalize(vec2(b, l1 - a))
      : (a >= d ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    vec2 e2 = vec2(-e1.y, e1.x);
    float r1 = min(2.0 * sqrt(l1), uMaxScreenRadius);
    float r2 = min(2.0 * sqrt(l2), uMaxScreenRadius);

    vec2 offsetPx = e1 * (aCorner.x * r1) + e2 * (aCorner.y * r2);
    vQuad = aCorner * 2.0;

    vec4 clip = projectionMatrix * viewPos;
    clip.xy += offsetPx * (2.0 / uViewport) * clip.w;
    gl_Position = clip;
  }
`;

const CRYSTAL_SPLAT_FRAGMENT = /* glsl */ `
  precision highp float;

${CRYSTAL_UNIFORM_GLSL}

  varying vec2 vQuad;
  varying vec3 vColorRgb;
  varying float vOpacity;
  varying vec3 vViewNormal;
  varying float vViewDepth;

${CRYSTAL_SHADING_GLSL}

  void main() {
    float r2 = dot(vQuad, vQuad);
    if (r2 > 4.0) discard;
    float g = exp(-0.5 * r2);

    // Splat yolunda normal GERÇEK veridir (gSplatB) — depth türevine düşmeye
    // gerek yok; uNormalKaynak = 2 seçilse bile splat'ın kendi normali daha
    // doğrudur (quad düzlemi yüzeyi temsil etmez).
    vec3 N = facetNormal(normalize(vViewNormal), uFacetScale);
    vec3 V = vec3(0.0, 0.0, 1.0); // splat quad'ı kameraya bakar
    if (dot(N, V) < 0.0) N = -N;

    vec3 base = vColorRgb * uTintColor;
    vec3 col = crystalShade(N, V, base, vViewDepth);
    col = mix(col, uFogColor, clamp(uFogDensity, 0.0, 1.0));

    float alpha = g * vOpacity;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

export type CrystalMaterial = THREE.ShaderMaterial & {
  uniforms: CrystalMaterialUniforms & Record<string, THREE.IUniform>;
};

export function createCrystalMaterial(): CrystalMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uImageTexture: { value: null },
      uHasImage: { value: 0 },
      uSceneColor: { value: null },
      uNormalKaynak: { value: 0 },
      uFacetScale: { value: 6 },
      uFresnelStrength: { value: 0.9 },
      uFresnelPower: { value: 3 },
      uSpecStrength: { value: 0.8 },
      uSpecPower: { value: 64 },
      uTintColor: { value: new THREE.Color('#cfe6ff') },
      uDensity: { value: 0.8 },
      uSparkleAmount: { value: 0 },
      uRefractStrength: { value: 0 },
      uDispersion: { value: 0 },
      uTime: { value: 0 },
      uFogDensity: { value: 0 },
      uFogColor: { value: new THREE.Color('#0b0e15') },
    },
    vertexShader: CRYSTAL_VERTEX,
    fragmentShader: CRYSTAL_FRAGMENT,
    // Cam opak çizilir (Gün 5 kırılması arkayı texture'dan okuyacak, blend
    // ile değil) — saydam yapmak sıralama sorununu bedavaya davet ederdi.
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
  });
  return material as CrystalMaterial;
}

/**
 * Splat varyantı: cam knob'larının UNIFORM NESNELERİNİ paylaşır.
 *
 * `{ ...shared }` yayılımı her uniform'un `{ value }` NESNESİNİ kopyalar
 * (referans), değerini değil — yani ControlPanel ya da preset tek bir yere
 * yazdığında iki material birden görür. İki ayrı uniform seti tutup elle
 * senkronlamak, kaçınılmaz olarak birinin geride kalmasıyla biterdi.
 *
 * Splat'a özgü uniform'lar (uSplatA/B/C, uViewport, …) crystal knob'ları
 * DEĞİLDİR: değerlerini Engine yazar (SplatObject.bindTextures / update).
 */
export function createCrystalSplatMaterial(shared: CrystalMaterial): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared.uniforms,
      uSplatA: { value: null },
      uSplatB: { value: null },
      uSplatC: { value: null },
      uSplatGrid: { value: 384 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uSplatScale: { value: 1 },
      uMaxScreenRadius: { value: 128 },
    },
    vertexShader: CRYSTAL_SPLAT_VERTEX,
    fragmentShader: CRYSTAL_SPLAT_FRAGMENT,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}
