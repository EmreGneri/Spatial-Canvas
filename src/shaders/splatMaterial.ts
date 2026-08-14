import * as THREE from 'three';
import type { ParamDef } from '../engine/params';

/**
 * SPLAT MATERIAL (5. render modu) — render katmanı. Sahiplik: Zeynep.
 *
 * 3B Gauss splat rasterizasyonu, WebGL2 / instanced quad üzerinde.
 *
 * ── VERİ SÖZLEŞMESİ (ARCHITECTURE.md · D.1 GaussianBuffer) ──────────────────
 *   uSplatA (RGBA32F, 384²) : xyz (dünya) + opaklık
 *   uSplatB (RGBA32F, 384²) : normal.xyz (birim) + ölçek (dünya yarıçapı)
 *   uSplatC (RGBA8,   384²) : rgb + AO
 * Üçünü de ENGINE her karede bind eder, material ASLA atama yapmaz —
 * `uPositions` kuralının birebir aynısı (ping-pong nedeniyle texture kimliği
 * değişebilir; material'ın elinde tuttuğu referans bayatlar).
 *
 * ── NEDEN INSTANCED QUAD ───────────────────────────────────────────────────
 * `gl_PointSize` ile nokta çizmek splat için yetmez: nokta her zaman EKRANA
 * PARALEL bir karedir, yani anizotropi ve yönelim taşıyamaz — kamera dönünce
 * yandan gelen bir surfel ince çizgiye dönmek zorundayken yuvarlak kalır.
 * Ayrıca `gl_PointSize` sürücüye göre üst sınırlıdır (çoğu masaüstünde 64-255
 * px) ve yakın plana gelen splat kırpılır. Instanced quad ikisini de çözer:
 * her instance kendi 2B elipsini görüş uzayında kurar.
 *
 * ── ELİPS NASIL KURULUYOR (Gün 2 — gerçek kovaryans) ───────────────────────
 * Splat, normalin etrafında YASSI bir 3B Gauss'tur (surfel):
 *     Σ₃ = R · diag(s², s², (s·ε)²) · Rᵀ
 * R, +z eksenini splat normaline döndüren dönme; ε (SPLAT_FLATTEN) kalınlık
 * oranı. Görüş uzayına taşıyıp perspektif Jacobian'ı ile 2B'ye indiriyoruz:
 *     Σ₂ = J · W · Σ₃ · Wᵀ · Jᵀ        (EWA splatting, Zwicker ve ark.)
 * Σ₂'nin özvektörleri ekrandaki elipsin eksenleridir; quad köşeleri bu iki
 * eksene göre yerleştirilir ve fragment'te Gauss ağırlığı MAHALANOBIS
 * uzaklığından okunur — yani elips, kovaryansın kendisiyle çiziliyor, elle
 * uydurulmuş bir "yassılaştırma" ile değil.
 *
 * Kısayol NEDEN yok: normal·view çarpımını doğrudan bir ölçek çarpanına
 * çevirmek (naif surfel) tam profilde splat'ı SIFIR alana indirir, yüzey
 * delik delik olur. Jacobian yolu profilde ince ama SIFIR OLMAYAN bir şerit
 * bırakır — yüzey kapalı kalır.
 *
 * ── SIRALAMA ───────────────────────────────────────────────────────────────
 * Alpha blend sırası CPU'da kurulur (`splatSort.ts`), instanced attribute
 * `aSplatIndex` olarak yüklenir. Material sıralamayı BİLMEZ: hangi index'i
 * verirsen onu çizer. depthWrite KAPALI, depthTest AÇIK (opak nokta bulutu
 * ya da kabuk aynı sahnedeyse splat'lar onların arkasında kalır), blend
 * premultiplied-alpha "over".
 */

/** Splat kalınlık oranı: normal ekseni, düzlem eksenlerinin bu katı kadar.
 *  0 yapılamaz (tekil kovaryans → determinant 0 → NaN); 0.1 yeterince yassı. */
export const SPLAT_FLATTEN = 0.1;
/** Gauss'un kesildiği yarıçap (σ katı). 2σ, ağırlığın ~%98'ini kapsar;
 *  daha büyüğü görünmeyen fragment'e para öder. */
export const SPLAT_CUTOFF_SIGMA = 2;

export interface SplatMaterialUniforms {
  /** D.1 gSplatA — xyz + opaklık. Değerini ENGINE yazar. */
  uSplatA: { value: THREE.Texture | null };
  /** D.1 gSplatB — normal.xyz + ölçek. Değerini ENGINE yazar. */
  uSplatB: { value: THREE.Texture | null };
  /** D.1 gSplatC — rgb + AO. Değerini ENGINE yazar. */
  uSplatC: { value: THREE.Texture | null };
  /** GaussianBuffer kenar uzunluğu (384) — index → uv çevrimi için. */
  uSplatGrid: { value: number };
  /** Viewport (px): Jacobian'ın piksel ölçeği buradan gelir. */
  uViewport: { value: THREE.Vector2 };
  /** 0.2..3 — tüm splat'lara ortak ölçek çarpanı (kullanıcı kolu). */
  uSplatScale: { value: number };
  /** 0..1 — genel opaklık çarpanı. */
  uSplatOpacity: { value: number };
  /** Ekranda bir splat'ın alabileceği en büyük yarıçap (px) — yakın plana
   *  gelen tek bir splat tüm ekranı boyayıp fill-rate'i öldürmesin. */
  uMaxScreenRadius: { value: number };
  /** 0..1 — AO (gSplatC.a) şiddeti; diğer modlarla aynı sözleşme. */
  uAoStrength: { value: number };
  /** 0..3 — parlaklık çarpanı. */
  uBrightness: { value: number };
  /** 0..1 — normal tabanlı diffuse ışık şiddeti (splat normali gerçek veridir). */
  uLightStrength: { value: number };
  /** Işık yönü (dünya, normalize). */
  uLightDir: { value: THREE.Vector3 };
  /** Gün A global look köprüsü — Engine yazar. */
  uFogDensity: { value: number };
  uFogColor: { value: THREE.Color };
}

/**
 * Gün 3 — preset sözleşmesi. `uSplatA/B/C`, `uViewport`, `uSplatGrid`
 * HESAPLANAN değerlerdir (Engine yazar), kullanıcı kolu değildir → listede
 * YOKTUR (ARCHITECTURE.md · Render Parametre Sözleşmesi).
 *
 * `uSortMode` bir uniform DEĞİLDİR (CPU sıralama kolu) — renderer düğümünün
 * params'ında string olarak yaşar, ascii `charSet` ile aynı desen.
 */
export const SPLAT_PARAMS: ParamDef[] = [
  { key: 'uSplatScale', label: 'splat ölçeği', min: 0.2, max: 3, default: 1 },
  { key: 'uSplatOpacity', label: 'splat opaklığı', min: 0, max: 1, default: 0.85 },
  { key: 'uMaxScreenRadius', label: 'ekran yarıçap tavanı', min: 8, max: 512, default: 128 },
  { key: 'uBrightness', label: 'parlaklık', min: 0, max: 3, default: 1 },
  { key: 'uLightStrength', label: 'ışık gölgesi', min: 0, max: 1, default: 0.4 },
  { key: 'uAoStrength', label: 'oklüzyon', min: 0, max: 1, default: 0.6 },
];

const SPLAT_VERTEX = /* glsl */ `
  precision highp float;

  uniform sampler2D uSplatA;
  uniform sampler2D uSplatB;
  uniform sampler2D uSplatC;
  uniform float uSplatGrid;
  uniform vec2 uViewport;
  uniform float uSplatScale;
  uniform float uMaxScreenRadius;

  // Quad köşesi: (-1,-1)..(+1,+1). Instance başına splat index'i.
  attribute vec2 aCorner;
  attribute float aSplatIndex;

  varying vec2 vQuad;      // birim elips uzayında köşe konumu
  varying vec4 vColor;     // rgb + AO
  varying float vOpacity;
  varying vec3 vNormalW;

  /** index → GaussianBuffer texel merkezi (y-flip YOK: upload'da çözüldü). */
  vec2 splatUv(float index) {
    float x = mod(index, uSplatGrid);
    float y = floor(index / uSplatGrid);
    return (vec2(x, y) + 0.5) / uSplatGrid;
  }

  /** +z eksenini n'e döndüren 3x3 dönme (Rodrigues, tekillik korumalı). */
  mat3 basisFromNormal(vec3 n) {
    // n ≈ -z iken çapraz çarpım sıfırlanır; o durumda sabit bir eksen seç.
    vec3 up = abs(n.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 t = normalize(cross(up, n));
    vec3 b = cross(n, t);
    return mat3(t, b, n);
  }

  void main() {
    vec2 uv = splatUv(aSplatIndex);
    vec4 A = texture2D(uSplatA, uv);
    vec4 B = texture2D(uSplatB, uv);
    vColor = texture2D(uSplatC, uv);
    vOpacity = A.w;

    vec3 nW = normalize(B.xyz);
    vNormalW = nW;
    float s = max(B.w, 1e-5) * uSplatScale;

    // ── 3B kovaryans (dünya) : Σ₃ = R · diag(s², s², (s·ε)²) · Rᵀ ──────────
    mat3 R = basisFromNormal(nW);
    vec3 sc = vec3(s, s, s * ${SPLAT_FLATTEN.toFixed(3)});
    // M = R · diag(sc) →  Σ₃ = M · Mᵀ
    mat3 M = mat3(R[0] * sc.x, R[1] * sc.y, R[2] * sc.z);

    // ── Görüş uzayına taşı: W = modelView'in 3x3'ü ─────────────────────────
    mat3 W = mat3(modelViewMatrix);
    mat3 MV = W * M;
    mat3 cov3 = MV * transpose(MV);

    vec4 viewPos = modelViewMatrix * vec4(A.xyz, 1.0);
    // Kameranın arkasındaki (ya da tam düzlemindeki) splat: Jacobian ıraksar.
    // Quad'ı yok et (dejenere üçgen), fragment aşamasına hiç gitmesin.
    if (viewPos.z > -0.01) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vQuad = vec2(0.0);
      return;
    }

    // ── Perspektif Jacobian (EWA) ─────────────────────────────────────────
    // x_ndc = fx·X/(-Z), y_ndc = fy·Y/(-Z). projectionMatrix[0][0] = fx,
    // [1][1] = fy (three.js perspektif). Piksele çevirmek için viewport/2.
    float fx = projectionMatrix[0][0] * uViewport.x * 0.5;
    float fy = projectionMatrix[1][1] * uViewport.y * 0.5;
    float invZ = 1.0 / -viewPos.z;
    float invZ2 = invZ * invZ;
    mat2x3 J = mat2x3(
      vec3(fx * invZ, 0.0, fx * viewPos.x * invZ2),
      vec3(0.0, fy * invZ, fy * viewPos.y * invZ2)
    );
    // Σ₂ = Jᵀ · Σ₃ᵥ · J  (mat2x3 sözleşmesi: J kolonları x/y ekranı verir)
    vec3 c0 = cov3 * J[0];
    vec3 c1 = cov3 * J[1];
    float a = dot(J[0], c0);
    float b = dot(J[0], c1);
    float d = dot(J[1], c1);

    // Düşük geçiren düzeltme: bir splat piksel altına inerse Σ₂ tekilleşir ve
    // elips kaybolur (delik). Köşegene 0.3 px² eklemek EWA'nın standart
    // "screen-space prefilter"ıdır — splat en az bir piksel kalır.
    a += 0.3;
    d += 0.3;

    // ── Σ₂'nin özvektörleri = elips eksenleri ──────────────────────────────
    float tr = a + d;
    float det = a * d - b * b;
    float disc = sqrt(max(tr * tr * 0.25 - det, 0.0));
    float l1 = tr * 0.5 + disc;
    float l2 = max(tr * 0.5 - disc, 0.1);
    // Büyük özvektör: (b, l1 - a). b ≈ 0 iken matris ZATEN köşegendir ve bu
    // formül 0/0'a düşer — o dalda eksen, BÜYÜK özdeğerin hangi köşegen
    // girdiye ait olduğuna bakılarak seçilir.
    // (Hata geçmişi: köşegen dalda koşulsuz vec2(1,0) seçiliyordu. Σ₂ köşegen
    // olduğunda — merkezdeki ya da eksen hizalı HER splat — büyük yarıçap
    // yanlış eksene yazılıyordu: elips 90° dönük çiziliyor, normal Y ekseni
    // etrafında eğildiğinde YATAY yerine DİKEY sıkışıyordu. Ölçüm: 0/30/45/60/
    // 75° için h/w = 1.000/0.865/0.712/0.500/0.269 — kısalma miktarı doğru
    // (cos θ), ekseni yanlıştı.)
    vec2 e1 = abs(b) > 1e-6
      ? normalize(vec2(b, l1 - a))
      : (a >= d ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    vec2 e2 = vec2(-e1.y, e1.x);
    float r1 = min(${SPLAT_CUTOFF_SIGMA.toFixed(1)} * sqrt(l1), uMaxScreenRadius);
    float r2 = min(${SPLAT_CUTOFF_SIGMA.toFixed(1)} * sqrt(l2), uMaxScreenRadius);

    // Köşeyi piksel uzayında yerleştir, sonra clip uzayına taşı.
    vec2 offsetPx = e1 * (aCorner.x * r1) + e2 * (aCorner.y * r2);
    vQuad = aCorner * ${SPLAT_CUTOFF_SIGMA.toFixed(1)};

    vec4 clip = projectionMatrix * viewPos;
    // px → NDC: 2/viewport. clip.w ile çarpmak perspektif bölmesini iptal eder.
    clip.xy += offsetPx * (2.0 / uViewport) * clip.w;
    gl_Position = clip;
  }
`;

const SPLAT_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform float uSplatOpacity;
  uniform float uBrightness;
  uniform float uAoStrength;
  uniform float uLightStrength;
  uniform vec3 uLightDir;
  uniform float uFogDensity;
  uniform vec3 uFogColor;

  varying vec2 vQuad;
  varying vec4 vColor;
  varying float vOpacity;
  varying vec3 vNormalW;

  void main() {
    // Mahalanobis uzaklığı birim elips uzayında sadeleşti: |vQuad|² = r².
    float r2 = dot(vQuad, vQuad);
    if (r2 > ${(SPLAT_CUTOFF_SIGMA * SPLAT_CUTOFF_SIGMA).toFixed(1)}) discard;
    float g = exp(-0.5 * r2);

    vec3 col = vColor.rgb;
    // AO renk grid'i sözleşmesiyle aynı: .a = oklüzyon, 1 = açık.
    col *= mix(1.0, vColor.a, uAoStrength);
    // Diffuse: splat normali GERÇEK veridir (D.1 gSplatB) — komşu texel'den
    // türetmeye gerek yok, nokta bulutundaki tahminden daha doğru.
    float diff = max(dot(normalize(vNormalW), normalize(uLightDir)), 0.0);
    col *= mix(1.0, 0.35 + 0.65 * diff, uLightStrength);
    col *= uBrightness;

    float alpha = g * vOpacity * uSplatOpacity;
    if (alpha < 0.003) discard;

    // Sis (Gün A global look): kamera uzaklığına göre değil, dünya z'sine göre
    // uygulanan diğer modlarla aynı basitlikte — splat'ta ekran derinliği yok.
    col = mix(col, uFogColor, clamp(uFogDensity, 0.0, 1.0));

    // Premultiplied alpha: blend "one, one-minus-src-alpha".
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

export function createSplatMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSplatA: { value: null },
      uSplatB: { value: null },
      uSplatC: { value: null },
      uSplatGrid: { value: 384 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uSplatScale: { value: 1 },
      uSplatOpacity: { value: 0.85 },
      uMaxScreenRadius: { value: 128 },
      uAoStrength: { value: 0.6 },
      uBrightness: { value: 1 },
      uLightStrength: { value: 0.4 },
      uLightDir: { value: new THREE.Vector3(0.4, 0.7, 0.6).normalize() },
      uFogDensity: { value: 0 },
      uFogColor: { value: new THREE.Color('#0b0e15') },
    } satisfies SplatMaterialUniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: SPLAT_VERTEX,
    fragmentShader: SPLAT_FRAGMENT,
    transparent: true,
    // Premultiplied "over": fragment rengi zaten alpha ile çarpılı.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    // KRİTİK: depthWrite kapalı. Açık olsaydı önce çizilen splat sonrakini
    // z-test'te eler ve arkadan öne sıralama hiçbir işe yaramazdı.
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  return material;
}
