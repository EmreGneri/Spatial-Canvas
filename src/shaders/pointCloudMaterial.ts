import * as THREE from 'three';
import { POINTS_DEPTH_RANGE } from '../engine/buffers';
import type { ParamDef } from '../engine/params';

/**
 * POINT CLOUD MATERIAL — render katmanı. Sahiplik: Zeynep.
 *
 * `src/engine/points.ts` içindeki yer tutucu material'ın yerine geçer:
 *   engine.setPointsMaterial(createPointCloudMaterial())
 *
 * Sözleşme (ARCHITECTURE.md · Point Cloud Sözleşmesi):
 * - Konumlar CPU dizisinden değil, `uPositions` texture'ından okunur. Geometri
 *   yalnızca `aUv` grid'ini taşır; position attribute boş, frustumCulled = false
 *   (ikisini de points.ts kurar, burası ona dokunmaz).
 * - `uPositions` zorunlu. Ping-pong nedeniyle okunan texture her karede
 *   değiştiği için değerini **Engine yazar** — burada yalnızca tanımlanır.
 * - z orijine ortalıdır (−1..+1); renk rampası için `z / POINTS_DEPTH_RANGE + 0.5`.
 * - `w` kanalı parçacık başına OPASİTE'dir (α): Tur 11'den beri İKİ seviyeli
 *   — 1 = ön plan, BACKDROP_OPACITY (0.4) = arka plan noktası (tek buffer).
 *   Değeri veri katmanı yazar (sampler.ts, buffers.ts); shader burada alpha
 *   çarpanı olarak tüketir. Jitter tohumu artık aUv hash'iyle türetilir.
 * - RENK (Tur 11): `uImageTexture` varsa (uHasImage = 1) parçacık rengi
 *   fotoğraftan gelir — `texture2D(uImageTexture, vUv)`; vUv = aUv olduğu
 *   için texel (i,j) konumla birebir aynı fotoğraf pikselini okur. Değerini
 *   Engine.setPhoto yazar (fotoğraf setDepth'te aynı remap ile grid'e
 *   örneklenir). uHasImage = 0 iken (kamera/video) eski derinlik rampası.
 */

export interface PointCloudMaterialUniforms {
  /**
   * Simülasyonun ping-pong RT texture'ı. Değeri Engine her karede yazar;
   * material'ın kendisi asla atama yapmaz. İlk kare çizilmeden önce Engine
   * mutlaka yazdığı için başlangıçtaki null hiçbir draw call'a ulaşmaz.
   */
  uPositions: { value: THREE.Texture | null };
  /** 2..20 — birim mesafedeki nokta boyutu (piksel) */
  uPointSize: { value: number };
  /** 0..1 — aUv hash tohumuyla boyut saçılması; 0 = hepsi eşit boyutta */
  uSizeJitter: { value: number };
  /**
   * 0..1 — Z hacmi. Ön plan parçacıkları tohumlarına göre kendi ön yüzeyleri
   * ile sabit arka düzlem (z = −0.5) arasına dağıtılır; 0 = kapalı (yalnızca
   * ön yüzey, eski 2.5D görünüm), 1 = arka düzleme kadar dolu blok.
   * Veri katmanı yan duvar üretmiyor (volume.ts) — hacim burada doğuyor.
   */
  uExtrusionDepth: { value: number };
  /** derinlik rampasının yakın ucu (z = +1) */
  uNearColor: { value: THREE.Color };
  /** derinlik rampasının uzak ucu (z = −1) */
  uFarColor: { value: THREE.Color };
  /**
   * Fotoğraf renk texture'ı (Tur 11): 384×384 RGBA8, konum grid'iyle aynı
   * eşleme (sampler.ts sampleImageGrid). Değerini Engine.setPhoto yazar;
   * null iken (kamera/video) uHasImage = 0'dır ve derinlik rampası kullanılır.
   * Tur 12: video aktifken Engine buraya canlı VideoTexture bağlar.
   */
  uImageTexture: { value: THREE.Texture | null };
  /** 0 = fotoğraf yok (derinlik rampası), 1 = fotoğraf renkleri açık */
  uHasImage: { value: number };
  /**
   * Nesne ayırma (Tur 12 — şikayet 4): 1 → arka plan parçacıkları (w < 0.5)
   * tamamen atılır (beyaz kağıt/perde yok, yalnızca büst); 0 → tüm sahne
   * çizilir ve arka plan pikselleri parlayıp özneyi yutmasın diye karartılır.
   * Değerini Engine.setObjectSeparation yazar.
   */
  uObjectSeparation: { value: number };
  /**
   * Renk modu (Tur 12 — şikayet 3): 1 (varsayılan) → parçacık rengi doğrudan
   * görselin RGB dokusundan (uImageTexture); 0 → dokular yok sayılır, renk
   * uNearColor/uFarColor derinlik gradyanından türetilir. Değerini
   * Engine.setUseTextureColor yazar.
   */
  uUseTextureColor: { value: number };
  /** 0..1 — nokta kenarının yumuşaklığı; 0 = sert daire */
  uSoftness: { value: number };
  /** 0..3 — genel parlaklık çarpanı */
  uBrightness: { value: number };
  /**
   * GÜN 6 (3D iyileştirme 1) — yüzey normalleri + ışık: 0..1 ışık şiddeti.
   * 0 = kapalı (eski düz görünüm). Normal, uPositions komşu texellerinden
   * türetilir (CPU/ek texture gerekmez).
   */
  uLightStrength: { value: number };
  /** Işık yönü (dünya uzayı, normalize) — n·light diffuse. */
  uLightDir: { value: THREE.Vector3 };
  /**
   * GÜN 6 (3D iyileştirme 2) — fresnel: 0..1. Siluet kenarlarını n·view
   * yönüne göre aydınlatır (hacim hissi). Power = uFresnelStrength * 5 + 1.
   */
  uFresnelStrength: { value: number };
  /** Normal türetme ölçeği — aşırı kavisli/bantlı depth'te normale gürültü.
   *  Küçük tut; büyükçe yüzey çizgileri görünür. */
  uNormalScale: { value: number };
}

/**
 * Parametre sözleşmesi (Gün 4): point cloud modunun preset'e giren kolları.
 * Renkler hex olarak serileştirilir (kind: 'color'). uPositions hesaplanır,
 * kullanıcı kolu değil — yok.
 */
export const POINTS_PARAMS: ParamDef[] = [
  { key: 'uPointSize', label: 'nokta boyutu', min: 2, max: 20, default: 6 },
  { key: 'uSizeJitter', label: 'boyut saçılması', min: 0, max: 1, default: 0.3 },
  { key: 'uExtrusionDepth', label: 'Extrusion Depth', min: 0, max: 1, default: 0 },
  { key: 'uNearColor', label: 'yakın rengi', min: 0, max: 1, default: 0, kind: 'color' },
  { key: 'uFarColor', label: 'uzak rengi', min: 0, max: 1, default: 0, kind: 'color' },
  { key: 'uSoftness', label: 'yumuşaklık', min: 0, max: 1, default: 0.5 },
  { key: 'uBrightness', label: 'parlaklık', min: 0, max: 3, default: 1 },
  { key: 'uLightStrength', label: 'ışık gölgesi', min: 0, max: 1, default: 0.45 },
  { key: 'uFresnelStrength', label: 'kenar parlaması', min: 0, max: 1, default: 0.35 },
  { key: 'uNormalScale', label: 'normal ölçeği', min: 0, max: 2, default: 0.8 },
];

/** ShaderMaterial, uniform'ları tipli görünsün diye daraltılmış. */
export type PointCloudMaterial = THREE.ShaderMaterial & {
  uniforms: PointCloudMaterialUniforms;
};

const VERTEX = /* glsl */ `
  uniform sampler2D uPositions;
  uniform float uPointSize;
  uniform float uSizeJitter;
  uniform float uExtrusionDepth;
  uniform float uNormalScale;

  attribute vec2 aUv;

  varying vec2 vUv;
  varying float vDepth;
  varying float vOpacity;
  varying float vExtrusion;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  /**
   * Hacmin arka sınırı (z, orijine ortalı −1..+1 uzayında). Parçacıklar ön
   * yüzeyleriyle bu düzlem arasına dağıtılır; veri katmanı yalnızca ön yüzey
   * + ince kabuk üretiyor (volume.ts: "KAPALI MESH / SIDE-WALL ÜRETMEZ"),
   * yan duvarlar bu yüzden render tarafında doğuyor.
   */
  const float BACK_PLANE_Z = -0.5;
  const float TEX_STEP = 1.0 / 384.0;

  void main() {
    vec4 pos = texture2D(uPositions, aUv);

    // Tur 11: renk, konumla aynı texel'i örnekler (uImageTexture grid ile
    // birebir eşleşir) — parçacık kendi fotoğraf pikselinin rengini alır.
    vUv = aUv;

    // z orijin etrafında ortalı (−RANGE/2 .. +RANGE/2) → rampa için 0..1'e geri.
    vDepth = clamp(pos.z / ${POINTS_DEPTH_RANGE.toFixed(1)} + 0.5, 0.0, 1.0);

    // w = parçacık opaklığı (α): 1 ön plan, 0.4 arka plan (Tur 11 — tek
    // buffer). Veri katmanı yazar, simülasyon korur.
    vOpacity = clamp(pos.w, 0.0, 1.0);

    // Tohum artık aUv hash'i: parçacık başına sabit, 0..1, boyut saçılması.
    // DİKKAT: pos.w BURADA KULLANILAMAZ — o opaklık ve yalnızca iki değeri var
    // (1 / 0.4). Onunla dağıtım yapılsaydı blok değil iki ince levha çıkardı.
    float seed = fract(sin(aUv.x * 12.9898 + aUv.y * 78.233) * 43758.5453);

    // -- Z HACMİ (Volumetric Shell): %70 ön yüzey / %30 kavisli arka dolgu --
    // Ön yüzeyin (yüz, göz, elbise) netliği KESİNLİKLE korunur: seed < 0.7
    // olan parçacıklar ön yüzeyde (pos.z) kalır — dağıtım, parçacıkların
    // çoğunu boşluğa fırlatan eski "her seed'i Z'ye yay" mantığının tersine
    // yalnızca kalan %30'u arkaya kavisli döker.
    //
    // Yalnızca ön plana uygulanır (w >= 0.5): arka plan noktaları veri
    // katmanının koyduğu duvardır, onları öne çekmek duvarı bulanıklaştırır.
    // t = (seed − 0.7) / 0.3: seed < 0.7 için 0 (tam ön yüzey), 0.7..1
    // aralığında 0..1'e çekilir; uExtrusionDepth arka kütle kalınlığını ayarlar.
    float t = clamp((seed - 0.7) / 0.3, 0.0, 1.0);
    float extrude = t * uExtrusionDepth * step(0.5, vOpacity);

    // Hedef ASLA parçacığın önüne düşmez: zaten arka düzlemden geride olan bir
    // parçacık (siluet kenarındaki döküm) öne çekilmesin diye min() ile kırpılır.
    float backZ = min(pos.z, BACK_PLANE_Z);
    float z = mix(pos.z, backZ, extrude);

    // Fragment gölgelemesi bu değeri okur: 0 = ön yüzey, büyüdükçe içeri.
    vExtrusion = extrude;

    // GÜN 6 (3D iyileştirme 1) — YÜZEY NORMALİ: komşu texellerin z farkından.
    // dz/dx, dz/dy → yüzey eğimi; ama ön yüze bakarken z artışı "bize doğru"
    // (: z = (d−0.5)·2). Normal = normalize(−D·dzdx, −D·dzdy, 1) — düz yüzey
    // (0,0,1), kavisler yönelir. ORİJİNAL yüzey z'sinden (pos.z, extrude
    // öncesi) türetilir: arka dolgu parçacıkları da aynı normali alır, hacim
    // yekpare bir kesit gibi ışık alır.
    float zL = texture2D(uPositions, aUv + vec2(-TEX_STEP, 0.0)).z;
    float zR = texture2D(uPositions, aUv + vec2(TEX_STEP, 0.0)).z;
    float zD = texture2D(uPositions, aUv + vec2(0.0, -TEX_STEP)).z;
    float zU = texture2D(uPositions, aUv + vec2(0.0, TEX_STEP)).z;
    vec3 surf = normalize(vec3(
      -(zR - zL) * uNormalScale,
      -(zU - zD) * uNormalScale,
      1.0
    ));
    vNormal = surf;

    // GÜN 6 (3D iyileştirme 2) — görüş yönü (dünya uzayı) — fresnel için.
    vec3 worldPos = vec3(pos.xy, z);
    vViewDir = normalize(cameraPosition - worldPos);

    vec4 mv = modelViewMatrix * vec4(pos.xy, z, 1.0);

    // Tohumla boyut saçılması. 1 etrafında simetrik: ortalama boyut sabit kalır,
    // uSizeJitter = 0 iken çarpan tam 1 olur (saçılma kapanır).
    float jitter = mix(1.0 - uSizeJitter, 1.0 + uSizeJitter, seed);

    // max() kırpması ZORUNLU: kameranın arkasına/üstüne düşen noktalarda
    // -mv.z ~ 0 olur, bölme patlar ve dev noktalar ekranı beyazlatır.
    gl_PointSize = uPointSize * jitter / max(-mv.z, 0.1);

    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uNearColor;
  uniform vec3 uFarColor;
  uniform sampler2D uImageTexture;
  uniform float uHasImage;
  uniform float uObjectSeparation;
  uniform float uUseTextureColor;
  uniform float uSoftness;
  uniform float uBrightness;
  uniform vec3 uLightDir;
  uniform float uLightStrength;
  uniform float uFresnelStrength;

  varying vec2 vUv;
  varying float vDepth;
  varying float vOpacity;
  varying float vExtrusion;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  /** Arka düzleme oturan parçacık bu oranda karartılır (0.5 = %50 koyu). */
  const float EXTRUSION_SHADE = 0.5;

  void main() {
    // Tur 12 (şikayet 4): nesne ayırma AÇIK iken arka plan parçacıkları
    // (w = BACKDROP_OPACITY < 0.5) tamamen atılır — ekranda beyaz kağıt/
    // perde kalmaz, yalnızca 3B büst görünür.
    if (uObjectSeparation > 0.5 && vOpacity < 0.5) discard;

    // Nokta merkezinden radyal mesafe, kenarda 1.0 olacak şekilde.
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;

    // Soft particle: sert daire yerine yumuşayan kenar. uSoftness = 0'da
    // smoothstep'in iki eşiği çakışıp tanımsız davranmasın diye alt sınır var.
    float soft = max(uSoftness, 0.001);
    float alpha = 1.0 - smoothstep(1.0 - soft, 1.0, r);

    // Opaklık (Tur 11): ön plan 1.0, arka plan noktaları 0.4 — iki katman
    // tek buffer'da, tek draw call; mantık hatası yok, w doğrudan alpha.
    alpha *= vOpacity;

    // Renk (Tur 12 — şikayet 3): uUseTextureColor AÇIK ve doku varsa parçacık
    // kendi pikselinin RGB'sini alır (fotoğraf grid'i ya da canlı video);
    // KAPALI ise doku yok sayılır, renk Near/Far derinlik gradyanından gelir.
    vec3 col = (uHasImage > 0.5 && uUseTextureColor > 0.5)
      ? texture2D(uImageTexture, vUv).rgb
      : mix(uFarColor, uNearColor, vDepth);
    // Tur 12 (şikayet 4): nesne ayırma KAPALI iken arka plan pikselleri
    // derinlikle karartılır (×0.4) — parlak duvar büstü yutmasın.
    if (uObjectSeparation < 0.5 && vOpacity < 0.5) col *= 0.4;

    // SAHTE GÖLGELENDİRME: içeri itilen parçacık kararır. Yan duvarlar boyunca
    // ön yüzeyden arkaya doğru sürekli bir gradyan oluşur — hacmi okutan şey
    // konumdan çok bu; düz renkli bir blok profilden yine yassı görünürdü.
    // vExtrusion = 0 iken çarpan tam 1: efekt kapalıyken renk hiç değişmez.
    col *= 1.0 - EXTRUSION_SHADE * vExtrusion;

    // GÜN 6 (3D iyileştirme 1) — DİFFUSE IŞIK: yüzey normali ışık yönüyle
    // çarpılır; düz yüzey tam aydınlık, ışığa yönelen kavisler gölgelenir.
    // Arka plan duvarı (w < 0.5) ve içeri itilen parçacıklar da ışık alır —
    // profil kesiti okunur. 0.5 altı yumuşak geçiş (ışık sıfırlanmaz, yüzey
    // kararmaz): zift siyah delikler oluşmaz (additive + siyah = boşluk).
    if (uLightStrength > 0.001) {
      vec3 n = normalize(vNormal);
      float ndl = dot(n, normalize(uLightDir));
      float diffuse = 0.5 + 0.5 * ndl; // rampa: (−1..1) → 0..1
      col *= mix(1.0, diffuse, uLightStrength);
    }

    // GÜN 6 (3D iyileştirme 2) — FRESNEL: siluet kenarlarında (n·view → 0)
    // parlak halka. Kavisli yüzeylerin kenarı (yüz/torso profili) aydınlanır,
    // düz bölgeler (alın, duvar) etkilenmez. Güç: slider 0..1 → pow 1..6.
    if (uFresnelStrength > 0.001) {
      vec3 n = normalize(vNormal);
      vec3 v = normalize(vViewDir);
      float nv = clamp(abs(dot(n, v)), 0.0, 1.0);
      float fres = pow(1.0 - nv, 1.0 + uFresnelStrength * 5.0);
      if (vOpacity < 0.5) fres *= 0.35; // duvar kenar parlaması sönük
      col += vec3(fres * uFresnelStrength * 2.0); // additive: kenar aydınlanır
    }

    col *= uBrightness;

    // AdditiveBlending (src = SrcAlpha, dst = One): ekrana eklenen katkı
    // col * alpha olur, yumuşak kenar doğal olarak sönümlenir.
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createPointCloudMaterial(): PointCloudMaterial {
  // Her material kendi uniform objesini alır; iki instance state paylaşmaz.
  const uniforms: PointCloudMaterialUniforms = {
    uPositions: { value: null },
    uPointSize: { value: 6 },
    uSizeJitter: { value: 0.3 },
    // 0 = kapalı: mevcut görünüm ve kayıtlı preset'ler aynen korunur.
    uExtrusionDepth: { value: 0 },
    uNearColor: { value: new THREE.Color(0.85, 0.95, 1.0) },
    uFarColor: { value: new THREE.Color(0.06, 0.1, 0.28) },
    // Tur 11: fotoğraf bağlanana kadar kapalı — Engine.setPhoto açar.
    uImageTexture: { value: null },
    uHasImage: { value: 0 },
    // Tur 12: nesne ayırma kapalı (tüm sahne), renk modu açık (doku) —
    // değerleri Engine yönetir.
    uObjectSeparation: { value: 0 },
    uUseTextureColor: { value: 1 },
    uSoftness: { value: 0.5 },
    uBrightness: { value: 1 },
    // GÜN 6 (3D iyileştirme 1+2): ışık + fresnel — varsayılan AÇIK (demo için
    // anında görünür); kullanıcı slider 0'a çekerek kapatır. Işık: üst-sol ön,
    // hafif. Eski preset'ler (bu alanlar yoktu) applyParams ile atlanır — ışık
    // kapatılmaz, yeni görünüm alırlar.
    uLightStrength: { value: 0.45 },
    uLightDir: { value: new THREE.Vector3(0.45, 0.75, 0.6).normalize() },
    uFresnelStrength: { value: 0.35 },
    uNormalScale: { value: 0.8 },
  };

  const material = new THREE.ShaderMaterial({
    name: 'point-cloud',
    // ShaderMaterial index signature'lı bir uniform sözlüğü bekler; dışarıya
    // açtığımız katı arayüzü bozmamak için daraltma yalnızca burada.
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    // Additive bulutta derinlik yazılırsa arkadaki parçacıklar kırpılır ve
    // yığılma kaybolur; test açık kalır, yazma kapalı.
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // ShaderMaterial uniform'ları gevşek tipler; burada kurduğumuz obje birebir bu.
  return material as PointCloudMaterial;
}
