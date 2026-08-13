import {
  RENDER_PRESET_VERSION,
  type AsciiState,
  type ChromaticState,
  type FeedbackState,
  type NeonState,
  type PointCloudState,
  type RenderState,
  type SolidState,
} from './renderPreset';

/**
 * HAZIR PRESET'LER — render katmanı. Sahiplik: Zeynep.
 *
 * Koddan gelir, silinemez. Kullanıcının kaydettikleri localStorage'da durur
 * (bkz. ControlPanel).
 *
 * Her preset TÜM grupları doldurur. Bir preset'in ilgilenmediği gruplar
 * (örneğin nokta bulutu preset'inde ascii ayarları) aşağıdaki VARSAYILAN
 * sabitlerden gelir; bunlar material/pass factory'lerindeki ilk değerlerin
 * birebir aynısıdır — mod değiştirildiğinde bilinen bir noktadan başlanır.
 */

/** pointCloudMaterial.ts factory değerleri. */
const DEFAULT_POINTS: PointCloudState = {
  uPointSize: 6,
  uSizeJitter: 0.3,
  uExtrusionDepth: 0,
  uSoftness: 0.5,
  uBrightness: 1,
  uNearColor: '#edf9ff',
  uFarColor: '#455990',
};

/** asciiMaterial.ts factory değerleri. */
const DEFAULT_ASCII: AsciiState = {
  uPointSize: 16,
  uSizeJitter: 0,
  uBgOpacity: 0,
  uDepthBias: 0,
  uCharRandom: 0,
  uColor: '#edf9ed',
  uBgColor: '#272738',
  charSet: ' .:-=+*#%@',
};

/** neonWireMaterial.ts factory değerleri. */
const DEFAULT_NEON: NeonState = {
  uPointSize: 3,
  uEdgeThreshold: 0.1,
  uGlowRadius: 0,
  uGlowIntensity: 1.5,
  uNeonColor: '#7cffed',
  uFlickerSpeed: 2,
  uFlickerIntensity: 0,
  uColorVariance: 0,
};

/** solidMaterial.ts factory değerleri. */
const DEFAULT_SOLID: SolidState = {
  uBrightness: 1,
  uLightStrength: 0.45,
  uFresnelStrength: 0.35,
  uNearColor: '#d9f2ff',
  uFarColor: '#0f1a47',
  uWallColor: '#23262e',
};

/** Feedback kapalı: uFeedbackAmount 0 iken diğerlerinin etkisi yoktur. */
const FEEDBACK_OFF: FeedbackState = {
  uFeedbackAmount: 0,
  uZoom: 1,
  uRotate: 0,
  uColorShift: 0,
  uDecay: 0.98,
};

/** Chromatic kapalı: uAmount 0 iken üç kanal da aynı noktadan örneklenir. */
const CHROMATIC_OFF: ChromaticState = { uAmount: 0, uRadial: 1, uAngle: 0 };

export const BUILT_IN_PRESETS: { name: string; state: RenderState }[] = [
  {
    name: 'sis',
    state: {
      version: RENDER_PRESET_VERSION,
      mode: 'points',
      points: {
        uPointSize: 11,
        uSizeJitter: 0.55,
        uExtrusionDepth: 0,
        uSoftness: 0.9,
        uBrightness: 0.7,
        uNearColor: '#b8bcc4',
        uFarColor: '#14161c',
      },
      ascii: { ...DEFAULT_ASCII },
      neon: { ...DEFAULT_NEON },
      solid: { ...DEFAULT_SOLID },
      feedback: { ...FEEDBACK_OFF },
      chromatic: { ...CHROMATIC_OFF },
      grain: {
        uGrainAmount: 0.05,
        uGrainSpeed: 0.6,
        uVignette: 1.1,
        uContrast: 0.75,
        uSaturation: 0.15,
      },
    },
  },
  {
    name: 'negatif',
    state: {
      version: RENDER_PRESET_VERSION,
      mode: 'points',
      points: {
        uPointSize: 4,
        uSizeJitter: 0.2,
        uExtrusionDepth: 0,
        uSoftness: 0.1,
        uBrightness: 1.4,
        uNearColor: '#ffffff',
        uFarColor: '#000000',
      },
      ascii: { ...DEFAULT_ASCII },
      neon: { ...DEFAULT_NEON },
      solid: { ...DEFAULT_SOLID },
      feedback: { ...FEEDBACK_OFF },
      chromatic: { ...CHROMATIC_OFF },
      grain: {
        uGrainAmount: 0.22,
        uGrainSpeed: 0,
        uVignette: 0.3,
        uContrast: 1.75,
        uSaturation: 0,
      },
    },
  },
  {
    name: 'terminal',
    state: {
      version: RENDER_PRESET_VERSION,
      mode: 'ascii',
      points: { ...DEFAULT_POINTS },
      ascii: {
        uPointSize: 30,
        uSizeJitter: 0,
        uBgOpacity: 0.25,
        uDepthBias: -0.1,
        uCharRandom: 0.15,
        uColor: '#7dd88f',
        uBgColor: '#060a07',
        charSet: ' .:-=+*#%@',
      },
      neon: { ...DEFAULT_NEON },
      solid: { ...DEFAULT_SOLID },
      feedback: { ...FEEDBACK_OFF },
      chromatic: { uAmount: 0.002, uRadial: 1, uAngle: 0 },
      grain: {
        uGrainAmount: 0.04,
        uGrainSpeed: 2.5,
        uVignette: 0.7,
        uContrast: 1.2,
        uSaturation: 1,
      },
    },
  },
  {
    name: 'akış',
    state: {
      version: RENDER_PRESET_VERSION,
      mode: 'points',
      points: {
        uPointSize: 5,
        uSizeJitter: 0.4,
        uExtrusionDepth: 0,
        uSoftness: 0.6,
        uBrightness: 0.9,
        uNearColor: '#e8e4dc',
        uFarColor: '#2a2420',
      },
      ascii: { ...DEFAULT_ASCII },
      neon: { ...DEFAULT_NEON },
      solid: { ...DEFAULT_SOLID },
      feedback: {
        uFeedbackAmount: 0.82,
        uZoom: 1.006,
        uRotate: 0.0035,
        uColorShift: 0.3,
        uDecay: 0.975,
      },
      chromatic: { uAmount: 0.006, uRadial: 1, uAngle: 0 },
      grain: {
        uGrainAmount: 0.06,
        uGrainSpeed: 1.2,
        uVignette: 0.5,
        uContrast: 1.1,
        uSaturation: 0.5,
      },
    },
  },
  {
    name: 'iskelet',
    state: {
      version: RENDER_PRESET_VERSION,
      mode: 'neon',
      points: { ...DEFAULT_POINTS },
      ascii: { ...DEFAULT_ASCII },
      neon: {
        uPointSize: 2,
        uEdgeThreshold: 0.06,
        // 'iskelet'in tarifindeki glow 2.2 parlaklık çarpanıydı; çap eklenmemişti.
        uGlowRadius: 0,
        uGlowIntensity: 2.2,
        uNeonColor: '#9ff5e0',
        // Titreşim/sapma preset tanımında yoktu — kapalı bırakıldı,
        // 'iskelet'in tarif edilen görünümü değişmesin.
        uFlickerSpeed: 2,
        uFlickerIntensity: 0,
        uColorVariance: 0,
      },
      solid: { ...DEFAULT_SOLID },
      feedback: {
        uFeedbackAmount: 0.35,
        uZoom: 1,
        uRotate: 0,
        uColorShift: 0,
        uDecay: 0.94,
      },
      chromatic: { uAmount: 0.009, uRadial: 1, uAngle: 0 },
      grain: {
        uGrainAmount: 0.03,
        uGrainSpeed: 0,
        uVignette: 0.85,
        uContrast: 1.3,
        uSaturation: 0.8,
      },
    },
  },
];
