import * as THREE from 'three';
import { POINTS_DEPTH_RANGE } from '../engine/buffers';
import type { ParamDef } from '../engine/params';

/**
 * ASCII MATERIAL — render katmanı, ikinci render modu. Sahiplik: Zeynep.
 *
 *   engine.setPointsMaterial(createAsciiMaterial())
 *
 * Sözleşme `pointCloudMaterial.ts` ile birebir aynı (ARCHITECTURE.md · Point
 * Cloud Sözleşmesi): konumlar `uPositions` texture'ından okunur, geometri
 * yalnızca `aUv` taşır, z orijine ortalıdır, `w` parçacık tohumudur ve
 * `gl_PointSize` bölmesinde `max(-mv.z, 0.1)` kırpması korunur.
 *
 * Fark: her parçacık daire yerine bir ASCII karakteri çizer. Karakter,
 * parçacığın derinliğine göre seçilir — uzak seyrek, yakın yoğun.
 */

/** Hazır karakter setleri. İlki varsayılan. Hepsi boştan doluya sıralı. */
export const CHAR_SETS: { label: string; chars: string }[] = [
  { label: 'ASCII', chars: ' .:-=+*#%@' },
  { label: 'Blok', chars: ' ░▒▓█' },
  { label: 'Nokta', chars: ' ·∙•●' },
  { label: 'Çizgi', chars: ' /\\|-_' },
];

/** Atlastaki bir karakter hücresinin piksel boyutu. */
const CELL = 64;

/** Bu eşiğin altındaki glif kapsaması karakter sayılmaz (kenar kirini temizler). */
const ALPHA_CUTOFF = 0.35;

/** Surrogate çiftlerine dayanıklı karakter listesi. */
function toChars(chars: string): string[] {
  return Array.from(chars);
}

export interface AsciiMaterialUniforms {
  /**
   * Simülasyonun ping-pong RT texture'ı. Değerini Engine her karede yazar;
   * material asla atama yapmaz. İlk kare çizilmeden önce Engine mutlaka
   * yazdığı için başlangıçtaki null hiçbir draw call'a ulaşmaz.
   */
  uPositions: { value: THREE.Texture | null };
  /** Çalışma zamanında üretilen karakter atlası (N×1 hücre). */
  uAtlas: { value: THREE.Texture };
  /**
   * Aktif karakter setinin hücre sayısı. Uniform string tutamaz: gliflerin
   * kendisi `uAtlas`'ta, buradaki sayı hücre haritalamasını sürer.
   * `setCharSet()` ikisini birlikte günceller.
   */
  uCharSet: { value: number };
  /** 8..40 — karakterler okunabilir kalsın diye noktalardan büyük */
  uPointSize: { value: number };
  /** 0..1 — w tohumuyla boyut saçılması; 0 = hepsi eşit boyutta */
  uSizeJitter: { value: number };
  /** karakter rengi */
  uColor: { value: THREE.Color };
  /** hücre arkasındaki dolgu rengi */
  uBgColor: { value: THREE.Color };
  /** 0..1 — dolgu opaklığı; 0 = hücre arkası tamamen şeffaf */
  uBgOpacity: { value: number };
  /** −0.5..0.5 — karakter seçimini yoğun (+) ya da seyrek (−) tarafa kaydırır */
  uDepthBias: { value: number };
  /** 0..1 — 0 = saf derinlik haritası, 1 = karakterler tohuma göre karışık */
  uCharRandom: { value: number };
}

/**
 * Parametre sözleşmesi (Gün 4): ascii modunun preset'e giren kolları.
 * uAtlas/uCharSet uniform değil API'dir (setCharSet) — burada yoklar;
 * aktif karakter seti (charSet) preset'e string olarak renderer düğümünün
 * params'ında gider, setCharSet ile geri yüklenir.
 */
export const ASCII_PARAMS: ParamDef[] = [
  { key: 'uPointSize', label: 'karakter boyutu', min: 8, max: 40, default: 16 },
  { key: 'uSizeJitter', label: 'boyut saçılması', min: 0, max: 1, default: 0 },
  { key: 'uColor', label: 'karakter rengi', min: 0, max: 1, default: 0, kind: 'color' },
  { key: 'uBgColor', label: 'dolgu rengi', min: 0, max: 1, default: 0, kind: 'color' },
  { key: 'uBgOpacity', label: 'dolgu opaklığı', min: 0, max: 1, default: 0 },
  { key: 'uDepthBias', label: 'derinlik kayması', min: -0.5, max: 0.5, default: 0 },
  { key: 'uCharRandom', label: 'karakter rastgeleliği', min: 0, max: 1, default: 0 },
];

/** ShaderMaterial, uniform'ları tipli görünsün ve atlas takası kapsansın diye. */
export type AsciiMaterial = THREE.ShaderMaterial & {
  uniforms: AsciiMaterialUniforms;
  /**
   * Aktif karakter seti. Kaynak doğruluk burada: UI unmount olup geri
   * geldiğinde seçili seti buradan okur, kendi hatırladığını varsaymaz.
   */
  charSet: string;
  /**
   * Karakter setini değiştirir: atlası yeniden üretir, eskisini bırakır ve
   * `uCharSet`'i yeni hücre sayısına eşitler. Shader'ın yeniden derlenmesi
   * gerekmez — hücre sayısı uniform, derleme zamanı sabiti değil.
   */
  setCharSet: (chars: string) => void;
};

/**
 * Karakter atlasını çalışma zamanında canvas2d ile üretir — dosya indirme yok.
 * Karakterler tek satırda, yoğunluk sırasına göre; siyah zemine beyaz monospace.
 * Beyaz kapsamayı maske olarak kullanırız (kırmızı kanal).
 */
function createAtlasTexture(chars: string[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * chars.length;
  canvas.height = CELL;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(CELL * 0.78)}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], i * CELL + CELL / 2, CELL / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  // Hücre sınırları keskin kalsın: glif bulanıklaşırsa ASCII okunmaz olur.
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

const VERTEX = /* glsl */ `
  uniform sampler2D uPositions;
  uniform float uPointSize;
  uniform float uSizeJitter;

  attribute vec2 aUv;

  varying float vDepth;
  varying float vSeed;

  void main() {
    vec4 pos = texture2D(uPositions, aUv);

    // z orijin etrafında ortalı (−RANGE/2 .. +RANGE/2) → karakter seçimi için 0..1.
    vDepth = clamp(pos.z / ${POINTS_DEPTH_RANGE.toFixed(1)} + 0.5, 0.0, 1.0);

    // w = parçacık başına sabit tohum (0..1); simülasyon bunu korur.
    vSeed = pos.w;

    vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);

    // Tohumla boyut saçılması. 1 etrafında simetrik: ortalama boyut sabit kalır,
    // uSizeJitter = 0 iken çarpan tam 1 olur (saçılma kapanır).
    float jitter = mix(1.0 - uSizeJitter, 1.0 + uSizeJitter, vSeed);

    // max() kırpması ZORUNLU: kameranın arkasına/üstüne düşen noktalarda
    // -mv.z ~ 0 olur, bölme patlar ve dev karakterler ekranı doldurur.
    gl_PointSize = uPointSize * jitter / max(-mv.z, 0.1);

    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uCharSet;
  uniform vec3 uColor;
  uniform vec3 uBgColor;
  uniform float uBgOpacity;
  uniform float uDepthBias;
  uniform float uCharRandom;

  varying float vDepth;
  varying float vSeed;

  const float ALPHA_CUTOFF = ${ALPHA_CUTOFF};

  void main() {
    // Derinlikten gelen hücre konumu ile tohumdan gelen rastgele konumun
    // karışımı: uCharRandom = 0 → saf derinlik, 1 → parçacık başına rastgele
    // (tohum sabit olduğu için karakter karede titremez).
    float d = clamp(vDepth + uDepthBias, 0.0, 1.0);
    float mixed = mix(d * uCharSet, vSeed * uCharSet, uCharRandom);
    float index = clamp(floor(mixed), 0.0, uCharSet - 1.0);

    // gl_PointCoord'u atlasın o hücresine haritala. Dikey ters çevrilir:
    // gl_PointCoord.y aşağı doğru artar, CanvasTexture ise flipY = true ile
    // yüklenir (v = 1 → canvas'ın üstü). Çevrilmezse karakterler baş aşağı çıkar.
    vec2 uv = vec2(
      (index + gl_PointCoord.x) / uCharSet,
      1.0 - gl_PointCoord.y
    );

    // Atlas siyah zemine beyaz: kırmızı kanal glif kapsamasıdır.
    float mask = texture2D(uAtlas, uv).r;
    float glyph = mask * step(ALPHA_CUTOFF, mask);

    // Karakter, hücre dolgusunun ÜSTÜNE gelir (source-over). Eşiğin altı artık
    // fragment'i atmaz — dolgu varsa hücre yine boyanmalı; yalnızca ikisi de
    // yoksa atılır.
    float alpha = glyph + uBgOpacity * (1.0 - glyph);
    if (alpha < 0.001) discard;
    vec3 col = (uColor * glyph + uBgColor * uBgOpacity * (1.0 - glyph)) / alpha;

    gl_FragColor = vec4(col, alpha);
  }
`;

export function createAsciiMaterial(): AsciiMaterial {
  // `let`: setCharSet atlası takas eder, dispose kancası güncelini bırakmalı.
  let atlas = createAtlasTexture(toChars(CHAR_SETS[0].chars));

  // Her material kendi uniform objesini alır; iki instance state paylaşmaz.
  const uniforms: AsciiMaterialUniforms = {
    uPositions: { value: null },
    uAtlas: { value: atlas },
    uCharSet: { value: toChars(CHAR_SETS[0].chars).length },
    uPointSize: { value: 16 },
    uSizeJitter: { value: 0 },
    uColor: { value: new THREE.Color(0.85, 0.95, 0.85) },
    uBgColor: { value: new THREE.Color(0.02, 0.02, 0.04) },
    uBgOpacity: { value: 0 },
    uDepthBias: { value: 0 },
    uCharRandom: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    name: 'ascii',
    // ShaderMaterial index signature'lı bir uniform sözlüğü bekler; dışarıya
    // açtığımız katı arayüzü bozmamak için daraltma yalnızca burada.
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    // Karakterler üst üste binerse öndeki kazansın istemiyoruz; sıralama yok,
    // derinlik yazımı kapalı. Normal blending (additive değil).
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const ascii = material as AsciiMaterial;
  ascii.charSet = CHAR_SETS[0].chars;

  ascii.setCharSet = (chars: string) => {
    const list = toChars(chars);
    // Boş set atlası 0 genişlikte yapar ve uCharSet'i 0'a çeker: bölme patlar.
    if (list.length === 0) return;
    const next = createAtlasTexture(list);
    atlas.dispose(); // eski atlas GPU'da kalmasın
    atlas = next;
    uniforms.uAtlas.value = next;
    uniforms.uCharSet.value = list.length;
    ascii.charSet = chars;
  };

  // Material.dispose() uniform'daki texture'ı kendiliğinden bırakmaz. Render
  // modları takas edilirken (Engine eskisini dispose eder) atlas sızmasın.
  // Closure `atlas` bağını okur: setCharSet sonrası güncel olanı bırakır.
  ascii.addEventListener('dispose', () => atlas.dispose());

  return ascii;
}
