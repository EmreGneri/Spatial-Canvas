import type { PointCloudMaterial } from './pointCloudMaterial';
import type { AsciiMaterial } from './asciiMaterial';
import type { NeonWireMaterial } from './neonWireMaterial';
import type { SolidMaterial } from './solidMaterial';
import type { SplatMaterial } from './splatMaterial';
import type { CrystalMaterial } from './crystalMaterial';
import type { FeedbackPassUniforms } from './feedbackPass';
import type { ChromaticPassUniforms } from './chromaticPass';
import type { GrainPassUniforms } from './grainPass';
import type { RenderMode } from '../ui/ModeSelector';

/**
 * RENDER PRESET — render katmanının kendi serileştirmesi. Sahiplik: Zeynep.
 *
 * Emre'nin `src/engine/preset.ts` şeması sahnenin tamamını (graf, kamera,
 * medya türü, simülasyon) tutar; bu dosya YALNIZCA render katmanının
 * uniform'larını tutar. İkisi ayrı yaşar — bağlanabilmesi için engine
 * şemasının değişmesi gerekiyor (bkz. rapor: renderer düğümü yalnızca AKTİF
 * modun parametrelerini düz bir sözlükte tutuyor, üç modu birden alamıyor).
 *
 * Serileştirilmeyenler (motor/çalışma zamanı sahipli, kullanıcı kolu değil):
 *   uPositions, uAtlas, tDiffuse, tPrev, uTime, uResolution.
 *   (Neon'un eski uDepth/uTexelSize/uHasDepth uniform'ları Gün C'de kaldırıldı:
 *   kenarlar artık uPositions'ın z'sinden türetiliyor.)
 *
 * Renkler hex ('#rrggbb') olarak yazılır; geri yüklerken THREE.Color YERİNDE
 * değiştirilir (yeni nesne atanmaz) — ControlPanel renk seçicileri mount
 * anındaki referansı tuttuğu için nesne takas edilirse panel sahipsiz kalır.
 */

export const RENDER_PRESET_VERSION = 1;

/**
 * DİKKAT (Gün C bulgusu): bu dosya `engine/params.ts` ParamDef listelerinin
 * ELLE YAZILMIŞ ikinci kopyasıdır. Gün 6'da eklenen ışık/fresnel/normal
 * kolları buraya işlenmemiş, yani hazır preset'ler (presets.ts) ve render
 * preset kaydı o değerleri SESSİZCE düşürüyordu. Eksikler tamamlandı ve yeni
 * alanlar OPSİYONEL yazıldı (eski kayıtlar açılmaya devam eder). Kalıcı çözüm
 * bu katmanı da ParamDef listeleri üzerinden yürütmektir — CHANGELOG'da açık
 * iş olarak duruyor.
 */
export interface PointCloudState {
  uPointSize: number;
  uSizeJitter: number;
  uExtrusionDepth: number;
  uSoftness: number;
  uBrightness: number;
  uNearColor: string;
  uFarColor: string;
  /** Gün 6 (Emre) — yüzey normali + diffuse ışık şiddeti, 0..1. */
  uLightStrength: number;
  /** Işık yönü, dünya uzayı. Uygulanırken normalize edilir. */
  uLightDir: [number, number, number];
  /** Normal türetme ölçeği — büyükte yüzey çizgileri belirir. */
  uNormalScale: number;
  /** Fresnel: siluet kenarı parlaması, 0..1. */
  uFresnelStrength: number;
  /** Gün C — bakılı oklüzyon şiddeti. Opsiyonel: hazır preset'ler yazmaz,
   *  eski kayıtlarda da yoktur; yoksa uniform'un mevcut değeri korunur. */
  uAoStrength?: number;
}

export interface AsciiState {
  uPointSize: number;
  uSizeJitter: number;
  uBgOpacity: number;
  uDepthBias: number;
  uCharRandom: number;
  uColor: string;
  uBgColor: string;
  /**
   * Aktif karakter seti (STRING). Dikkat: `uCharSet` uniform'u hücre SAYISIDIR,
   * karakterlerin kendisi atlasta durur. Geri yüklerken `setCharSet()` çağrılır,
   * o da atlası yeniden üretip sayacı eşitler.
   */
  charSet: string;
}

export interface NeonState {
  uPointSize: number;
  uEdgeThreshold: number;
  uGlowRadius: number;
  uGlowIntensity: number;
  /** @deprecated uGlowIntensity'ye bölündü. Eski kayıtlarda bulunabilir. */
  uGlow?: number;
  uNeonColor: string;
  uFlickerSpeed: number;
  uFlickerIntensity: number;
  uColorVariance: number;
}

export interface SolidState {
  uBrightness: number;
  uLightStrength: number;
  uFresnelStrength: number;
  uNearColor: string;
  uFarColor: string;
  uWallColor: string;
  uAoStrength?: number;
  uSpecular?: number;
}

export interface SplatState {
  uSplatScale: number;
  uSplatOpacity: number;
  uMaxScreenRadius: number;
  uBrightness: number;
  uLightStrength: number;
  uAoStrength: number;
}

/** Gün 2 — crystal modu preset grubu (diğer modlarla aynı şema). */
export interface CrystalState {
  uNormalKaynak: number;
  uFacetScale: number;
  uFresnelStrength: number;
  uFresnelPower: number;
  uSpecStrength: number;
  uSpecPower: number;
  uTintColor: string;
  uDensity: number;
  uSparkleAmount: number;
  uRefractStrength: number;
  uDispersion: number;
}

export interface FeedbackState {
  uFeedbackAmount: number;
  uZoom: number;
  uRotate: number;
  uColorShift: number;
  uDecay: number;
}

export interface ChromaticState {
  uAmount: number;
  uRadial: number;
  uAngle: number;
}

export interface GrainState {
  uGrainAmount: number;
  uGrainSpeed: number;
  uVignette: number;
  uContrast: number;
  uSaturation: number;
}

export interface RenderState {
  version: number;
  mode: RenderMode;
  points: PointCloudState;
  ascii: AsciiState;
  neon: NeonState;
  solid: SolidState;
  /** Gün 8 — opsiyonel: eski kayıtlarda (v1 öncesi) yoktur; yoksa splat
   *  uniform'ları dokunulmadan kalır (uAoStrength deseni). */
  splat?: SplatState;
  /** Gün 2 — opsiyonel: eski kayıtlarda yoktur; yoksa crystal dokunulmaz. */
  crystal?: CrystalState;
  feedback: FeedbackState;
  chromatic: ChromaticState;
  grain: GrainState;
}

/**
 * Serileştirmenin okuyup yazdığı canlı nesneler.
 * Feedback ve chromatic pass'leri henüz composer'a takılı olmadığı için
 * opsiyonel: yoksa varsayılan değerler yazılır, geri yüklemede atlanır.
 * Splat material'ı da aynı sözleşmeyle opsiyoneldir (her zaman kurulu olması
 * gerekmez — EmbedView/ControlPanel bağlamına göre değişir).
 */
export interface RenderTargets {
  mode: RenderMode;
  points: PointCloudMaterial;
  ascii: AsciiMaterial;
  neon: NeonWireMaterial;
  solid: SolidMaterial;
  grain: GrainPassUniforms;
  splat?: SplatMaterial;
  crystal?: CrystalMaterial;
  feedback?: FeedbackPassUniforms;
  chromatic?: ChromaticPassUniforms;
  /** Mod değişimi Engine'den geçer (setPointsMaterial); çağıran bağlar. */
  setMode?: (mode: RenderMode) => void;
}

/** Pass takılı değilken yazılacak değerler — pass factory'lerindeki ilk değerler. */
const FEEDBACK_OFF: FeedbackState = {
  uFeedbackAmount: 0,
  uZoom: 1,
  uRotate: 0,
  uColorShift: 0,
  uDecay: 0.98,
};

const CHROMATIC_OFF: ChromaticState = { uAmount: 0, uRadial: 1, uAngle: 0 };

/** Splat material'ı hedeflerde yokken yazılacak değerler — factory başlangıçları. */
const SPLAT_OFF: SplatState = {
  uSplatScale: 1,
  uSplatOpacity: 0.85,
  uMaxScreenRadius: 128,
  uBrightness: 1,
  uLightStrength: 0.4,
  uAoStrength: 0.6,
};

export function serializeRenderState(targets: RenderTargets): RenderState {
  const p = targets.points.uniforms;
  const a = targets.ascii.uniforms;
  const n = targets.neon.uniforms;
  const s = targets.solid.uniforms;
  const g = targets.grain;
  const f = targets.feedback;
  const c = targets.chromatic;

  return {
    version: RENDER_PRESET_VERSION,
    mode: targets.mode,
    points: {
      uPointSize: p.uPointSize.value,
      uSizeJitter: p.uSizeJitter.value,
      uExtrusionDepth: p.uExtrusionDepth.value,
      uSoftness: p.uSoftness.value,
      uBrightness: p.uBrightness.value,
      uNearColor: `#${p.uNearColor.value.getHexString()}`,
      uFarColor: `#${p.uFarColor.value.getHexString()}`,
      uLightStrength: p.uLightStrength.value,
      uLightDir: [p.uLightDir.value.x, p.uLightDir.value.y, p.uLightDir.value.z],
      uNormalScale: p.uNormalScale.value,
      uFresnelStrength: p.uFresnelStrength.value,
      uAoStrength: p.uAoStrength.value,
    },
    ascii: {
      uPointSize: a.uPointSize.value,
      uSizeJitter: a.uSizeJitter.value,
      uBgOpacity: a.uBgOpacity.value,
      uDepthBias: a.uDepthBias.value,
      uCharRandom: a.uCharRandom.value,
      uColor: `#${a.uColor.value.getHexString()}`,
      uBgColor: `#${a.uBgColor.value.getHexString()}`,
      charSet: targets.ascii.charSet,
    },
    neon: {
      uPointSize: n.uPointSize.value,
      uEdgeThreshold: n.uEdgeThreshold.value,
      uGlowRadius: n.uGlowRadius.value,
      uGlowIntensity: n.uGlowIntensity.value,
      uNeonColor: `#${n.uNeonColor.value.getHexString()}`,
      uFlickerSpeed: n.uFlickerSpeed.value,
      uFlickerIntensity: n.uFlickerIntensity.value,
      uColorVariance: n.uColorVariance.value,
      // uTime serileştirilmez: material kendi sürüyor, kullanıcı kolu değil.
    },
    solid: {
      uBrightness: s.uBrightness.value,
      uLightStrength: s.uLightStrength.value,
      uFresnelStrength: s.uFresnelStrength.value,
      uNearColor: `#${s.uNearColor.value.getHexString()}`,
      uFarColor: `#${s.uFarColor.value.getHexString()}`,
      uWallColor: `#${s.uWallColor.value.getHexString()}`,
      uAoStrength: s.uAoStrength.value,
      uSpecular: s.uSpecular.value,
    },
    splat: targets.splat
      ? {
          uSplatScale: targets.splat.uniforms.uSplatScale.value,
          uSplatOpacity: targets.splat.uniforms.uSplatOpacity.value,
          uMaxScreenRadius: targets.splat.uniforms.uMaxScreenRadius.value,
          uBrightness: targets.splat.uniforms.uBrightness.value,
          uLightStrength: targets.splat.uniforms.uLightStrength.value,
          uAoStrength: targets.splat.uniforms.uAoStrength.value,
        }
      : { ...SPLAT_OFF },
    crystal: targets.crystal
      ? {
          uNormalKaynak: targets.crystal.uniforms.uNormalKaynak.value,
          uFacetScale: targets.crystal.uniforms.uFacetScale.value,
          uFresnelStrength: targets.crystal.uniforms.uFresnelStrength.value,
          uFresnelPower: targets.crystal.uniforms.uFresnelPower.value,
          uSpecStrength: targets.crystal.uniforms.uSpecStrength.value,
          uSpecPower: targets.crystal.uniforms.uSpecPower.value,
          uTintColor: `#${targets.crystal.uniforms.uTintColor.value.getHexString()}`,
          uDensity: targets.crystal.uniforms.uDensity.value,
          uSparkleAmount: targets.crystal.uniforms.uSparkleAmount.value,
          uRefractStrength: targets.crystal.uniforms.uRefractStrength.value,
          uDispersion: targets.crystal.uniforms.uDispersion.value,
        }
      : undefined,
    feedback: f
      ? {
          uFeedbackAmount: f.uFeedbackAmount.value,
          uZoom: f.uZoom.value,
          uRotate: f.uRotate.value,
          uColorShift: f.uColorShift.value,
          uDecay: f.uDecay.value,
        }
      : { ...FEEDBACK_OFF },
    chromatic: c
      ? { uAmount: c.uAmount.value, uRadial: c.uRadial.value, uAngle: c.uAngle.value }
      : { ...CHROMATIC_OFF },
    grain: {
      uGrainAmount: g.uGrainAmount.value,
      uGrainSpeed: g.uGrainSpeed.value,
      uVignette: g.uVignette.value,
      uContrast: g.uContrast.value,
      uSaturation: g.uSaturation.value,
    },
  };
}

/**
 * Preset'i canlı uniform'lara uygular. Bilinmeyen/eksik alanlar ATLANIR ve
 * uyarı olarak döner — eski bir preset açıldığında sahne patlamaz.
 */
export function applyRenderState(
  targets: RenderTargets,
  state: RenderState,
): { warnings: string[] } {
  const warnings: string[] = [];

  if (state.version !== RENDER_PRESET_VERSION) {
    warnings.push(
      `render preset sürümü ${state.version}, beklenen ${RENDER_PRESET_VERSION} — tanınan alanlar yine de uygulandı`,
    );
  }

  const num = (value: unknown, uniform: { value: number }) => {
    if (typeof value === 'number' && Number.isFinite(value)) uniform.value = value;
  };
  // Renk YERİNDE değişir: panelin tuttuğu THREE.Color referansı korunur.
  const col = (value: unknown, uniform: { value: { set: (v: string) => void } }) => {
    if (typeof value === 'string') uniform.value.set(value);
  };

  if (state.points) {
    const p = targets.points.uniforms;
    num(state.points.uPointSize, p.uPointSize);
    num(state.points.uSizeJitter, p.uSizeJitter);
    num(state.points.uExtrusionDepth, p.uExtrusionDepth);
    num(state.points.uSoftness, p.uSoftness);
    num(state.points.uBrightness, p.uBrightness);
    col(state.points.uNearColor, p.uNearColor);
    col(state.points.uFarColor, p.uFarColor);
    num(state.points.uLightStrength, p.uLightStrength);
    num(state.points.uNormalScale, p.uNormalScale);
    num(state.points.uFresnelStrength, p.uFresnelStrength);
    // Vektör YERİNDE güncellenir (uniform'un tuttuğu nesne korunur) ve
    // normalize edilir: shader n·light bekliyor, elle yazılmış bir preset
    // birim boyda olmayabilir. Sıfır vektör normalize'da NaN üretirdi.
    const dir = state.points.uLightDir;
    if (Array.isArray(dir) && dir.length === 3 && dir.every((n) => typeof n === 'number')) {
      const [x, y, z] = dir;
      if (x * x + y * y + z * z > 1e-8) p.uLightDir.value.set(x, y, z).normalize();
      else warnings.push('uLightDir sıfır vektör — yok sayıldı');
    }
    // Gün C: bakılı oklüzyon kolu (num, sayı olmayanı atlar → alanı olmayan
    // eski kayıtlarda uniform'un mevcut değeri korunur).
    num(state.points.uAoStrength, p.uAoStrength);
  }

  if (state.ascii) {
    const a = targets.ascii.uniforms;
    num(state.ascii.uPointSize, a.uPointSize);
    num(state.ascii.uSizeJitter, a.uSizeJitter);
    num(state.ascii.uBgOpacity, a.uBgOpacity);
    num(state.ascii.uDepthBias, a.uDepthBias);
    num(state.ascii.uCharRandom, a.uCharRandom);
    col(state.ascii.uColor, a.uColor);
    col(state.ascii.uBgColor, a.uBgColor);
    // Atlası yeniden üretir ve uCharSet sayacını eşitler.
    if (typeof state.ascii.charSet === 'string') targets.ascii.setCharSet(state.ascii.charSet);
  }

  if (state.neon) {
    const n = targets.neon.uniforms;
    num(state.neon.uPointSize, n.uPointSize);
    num(state.neon.uEdgeThreshold, n.uEdgeThreshold);
    num(state.neon.uGlowRadius, n.uGlowRadius);
    // Geriye dönük: uGlow tek başınayken parlaklık çarpanıydı. Yeni anahtar
    // yoksa eskisi okunur, varsa eskisi yok sayılır.
    num(state.neon.uGlowIntensity ?? state.neon.uGlow, n.uGlowIntensity);
    col(state.neon.uNeonColor, n.uNeonColor);
    num(state.neon.uFlickerSpeed, n.uFlickerSpeed);
    num(state.neon.uFlickerIntensity, n.uFlickerIntensity);
    num(state.neon.uColorVariance, n.uColorVariance);
  }

  if (state.solid) {
    const s = targets.solid.uniforms;
    num(state.solid.uBrightness, s.uBrightness);
    num(state.solid.uLightStrength, s.uLightStrength);
    num(state.solid.uFresnelStrength, s.uFresnelStrength);
    col(state.solid.uNearColor, s.uNearColor);
    col(state.solid.uFarColor, s.uFarColor);
    col(state.solid.uWallColor, s.uWallColor);
    num(state.solid.uAoStrength, s.uAoStrength);
    num(state.solid.uSpecular, s.uSpecular);
  }

  if (state.crystal) {
    const cr = targets.crystal;
    if (cr) {
      num(state.crystal.uNormalKaynak, cr.uniforms.uNormalKaynak);
      num(state.crystal.uFacetScale, cr.uniforms.uFacetScale);
      num(state.crystal.uFresnelStrength, cr.uniforms.uFresnelStrength);
      num(state.crystal.uFresnelPower, cr.uniforms.uFresnelPower);
      num(state.crystal.uSpecStrength, cr.uniforms.uSpecStrength);
      num(state.crystal.uSpecPower, cr.uniforms.uSpecPower);
      col(state.crystal.uTintColor, cr.uniforms.uTintColor);
      num(state.crystal.uDensity, cr.uniforms.uDensity);
      num(state.crystal.uSparkleAmount, cr.uniforms.uSparkleAmount);
      num(state.crystal.uRefractStrength, cr.uniforms.uRefractStrength);
      num(state.crystal.uDispersion, cr.uniforms.uDispersion);
    } else {
      warnings.push("crystal material kurulu değil — preset'in crystal ayarları uygulanmadı");
    }
  }

  if (state.splat) {
    const sp = targets.splat;
    if (sp) {
      num(state.splat.uSplatScale, sp.uniforms.uSplatScale);
      num(state.splat.uSplatOpacity, sp.uniforms.uSplatOpacity);
      num(state.splat.uMaxScreenRadius, sp.uniforms.uMaxScreenRadius);
      num(state.splat.uBrightness, sp.uniforms.uBrightness);
      num(state.splat.uLightStrength, sp.uniforms.uLightStrength);
      num(state.splat.uAoStrength, sp.uniforms.uAoStrength);
    } else {
      warnings.push('splat material kurulu değil — preset\'in splat ayarları uygulanmadı');
    }
  }

  if (state.feedback) {
    const f = targets.feedback;
    if (f) {
      num(state.feedback.uFeedbackAmount, f.uFeedbackAmount);
      num(state.feedback.uZoom, f.uZoom);
      num(state.feedback.uRotate, f.uRotate);
      num(state.feedback.uColorShift, f.uColorShift);
      num(state.feedback.uDecay, f.uDecay);
    } else if (state.feedback.uFeedbackAmount > 0) {
      warnings.push('feedback pass zincirde yok — preset\'in feedback ayarları uygulanmadı');
    }
  }

  if (state.chromatic) {
    const c = targets.chromatic;
    if (c) {
      num(state.chromatic.uAmount, c.uAmount);
      num(state.chromatic.uRadial, c.uRadial);
      num(state.chromatic.uAngle, c.uAngle);
    } else if (state.chromatic.uAmount > 0) {
      warnings.push('chromatic pass zincirde yok — preset\'in chromatic ayarları uygulanmadı');
    }
  }

  if (state.grain) {
    const g = targets.grain;
    num(state.grain.uGrainAmount, g.uGrainAmount);
    num(state.grain.uGrainSpeed, g.uGrainSpeed);
    num(state.grain.uVignette, g.uVignette);
    num(state.grain.uContrast, g.uContrast);
    num(state.grain.uSaturation, g.uSaturation);
  }

  // Mod en son: material takası Engine'den geçer, uniform yazımından bağımsız.
  if (state.mode && state.mode !== targets.mode) {
    if (targets.setMode) targets.setMode(state.mode);
    else warnings.push(`mod '${state.mode}' uygulanamadı — setMode bağlanmamış`);
  }

  return { warnings };
}
