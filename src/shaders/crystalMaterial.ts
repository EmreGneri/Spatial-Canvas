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
  // Sebep: ParamDef listesi, preset şeması ve uniform sözleşmesi BUGÜN
  // donuyor (verify-crystal-params bunu denetliyor); o günler geldiğinde
  // yalnızca fragment gövdesi değişecek, arayüz değil. Varsayılanları 0
  // olduğu için mod ilk açılışta doğru görünür.
  uniform sampler2D uSceneColor;   // Gün 5: ekran-uzayı kırılma kaynağı
  uniform float uRefractStrength;  // Gün 5
  uniform float uDispersion;       // Gün 5: kromatik ayrışma
  uniform float uSparkleAmount;    // Gün 6: parıltı
  uniform float uTime;             // Gün 6: Engine tick'inden

  varying vec2 vUv;
  varying vec3 vViewPos;
  varying vec3 vViewNormal;

  /**
   * FASET: normali kaba bir yön ızgarasına yuvarlar. Düz yüzey yerine kırık
   * cam yüzleri üretir — geometriyi değiştirmeden, yalnız gölgelemeyle.
   * uFacetScale büyüdükçe faset KÜÇÜLÜR (çözünürlük artar).
   */
  vec3 facetNormal(vec3 n, float scale) {
    if (scale <= 1.0) return n;
    return normalize(floor(n * scale + 0.5) / scale);
  }

  void main() {
    // --- normal kaynağı ---
    vec3 N;
    if (uNormalKaynak < 1.5) {
      // 0 = mesh attribute, 1 = splat normali (ikisi de vViewNormal'a taşındı)
      N = normalize(vViewNormal);
    } else {
      // 2 = depth türevi: görüş-uzayı pozisyonundan yüzey normali.
      // WebGL2'de dFdx/dFdy çekirdektedir — eklenti gerekmez.
      N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
    }
    N = facetNormal(N, uFacetScale);
    // Kamera görüş uzayında; V = yüzeyden kameraya (kamera orijinde).
    vec3 V = normalize(-vViewPos);
    if (dot(N, V) < 0.0) N = -N; // arka yüzler ters normal taşıyabilir

    // --- taban renk ---
    vec3 base = uHasImage > 0.5 ? texture2D(uImageTexture, vUv).rgb : vec3(0.55, 0.62, 0.72);
    base *= uTintColor;

    // --- absorpsiyon (Beer-Lambert benzeri) ---
    // d: görüş-uzayı derinliği. Kalın/uzak yerler daha doygun ve koyu.
    float d = max(0.0, -vViewPos.z);
    base *= exp(-uDensity * d * 0.25);

    // --- speküler: iki sabit yönlü ışık (key + fill) ---
    // Cam parlaklığının ÇOĞU buradan gelir; fresnel yalnız kenarı aydınlatır.
    vec3 key = normalize(vec3(0.5, 0.8, 0.6));
    vec3 fill = normalize(vec3(-0.6, 0.2, 0.4));
    vec3 hKey = normalize(key + V);
    vec3 hFill = normalize(fill + V);
    float spec = pow(max(dot(N, hKey), 0.0), uSpecPower)
               + 0.35 * pow(max(dot(N, hFill), 0.0), uSpecPower);
    // Diffuse'un cam üzerinde payı az — yüzeyin tamamen düz görünmemesi için.
    float diff = 0.5 + 0.5 * max(dot(N, key), 0.0);

    // --- fresnel (Schlick) ---
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uFresnelPower) * uFresnelStrength;

    vec3 col = base * diff;
    col += vec3(spec) * uSpecStrength;
    col += vec3(fres);

    col = mix(col, uFogColor, clamp(uFogDensity, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
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
