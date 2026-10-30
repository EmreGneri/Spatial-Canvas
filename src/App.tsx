import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { yuzNoktalari } from './engine/vision/yuzTespit';
import { beginPhotoMeasurement } from './engine/photoMeasurement';
import { yuzRolyefHaritasi, type YuzRolyefi } from './engine/reconstruction/yuzRolyef';
import { photoPerspectiveEnabled, type PhotoCameraInput } from './engine/reconstruction/photoPerspective';
import { readExifFocal } from './vendor/splat.js/io/exif.js';
import { estimateDepth, depthDevice, FOTO_KALITE, loadDepthModel, luminanceHeightMap, resetLuminanceState } from './depth';
import { segmentForeground, preloadPhotoMaskBytes } from './engine/reconstruction/segmentation';
import { resampleBilinear } from './engine/reconstruction/silhouette';
import { captureLiveMask, estimateMaskShift, shiftLiveMask } from './engine/vision/liveMask';
import { liveInterpolationEnabled, shouldPresentLiveDepth } from './engine/vision/liveDepthFlow';
import { estimatePreparationSeconds, prepareVideoDepth, videoPreparationPolicy, type VideoDepthHandle, type VideoDepthProgress, type VideoMaskCapture } from './engine/vision/videoPrecompute';
import { startBufferedVideoPlayback } from './engine/vision/bufferedVideoPlayback';
import { logMaskJob, videoStats, type VideoMaskJob } from './engine/vision/videoStats';
import { maskeOverlayKaynagi, type OverlayMask } from './ui/maskOverlay';
import { previewNextAt } from './engine/vision/previewBudget';
import { Engine } from './engine';
import { VIDEO_EDGE_CLEANUP_DEFAULT } from './engine/Engine';
import { ControlPanel } from './ui/ControlPanel';
import { createPointCloudMaterial, POINTS_PARAMS } from './shaders/pointCloudMaterial';
import { createAsciiMaterial, ASCII_PARAMS } from './shaders/asciiMaterial';
import { createNeonWireMaterial, NEON_PARAMS } from './shaders/neonWireMaterial';
import { createSolidMaterial, SOLID_PARAMS } from './shaders/solidMaterial';
import { createSplatMaterial, SPLAT_FLATTEN, SPLAT_PARAMS } from './shaders/splatMaterial';
import { createCrystalMaterial, createCrystalSplatMaterial, CRYSTAL_PARAMS } from './shaders/crystalMaterial';
import { ModeSelector, type RenderMode } from './ui/ModeSelector';
import { CapturePanel } from './ui/CapturePanel';
import { MetricsPanel } from './ui/MetricsPanel';
import { NodeGraphEditor } from './ui/NodeGraphEditor';
import { TrackerOverlay } from './ui/TrackerOverlay';
import { ExportBar } from './ui/ExportBar';
import { TransportSerit } from './ui/TransportSerit';
import { LiveVideoControls, type LiveVideoStats } from './ui/LiveVideoControls';
import { liveGeometryAgeMs } from './ui/liveVideoStats';
import { KutuphanePaneli } from './ui/KutuphanePaneli';
import { kaynakBelirle } from './ui/presetOnizleme';
import { soganAcilisGerekliMi, sunumAcikMi } from './ui/sunumModu';
import { serializeRenderState } from './shaders/renderPreset';
import { AYIRMA_KAPATMA_ORANI, maskeKarari, maskeTekParcaOrani, videoAyirmaDurumu, videoMaskeIstegi } from './ui/maskeKarari';
import { classifyCategory, type CategoryInput } from './ui/category';
import { useDarEkran } from './ui/useDarEkran';
import { ACILIS_BOY, ACILIS_EN, ACILIS_NOTU, acilisDerinligi, BINALAR, GOK, KURE, UFUK_Y, ZEMIN } from './ui/acilisSahnesi';
import { indirmeDinle, indirmeSifirla } from './indirmeIlerleme';
import { birincilDugme, bosluk, cam, dugme as temaDugme, led, MONO, renk, SANS, yaricap, yazi, yuzey } from './ui/tema';
import { YetenekUyarisi } from './ui/YetenekUyarisi';
import { Egitim3D } from './ui/Egitim3D';
import { EgitimGrafik } from './ui/EgitimGrafik';
import { seriEkle, type GrafikNoktasi } from './ui/egitimIlerleme';
import { SplatTemizleme } from './ui/SplatTemizleme';
import { motorKaynagi } from './ui/temizlemeKaynagi';
import { ArDugmesi } from './ui/ArDugmesi';
import {
  girisDegerleri, KALITE_GRUPLARI, type KaliteGrubu, type ModHafizasi,
} from './shaders/modKalite';
import { BLOOM_PARAMS } from './shaders/bloomPass';
import { CHROMATIC_PARAMS } from './shaders/chromaticPass';
import { GRAIN_PARAMS } from './shaders/grainPass';
import { LOOK_PARAMS } from './shaders/look';
import { applyParams, type ParamDef } from './engine/params';
import * as THREE from 'three';
import { type TrackedTarget, type TrackerModu } from './engine/vision/tracker';
import { TrackerClient } from './engine/vision/trackerClient';
import {
  canliGirdiBoyutu, isitLiveModel, liveDepthKullanilabilir, liveGrabSize,
  startLiveDepth, type LiveDepthResult,
} from './engine/vision/liveDepth';
import { yetenekRaporu } from './engine/vision/yetenek';
import {
  applyPreset,
  deleteSlot,
  downloadPresetFile,
  listSlots,
  loadSlot,
  parsePresetFile,
  PRESET_VERSION,
  saveSlot,
  toPreset,
} from './engine/preset';
import { exportPly, exportPNG, exportWebM } from './engine/export';
import { buildFusionScene, captureKeyframes } from './engine/vision/videoPipe';
import { captureGeneration, sourceErrorMessage } from './sourceGuard';

/**
 * Video/kamera luminance yolunda temporal smoothing katsayısı (kalite kararı):
 * luminance her karede home'a 1:1 yazılır; video codec gürültüsü parçacıkların
 * Z'sini her karede dürttüğünde bulut sürekli titriyordu. lerp ile geçen kareye
 * sabitlenir — gürültü ölür, gerçek hareket akışkan kalır. Küçük tutulur.
 */
const LUMINANCE_SMOOTHING_ALPHA = 0.12;
/**
 * GÜN C — hareket duyarlı harman: sabit α = 0.1 gürültüyü söndürüyordu ama
 * gerçek hareketi de ~10 kare geciktiriyordu (el sallamada iz/hayalet). Piksel
 * başına fark büyükse harman katsayısı 1'e doğru açılır: durgun bölge kararlı,
 * hareketli bölge anında takip eder. |Δ| ≥ ~0.15 → tam takip.
 */
const LUMINANCE_MOTION_GAIN = 6;
/** Video hazırlanırken canlı V2 çıkarımları arası en az süre (GPU kuyruğu paylaşılır). */
const PREPARING_LIVE_INFER_MS = 500;
const VIDEO_STAGE_LABEL: Record<VideoDepthProgress['stage'], string> = {
  loading: 'yükleniyor', decoding: 'kareler çözülüyor', processing: 'işleniyor',
  finalizing: 'derinlik kaydediliyor',
  ready: 'hazır', fallback: 'canlı derinlik', cancelled: 'iptal edildi',
};
const LOG_LIMIT = 200;

/**
 * ARAÇ ÇUBUĞU STİLİ (Gün 5, Zeynep — UI/UX cilası).
 *
 * Üst şerit 13 kontrole çıktı ve üç ayrı stille karışıyordu: tarayıcı
 * varsayılanı (açık gri), ad-hoc renkli toggle'lar ve PNG/WebM'in koyu
 * stili. Hepsi ModeSelector/ControlPanel'in koyu terminal diline çekildi;
 * şerit `flexWrap` ile sarıyor (dar pencerede ipucu metni kırpılıyordu).
 *
 * Toggle'ların vurgu rengi ANLAM taşır ve değişmedi: yeşil = nesne ayırma,
 * turuncu = maske tanısı, mavi = tracker HUD.
 */
const toolButton: CSSProperties = temaDugme(false);

/**
 * Toggle'ın AÇIK hâli: vurgu rengi dolgusu + aynı renkte hafif parıltı. Renk
 * hâlâ ANLAM taşır (yeşil = nesne ayırma, turuncu = maske, mavi = tracker),
 * ama artık düz blok yerine camın üstünde ışıyan bir yüzey.
 */
function toggleButton(active: boolean, accent: string): CSSProperties {
  if (!active) return toolButton;
  // Etkin hâl DOLGU ile ayrışır, ışımayla değil: ekranda aynı anda birden
  // çok ışık kaynağı olması "efekt gösterisi" hissi veriyordu.
  return {
    ...temaDugme(false),
    background: `${accent}26`,
    borderColor: `${accent}66`,
    color: '#fff',
  };
}

/**
 * Çalışma alanı: canvas · kütüphane (ince) · efektler. Dar ekranda alt alta
 * iner. `minmax(0, …)` şart — `auto` sütun içeriğin max-content'ine şişip
 * kadrajı taşırıyordu.
 */
/** Sahnenin üstünde duran çalışma katmanı — sahneyi örtmez, köşede durur. */
const calismaKatmani: CSSProperties = {
  position: 'absolute',
  left: 10,
  top: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: yaricap.kontrol,
  background: 'rgba(10,12,16,0.78)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: renk.kenar,
  color: renk.metin,
  fontSize: yazi.govde,
  pointerEvents: 'none',
};

/** Nabız atan nokta: CSS animasyonu index.html'de (`sc-nabiz`). */
const calismaNokta: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: renk.vurgu,
  animation: 'sc-nabiz 1s ease-in-out infinite',
};

function calismaAlani(dar: boolean, sunum: boolean): CSSProperties {
  /**
   * SUNUMDA İKİ SÜTUN. Normalde kütüphane ve efektler ayrı sütunlar; efekt
   * rafı sunumda kapalı başladığı için 6 satırdan sonra sütunun altı boş
   * kalıyordu (ölçüldü 1680×1050: ~296×600 px hiçbir şey göstermiyor).
   * İkisi tek sütunda üst üste konunca o boşluk kütüphaneyle dolar ve
   * artı ~270 px tuvale geçer.
   */
  const genisSutunlar = sunum
    ? 'minmax(360px, 1fr) minmax(0, 264px)'
    : 'minmax(360px, 1fr) minmax(0, 228px) minmax(0, 296px)';
  return {
    display: 'grid',
    gridTemplateColumns: dar ? 'minmax(0, 1fr)' : genisSutunlar,
    alignItems: 'start',
    gap: dar ? 10 : 12,
    width: '100%',
    minWidth: 0,
  };
}

function ustSerit(dar: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: dar ? 4 : 8,
    width: '100%',
    maxWidth: 'min(960px, 100%)',
    boxSizing: 'border-box',
    padding: dar ? '8px 8px' : '8px 16px',
    ...cam({ blur: 24, radius: yaricap.panel }),
  };
}

/** Gruplar arası ince ayraç — şerit sardığında da grupları ayırır. */
const toolDivider: CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.18), transparent)',
  margin: '0 4px',
};


/**
 * Yüz rölyefi güç tavanı (MediaPipe yüz ağı, yuzRolyef.ts). Varsayılan 1.5;
 * otomatik yolda zayıf yüz derinliği ek güçle sivrilmesin diye kazanç sınırlanır.
 * `?yuz=<güç>` ezer, `?yuz=0` kapatır.
 */
const VARSAYILAN_YUZ_GUCU = 1.5;
const YUZ_GUCU = (() => {
  if (typeof location === 'undefined') return VARSAYILAN_YUZ_GUCU;
  const ham = new URLSearchParams(location.search).get('yuz');
  if (ham === null) return VARSAYILAN_YUZ_GUCU;
  const v = Number(ham);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 4) : 0;
})();
export default function App() {  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** Tracker HUD veri üreteci (Emre, engine/vision/tracker.ts) — kaynak
   *  değiştiğinde (teardownSource) sıfırlanır, eski karenin izi sızmasın. */
  const trackerRef = useRef<TrackerClient | null>(null);
  /** Son hesaplanan hedefler. Motorun çizim-sonrası kancasında yazılır,
   *  overlay'in kendi rAF'ında okunur — iki döngü birbirini beklemez. */
  const trackerTargetsRef = useRef<TrackedTarget[]>([]);
  /** Canlı model derinliği sürücüsünü durduran kanca (yoksa çalışmıyor). */
  const liveDepthStopRef = useRef<(() => void) | null>(null);
  /** Luminance vekili hâlâ çizsin mi? Model devralınca false olur —
   *  rVFC zinciri kendi kendini beslediği için durdurma bayrağı şart. */
  const luminanceActiveRef = useRef(false);
  const luminanceFrameRef = useRef<{ video: HTMLVideoElement; id: number } | null>(null);
  const videoMaskRequestRef = useRef<(() => void) | null>(null);
  const videoDepthRefreshRef = useRef<(() => void) | null>(null);
  const preparedVideoRef = useRef<VideoDepthHandle | null>(null);
  const preparedVideoAbortRef = useRef<AbortController | null>(null);
  const preparedVideoStopRef = useRef<(() => void) | null>(null);
  const preparedVideoUsableRef = useRef(false);
  /** Hazırlık sürüyor: canlı çıkarım kısılır (F4), V2 zorlanır (F11). */
  const videoPreparingRef = useRef(false);
  /** Nesne ayırma açılınca hazır videonun maske izini başlatır (varsa). */
  const preparedMaskRequestRef = useRef<(() => void) | null>(null);
  const maskPreparingRef = useRef(false);
  const preparedFrameTimeRef = useRef(-Infinity);
  const preparedFramePresenterRef = useRef<((frame: LiveDepthResult) => void) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Bumped by teardownSource; async source paths bail out once it moves (sourceGuard.ts). */
  const sourceGenRef = useRef(0);
  /** getUserMedia in flight: cameraOn flips only after the stream plays, so it cannot block a second click. */
  const cameraStartingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  /** Z3 — mobil düzen: sabit sağ panel akışa girer, sahne kadraja sığar. */
  const dar = useDarEkran();
  const [mode, setMode] = useState<RenderMode>('points');
  // Render modu material'ları BİR KEZ üretilir; mod değişiminde yalnızca takas
  // edilir. Atlas rasterleştirmesi (ASCII) her tıkta tekrarlanmasın.
  const materials = useMemo(
    () => ({
      points: createPointCloudMaterial(),
      ascii: createAsciiMaterial(),
      neon: createNeonWireMaterial(),
      solid: createSolidMaterial(),
      splat: createSplatMaterial(),
      crystal: createCrystalMaterial(),
    }),
    [],
  );
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [videoEdgeCleanup, setVideoEdgeCleanup] = useState(VIDEO_EDGE_CLEANUP_DEFAULT);
  const [liveRates, setLiveRates] = useState({ model: 0, flow: 0 });
  const liveQualityRef = useRef(154);
  const [liveQuality, setLiveQuality] = useState(154);
  const [playbackVideo, setPlaybackVideo] = useState<HTMLVideoElement | null>(null);
  const [liveStats, setLiveStats] = useState<LiveVideoStats>({ path: 'loading', hz: 0,
    inferenceMs: 0, width: 0, height: 0, frames: 0, mediaTime: null, geometryAgeMs: null });
  const [videoPreparation, setVideoPreparation] = useState<VideoDepthProgress | null>(null);
  /** Hazır videonun maske izi ilerlemesi (0..1); null = istenmedi. */
  const [videoMaskProgress, setVideoMaskProgress] = useState<number | null>(null);
  // Always start on the reference live path. Preparation is an explicit session choice.
  const [videoProcessing, setVideoProcessing] = useState(() =>
    new URLSearchParams(location.search).get('videoHazirla') === '1');
  /** Uzun video: hazırlık için onay bekleniyor (tahmini süreyle). */
  const [videoPreparationAsk, setVideoPreparationAsk] = useState<{ file: File; video: HTMLVideoElement; estimate: number } | null>(null);
  const [segment, setSegment] = useState(false);
  const segmentRef = useRef(false);
  /** Kullanıcı nesne ayırmayı bu kaynakta KAPATTI: video maskesi kendiliğinden üretilmez (referans yol). */
  const segmentKapaliRef = useRef(false);
  const segmentRevisionRef = useRef(0);
  const updateSegment = (next: boolean) => {
    segmentRef.current = next;
    segmentRevisionRef.current++;
    setSegment(next);
  };
  /** Tanılama: RMBG maskesini overlay olarak göster (model mi, morf mu?). */
  const [showMask, setShowMask] = useState(false);
  /** Tracker HUD overlay açık mı (Gün 2: mock veri — gerçek tracker.ts
   *  bağlantısı akşam sync'inde takılır). */
  const [trackerOn, setTrackerOn] = useState(false);
  // Gerçek 3DGS eğitimi: son yüklenen video dosyası (kare seçimi dosyanın
  // kendisini ister, <video> öğesini değil) ve eğitimi süren dosya.
  const [videoDosya, setVideoDosya] = useState<File | null>(null);

  /** Model indirme satiri (`indirmeIlerleme`); indirme yokken null. */
  const [indirme, setIndirme] = useState<string | null>(null);
  useEffect(() => indirmeDinle(setIndirme), []);
  const [egitimDosya, setEgitimDosya] = useState<File | null>(null);
  /** 3D eğitim kalite eğrisi — transport şeridinin altında çizilir. */
  const [egitimSeri, setEgitimSeri] = useState<GrafikNoktasi[]>([]);
  const [egitimHedef, setEgitimHedef] = useState(0);
  const [egitimBitti, setEgitimBitti] = useState(false);
  /** Splat temizleme aracı açık mı (sahnenin üstünde seçim katmanı). */
  const [temizlemeAcik, setTemizlemeAcik] = useState(false);
  /**
   * SUNUM MODU (`?sunum=1`) — bkz. `ui/sunumModu.ts`. Render boyunca sabit:
   * `useState`'in başlangıç değeri olarak okunur, böylece bir kez hesaplanır
   * ve hiçbir effect'e bağımlılık eklemez.
   */
  const [sunum] = useState(() => sunumAcikMi(window.location.search));
  /** Soğuk açılış yalnız BİR KEZ tetiklenir. */
  const soganTetiklendi = useRef(false);
  // CapturePanel (hızlı 3B harita) kendi Depth Anything çıkarımını koşar —
  // splat.js eğitimiyle aynı WebGPU cihazını paylaşır. İkisi eşzamanlı
  // koşarsa DXGI_ERROR_DEVICE_HUNG riski var (VENDORED.md koruma 4); bu
  // yüzden ikisi karşılıklı kilitlenir. CapturePanel kendi running durumunu
  // buraya bildirir.
  const [captureRunning, setCaptureRunning] = useState(false);

  useEffect(() => {
    engine?.setSuspended(egitimDosya !== null);
    return () => engine?.setSuspended(false);
  }, [engine, egitimDosya]);
  /** Tracker modu: 'ozellik' kontrast kümeleri (model yok) · 'nesne' COCO
   *  tespiti (etiketli kutular). HUD panelindeki seçiciden değişir. */
  const [trackerMod, setTrackerMod] = useState<TrackerModu>('ozellik');
  const [useTextureColor, setUseTextureColor] = useState(true);
  const [fps, setFps] = useState(0);
  /** Editör dışından graf kurulduğunda (preset yükleme) editörü tazele. */
  const [graphTick, setGraphTick] = useState(0);
  /** ControlPanel caches uniform values at mount; bump after reset / graph
   *  apply so it re-reads them instead of showing stale numbers. */
  const [panelTick, setPanelTick] = useState(0);
  const refreshPanel = () => setPanelTick((t) => t + 1);
  /** Son yüklenen fotoğraf kaynağı — nesne ayırma sonradan açılırsa RMBG'yi
   *  yeniden çalıştırmak için saklanır (Tur 12: buton canlı shader'a bağlı). */
  const lastPhotoRef = useRef<HTMLCanvasElement | HTMLImageElement | null>(null);
  const lastPhotoCameraRef = useRef<PhotoCameraInput | undefined>(undefined);
  const lastDepthRef = useRef<{ data: Float32Array; width: number; height: number } | null>(null);
  /** Bu kaynak için maske zaten üretildi mi? (video/kamera yollarında sıfırlanır) */
  const maskLoadedRef = useRef(false);
  /** Maske overlay canvas'ı ve görünürlük aynası — async yollardan (run,
   *  toggleSegment) drawMaskOverlay çağrılır; state'i beklemez. */
  const segOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const maskOverlayOnRef = useRef(false);
  /** Video: the mask the engine got with the last depth frame (null = none applied); the overlay draws it. */
  const appliedVideoMaskRef = useRef<OverlayMask | null>(null);
  const drawnOverlayMaskRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    // Dev-only switch gives the E3 benchmark an identical main-thread path.
    const mainTracker = import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get('trackerBackend') === 'main';
    const tracker = new TrackerClient({}, mainTracker);
    trackerRef.current = tracker;
    if (import.meta.env.DEV) (window as unknown as { __tracker?: TrackerClient }).__tracker = tracker;
    const engine = new Engine(containerRef.current!);
    engineRef.current = engine;
    setEngine(engine);
    // Yalnızca dev: tarayıcı konsolundan motor durumunu ölçmek için
    // (dev-smoke.ts ve elle tanı). Üretim bundle'ında yok.
    if (import.meta.env.DEV) Object.assign(window, { __engine: engine, __videoStats: videoStats });    // Render katmanının shader'ı yer tutucunun yerine geçer (başlangıç modu).
    // Engine yer tutucuyu dispose eder; uPositions'ı her karede o yazar.
    // Modların parametre tanımları da kaydedilir — preset serileştirmesi bunları okur.
    engine.registerRenderMode('points', materials.points, POINTS_PARAMS);
    engine.registerRenderMode('ascii', materials.ascii, ASCII_PARAMS);
    engine.registerRenderMode('neon', materials.neon, NEON_PARAMS);
    engine.registerRenderMode('solid', materials.solid, SOLID_PARAMS);
    engine.registerRenderMode('splat', materials.splat, SPLAT_PARAMS);
    engine.registerRenderMode('crystal', materials.crystal, CRYSTAL_PARAMS);
    // Gün 3: crystal video kaynağında da çizsin — splat varyantı ORTAK
    // uniform nesnelerini kullanır, ayrı knob seti yoktur.
    engine.setCrystalSplatMaterial(createCrystalSplatMaterial(materials.crystal));
    // BAŞLANGIÇ MODU da profilini alır. Yalnız `changeMode`'a bağlasaydık
    // uygulama ilk açılışta (points) post-FX'siz görünür, kullanıcı bir mod
    // değiştirip geri gelmeden farkı göremezdi.
    modKaliteUygula('points');
    engine.setPointsMaterial(materials.points);
    // Z3 (yerleşim): motorun tuvali AKIŞTAN çıkarılır. Sebep ölçüldü —
    // konteynere `aspect-ratio` verildiğinde tuval kendi CSS yüksekliğiyle
    // (önceki karenin ölçüsü) konteyneri geri itiyor ve oran hiç uygulanmıyor
    // (353×302 ölçüldü, oranın istediği 353×232). Tuval absolute olunca
    // konteynerin ölçüsünü oran belirler, Engine.resize de o ölçüyü okur.
    // Engine yalnız width/height yazar; position'a dokunmaz.
    {
      const cv = engine.renderer.domElement;
      cv.style.position = 'absolute';
      cv.style.top = '0';
      cv.style.left = '0';
    }
    const textureType = engine.simTextureLabel;
    setLog((prev) => [
      ...prev,
      `engine hazır · ${engine.positionCount.toLocaleString('tr-TR')} parçacık slotu · sim RT: ${textureType} · sürükle-döndür`,
      'point cloud material → shaders/pointCloudMaterial (soft particle, additive · video: alpha blend)',
    ]);
    const fpsTimer = window.setInterval(() => setFps(engine.fps), 1000);
    // GÜN 6 (URL) — ?preset=<slotAdı> sayfa açılışında yükler (paylaşılabilir link).
    const urlPreset = new URLSearchParams(window.location.search).get('preset');
    if (urlPreset) {
      const preset = loadSlot(urlPreset);
      if (preset) {
        try {
          const { applied, warnings } = applyPreset(engine, preset);
          setLog((prev) => [...prev, `URL preset yüklendi: "${urlPreset}" · düğümler: ${applied.length}`]);
          for (const w of warnings) setLog((prev) => [...prev, `  uyarı: ${w}`]);
        } catch (err) {
          setLog((prev) => [...prev, `URL preset HATA: ${err instanceof Error ? err.message : String(err)}`]);
        }
      } else {
        setLog((prev) => [...prev, `URL preset bulunamadı: "${urlPreset}"`]);
      }
    }
    return () => {
      clearInterval(fpsTimer);
      teardownSource();
      tracker.dispose();
      trackerRef.current = null;
      // Sahiplik: bu material'lar burada üretildi, burada bırakılır.
      // Engine yalnızca kendi yer tutucusunu dispose eder (Engine.setPointsMaterial).
      engine.dispose();
      materials.points.dispose();
      materials.ascii.dispose();
      materials.neon.dispose();
      materials.solid.dispose(); // düzeltme: solid material sızdırılıyordu
      materials.splat.dispose();
      materials.crystal.dispose();
      setEngine(null);
    };
  }, [materials]);

  const say = (line: string) => setLog((prev) => [...prev.slice(-(LOG_LIMIT - 1)), line]);

  /** Preset kütüphanesinin okuyup yazdığı hedefler — panelle aynı sözleşme. */
  const panelHedefleri = () => ({
    mode,
    points: materials.points,
    ascii: materials.ascii,
    neon: materials.neon,
    solid: materials.solid,
    splat: materials.splat,
    crystal: materials.crystal,
    grain: engineRef.current!.grainUniforms,
    feedback: engineRef.current!.feedbackUniforms,
    chromatic: engineRef.current!.chromaticUniforms,
    setMode: changeMode,
  });

  function clearTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  /**
   * Çalışan kaynağı (video/kamera) tamamen bırakır. ÇAĞRI SIRASI ÖNEMLİ: yeni
   * kaynak oluşturulmadan ÖNCE çağrılır — sonra çağrılırsa yeni açılan video'yu
   * durdurur.
   */
  function teardownSource() {
    setVideoLook(false);
    setPhotoPreview(false);
    engineRef.current?.setSuspended(false);
    // Every pending async source path (photo inference, camera prompt, video
    // decode, live-depth start) sees this and stops before writing anything.
    sourceGenRef.current++;
    preparedVideoAbortRef.current?.abort();
    preparedVideoAbortRef.current = null;
    videoPreparingRef.current = false;
    preparedVideoStopRef.current?.();
    preparedVideoStopRef.current = null;
    void preparedVideoRef.current?.dispose().catch(() => {});
    preparedVideoRef.current = null;
    preparedVideoUsableRef.current = false;
    preparedFrameTimeRef.current = -Infinity;
    preparedFramePresenterRef.current = null;
    preparedMaskRequestRef.current = null;
    maskPreparingRef.current = false;
    setVideoPreparation(null);
    setVideoMaskProgress(null);
    setVideoPreparationAsk(null);
    clearTimer();
    luminanceActiveRef.current = false;
    cancelLuminanceFrame();
    // Canlı model derinliği sürücüsü de bırakılır — yeni kaynak eski
    // sürücüyle çakışmasın (iki döngü aynı GPU kuyruğunda çekişir).
    liveDepthStopRef.current?.();
    liveDepthStopRef.current = null;
    videoMaskRequestRef.current = null;
    videoDepthRefreshRef.current = null;
    setLiveRates({ model: 0, flow: 0 });
    // GÜN 6 (madde 4): canlı home modunu kapat — sonraki fotoğraf yolu toptan
    // yazar (eski davranış korunur).
    const engine = engineRef.current;
    if (engine) {
      engine.dynamicHome = false;
      engine.simUniforms.uGrabStrength.value = 0;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      videoRef.current = null;
    }
    appliedVideoMaskRef.current = null;
    if (maskOverlayOnRef.current) drawMaskOverlay();
    setPlaybackVideo(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // Tur 12 (şikayet 1): GPU'daki video dokusunu bırak — yeni kaynak
    // gelene kadar eski karelerin renkleri parçacıklarda kalmasın.
    engineRef.current?.setVideoSource(null);
    // Tracker HUD (Gün 2 akşam sync): eski kaynağın luminance karesi yeni
    // kaynakla karşılaştırılırsa sahte akış üretir — kaynak değişiminde sil.
    trackerRef.current?.reset();
    trackerTargetsRef.current = [];
  }

  /** Örnek sahne: çizim + YAZILI derinlik, tek kod yolundan (`run`). */
  function acilisSahne() {
    const g = syntheticImage();
    return run(g, acilisDerinligi(g.width, g.height));
  }

  /**
   * @param analitikDerinlik ÖRNEK SAHNE için YAZILI derinlik (ui/acilisSahnesi).
   *   Verilirse model yükleme, nesne ayırma, çıkarım ve yüz rölyefi ATLANIR;
   *   geri kalan her şey (setPhoto, setYuzRolyefi, setDepth, overlay, meşgul
   *   durumu) AYNEN işler.
   *
   *   NEDEN BURADA, AYRI BİR FONKSİYONDA DEĞİL: önce `run`'ı baypas eden ayrı
   *   bir yol yazmıştım. `run`'ın yaptığı birkaç yan etkiyi atladığı için
   *   örnek sahneden sonra yüklenen fotoğraf sentetik düzenin üstüne biniyordu
   *   (Emre'nin bildirimi, 2026-10-24: point cloud/ASCII/neon'da özne ezik).
   *   Tek kod yolu = iki sahne arasında fark yok.
   */
  async function run(
    source: HTMLCanvasElement | HTMLImageElement,
    analitikDerinlik?: Float32Array,
    photoFile?: Blob,
  ) {
    setBusy(true);
    setPhotoPreview(false);
    // Captured after the caller's teardownSource. A stale result must not
    // write depth, mask, photo or segmentation settings over a newer source.
    const isCurrent = captureGeneration(sourceGenRef);
    const measurement = analitikDerinlik ? null : beginPhotoMeasurement({
      generation: sourceGenRef.current, width: source.width, height: source.height,
    });
    let measurementStatus: 'ready' | 'failed' | 'cancelled' = 'cancelled';
    const measurementMeta: Record<string, unknown> = {
      scope: 'decoded-photo-through-geometry',
      includesImageDecode: false, includesFirstPresentedFrame: false,
      encoding: 'separate-output-measurement',
    };
    const olc = <T,>(name: string, task: () => Promise<T>): Promise<T> =>
      measurement ? measurement.measure(name, task) : task();
    const olcSync = <T,>(name: string, task: () => T): T =>
      measurement ? measurement.measureSync(name, task) : task();
    let previewTimer: number | undefined;
    let photoGpuBudget = false;
    try {
      // DA3/MoGe seçimini estimateDepth yönetir; burada ek V2 oturumu ayırma.
      if (!analitikDerinlik && FOTO_KALITE.model === 'v2-small') {
        const t0 = performance.now();
        await olc('depth.load', () => loadDepthModel());
        if (!isCurrent()) return;
        say(`model yüklendi            ${Math.round(performance.now() - t0)} ms`);
      }

      // Nesne/arka plan ayırma (RMBG): fotoğraflarda OTOMATİK — Gün B temizlik
      // kararı: solid mesh silüeti maskeyle kesilir (arka plan büstü yastığa
      // çevirir), parçacıklar da arka planı atar. Maske depth ile aynı görsel
      // alanı kapsar (letterbox + kırpım) ama boyutu farklıdır; Engine maskeyi
      // depth boyutuna örnekler ve siluete AND eder. Başarısızlıkta maske
      // olmadan devam (silüet depth eşiğine düşer) — hoparlörden say edilir.
      //
      // GÜN E (bulgu 1): RMBG artık depth'ten ÖNCE koşar. Sebep: estimateDepth
      // stretch/sobel/eğim aşamalarını bu maskeyle çalıştırıyor; maske-kör
      // koştuğunda gövde/ayna karesinde yakın zemin "ön plan" sayılıyor ve
      // özne düz kalıyordu (ölçüm: özne derinlik aralığı 0.116 → 0.117 vs
      // gerçek maskeyle 0.850). Maske üretilemezse depth eskisi gibi maskesiz
      // koşar — bu yol AYNEN korunur.
      let mask: Float32Array | undefined;
      let maskW = 0;
      let maskH = 0;
      let categoryMask: CategoryInput = {};
      lastPhotoRef.current = source;
      lastPhotoCameraRef.current = undefined;
      maskLoadedRef.current = false;
      const progressive = !analitikDerinlik && FOTO_KALITE.model !== 'moge-2'
        && !photoPerspectiveEnabled(location.search)
        && new URLSearchParams(location.search).get('onizleme') !== '0';
      if (progressive) {
        photoGpuBudget = true;
        engineRef.current!.setSuspended(true);
      }
      if (progressive) void preloadPhotoMaskBytes().catch(() => {});
      async function prepareMask() {
        if (!isCurrent()) throw new Error('Photo source changed');
        if (analitikDerinlik) {
          // Analitik sahnede ayırma YOK: maske zaten anlamsız, IS-Net de inmez.
          updateSegment(false);
          engineRef.current!.setObjectSeparation(false);
        } else {
          const t2 = performance.now();
          try {
            const seg = await olc('segmentation.pipeline', () => segmentForeground(source, 'webgpu', 'foto'));
            measurementMeta.segmentationModel = seg.model;
            if (!isCurrent()) throw new Error('Photo source changed');
            // Güvenlik: boş maske (sentetik/soyut görsel) kullanılmaz — AND tüm
            // silueti sıfırlar, mesh null'a düşer, parçacıklar ölür.
            // GÜN E (bulgu 9): boş maske kadar TÜM KAREYİ kaplayan maske de
            // kullanılamaz. RMBG bazı karelerde (ölçüldü: ayna selfie'si) "her
            // piksel ön plan" döndürüyor — o maske hiçbir şey ayırmaz ama ZARAR
            // verir: stretch aralığı sahnenin tamamına açılır (özne bandı yine
            // sıkışır) ve siluet AND'i arka planı elemez. Eşik %92: gerçek bir
            // özne kadrajı tamamen doldursa bile RMBG kenarlarda 0 bırakır;
            // %92 üstü pratikte "model pes etti" demektir.
            let fgCount = 0;
            for (let q = 0; q < seg.mask.length; q++) {
              if (seg.mask[q] >= 0.5) fgCount++;
            }
            // GÜN 25 (düzeltme): karar ÜÇ uçlu. Alt uç eskiden yoktu ve IS-Net'e
            // geçince sentetik görselde maske kadrajın %4,7'sini seçip sahnenin
            // gerisini siliyordu — ekran pratikte siyahtı, sebebi de yazmıyordu.
            // Eşiklerin ölçümü: ui/maskeKarari.ts başlığı.
            const mainComponent = maskeTekParcaOrani(seg.mask, seg.width, seg.height);
            const karar = maskeKarari(fgCount / seg.mask.length, mainComponent);
            categoryMask = { maskCoverage: fgCount / seg.mask.length, maskMainComponent: mainComponent, maskAccepted: karar.tip === 'kullan' };
            if (karar.sebep) say(karar.sebep);
            if (karar.tip === 'kullan') {
              mask = seg.mask;
              maskW = seg.width;
              maskH = seg.height;
              maskLoadedRef.current = true;
              say(`nesne ayırma (${seg.model === 'birefnet' ? 'BiRefNet' : 'IS-Net'})  ${Math.round(performance.now() - t2)} ms  (${maskW}x${maskH})`);
            }
            updateSegment(karar.ayirmaAcik);
            engineRef.current!.setObjectSeparation(karar.ayirmaAcik);
          } catch (err) {
            if (!isCurrent()) throw new Error('Photo source changed');
            say(`nesne ayırma atlandı (${err instanceof Error ? err.message : String(err)}); maske olmadan devam`);
            updateSegment(false);
            engineRef.current!.setObjectSeparation(false);
          }
        }
        if (!isCurrent()) throw new Error('Photo source changed');
        return mask ? { data: mask, width: maskW, height: maskH } : undefined;
      }
      if (!progressive) await prepareMask();

      // Depth ARTIK maskeyi görüyor (GÜN E, bulgu 1).
      let depth: Partial<Awaited<ReturnType<typeof estimateDepth>>> & { data: Float32Array; width: number; height: number };
      let photoFace: Awaited<ReturnType<typeof yuzNoktalari>> | undefined;
      if (analitikDerinlik) {
        depth = { data: analitikDerinlik, width: source.width, height: source.height };
        say(ACILIS_NOTU);
      } else {
        const t1 = performance.now();
        const focal35 = photoFile ? (await olc('photo.exif', () => readExifFocal(photoFile)))?.f35 : undefined;
        if (!isCurrent()) return;
        const photoCamera: PhotoCameraInput | undefined = photoPerspectiveEnabled(location.search) ? { focal35 } : undefined;
        if (photoCamera) {
          photoFace = await olc('face.pipeline', () => yuzNoktalari(source));
          if (!isCurrent()) return;
          if (photoFace) photoCamera.face = [photoFace.noktalar[234],photoFace.noktalar[454]];
        }
        lastPhotoCameraRef.current = photoCamera;
        depth = await olc('depth.pipeline', () => estimateDepth(
          source,
          { ...FOTO_KALITE,
            ...(progressive ? {
              prepareSubjectMask: prepareMask,
              onPreview: async (preview: Awaited<ReturnType<typeof estimateDepth>>) => {
                if (!isCurrent()) throw new Error('Photo source changed');
                olcSync('geometry.preview', () => {
                  const engine = engineRef.current!;
                  engine.setPhoto(source);
                  engine.setMetricPhotoGeometry(null);
                  engine.setYuzRolyefi(null);
                  engine.setObjectSeparation(false);
                  engine.setDepth(preview.data, preview.width, preview.height);
                  engine.yenidenTohumla();
                  engine.renderFrame();
                });
                // Keep the preview visible without competing with model inference at full frame rate.
                previewTimer = window.setInterval(() => {
                  if (isCurrent()) engineRef.current?.renderFrame();
                }, 1000);
                measurementMeta.previewReadyMs = measurement ? performance.now() - measurement.startedAt : undefined;
                setPhotoPreview(true);
                say('Önizleme hazır · maske ve kalite iyileştiriliyor…');
                // Let the renderer present the coarse scene before expensive mask setup.
                await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                if (!isCurrent()) throw new Error('Photo source changed');
              },
            } : {}),
            ...(photoCamera ? { photoCamera } : {}),
            ...(mask ? { subjectMask: { data: mask, width: maskW, height: maskH } } : {}) },
        ));
        if (!isCurrent()) return;
        measurementMeta.depthModel = depth.sourceModel;
        measurementMeta.depthBackend = depthDevice;
        measurementMeta.davidMask = depth.davidMaske;
        say(
          `çıkarım                  ${Math.round(performance.now() - t1)} ms  (${depth.width}x${depth.height})` +
            (depth.sourceModel ? ` · ${depth.sourceModel}` : '') +
            (mask ? ' · özne maskesi kullanıldı' : ' · maskesiz') +
            (depth.davidMaske ? ` · DAViD maskesi (${depth.davidMaske.arkaUc}, ${Math.round(depth.davidMaske.sureMs)} ms)` : ''),
        );
      }
      lastDepthRef.current = { data: depth.data, width: depth.width, height: depth.height };

      // TUR 11: fotoğrafın kendisi de parçacık renklerine bağlanır (görev 1 —
      // varsayılan mavi rampa yerine orijinal RGB). Kamera/video yolu bu
      // çağrıyı yapmaz → shader'lar derinlik rampasına düşer.
      olcSync('geometry.photo-colors', () => engineRef.current!.setPhoto(source));
      engineRef.current!.setMetricPhotoGeometry(depth.metricGeometry ?? null);
      // YÜZ RÖLYEFİ (varsayılan, ?yuz=0 kapatır): MediaPipe yüz ağının 3B şekli yüz bölgesine işlenir
      // (yuzRolyef.ts). Yüz bulunamazsa ya da kapalıysa null → eski davranış birebir.
      let rolyef: YuzRolyefi | null = null;
      if (YUZ_GUCU > 0 && !analitikDerinlik) {
        const t3 = performance.now();
        const yuz = photoFace === undefined ? await olc('face.pipeline', () => yuzNoktalari(source)) : photoFace;
        if (!isCurrent()) return;
        photoFace = yuz;
        rolyef = yuz ? olcSync('geometry.face-relief-map', () => yuzRolyefHaritasi(yuz.noktalar, depth.width, depth.height, YUZ_GUCU,
          new URLSearchParams(location.search).get('yuz') === null)) : null;
        say(rolyef
          ? `yüz rölyefi              ${Math.round(performance.now() - t3)} ms  (${yuz!.noktalar.length} nokta, güç tavanı ×${YUZ_GUCU})`
          : 'yüz rölyefi: yüz bulunamadı, uygulanmadı');
      }
      engineRef.current!.setYuzRolyefi(rolyef);
      if (!analitikDerinlik && isCurrent()) {
        // Yalnız kayıt: mevcut yüz sonucunu kullan; ek model çağrısı yapma.
        try {
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 128 / Math.max(source.width, source.height));
          canvas.width = Math.max(1, Math.round(source.width * scale));
          canvas.height = Math.max(1, Math.round(source.height * scale));
          const context = canvas.getContext('2d');
          context?.drawImage(source, 0, 0, canvas.width, canvas.height);
          const result = classifyCategory({ ...categoryMask, faceDetected: photoFace === undefined ? undefined : !!photoFace,
            frame: context?.getImageData(0, 0, canvas.width, canvas.height) });
          console.info('[category:photo]', result);
          say(`kategori: ${result.kategori} · sezgisel puan ${result.guven.toFixed(2)} (kalibre değil)`);
        } catch (error) { console.warn('[category:photo] signals unavailable', error); }
      }
      // Deliği kapatılmış maske (derinlik ızgarasında) varsa motor da onu kullanır:
      // siluet aynı maskeden çıkar, yoksa yüz/karındaki delikler 3B'de boş kalır.
      olcSync('geometry.depth-points-shell', () => {
        if (depth.subjectMask) engineRef.current!.setDepth(depth.data, depth.width, depth.height, depth.subjectMask, depth.width, depth.height);
        else engineRef.current!.setDepth(depth.data, depth.width, depth.height, mask, maskW, maskH);
      });
      if (maskOverlayOnRef.current) drawMaskOverlay();
      // KAYNAK DEĞİŞTİ: parçacıklar yeni sahneye OTURTULUR. Yumuşak geçiş
      // yolu (setHome + yay) hedefe varmıyordu; ölçüm ve gerekçe
      // Engine.yenidenTohumla'da.
      olcSync('geometry.seed', () => engineRef.current!.yenidenTohumla());
      measurementStatus = 'ready';
      say('depth → engine · point cloud konumları positionTexture\'dan okunur');
    } catch (err) {
      measurementStatus = isCurrent() ? 'failed' : 'cancelled';
      if (isCurrent()) say(`HATA: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (previewTimer !== undefined) clearInterval(previewTimer);
      if (photoGpuBudget && isCurrent()) engineRef.current?.setSuspended(egitimDosya !== null);
      measurement?.finish(measurementStatus, measurementMeta);
      if (isCurrent() && measurementStatus === 'ready') setPhotoPreview(false);
      // Cleared even when stale: skipping it would leave the source controls locked.
      setBusy(false);
    }
  }

  /** Temporary brightness preview until the live model publishes its first frame. */
  function cancelLuminanceFrame() {
    const pending = luminanceFrameRef.current;
    if (pending) pending.video.cancelVideoFrameCallback(pending.id);
    luminanceFrameRef.current = null;
  }

  function startLuminanceLoop(source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement, label: string) {
    clearTimer(); // kaynağı bırakmaz — teardownSource'u çağıran taraf yapar
    cancelLuminanceFrame();
    luminanceActiveRef.current = true;
    // Yeni kaynak eski karenin normalizasyon aralığını miras almasın.
    resetLuminanceState();
    // GÜN 6 (madde 4): canlı home → blend yazım + gevşetilmiş yay. Home her
    // karede değişir; toptan yazılırsa parçacık sürekli dürülür (titreme).
    const engine = engineRef.current!;
    engine.dynamicHome = true;
    engine.simUniforms.uStiffness.value = Math.max(engine.simUniforms.uStiffness.value, 0.05);
    if (engine.simUniforms.uRestLength.value < 0.008) engine.simUniforms.uRestLength.value = 0.008;
    let lastLog = 0;
    // Geçen smoothed kare. İlk karede geçmiş yoktur, ham kabul edilir; kaynak
    // değişince (boyut değişimi) de sıfırlanır. lerp prev üzerinden in-place
    // yapılır — frame başına allocation sıfırdır.
    let prev: Float32Array | null = null;
    // rVFC koruması: callback içinde iş tekrar tetiklenirse atla (birikme yok).
    let scheduled = false;
    // Main-thread budget: the preview must not starve the depth model it is waiting for.
    let nextAt = 0;

    const processFrame = () => {
      scheduled = false;
      // Model devraldıysa vekil susar (rVFC zinciri kendi kendini besler).
      if (!luminanceActiveRef.current) return;
      // Video ilk kareyi çözmeden drawImage boş/hatalı çizer.
      if (source instanceof HTMLVideoElement && source.readyState < 2) return;
      const t0 = performance.now();
      // Only while a live model is starting; the no-WebGPU fallback keeps every frame.
      if (liveDepthStopRef.current && t0 < nextAt) return;
      const hm = luminanceHeightMap(source, 256, {
        // GÜN 6/C: işaretli mikro rölyef + netlik (defocus) ipucu + ölçülü
        // merkez vurgusu. Netlik ipucu asıl yapıyı taşır (özne net → yakın),
        // parlaklık yalnızca taban olur; codec gürültüsü smoothing + zamansal
        // harmanla, kare-arası z kayması EMA aralığıyla bastırılır.
        edgeStrength: 0.35,
        centerBoost: 0.3,
        focusStrength: 0.55,
      });
      const data = hm.data;
      if (prev && prev.length === data.length) {
        // Temporal smoothing (hareket duyarlı): durgun bölgede güçlü sönüm,
        // hareketli bölgede anında takip — sabit alpha iz bırakıyordu.
        for (let i = 0; i < data.length; i++) {
          const d = data[i] - prev[i];
          const a = Math.min(
            1,
            LUMINANCE_SMOOTHING_ALPHA + Math.abs(d) * LUMINANCE_MOTION_GAIN,
          );
          data[i] = prev[i] + a * d;
        }
        prev.set(data); // bir sonraki karenin geçmişi = bugünkü smoothed kare
      } else {
        prev = new Float32Array(data); // ilk kare / yeni boyut: ham + kopya
      }
      engineRef.current!.setDepth(data, hm.width, hm.height);
      nextAt = previewNextAt(t0, performance.now());
      if (performance.now() - lastLog > 2000) {
        lastLog = performance.now();
        say(`luminance · ${label} · ${Math.round(performance.now() - t0)} ms`);
      }
    };

    processFrame();
    if (source instanceof HTMLVideoElement && 'requestVideoFrameCallback' in source) {
      // Yalnızca gerçek yeni video karesi geldiğinde işle. 100ms interval
      // video karelerini rastgele atlıyordu (sıçrama); rVFC her kareyi bir kez
      // verir. Callback senkron çalışır, zincir pause'da doğal olarak ölür.
      const tick = () => {
        luminanceFrameRef.current = null;
        if (!luminanceActiveRef.current) return;
        luminanceFrameRef.current = { video: source, id: source.requestVideoFrameCallback(tick) };
        if (!scheduled) {
          scheduled = true;
          processFrame();
        }
      };
      luminanceFrameRef.current = { video: source, id: source.requestVideoFrameCallback(tick) };
    } else {
      // rVFC desteklenmeyen tarayıcı: eski interval davranışı (kare kimliği
      // yok, smoothing yine de titremeyi önler).
      timerRef.current = window.setInterval(processFrame, 100);
    }
  }

  function stopLuminanceLoop() {
    luminanceActiveRef.current = false;
    cancelLuminanceFrame();
    clearTimer();
  }

  /**
   * CANLI DERİNLİK MODELİNİ BOŞTA ÖNDEN ISIT.
   *
   * Ölçüldü: ilk kare 4815 ms (indirme + derleme), sonrakiler 268 ms. Video
   * yüklenince bu bedel kullanıcının tam baktığı anda ödeniyordu ve ~5 sn
   * parlaklık vekili görünüyordu. Isıtma boşta koşar; `onceRetry` sayesinde
   * gerçek kullanım aynı yüklemeye biner (iki kez inmez).
   *
   * WebGPU YOKSA ISITILMAZ: o durumda canlı yol zaten açılmıyor, 47 MB'ı
   * boşuna indirmenin anlamı yok.
   */
  useEffect(() => {
    let iptal = false;
    // E2 — yetenek raporu: kapalı olan varsa SEBEBİYLE birlikte söylenir.
    void yetenekRaporu().then((r) => {
      if (iptal) return;
      if (r.sebep) say(`yetenek: ${r.sebep}`);
    });
    const isit = () => {
      if (iptal) return;
      void liveDepthKullanilabilir().then((varMi) => {
        if (iptal || !varMi) return;
        const t0 = performance.now();
        void isitLiveModel()
          .then(() => {
            if (!iptal) say(`canlı derinlik modeli hazır · ön ısıtma ${Math.round(performance.now() - t0)} ms`);
          })
          .catch(() => {
            /* ısıtma başarısızsa sessiz: gerçek kullanım kendi hatasını raporlar */
          });
      });
    };
    // DÜZ ZAMANLAYICI, `requestIdleCallback` DEĞİL: ölçüldü — sekme ön planda
    // değilken rIC hiç tetiklenmiyor (timeout verilse bile), ısıtma da hiç
    // koşmuyordu. Sabit gecikme her durumda çalışır; 1.5 sn açılış işlerinin
    // (motor kurulumu, preset) önüne geçmemek için.
    // SUNUMDA SPEKÜLATİF INDIRME YOK. Isıtma canlı (kamera/video) yolunu
    // hazır tutmak için var; linke bakıp örnek sahneyi izleyen biri o yolu
    // hiç açmıyor ve 47 MB boşuna iniyordu (ölçüldü 2026-10-23).
    // Kodun kendi gerekçesinin ("WebGPU yoksa ısıtılmaz") aynısı: kullanım
    // ihtimali yokken indirme.
    // CANLI KAYNAK YOKSA ISITMA YOK. Isıtma yalnız kamera/video yolu için;
    // fotoğraf yolu bu modeli HİÇ kullanmaz. Bir ara "kullanıcı bir dosya
    // seçti mi" diye bağlamıştım ve fotoğraf yüklenince ısıtma da
    // tetikleniyordu: aynı 47 MB iki kez, paralel indi (ölçüldü, 131 MB
    // beklenirken 178,8 MB). Koşul artık GERÇEKTEN canlı yolu kullanacak
    // kaynak: kamera açık ya da video yüklü.
    const canliKaynak = cameraOn || !!videoDosya;
    if (!canliKaynak) return () => { iptal = true; };
    const id = window.setTimeout(isit, 1500);
    return () => {
      iptal = true;
      clearTimeout(id);
    };
  }, [sunum, cameraOn, videoDosya]);

  /**
   * VİDEO/KAMERA DERİNLİĞİ — parlaklık vekiliyle başlar, MODEL devralır.
   *
   * Eskiden video yolunda derinlik YOKTU: parlaklık yükseklik sayılıyordu
   * (Gün 1 kararı), yani parlak pikseller öne fırlıyordu ve bulut sahnenin
   * gerçek geometrisiyle ilgisiz bir mush oluyordu. `liveDepth.ts` (kişisel
   * geliştirme reposundan taşındı) canlı yola gerçek modeli
   * (depth-anything-v2-small, fp16, WebGPU) bağlar.
   *
   * VEKİL NEDEN HÂLÂ BAŞLIYOR: model soğuk açılışta saniyeler sürer; o süre
   * boyunca sahne boş kalmasın diye parlaklık çizer, ilk gerçek derinlik
   * gelince `stopLuminanceLoop` ile susar.
   *
   * WebGPU YOKSA canlı yol açılmaz (wasm'da ölçülen ~2 sn/kare — "canlı"
   * olmaz) ve vekil devam eder; kullanıcıya sebebi söylenir, sessiz düşüş yok.
   *
   * Uploaded videos can receive a foreground mask once the first model frame
   * arrives. The mask is refreshed only after measured drift; otherwise its
   * GPU cost would make live depth less responsive.
   */
  function startVideoDepth(video: HTMLVideoElement, label: string) {
    setVideoLook(true);
    engineRef.current?.setRealtimeVideoColor(!liveInterpolationEnabled());
    const isCurrent = captureGeneration(sourceGenRef);
    startLuminanceLoop(video, label);
    let iptal = false;
    setPlaybackVideo(video);
    setLiveStats({ path: 'loading', hz: 0, inferenceMs: 0, width: 0, height: 0,
      frames: 0, mediaTime: null, geometryAgeMs: null });
    let statsAt = performance.now(), statsFrames = 0, totalFrames = 0;
    // `data` is what is applied (the captured mask moved by the image tracker); `captured` never changes.
    let videoMask: { data: Float32Array; captured: Float32Array; width: number; height: number; mediaTime: number;
      colorFrame: { data: Uint8ClampedArray; width: number; height: number }; job?: VideoMaskJob } | null = null;
    let maskBusy = false;
    let maskUnavailable = false;
    let maskErrors = 0;
    let invalidMasks = 0;
    let maskNextRetryAt = 0;
    // Image tracker: the subject is no longer where the mask says (cut, occlusion, left the frame).
    let maskLost = false;
    let lastJobMs: number | null = null;
    let lastMaskAttempt = -Infinity;
    let maskRevision = 0;
    let requestedRevision = segmentRevisionRef.current;
    let lastDepth: LiveDepthResult | null = null;
    // Mask track of the last prepared frame: the paused detailed (V2) frame reuses it.
    let preparedMask: { data: Float32Array; width: number; height: number; mediaTime: number } | null = null;
    const pausedPreparedMask = (time: number) =>
      video.paused && preparedMask && Math.abs(preparedMask.mediaTime - time) <= 0.2 ? preparedMask : null;
    // The mask only sets particle opacity. Re-applying the last depth lets a
    // mask that arrives while the video is paused take effect immediately.
    let lastCategoryAt = -Infinity;
    const applyDepth = (d: LiveDepthResult, fromCache = false) => {
      if (iptal || !isCurrent() || videoRef.current !== video) return;
      // Duraklatılmış karede canlı 378 sonucu hazır kareyi bilerek geçer (aynı medya zamanı).
      if (!fromCache && !video.paused && preparedVideoUsableRef.current && preparedFrameTimeRef.current >= d.mediaTime) return;
      // Referans yol gibi kurulu maske her karede (kaydırma koluyla izlenerek) kullanılır.
      const mask = segmentRef.current ? (d.flowMask ?? videoMask ?? pausedPreparedMask(d.mediaTime)) : null;
      engineRef.current?.setDepth(d.data, d.width, d.height,
        mask?.data, mask?.width, mask?.height, d.colorFrame, d.flowConfidence);
      appliedVideoMaskRef.current = mask ?? null;
      // Overlay off: nothing else. On: redraw only when the applied array changed (new or moved mask).
      if (maskOverlayOnRef.current && (mask?.data ?? null) !== drawnOverlayMaskRef.current) drawMaskOverlay();
      if (mask && mask === videoMask && videoMask.job && videoMask.job.appliedAt === null) videoMask.job.appliedAt = performance.now();
      statsFrames++; totalFrames++;
      const statsNow = performance.now();
      if (video.paused || totalFrames === 1 || statsNow - statsAt >= 250) {
        setLiveStats({ path: 'depth', hz: statsFrames * 1000 / Math.max(1, statsNow - statsAt),
          inferenceMs: d.inferenceMs, width: d.width, height: d.height, frames: totalFrames,
          mediaTime: d.mediaTime, geometryAgeMs: liveGeometryAgeMs(video.currentTime,
            d.mediaTime, video.playbackRate, video.duration, video.loop) });
        statsFrames = 0; statsAt = statsNow;
      }
      // Hazır renk karesini en çok beş saniyede bir oku; model/ek kare yakalama yok.
      if (d.colorFrame && performance.now() - lastCategoryAt >= 5000) {
        lastCategoryAt = performance.now();
        const categoryMask = d.flowMask ?? videoMask ?? pausedPreparedMask(d.mediaTime);
        let signals: CategoryInput = {};
        if (categoryMask && (categoryMask === d.flowMask || !videoMask || Math.abs(videoMask.mediaTime - d.mediaTime) < 0.5)) {
          let count = 0;
          for (const value of categoryMask.data) if (value >= 0.5) count++;
          const coverage = count / categoryMask.data.length;
          const main = maskeTekParcaOrani(categoryMask.data, categoryMask.width, categoryMask.height);
          signals = { maskCoverage: coverage, maskMainComponent: main, maskAccepted: maskeKarari(coverage, main).tip === 'kullan' };
        }
        console.info('[category:video]', classifyCategory({ ...signals, frame: d.colorFrame }));
      }
    };
    videoDepthRefreshRef.current = () => {
      if (!iptal && isCurrent() && lastDepth) applyDepth(lastDepth, preparedVideoUsableRef.current);
    };
    preparedFramePresenterRef.current = (frame) => {
      if (iptal || !isCurrent() || videoRef.current !== video) return;
      // A detailed result for the paused cursor wins even when the cache floors to an earlier source frame.
      if (video.paused && lastDepth?.depthModel === 'v2' && !lastDepth.interpolated
        && Math.abs(lastDepth.mediaTime - video.currentTime) < 1e-3) return;
      stopLuminanceLoop();
      if (preparedFrameTimeRef.current === -Infinity) setLiveRates({ model: 0, flow: 0 });
      // Hazır derinlik o anki kareyle hizalı: renk doğrudan video dokusundan (canlı
      // karelerin yakalanmış renk ızgarası bırakılır; zaten boşsa çağrı bedava).
      engineRef.current?.clearVideoFrameColor();
      preparedMask = frame.flowMask ? { ...frame.flowMask, mediaTime: frame.mediaTime } : null;
      lastDepth = frame;
      preparedFrameTimeRef.current = frame.mediaTime;
      applyDepth(frame, true);
    };
    const syncMaskRequest = () => {
      if (requestedRevision === segmentRevisionRef.current) return;
      requestedRevision = segmentRevisionRef.current;
      maskRevision++;
      if (lastDepth) lastDepth = { ...lastDepth, flowMask: undefined };
      videoMask = null;
      maskUnavailable = false;
      maskErrors = 0;
      invalidMasks = 0;
      maskNextRetryAt = 0;
      lastMaskAttempt = -Infinity;
    };
    // Referans yol: maske ilk derinlikten sonra KENDİLİĞİNDEN üretilir; yalnız
    // kullanıcı nesne ayırmayı kapattıysa üretilmez.
    const captureMask = (reason = 'request') => {
      syncMaskRequest();
      if (maskBusy) videoStats.maskGate.busy++;
      if (segmentKapaliRef.current || iptal || maskBusy || maskUnavailable ||
        performance.now() < maskNextRetryAt || videoRef.current !== video) return;
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
      maskBusy = true;
      lastMaskAttempt = performance.now();
      const revision = maskRevision;
      const job = logMaskJob({ reason, startAt: lastMaskAttempt, mediaTime: video.currentTime, doneAt: null,
        appliedAt: null, coverage: null, separation: null, dropped: false });
      // Capture before awaiting GPU work; the mask must describe one stable frame.
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) { maskBusy = false; maskUnavailable = true; return; }
      const maskMediaTime = video.currentTime;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const flowCanvas = document.createElement('canvas');
      const flowSize = liveGrabSize(video.videoWidth, video.videoHeight);
      flowCanvas.width = flowSize.w;
      flowCanvas.height = flowSize.h;
      const flowContext = flowCanvas.getContext('2d', { willReadFrequently: true });
      if (!flowContext) { maskBusy = false; return; }
      flowContext.drawImage(canvas, 0, 0, flowSize.w, flowSize.h);
      const maskColorFrame = { data: flowContext.getImageData(0, 0, flowSize.w, flowSize.h).data,
        width: flowSize.w, height: flowSize.h };
      // segmentForeground kendi içinde GPU sırasına girer (segmentation.ts) —
      // burada ikinci kez sarmalamak kuyruğu KİLİTLERDİ (yeniden girişli
      // değil, depth.ts:~112).
      void captureLiveMask(canvas)
        .then((result) => {
          job.doneAt = performance.now();
          if (iptal || videoRef.current !== video || revision !== maskRevision) { job.dropped = true; return; }
          let foreground = 0;
          for (const value of result.data) if (value >= 0.5) foreground++;
          const coverage = foreground / result.data.length;
          job.coverage = coverage;
          // Referans yoldaki kapı (`maskeGecerliMi`): boş ya da %92'den dolu maske kullanılmaz.
          if (foreground === 0 || coverage > 0.92) {
            videoMask = null;
            invalidMasks++;
            maskNextRetryAt = performance.now() + Math.min(60_000, 15_000 * 2 ** (invalidMasks - 1));
            say(`video maskesi güvenilir değil (%${(coverage * 100).toFixed(0)} ön plan); sonra yeniden denenecek`);
            return;
          }
          videoMask = { data: result.data, captured: result.data, width: result.width, height: result.height,
            mediaTime: maskMediaTime, colorFrame: maskColorFrame, job };
          maskLost = false;
          // The first job also creates the model session (1.5 s measured): it would set a 6 s period.
          if (reason !== 'ilk') lastJobMs = job.doneAt - job.startAt;
          invalidMasks = 0;
          maskErrors = 0;
          maskNextRetryAt = 0;
          // Referans yol: maske gelince nesne ayırma açılır (kullanıcı kapatmadıysa). Fark:
          // Histerezis (maskeKarari.ts): %8'de açılır, %4'ün altında kapanır — eşik civarında
          // salınan maske ayırmayı açıp kapatmaz. Maske yine saklanır; elle açılınca kullanılır.
          // Kullanıcı-kapalı mandalı (segmentKapaliRef) açmayı engellemeye devam eder.
          const ayirma = videoAyirmaDurumu(coverage, segmentRef.current);
          if (ayirma !== segmentRef.current && !(ayirma && segmentKapaliRef.current)) {
            updateSegment(ayirma);
            requestedRevision = segmentRevisionRef.current;
            engineRef.current?.setObjectSeparation(ayirma);
          }
          job.separation = segmentRef.current;
          say(`video özne maskesi hazır · ${result.model} · %${(coverage * 100).toFixed(0)} ön plan · nesne ayırma ${segmentRef.current ? 'açık' : 'kapalı (maske küçük)'}`);
          // Paused: show it now. Playing: the next depth frame (~0.15 s) carries it; re-applying
          // here cost one extra setDepth (~40 ms main thread) per mask job.
          if (lastDepth && video.paused) applyDepth(lastDepth);
        })
        .catch((err) => {
          if (iptal || revision !== maskRevision) return;
          say(`video maskesi atlandı: ${err instanceof Error ? err.message : String(err)}`);
          videoMask = null;
          maskErrors++;
          maskUnavailable = maskErrors >= 3;
          maskNextRetryAt = performance.now() + 30_000;
        })
        .finally(() => { maskBusy = false; });
    };
    videoMaskRequestRef.current = captureMask;
    liveDepthStopRef.current = () => {
      iptal = true;
    };
    void liveDepthKullanilabilir().then((varMi) => {
      // A stale start must not install a driver: its stop function would
      // replace the newer source's without ever being called.
      if (iptal || !isCurrent()) return;
      if (!varMi) {
        setLiveStats(previous => ({ ...previous, path: 'fallback' }));
        liveDepthStopRef.current = null;
        say('canlı derinlik: WebGPU yok; parlaklık vekiliyle devam');
        return;
      }
      say(`canlı derinlik başlıyor · video ${video.videoWidth}x${video.videoHeight} · ${video.duration.toFixed(1)} sn`);
      let devraldi = false;
      let sayac = 0;
      let flowCount = 0;
      const ageSamples: number[] = [];
      let flowCoverageTotal = 0;
      let staleDrops = 0;
      const percentile = (values: number[], q: number) => {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
      };
      let sonLog = performance.now();
      let lastPreparingInfer = -Infinity;
      let lastCutMaskReset = -Infinity;
      const stopDriver = startLiveDepth(
        video,
        (d) => {
          if (!devraldi) {
            devraldi = true;
            stopLuminanceLoop();
            say('canlı derinlik: model devraldı (depth-anything-v2-small · fp16)');
          }
          syncMaskRequest();
          const mask = segmentRef.current ? videoMask : null;
          if (mask && d.colorFrame) {
            // Align the mask to THIS depth frame's own picture: where did the masked pixels of the
            // mask's capture frame move to? Measured from the capture frame every time, so no drift.
            const captured = { data: mask.captured, width: mask.width, height: mask.height };
            const shift = estimateMaskShift(captured, mask.colorFrame, d.colorFrame);
            maskLost = !!shift?.lost;
            // Keep object identity: replacing it would invalidate an in-flight depth inference.
            if (shift && !shift.lost) mask.data = shiftLiveMask(captured, shift);
          }
          // First mask, retry after a rejected one, the cost-bounded refresh (also while separation
          // is off, so a later larger mask can switch it on) and the tracker's "lost": maskeKarari.ts.
          const istek = videoMaskeIstegi({ maskeVar: !!videoMask, kullaniciKapatti: segmentKapaliRef.current,
            duraklatildi: video.paused, hazirMaskeVar: !!pausedPreparedMask(d.mediaTime),
            ayirmaAcik: segmentRef.current, gecenMs: performance.now() - lastMaskAttempt,
            izKayip: maskLost, sonIsMs: lastJobMs });
          if (istek) captureMask(istek);
          else if (videoMask) videoStats.maskGate.interval++;
          // Let the Worker align the new model anchor before replacing a masked flow frame.
          const awaitingMask = segmentRef.current && lastDepth?.flowMask && !d.flowMask
            && !video.paused && d.mediaTime - lastDepth.mediaTime < 0.5;
          if (!awaitingMask && shouldPresentLiveDepth(d.mediaTime, lastDepth?.mediaTime ?? -Infinity)) {
            lastDepth = d;
            applyDepth(d);
          }
          sayac++;
          if (video.currentTime >= d.mediaTime) {
            ageSamples.push((video.currentTime - d.mediaTime) * 1000);
          }
          flowCoverageTotal += d.flowCoverage ?? 0;
          const simdi = performance.now();
          if (simdi - sonLog > 3000) {
            const elapsed = (simdi - sonLog) / 1000;
            if (!preparedVideoUsableRef.current) setLiveRates({ model: sayac / elapsed, flow: flowCount / elapsed });
            say(`canlı derinlik · ${(sayac / ((simdi - sonLog) / 1000)).toFixed(1)} Hz · ${d.width}x${d.height} · kare yaşı p50/p95 ${Math.round(percentile(ageSamples, 0.5))}/${Math.round(percentile(ageSamples, 0.95))} ms · akış kapsaması ${Math.round(100 * flowCoverageTotal / Math.max(1, sayac))}% · eski kare atlandı ${staleDrops}`);
            sayac = 0;
            flowCount = 0;
            ageSamples.length = 0;
            flowCoverageTotal = 0;
            staleDrops = 0;
            sonLog = simdi;
          }
        },
        {
          girdiAl: () => canliGirdiBoyutu(liveQualityRef.current, video.paused),
          shouldInfer: () => {
            // A paused frame respects the selected quality, as in the reference build.
            if (video.paused) return true;
            const prepared = preparedVideoRef.current;
            if ((!segmentRef.current || prepared?.hasMask(video.currentTime)) && preparedVideoUsableRef.current
              && prepared?.hasFrame(video.currentTime)) return false;
            // Hazırlık ve maske izi aynı GPU kuyruğunu kullanır: canlı çıkarım 2 Hz'e kısılır (F4).
            if (videoPreparingRef.current || maskPreparingRef.current) {
              const now = performance.now();
              if (now - lastPreparingInfer < PREPARING_LIVE_INFER_MS) return false;
              lastPreparingInfer = now;
            }
            return true;
          },
          // V2 only while the offline cache is still being built (F11).
          forceV2: () => videoPreparingRef.current || video.paused,
          // Referans yol: maske oynarken de son işlemeye (kırpma + stretch + sobel) girer.
          maskeAl: () => segmentRef.current ? (videoMask ?? pausedPreparedMask(video.currentTime)) : null,
          flowMaskAl: () => segmentRef.current ? videoMask : null,
          onInterpolatedDepth: (d) => {
            if (iptal || !isCurrent() || videoRef.current !== video) return;
            if (preparedVideoUsableRef.current && preparedVideoRef.current?.hasFrame(video.currentTime)) return;
            if (!shouldPresentLiveDepth(d.mediaTime, lastDepth?.mediaTime ?? -Infinity)) return;
            lastDepth = d;
            applyDepth(d);
            flowCount++;
            videoStats.interpolatedApplied++;
          },
          // The driver keeps looped masks; only a user seek shows a different subject.
          onDiscontinuity: (reason) => {
            lastDepth = null;
            // Flaş/hızlı pan kesme sanılabilir; maske yeniden yakalama (saniyelerce
            // GPU) kesme kaynaklıysa 10 sn'de en fazla bir kez (F13).
            const cutTooSoon = reason === 'scene-cut' && performance.now() - lastCutMaskReset < 10_000;
            if (reason === 'scene-cut' && !cutTooSoon) lastCutMaskReset = performance.now();
            if (reason !== 'loop' && !cutTooSoon) {
              maskRevision++;
              videoMask = null;
              maskLost = false;
              maskUnavailable = false;
              maskErrors = 0;
              invalidMasks = 0;
              maskNextRetryAt = 0;
              lastMaskAttempt = -Infinity;
            }
          },
          onStaleDrop: () => { staleDrops++; },
          onError: (err, ardisik) =>
            say(`canlı derinlik hatası (${ardisik}/3): ${err instanceof Error ? err.message : String(err)}`),
          onVazgec: () => {
            setLiveStats(previous => ({ ...previous, path: 'fallback' }));
            say('canlı derinlik: ardışık 3 hata; parlaklık vekiline dönüldü');
            engineRef.current?.clearVideoFrameColor();
            liveDepthStopRef.current = null;
            if (videoRef.current === video) startLuminanceLoop(video, label);
          },
        },
      );
      liveDepthStopRef.current = () => {
        iptal = true;
        stopDriver();
      };
    });
  }

  /**
   * NESNE AYIRMA BUTONU (Tur 12 — şikayet 4): durum shader'a CANLI bağlanır
   * (Engine.setObjectSeparation — AÇIK: arka plan parçacıkları atılır, sadece
   * büst kalır; KAPALI: tüm sahne, arka plan karartılmış). Yükleme sırasında
   * maske üretilmediyse ve fotoğraf hâlâ eldeyse RMBG şimdi yeniden çalıştırılır
   * (depth korunur, yalnızca maske türetilir).
   */
  function prepareUploadedVideo(file: File, video: HTMLVideoElement) {
    const isCurrent = captureGeneration(sourceGenRef);
    const controller = new AbortController();
    preparedVideoAbortRef.current = controller;
    videoPreparingRef.current = true;
    const fallback = () => {
      if (!isCurrent() || controller.signal.aborted) return;
      videoStats.fallbacks++;
      preparedVideoUsableRef.current = false;
      preparedFrameTimeRef.current = -Infinity;
      if (!liveDepthStopRef.current && !luminanceActiveRef.current) startLuminanceLoop(video, 'video');
    };
    let lastReadError = -Infinity;
    // Takılma bekçisi: hazırlık sürerken bir kare >100 ms sürerse hazırlık kısa
    // süre bekler (oynatma önceliklidir, sekme donmaz; madde 4).
    let lastFrameAt = performance.now(), lastStutterAt = -Infinity, watchId = 0;
    const watch = (t: number) => {
      if (t - lastFrameAt > 100 && !document.hidden) lastStutterAt = t;
      lastFrameAt = t;
      if (videoPreparingRef.current && isCurrent() && !controller.signal.aborted) watchId = requestAnimationFrame(watch);
    };
    watchId = requestAnimationFrame(watch);
    controller.signal.addEventListener('abort', () => cancelAnimationFrame(watchId), { once: true });
    void prepareVideoDepth(file, {
      signal: controller.signal,
      shouldPause: () => !video.paused && performance.now() - lastStutterAt < 500,
      onProgress: (progress) => {
        if (!isCurrent() || controller.signal.aborted) return;
        setVideoPreparation(progress);
        if (progress.stage === 'fallback') say(`video derinliği hazırlanamadı: ${progress.error ?? 'canlı derinlik kullanılıyor'}`);
      },
    }).then(async (handle) => {
      if (!isCurrent() || controller.signal.aborted) { await handle.dispose(); return; }
      preparedVideoRef.current = handle;
      const beginPlayback = () => startBufferedVideoPlayback(video, handle, {
        // Separation needs the mask track for this frame; until then the live mask pipeline runs (F6).
        enabled: () => !segmentRef.current || handle.hasMask(video.currentTime),
        onFrame: (frame) => {
          if (!isCurrent() || controller.signal.aborted) return;
          preparedVideoUsableRef.current = true;
          videoStats.preparedFrames++;
          preparedFramePresenterRef.current?.({ ...frame, inferenceMs: 0, depthModel: 'vda',
            modelOutput: { data: frame.data, width: frame.width, height: frame.height },
            flowMask: frame.mask ? { data: frame.mask, width: frame.width, height: frame.height } : undefined });
        },
        onFallback: fallback,
        onError: (error) => {
          // Okuma hataları kare kare tekrarlanabilir; günlük ve React yenilemesi 10 sn'de bir.
          if (!isCurrent() || performance.now() - lastReadError < 10_000) return;
          lastReadError = performance.now();
          say(`hazır derinlik okunamadı; canlı derinlik kullanılıyor: ${String(error)}`);
        },
      });
      preparedVideoStopRef.current = beginPlayback();
      // Maske izi: anahtar karelerde canlı maske zinciri (sidecar varsa BiRefNet+DAViD,
      // yoksa IS-Net), aradaki kareler akışla. Yalnız nesne ayırma açıkken istenir.
      const capture: VideoMaskCapture = async (frame) => {
        const canvas = document.createElement('canvas');
        canvas.width = frame.width; canvas.height = frame.height;
        canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
        const result = await captureLiveMask(canvas);
        let foreground = 0;
        for (const value of result.data) if (value >= 0.5) foreground++;
        const coverage = foreground / result.data.length;
        if (coverage < AYIRMA_KAPATMA_ORANI || coverage >= 0.92) return null;
        return resampleBilinear(result.data, result.width, result.height, frame.width, frame.height);
      };
      preparedMaskRequestRef.current = () => {
        if (!segmentRef.current || !isCurrent() || controller.signal.aborted) return;
        const started = performance.now();
        setVideoMaskProgress((value) => value ?? 0);
        maskPreparingRef.current = true;
        void handle.prepareMasks(capture, (fraction) => {
          if (isCurrent() && !controller.signal.aborted) setVideoMaskProgress(fraction);
        }).finally(() => { if (isCurrent()) maskPreparingRef.current = false; }).then(() => {
          if (isCurrent()) say(`video maske izi hazır · ${((performance.now() - started) / 1000).toFixed(1)} sn`);
        }).catch((error) => {
          if (!isCurrent() || controller.signal.aborted) return;
          setVideoMaskProgress(null);
          say(`video maske izi üretilemedi; canlı maske sürüyor: ${String(error)}`);
        });
      };
      preparedMaskRequestRef.current();
      await handle.done;
      if (!isCurrent() || controller.signal.aborted) return;
      videoPreparingRef.current = false;
      // Fallback/cancel: nothing will ever be readable, so stop the player and drop the store (F16).
      if (!handle.hasFrame(video.currentTime)) { stopPreparedVideo(); fallback(); return; }
      // Paused videos have no new decoded callback when preparation finishes.
      if (video.paused) {
        preparedVideoStopRef.current?.();
        preparedVideoStopRef.current = beginPlayback();
      }
    }).catch((error) => {
      if (!isCurrent() || controller.signal.aborted) return;
      videoPreparingRef.current = false;
      preparedVideoUsableRef.current = false;
      say(`video hazırlığı başarısız; canlı derinlik kullanılıyor: ${String(error)}`);
    });
  }

  /** Kısa video hemen, uzun video onayla, ayar kapalıysa hiç hazırlanmaz (canlı derinlik sürer). */
  function startVideoPreparationByPolicy(file: File, video: HTMLVideoElement, enabled: boolean) {
    const policy = videoPreparationPolicy(video.duration, enabled);
    if (policy === 'auto') prepareUploadedVideo(file, video);
    else if (policy === 'ask') setVideoPreparationAsk({ file, video, estimate: estimatePreparationSeconds(video.duration) });
  }

  function setVideoProcessingSetting(on: boolean) {
    setVideoProcessing(on);
    if (!on) {
      setVideoPreparationAsk(null);
      if (videoPreparingRef.current) {
        preparedVideoAbortRef.current?.abort();
        stopPreparedVideo();
        setVideoPreparation((value) => value && { ...value, stage: 'cancelled' });
      }
    } else if (videoDosya && videoRef.current && !preparedVideoRef.current && !videoPreparingRef.current) {
      startVideoPreparationByPolicy(videoDosya, videoRef.current, true);
    }
  }

  /** Player and handle are released together; live depth takes over (Cancel, failure). */
  function stopPreparedVideo() {
    videoPreparingRef.current = false;
    preparedVideoStopRef.current?.();
    preparedVideoStopRef.current = null;
    void preparedVideoRef.current?.dispose().catch(() => {});
    preparedVideoRef.current = null;
    preparedVideoUsableRef.current = false;
    preparedFrameTimeRef.current = -Infinity;
  }

  async function toggleSegment() {
    const next = !segment;
    segmentKapaliRef.current = !next;
    if (next) preparedVideoUsableRef.current = false;
    if (next && !liveDepthStopRef.current && !luminanceActiveRef.current && videoRef.current) startLuminanceLoop(videoRef.current, 'video');
    updateSegment(next);
    engineRef.current!.setObjectSeparation(next);
    if (next) preparedMaskRequestRef.current?.();
    say(`nesne ayırma: ${next ? 'AÇIK (arka plan parçacıkları atılır, sadece büst)' : 'kapalı (tüm sahne, arka plan karartılır)'}`);
    if (!next) return;
    // Video: request a mask now instead of waiting for a new depth frame,
    // which never comes while paused. A stale callback ignores the call.
    videoMaskRequestRef.current?.();
    if (maskLoadedRef.current || !lastPhotoRef.current || !lastDepthRef.current) return;
    // Maske yok — fotoğraf yüklüyken buton sonradan açıldı: şimdi ayır.
    setBusy(true);
    try {
      const t2 = performance.now();
      const seg = await segmentForeground(lastPhotoRef.current, 'webgpu', 'foto');
      say(`nesne ayırma (${seg.model === 'birefnet' ? 'BiRefNet' : 'IS-Net'})  ${Math.round(performance.now() - t2)} ms  (${seg.width}x${seg.height})`);
      // GÜN E (bulgu 1): önbellekteki depth MASKE-KÖR hesaplandı (buton o an
      // kapalıydı). Maske geldiğine göre depth yeniden çıkarılır — yoksa bu
      // yolda stretch/eğim aşamaları düzeltmeden yararlanamazdı.
      const d = await estimateDepth(lastPhotoRef.current, {
        ...FOTO_KALITE,
        ...(lastPhotoCameraRef.current ? { photoCamera: lastPhotoCameraRef.current } : {}),
        subjectMask: { data: seg.mask, width: seg.width, height: seg.height },
      });
      lastDepthRef.current = { data: d.data, width: d.width, height: d.height };
      engineRef.current!.setMetricPhotoGeometry(d.metricGeometry ?? null);
      if (d.subjectMask) engineRef.current!.setDepth(d.data, d.width, d.height, d.subjectMask, d.width, d.height);
      else engineRef.current!.setDepth(d.data, d.width, d.height, seg.mask, seg.width, seg.height);
      if (maskOverlayOnRef.current) drawMaskOverlay();
      maskLoadedRef.current = true;
    } catch (err) {
      say(`HATA nesne ayırma: ${err instanceof Error ? err.message : String(err)}`);
      engineRef.current!.setObjectSeparation(false);
      updateSegment(false);
    } finally {
      setBusy(false);
    }
  }

  function toggleMaskOverlay() {
    setShowMask((on) => !on);
  }

  /**
   * Tracker HUD, KAYNAK VİDEOYU değil ÇİZİLEN KAREYİ izler. Ekranda görünen
   * şey videonun kendisi değil ondan türetilen 3B sahnedir; video piksel
   * uzayında bulunan hedef ekranda başka yere (boş alana bile) düşüyordu.
   * Çizilen kare tek uzaydır: kutu gördüğün şeyin üstünde durur ve HUD
   * fotoğraf/sentetik/splat kaynaklarında da çalışır.
   *
   * Kanca motorun çizim döngüsünde, `composer.render()`'dan hemen sonra
   * koşar (`Engine.setFrameTap` sözleşmesi) — canvas ancak o an okunabilir.
   * Tracker kendi içinde `everyNFrames` ile seyreltir; kanca her karede
   * çağrılsa da hesap her karede yapılmaz.
   */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!trackerOn) {
      engine.setFrameTap(null);
      trackerTargetsRef.current = [];
      trackerRef.current!.reset();
      return;
    }
    engine.setFrameTap((view) => {
      trackerTargetsRef.current = trackerRef.current!.step(view);
    });
    return () => engine.setFrameTap(null);
  }, [trackerOn, engine]);

  /**
   * MASKE OVERLAY'İ MOUNT SONRASI ÇİZİLİR (düzeltme). Eskiden toggle
   * fonksiyonunun içinden çizilirdi: overlay canvas'ı `showMask &&` ile
   * koşullu render edildiği için React henüz mount etmemiş oluyor,
   * `segOverlayRef.current` null dönüyor ve drawMaskOverlay sessizce
   * çıkıyordu — buton hiç çalışmıyor görünüyordu. Effect mount'tan SONRA
   * koşar; maske yoksa kullanıcıya sebebi söylenir (sessiz boş kutu yok).
   */
  useEffect(() => {
    maskOverlayOnRef.current = showMask;
    if (!showMask) return;
    drawMaskOverlay();
    if (!videoRef.current && !engineRef.current?.foregroundMask) {
      say('maskeyi göster: bu kaynakta maske yok (kamera ya da nesne ayırma kapalı)');
    }
  }, [showMask, engine]);

  /** Maskeyi gri tonlama overlay olarak çizer. Fotoğraf: Engine'de işlenmiş RMBG maskesi
   *  (resample + dilate) — "model mi morf mu" tanısı; yoksa temizlenir. Video: sahneye
   *  uygulanan maske (izleyici kaydırması sonrası); yoksa sebep yazılır. */
  function drawMaskOverlay() {
    const canvas = segOverlayRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const source = maskeOverlayKaynagi({ video: !!videoRef.current, videoMask: appliedVideoMaskRef.current,
      photoMask: engine.foregroundMask, photoSize: engine.depthTexture?.image as { width: number; height: number } | undefined });
    drawnOverlayMaskRef.current = source && 'mask' in source ? source.mask.data : null;
    if (!source || 'mesaj' in source) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (source) {
        canvas.width = 256;
        canvas.height = 40;
        ctx.fillStyle = '#ccc';
        ctx.font = '11px sans-serif';
        source.mesaj.split(' (').forEach((line, i) => ctx.fillText(i ? `(${line}` : line, 6, 16 + i * 14));
      }
      return;
    }
    const mask = source.mask.data;
    const w = source.mask.width;
    const h = source.mask.height;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d')!;
    const img = octx.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
      const v = Math.round(Math.min(1, Math.max(0, mask[i])) * 255);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    const cap = 256;
    const scale = Math.min(1, cap / w, cap / h);
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  async function toggleCamera() {
    if (cameraOn) {
      teardownSource();
      setCameraOn(false);
      say('kamera kapatıldı');
      return;
    }
    // Permission prompt still open: a second getUserMedia would open a second
    // stream that nothing ever stops (camera light stays on).
    if (cameraStartingRef.current) return;
    cameraStartingRef.current = true;
    teardownSource(); // önce açık video/stream varsa bırak
    setVideoDosya(null);
    const isCurrent = captureGeneration(sourceGenRef);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      if (!isCurrent()) {
        // Another source took over during the prompt; this stream is not ours to keep.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      videoRef.current = video;
      await video.play();
      // teardownSource already stopped this stream via streamRef.
      if (!isCurrent()) return;
      setCameraOn(true);
      engineRef.current!.mediaType = 'camera';
      // Kütüphane kapakları sahneye bağlı: kaynak değişti, eskiler artık
      // bu sahneyi temsil etmiyor (bkz. presetOnizleme.ts).
      kaynakBelirle('kamera');
      // Tur 12 (şikayet 1): kamera da canlı renk dokusu olarak bağlanır —
      // önceki resmin hayaleti parçacıklarda kalmaz.
      lastPhotoRef.current = null;
      lastDepthRef.current = null;
      maskLoadedRef.current = false;
      // Gün 8: fotoğraf maskesi bu kaynakta geçersiz — nesne ayırma canlı
      // shader bayrağıyla birlikte kapatılır (UI "AÇIK" yalanı söylemesin).
      updateSegment(false);
      segmentKapaliRef.current = false;
      engineRef.current!.setObjectSeparation(false);
      engineRef.current!.setVideoSource(video);
      startVideoDepth(video, 'kamera');
      say('kamera açık · canlı luminance height map');
    } catch (err) {
      // Stale: play() was aborted by the newer source's teardown; nothing to report.
      if (!isCurrent()) return;
      // A failed play() leaves the stream open; release it so the light goes off.
      teardownSource();
      say(`HATA kamera: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      cameraStartingRef.current = false;
    }
  }

  async function handleFile(file: File) {
    indirmeSifirla();
    const isVideo = file.type.startsWith('video/');
    if (!isVideo && !file.type.startsWith('image/')) {
      say(`desteklenmiyor: ${file.type || file.name}`);
      return;
    }
    teardownSource(); // canlı döngü varsa dursun
    setCameraOn(false);
    setVideoDosya(null);
    engineRef.current!.mediaType = 'upload';
    kaynakBelirle(`dosya:${file.name}:${file.size}`);
    const isCurrent = captureGeneration(sourceGenRef);
    const url = URL.createObjectURL(file);
    try {
      if (isVideo) {
        objectUrlRef.current = url; // teardownSource revokes it
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        video.src = url;
        videoRef.current = video;
        await video.play();
        if (!isCurrent()) return;
        // A container whose video codec is unsupported can still "play" its
        // audio track; without a picture there is nothing to reconstruct.
        if (video.videoWidth === 0) throw new Error('görüntü izi çözülemedi');
        setVideoDosya(file);
        // Tur 12 (şikayet 1): video canlı renk dokusu olarak bağlanır —
        // resimden videoya geçişte parçacık renklerinde resim hayaleti kalmaz.
        lastPhotoRef.current = null;
        lastDepthRef.current = null;
        maskLoadedRef.current = false;
        // Gün 8: fotoğraf maskesi bu kaynakta geçersiz — nesne ayırma canlı
        // shader bayrağıyla birlikte kapatılır (UI "AÇIK" yalanı söylemesin).
        updateSegment(false);
        segmentKapaliRef.current = false;
        engineRef.current!.setObjectSeparation(false);
        engineRef.current!.setVideoSource(video);
        say(`video yüklendi · ${file.name} · model gelene kadar geçici parlaklık önizlemesi`);
        startVideoDepth(video, 'video');
        startVideoPreparationByPolicy(file, video, videoProcessing);
      } else {
        const image = await loadImage(url);
        if (!isCurrent()) return;
        await run(image, undefined, file); // EXIF yalnız bu fotoğrafın dosyasından okunur.
      }
    } catch (err) {
      // Stale: the newer source's teardown aborted this one; it owns the UI now.
      if (!isCurrent()) return;
      // HEVC .MOV / HEIC land here. Drop the half-opened source and the stored
      // file so "3D eğit" is not offered for a video that cannot play.
      teardownSource();
      setVideoDosya(null);
      say(sourceErrorMessage(file, err));
    } finally {
      if (!isVideo) URL.revokeObjectURL(url);
    }
  }

  /**
   * GÜN 8: mod değiştirmenin TEK kapısı — ModeSelector, ControlPanel ve
   * graf editörü hep buraya düşer. Sıra: ① material takası (Engine'in tek
   * bilinen yolu, eskisini dispose etmez) ② Engine.selectRenderMode →
   * graf params.mode güncellenir (graf = tek doğruluk kaynağı) ③ UI state
   * ④ editör tazelenir — üç kol da birbirinin değişikliğini görür.
   */
  /**
   * MOD BAŞINA POST-FX HAFIZASI (oturumluk). Kalıcı olması istenirse preset
   * kaydı zaten var; her mod geçişini localStorage'a yazmak, kullanıcının
   * bir kez denediği bir ayarı kalıcı hale getirirdi.
   */
  const modHafizaRef = useRef<ModHafizasi>({});
  const videoModHafizaRef = useRef<ModHafizasi>({});
  const videoLookRef = useRef(false);

  function setVideoLook(on: boolean) {
    const engine = engineRef.current;
    if (!engine || videoLookRef.current === on) return;
    const activeMode = engine.renderMode as RenderMode;
    modHafizaYaz(activeMode);
    videoLookRef.current = on;
    modKaliteUygula(activeMode);
  }

  /** Post-FX gruplarının canlı uniform sözlükleri — tek yerde toplanır. */
  function kaliteHedefleri(engine: Engine): Record<KaliteGrubu, {
    defs: ParamDef[]; uniforms: Record<string, THREE.IUniform>;
  }> {
    return {
      bloom: { defs: BLOOM_PARAMS, uniforms: engine.bloomUniforms as unknown as Record<string, THREE.IUniform> },
      chromatic: { defs: CHROMATIC_PARAMS, uniforms: engine.chromaticUniforms as unknown as Record<string, THREE.IUniform> },
      grain: { defs: GRAIN_PARAMS, uniforms: engine.grainUniforms as unknown as Record<string, THREE.IUniform> },
      look: { defs: LOOK_PARAMS, uniforms: engine.lookUniforms as unknown as Record<string, THREE.IUniform> },
    };
  }

  /** ParamDef listelerinin kendi `default` alanları — tek doğruluk kaynağı. */
  function kaliteVarsayilanlari(engine: Engine): Record<KaliteGrubu, Record<string, number>> {
    const hedef = kaliteHedefleri(engine);
    const out = {} as Record<KaliteGrubu, Record<string, number>>;
    for (const g of KALITE_GRUPLARI) {
      out[g] = {};
      for (const d of hedef[g].defs) {
        // Renk kolları profile girmez (mod kalitesi bir RENK kararı değil).
        if (d.kind !== 'color') out[g][d.key] = d.default;
      }
    }
    return out;
  }

  function modHafizaYaz(m: RenderMode) {
    const engine = engineRef.current;
    if (!engine) return;
    const hedef = kaliteHedefleri(engine);
    const kayit = {} as Record<KaliteGrubu, Record<string, number>>;
    for (const g of KALITE_GRUPLARI) {
      kayit[g] = {};
      for (const d of hedef[g].defs) {
        const u = hedef[g].uniforms[d.key];
        if (d.kind !== 'color' && typeof u?.value === 'number') kayit[g][d.key] = u.value;
      }
    }
    if (videoLookRef.current) videoModHafizaRef.current[m] = kayit;
    else modHafizaRef.current[m] = kayit;
  }

  function modKaliteUygula(m: RenderMode) {
    const engine = engineRef.current;
    if (!engine) return;
    const hedef = kaliteHedefleri(engine);
    const defaults = kaliteVarsayilanlari(engine);
    // Reference video has no photo-oriented bloom/exposure profile. Keep edits in separate memories.
    const degerler = videoLookRef.current ? (videoModHafizaRef.current[m] ?? defaults)
      : girisDegerleri(m, modHafizaRef.current, defaults);
    for (const g of KALITE_GRUPLARI) applyParams(hedef[g].defs, hedef[g].uniforms, degerler[g]);
    refreshPanel();
  }

  /**
   * SOĞUK AÇILIŞ — sunum modunda sahne kendiliğinden yüklenir.
   *
   * Normal modda açılış boş siyah tuvaldir: geliştirici ne yapacağını bilir.
   * Sunumda ilk iki saniye en pahalı saniyelerdir — izleyici bir şey dönerken
   * dinlemeye başlar, boş ekrana bakarken "bozuk mu?" diye düşünür.
   *
   * YALNIZ BİR KEZ (`soganTetiklendi`) ve yalnız motor hazırken. Kullanıcı o
   * sırada kendi dosyasını seçtiyse sahne EZİLMEZ: `mediaType` artık
   * 'synthetic' değilse ya da bir video/kamera açıldıysa atlanır.
   */
  useEffect(() => {
    const e = engineRef.current;
    const kaynakVar = !!videoDosya || cameraOn || !!egitimDosya;
    if (!soganAcilisGerekliMi(!!engine && !!e, soganTetiklendi.current, kaynakVar)) return;
    soganTetiklendi.current = true;
    e!.mediaType = 'synthetic';
    kaynakBelirle('sentetik');
    void acilisSahne();
    // `run` ve `syntheticImage` modül/bileşen düzeyinde bildirilmiş
    // fonksiyonlar; bağımlılık listesine girerlerse effect her render'da
    // yeniden kurulur ve soğuk açılış döngüye girer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sunum, engine, videoDosya, cameraOn, egitimDosya]);

  /**
   * Mod değiştirmenin GÜNCEL referansı. `changeMode` her render'da yeniden
   * oluşur ve içindeki `mode` o render'ın değeridir; uzun süren bir iş
   * (preset kapağı üretimi) sırasında yakalanan kopya bayatlar ve
   * `next === mode` kontrolü yanlışlıkla erken döner. Ref hep sonuncuyu
   * gösterir.
   */
  const changeModeRef = useRef<(m: RenderMode) => void>(() => {});

  function changeMode(next: RenderMode) {
    const engine = engineRef.current;
    if (!engine) return;
    if (next === mode) return;
    // MOD BAŞINA POST-FX (shaders/modKalite.ts). Çıkarken o modun o anki
    // değerleri hafızaya alınır, girerken hafıza varsa O uygulanır — yani
    // kullanıcının bir modda yaptığı ayar, başka modu gezip dönünce yerinde
    // durur. Sıra önemli: önce YAZ, sonra OKU.
    modHafizaYaz(mode);
    engine.setPointsMaterial(materials[next]);
    engine.selectRenderMode(next);
    modKaliteUygula(next);
    // Reuse the accepted frame so paused video can build the newly selected representation.
    if (videoRef.current) videoDepthRefreshRef.current?.();
    setMode(next);
    setGraphTick((t) => t + 1);
    if (next === 'solid' && !engine.solidAvailable) {
      say('solid: derinlik bekleniyor; geçici olarak nokta bulutu gösteriliyor');
    }
  }
  changeModeRef.current = changeMode;

  /**
   * GÜN 7 KABLOSU: canlı video/kamera → tek dünya sahnesi → splat modu.
   * Akış: keyframe yakala (256×192, zaman kapılı 8 kare) → flow (Shi-Tomasi +
   * LK) → chainPoseTrack (8-nokta + RANSAC + cheirality) → fuseVideoFrames
   * (ölçek üçgenlemeden) → kamera görüşüne sığdır → Engine.setGaussians →
   * splat moduna geç. Yoğun derinlik videoPipe'ın DepthProvider yolundan
   * gelir; model açılamazsa luminance geri düşüşü açıkça raporlanır.
   */
  async function fuseVideoToSplat() {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine) {
      say('video → 3B: önce video yükle veya kamerayı aç');
      return;
    }
    setBusy(true);
    try {
      const t0 = performance.now();
      say(`video → 3B: keyframe yakalanıyor (${(video.currentTime || 0).toFixed(1)}s)...`);
      const frames = await captureKeyframes(video);
      if (frames.length < 2) {
        say(`video → 3B: keyframe yetersiz (${frames.length}). Video oynuyor mu?`);
        return;
      }
      say(`video → 3B: ${frames.length} keyframe · eşleştirme + poz + füzyon...`);
      const scene = await buildFusionScene(frames);
      if (scene.data.count === 0) {
        say('video → 3B: splat üretilemedi (luminance/video durağan mı?)');
        return;
      }
      engine.setGaussians(scene.data);
      engine.setCameraPose({ position: [0, 0.35, 2.2], target: [0, 0, 0] });
      if (mode !== 'splat') changeMode('splat');
      say(
        `video → 3B: ${scene.data.count.toLocaleString('tr-TR')} splat · ` +
          (scene.scale ? `ölçek a=${scene.scale.scaleA.toFixed(3)} b=${scene.scale.scaleB.toFixed(3)}` : 'ölçek yok (üçgenleme yetersiz, d_pred ölçeği)') +
          ` · ${scene.stats.flowMatches} eşleşme · ${Math.round(performance.now() - t0)} ms`,
      );
    } catch (err) {
      say(`video → 3B HATA: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * SAĞ PANELLER değişkende tutulur: normal düzende ayrı birer ızgara
   * sütunu, sunumda tek sütunda üst üste — iki yerleşim de aynı
   * elemanları kullanır, prop listesi iki kez yazılmaz.
   */
  const kutuphanePaneli = engine && (
    <KutuphanePaneli
      targets={panelHedefleri()}
      onApplied={refreshPanel}
      sahne={{
        canvas: engine.renderer.domElement,
        renderFrame: () => engine.renderFrame(),
        serialize: () => serializeRenderState(panelHedefleri()),
        setMode: (m) => changeModeRef.current(m),
      }}
    />
  );
  const efektPaneli = engine && (
    <ControlPanel
      engine={engine}
      baslangicKapali={sunum}
      setModeGuncel={(m) => changeModeRef.current(m)}
      grain={engine.grainUniforms}
      feedback={engine.feedbackUniforms}
      chromatic={engine.chromaticUniforms}
      bloom={engine.bloomUniforms}
      look={engine.lookUniforms}
      points={materials.points}
      ascii={materials.ascii}
      neon={materials.neon}
      solid={materials.solid}
      splat={materials.splat}
      crystal={materials.crystal}
      setMode={changeMode}
      mode={mode}
      syncKey={panelTick}
    />
  );

  return (
    <div
      style={{
        // Z3: masaüstünde sağdaki SABİT panel (220 px) içeriği örtüyordu;
        // kadraj payı bırakılır. Dar ekranda panel akışa girdiği için pay
        // gerekmez ve kenar boşluğu küçülür (351 px'lik sahneye yer açar).
        padding: dar ? 12 : 16,
        display: 'grid',
        /**
         * Kök akış tek sütun: üst bar, çalışma alanı, transport, sonra ALT
         * bölüm (graf/capture/metrik/log) — alt bölüm olduğu gibi kalır.
         *
         * ÜÇ SÜTUN yalnız ÇALIŞMA ALANINDA (aşağıdaki iç grid).
         */
        gridTemplateColumns: 'minmax(0, 1fr)',
        alignContent: 'start',
        gap: dar ? 10 : 12,
        justifyItems: 'stretch',
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100%',
        fontFamily: SANS,
        color: renk.metin,
        // Camın altında görünecek derinlik: düz siyah yerine hafif renk geçişi
        // (glassmorphism arkasında desen yoksa cam "gri sis" gibi durur).
        minHeight: '100vh',
        // TEK EKSEN: siyahtan koyu maviye. Mor gradyan kalktı (istenen palet
        // siyah/gri/koyu mavi; ayrıca o gradyan "yapay arayüz" imzasıydı).
        background: `linear-gradient(180deg, #0d1018 0%, ${renk.zemin} 420px)`,
      }}
    >
      {/* `font` kısayolu + `fontSize` birlikte kullanılınca React her
          yeniden çizimde uyarı basıyordu (konsolda onlarca satır). */}
      {/* ÜST ŞERİT — referans arayüzdeki durum barı: kimlik + sürüm solda,
          canlı durum (mod · kaynak · fps) sağda. Sürüm `package.json`'dan
          gelir (elle güncellenmez). */}
      <header style={{ ...ustSerit(dar) }}>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.2 }}>spatial-canvas</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: renk.metinSilik, padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.06)' }}>
          v{__APP_VERSION__}
        </span>
        <span style={toolDivider} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: renk.metinSolgun }}>
          <span style={led(true, renk.vurgu)} />
          {mode}
        </span>
        <span style={{ fontSize: 11, color: renk.metinSilik }}>
          {cameraOn ? 'kamera' : videoDosya ? 'video' : 'fotoğraf'}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: fps >= 30 ? renk.iyi : renk.uyari }}>
          {fps} fps
        </span>
      </header>

      {/* Z2 — sessiz bozulma yerine sebep: WebGPU/canlı derinlik/tespit
          kapalıysa üstte tek şerit. Her şey çalışıyorsa hiç çizilmez. */}
      <YetenekUyarisi say={say} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* KAYNAK */}
        <button
          style={toolButton}
          disabled={busy || !!egitimDosya}
          onClick={() => {
            teardownSource();
            setCameraOn(false);
            engineRef.current!.mediaType = 'synthetic';
            kaynakBelirle('sentetik');
            void acilisSahne();
          }}
        >
          {sunum ? 'örnek sahne' : 'sentetik görsel'}
        </button>
        {/* İLK HAMLE. Sunumda bu düğme tek DOLGU kontrolüdür: ziyaretçi
            kendi fotoğrafını yüklemeden hiçbir şey anlam kazanmıyor, ama
            düğme diğer yirmi kontrolle aynı ağırlıktaydı. */}
        <label
          style={{
            ...(sunum ? birincilDugme() : toolButton),
            display: 'inline-flex',
            gap: 4,
            alignItems: 'center',
          }}
          title="görsel ya da video seç (sürükle-bırak da çalışır)"
        >
          {sunum ? 'fotoğrafını yükle' : 'dosya…'}
          <input
            type="file"
            accept="image/*,video/*"
            disabled={busy || !!egitimDosya}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset first: picking the same file again must fire onChange
              // even when this attempt fails.
              e.target.value = '';
              if (file) void handleFile(file);
            }}
          />
        </label>
        {!sunum && (
          <button style={toggleButton(cameraOn, '#357')} disabled={busy || !!egitimDosya} onClick={toggleCamera}>
            {cameraOn ? 'kamerayı kapat' : 'kamera'}
          </button>
        )}
        <span style={toolDivider} />
        {/* ANALİZ */}
        {!sunum && <button
          style={toolButton}
          disabled={busy || !!egitimDosya}
          onClick={fuseVideoToSplat}
          title="videodan keyframe yakala → flow + poz + füzyon → 3B splat sahnesi (Gün 7 kablosu)"
        >
          video → 3B
        </button>}
        {/* Video yüklenmeden ÇALIŞAMAZ. Sunumda devre dışı göstermek yerine
            HİÇ çizilmez: ilk ekranda tıklanamayan bir düğme hem kontrol
            sayısına giriyor hem "neden çalışmıyor" sorusu doğuruyor.
            Video gelince kendiliğinden belirir — 3. vuruş kaybolmaz. */}
        {(!sunum || !!videoDosya) && <button
          style={toolButton}
          disabled={busy || !videoDosya || !!egitimDosya || captureRunning}
          onClick={() => {
            // Canlı derinlik + tespit + eğitim aynı GPU'yu paylaşır; splat.js
            // bizim GPU kuyruğumuzu bilmez. Kaynağı bırakmak canlı döngüleri
            // durdurur, tracker kapanınca tespit de durur.
            teardownSource();
            setTrackerOn(false);
            setEgitimDosya(videoDosya);
            say(`3D eğitim başladı · ${videoDosya!.name}`);
          }}
          title={
            captureRunning
              ? 'hızlı 3B harita sürüyor; bitince eğitilebilir'
              : videoDosya
                ? 'videodan gerçek 3D Gaussian Splat eğit (WebGPU, birkaç dakika)'
                : 'önce video yükle'
          }
        >
          3D eğit
        </button>}
        {playbackVideo && <LiveVideoControls video={playbackVideo} quality={liveQuality}
          stats={liveStats} onError={say} onQuality={(size) => {
            liveQualityRef.current = size; setLiveQuality(size);
          }} />}
        {!!videoDosya && videoPreparationAsk && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span>uzun video ({(videoPreparationAsk.video.duration / 60).toFixed(1)} dk): derinlik arka planda hazırlansın mı? tahmini ~{Math.ceil(videoPreparationAsk.estimate / 60)} dk</span>
          <button onClick={() => {
            const ask = videoPreparationAsk;
            setVideoPreparationAsk(null);
            if (videoRef.current === ask.video) prepareUploadedVideo(ask.file, ask.video);
          }}>hazırla</button>
          <button onClick={() => setVideoPreparationAsk(null)}>geç</button>
        </div>}
        {!!videoDosya && videoPreparation && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span>Video derinliği: {VIDEO_STAGE_LABEL[videoPreparation.stage]}</span>
          <progress aria-label="Hazırlanan video derinliği" max={Math.max(1, videoPreparation.totalSeconds)}
            value={videoPreparation.readySeconds} />
          <span>{videoPreparation.readySeconds.toFixed(1)} / {videoPreparation.totalSeconds.toFixed(1)} sn</span>
          {videoPreparation.stage !== 'ready' && <span>işlenen {(videoPreparation.processedSeconds ?? 0).toFixed(1)} sn</span>}
          {!['ready', 'fallback', 'cancelled'].includes(videoPreparation.stage) && <button onClick={() => {
            preparedVideoAbortRef.current?.abort();
            stopPreparedVideo();
            setVideoPreparation({ ...videoPreparation, stage: 'cancelled' });
          }}>hazırlığı iptal et</button>}
          {videoPreparation.error && <span role="status">canlı derinliğe dönüldü</span>}
          {segment && videoMaskProgress !== null && videoMaskProgress < 1 && <span>nesne ayırma için canlı derinlik · maske izi %{Math.round(videoMaskProgress * 100)}</span>}
        </div>}
        {(cameraOn || !!videoDosya) && <>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
            kenar temizliği
            <input type="range" min={0} max={4} step={1} value={videoEdgeCleanup}
              aria-label="Video kenar temizliği"
              onChange={(event) => {
                const strength = Number(event.target.value);
                setVideoEdgeCleanup(strength);
                engineRef.current?.setVideoEdgeCleanup(strength);
                videoDepthRefreshRef.current?.();
              }} />
            <output>{videoEdgeCleanup}</output>
          </label>
          <span style={{ fontFamily: MONO, fontSize: 11 }} aria-live="polite">
            model {liveRates.model.toFixed(1)} Hz · akış {liveRates.flow.toFixed(1)} Hz
          </span>
        </>}
        {/* DURUM OKUMALARI — "nesne ayırma: kapalı" bir FİİL değil, bir
            geliştirici göstergesi. Sunumda mount edilmez. */}
        {!sunum && (
          <>
            {import.meta.env.DEV && <a href="/bench/points.html" target="_blank" rel="noreferrer"
              style={{ color: renk.metin, fontSize: 12 }}>nokta sayısı ölçümü</a>}
            <button style={toggleButton(segment, '#2a3')} disabled={busy} onClick={toggleSegment}>
              nesne ayırma: {segment ? 'AÇIK' : 'kapalı'}
            </button>
            <button style={toggleButton(showMask, '#a53')} disabled={busy} onClick={toggleMaskOverlay}>
              maskeyi göster: {showMask ? 'AÇIK' : 'kapalı'}
            </button>
            <button
              style={toggleButton(trackerOn, '#357')}
              disabled={busy}
              onClick={() => setTrackerOn((on) => !on)}
              title="izleme HUD'u: hedef kutuları motor görüntüsünün üstüne çizilir"
            >
              tracker: {trackerOn ? 'AÇIK' : 'kapalı'}
            </button>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', color: '#889', fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useTextureColor}
                onChange={(e) => {
                  const v = e.target.checked;
                  setUseTextureColor(v);
                  engineRef.current!.setUseTextureColor(v);
                }}
              />
              orijinal renkler
            </label>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', color: '#889', fontSize: 12, cursor: 'pointer' }}
              title="yüklenen videonun derinliğini arka planda hazırlar (kısa videolar kendiliğinden, uzunlar sorulduktan sonra)">
              <input type="checkbox" checked={videoProcessing}
                onChange={(e) => setVideoProcessingSetting(e.target.checked)} />
              arka planda video işleme
            </label>
            <span style={toolDivider} />
          </>
        )}
        {/* ÇIKTI + DURUM */}
        </div>

      {/* İpucu şeridi: eskiden butonların ARASINDAydı ve dar pencerede
          kırpılıyordu — kendi satırına alındı. */}
      <span style={{ color: renk.metinSilik, fontSize: yazi.kucuk, marginTop: -4 }}>
        sürükle-bırak · tıkla-döndür · hover = kuvvet
      </span>

      {/* ÇALIŞMA ALANI — üç sütun: canvas · kütüphane (ince) · efektler.
          Göz soldan sağa akar: ne çizildiği → neyle çizileceği → nasıl
          ayarlandığı. Alt bölüm (graf/capture/metrik/log) bu grid'in DIŞINDA,
          eskisi gibi tam genişlikte akar. */}
      <div style={calismaAlani(dar, sunum)}>
      {/* SOL SÜTUN: canvas ve onun kumandası (transport) birlikte. */}
      <div style={{ display: 'grid', gap: dar ? 10 : 12, minWidth: 0 }}>
      <div
        ref={containerRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          // Same gate as the file input: a drop during photo processing would
          // tear down the source that run() is still writing into.
          if (busy || egitimDosya) return;
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        style={{
          // Z3: sabit 640×420 telefonda kadrajdan taşıyordu (375 px ekranda
          // sayfa 810 px'e çıkıp yatay kaydırma açıyordu). Genişlik kadraja
          // uyar, oran korunur — Engine zaten konteynerin ölçüsüne göre
          // yeniden boyutlanır (Engine.resize parent'ı okur).
          // Sahne artık ana alanın tamamını alır (referans düzen: solda büyük
          // görüntü, sağda efekt rafı). Üst sınır 960 px — daha genişte
          // parçacık yoğunluğu seyrelip görüntü zayıflıyor.
          width: '100%',
          aspectRatio: '16 / 10',
          /**
           * SUNUMDA TEK EKRAN. Sağ sütun ikiye inince tuval genişledi,
           * 16/10 oranı yüzden boyu da uzadı ve mod şeridi katlamanın
           * altına düştü (ölçüldü 1680×1050: şerit 1030 px'de, pencere
           * 1050). Sunumda modlara CANLI tıklanıyor — kaydirmak kabul
           * edilemez. Tavan konunca oran serbest kalır ve sahne biraz daha
           * geniş bir kadraja oturur; Engine konteyneri okuduğu için
           * sorunsuz. 300 px = üst bar + kaynak satırı + ipucu + transport.
           */
          ...(sunum ? { maxHeight: 'calc(100vh - 300px)' } : null),
          background: '#000',
          borderRadius: yaricap.kart,
          // Çerçeve yerine iç gölge: sahne "kutuda" değil, gömülü durur.
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), 0 24px 60px rgba(0,0,0,0.55)',
          position: 'relative',
          overflow: 'hidden',
          // Dokunmatikte sahneyi sürüklerken sayfa kaymasın (OrbitControls
          // kendi jestini alır).
          touchAction: 'none',
        }}
      >
        {/* Tracker HUD — maske overlay'iyle AYNI desen: motor canvas'ının
            üstünde, WebGL sahnesinin dışında. Kapalıyken hiç mount edilmez,
            rAF döngüsü de çalışmaz. Gün 2 akşam sync: mock veri yerine
            gerçek tracker.ts — kaynak yoksa (fotoğraf modu) boş dizi döner. */}
        {egitimDosya && (
          <Egitim3D
            dosya={egitimDosya}
            onKapat={() => setEgitimDosya(null)}
            say={say}
            onIlerleme={(m, hedef, bittiMi) => {
              if (!m) { setEgitimSeri([]); setEgitimHedef(0); setEgitimBitti(false); return; }
              setEgitimHedef(hedef);
              if (bittiMi) setEgitimBitti(true);
              setEgitimSeri((seri) => seriEkle(seri, m));
            }}
          />
        )}
        {trackerOn && (
          <TrackerOverlay
            getTargets={() => trackerTargetsRef.current}
            getDetectionStatus={() => trackerRef.current!.status}
            getGeneration={() => trackerRef.current!.generation}
            mod={trackerMod}
            onModChange={(m) => {
              setTrackerMod(m);
              trackerRef.current!.setMod(m);
              trackerTargetsRef.current = [];
              if (m === 'nesne') say('tracker: nesne modu. İlk tespit modeli yüklerken birkaç saniye sürebilir');
            }}
          />
        )}
        {/* ÇALIŞMA GÖSTERGESİ (tasarim-kurallari.md · Doherty eşiği): 400
            ms'yi aşan işlerde ekranda bir şey DEĞİŞMELİ. Model yükleme, RMBG
            ve derinlik çıkarımı saniyeler sürüyordu ve tek geri bildirim en
            alttaki log satırıydı — kullanıcı donmuş sanıyordu. */}
        {(busy || photoPreview) && (
          <div style={calismaKatmani}>
            <span style={calismaNokta} />
            {/* İNDİRME VARSA ONU SÖYLE. "işleniyor…" 131 MB boyunca da aynı
                kalıyordu; değişmeyen bir ekran "bozuldu" diye okunur. İndirme
                bitince satir düşer ve yine "işleniyor…" yazılır. */}
            <span>{photoPreview
              ? busy ? `Önizleme · ${indirme ?? 'kalite iyileştiriliyor…'}` : 'Önizleme · kalite tamamlanamadı; yeniden yükleyin'
              : indirme ?? 'işleniyor…'}</span>
            {indirme && (
              <span style={{ fontSize: yazi.kucuk, color: renk.metinSilik }}>
                görüntün bilgisayarından çıkmıyor
              </span>
            )}
          </div>
        )}
        {/* SPLAT TEMİZLEME — seçim katmanı sahnenin üstünde (TrackerOverlay ile
            aynı desen: WebGL sahnesinin DIŞINDA, 2D kanvas). Kapalıyken hiç
            mount edilmez, kendi rAF döngüsü de çalışmaz. */}
        {engine && temizlemeAcik && !egitimDosya && (
          <SplatTemizleme
            kaynak={motorKaynagi(engine, () => {
              const c = engine.renderer.domElement;
              return { en: c.clientWidth, boy: c.clientHeight };
            })}
            say={say}
            onKapat={() => setTemizlemeAcik(false)}
          />
        )}
        {showMask && (
          <canvas
            ref={segOverlayRef}
            style={{ position: 'absolute', left: 8, bottom: 8, border: '1px solid #444', background: '#111', pointerEvents: 'none' }}
          />
        )}
      </div>
      {/* TRANSPORT — sahne durumu · mod · çıktı tek şeritte (bkz. TransportSerit). */}
      {engine && (
        <TransportSerit
          engine={engine}
          fps={fps}
          mod={mode}
          modlar={
            <ModeSelector
              engine={engine}
              materials={materials}
              mode={mode}
              sunum={sunum}
              onChange={changeMode}
              onReset={() => { say('sıfırlandı: efektler, look ve kamera başlangıç değerlerinde (görsel korundu)'); refreshPanel(); }}
            />
          }
          ciktiKatlanir={sunum}
          cikti={
            <>
              <ExportBar engine={engine} say={say} preparing={busy || photoPreview} />
              {/* AR/VR önizleme ÇIKTI bloğunda: sahneyi başka bir yere
                  taşıyan işlemler burada toplanır (PNG · WebM · PLY · AR). */}
              <ArDugmesi engine={engine} sahneVar={!egitimDosya} say={say} />
            </>
          }
          araclar={
            <button
              type="button"
              style={{ ...temaDugme(temizlemeAcik), opacity: engine.splatAvailable ? 1 : 0.45 }}
              disabled={!engine.splatAvailable || !!egitimDosya}
              aria-pressed={temizlemeAcik}
              title={engine.splatAvailable
                ? 'boşlukta kalan parçacıkları elle seçip sil (geri alınabilir)'
                : 'splat sahnesi yok; önce splat modu ya da füzyon gerekiyor'}
              onClick={() => setTemizlemeAcik((v) => !v)}
            >
              {/* ⌫ (backspace) KALDIRILDI: 11 px'te okunmuyor, kullanıcı onu
                  "fırça" sandı ve düğmenin neyi temizlediği anlaşılmadı.
                  Etiket artık NESNEYİ söylüyor; glif tahmine bırakmıyor. */}
              artıkları temizle
            </button>
          }
          altSatir={egitimDosya
            ? <EgitimGrafik seri={egitimSeri} hedefIter={egitimHedef} bitti={egitimBitti} />
            : undefined}
        />
      )}
      </div>

      {/* SAĞ PANELLER — düzene göre iki sütun ya da tek.
          Kütüphane eskiden efekt rafının 07. kartının içindeydi: kapak
          görmek için önce kartı açmak gerekiyordu. Sunumda ikisi tek
          sütunda üst üste (calismaAlani); efekt rafı ÜSTTE, çünkü kapalı
          başlıyor ve kısa — kaydırmalı kütüphane altındaki yeri doldurur. */}
      {engine && (sunum ? (
        <div
          style={{
            display: 'grid',
            // Efekt rafı kendi boyunda, kütüphane KALANI alır ve kendi içinde
            // kaydırılır. minmax(0,1fr) şart: 1fr tek başına içeriğin altına
            // inemez ve sütun sayfayı 1,41 ekrana uzatıyordu (ölçüldü).
            gridTemplateRows: 'auto minmax(0, 1fr)',
            gap: 12,
            minWidth: 0,
            maxHeight: 'calc(100vh - 120px)',
          }}
        >
          {efektPaneli}
          {kutuphanePaneli}
        </div>
      ) : (
        <>
          {kutuphanePaneli}
          {efektPaneli}
        </>
      ))}
      </div>

      {/* ── ENSTRÜMAN KATMANI ────────────────────────────────────────────
          Buradan aşağısı geliştiricinin sorusunu cevaplar: graf, capture,
          eval raporu, preset yönetimi, kuvvet kolları, ham log. Sunum
          modunda MOUNT EDİLMEZ (ui/sunumModu.ts · SUNUM_DISI); mount
          edilmediği için kurulum maliyeti de oluşmaz. */}
      {!sunum && engine && <NodeGraphEditor engine={engine} graphTick={graphTick} onRenderModeChange={changeMode} onParamsApplied={refreshPanel} />}
      {/* GÜN 6-7 (render şeridi): capture akışı + metrik paneli. İkisi de
          kendi durumunu tutar; Engine'e yalnızca imzalı API'den yazarlar
          (setGaussians / setPoseTrack / setSelectedKeyframe). */}
      {!sunum && engine && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260, flex: '1 1 260px' }}>
            <CapturePanel
              engine={engine}
              setMode={changeMode}
              onLog={say}
              disabled={!!egitimDosya}
              onRunningChange={setCaptureRunning}
            />
          </div>
          <div style={{ minWidth: 260, flex: '1 1 260px' }}>
            <MetricsPanel />
          </div>
        </div>
      )}
      {!sunum && engine && <PresetControls engine={engine} say={say} onGraphChanged={() => { setGraphTick((t) => t + 1); refreshPanel(); }} />}
      {!sunum && engine && <ForceControls engine={engine} />}
      {!sunum && (
        <pre style={{
          margin: 0, color: renk.metinSolgun, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          maxWidth: 'min(960px, 100%)', boxSizing: 'border-box', width: '100%',
          fontFamily: MONO, fontSize: 11, lineHeight: 1.6, maxHeight: 180, overflowY: 'auto',
          ...yuzey(1), padding: bosluk.m,
        }}>{log.join('\n')}</pre>
      )}
    </div>
  );
}

/**
 * Simülasyon kontrolleri — veri katmanının kendi ayar kolları (Emre).
 * Zeynep'in `ui/ControlPanel` paneli render katmanına ait, karıştırma.
 * Slider'lar uniform'a doğrudan yazar; React state yalnızca etiketi tazeler.
 */
/**
 * Preset kontrolleri — veri katmanının kendi kolu (Emre). Gün 4:
 * kaydet → sayfayı yenile → yükle = sahne birebir geri gelir (kamera dahil).
 * Dosya indirme/yükleme yok; isimli localStorage slotları, sürüm 1.
 */
function PresetControls({
  engine,
  say,
  onGraphChanged,
}: {
  engine: Engine;
  say: (line: string) => void;
  onGraphChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [slots, setSlots] = useState<string[]>(() => listSlots());

  const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 };

  function save() {
    const n = name.trim();
    if (!n) return;
    const ok = saveSlot(n, toPreset(engine, n));
    say(ok ? `preset kaydedildi: "${n}" · versiyon ${PRESET_VERSION}` : `preset kaydedilemedi: "${n}" (depolama yok)`);
    setSlots(listSlots());
  }

  function load(n: string) {
    const preset = loadSlot(n);
    if (!preset) {
      say(`preset açılamadı: "${n}" (sürüm uyuşmuyor ya da bozuk)`);
      return;
    }
    try {
      const { applied, warnings } = applyPreset(engine, preset);
      say(`preset yüklendi: "${n}" · aktif düğümler: ${applied.length} (${[...applied].join(', ')})`);
      for (const w of warnings) say(`  uyarı: ${w}`);
      onGraphChanged();
    } catch (err) {
      say(`preset HATA: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function remove(n: string) {
    deleteSlot(n);
    setSlots(listSlots());
  }

  /** GÜN 6: anlık durumu JSON dosyası olarak indir — paylaşım + yedek. */
  function exportFile() {
    const n = name.trim() || 'preset';
    try {
      downloadPresetFile(toPreset(engine, n));
      say(`preset dosyası indirildi: ${n}.json`);
    } catch (err) {
      say(`dosya indirme HATA: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** GÜN 6: JSON dosyasından preset aç — sürüm koruması uygulanır. */
  async function importFile(file: File) {
    try {
      const preset = await parsePresetFile(file);
      const { applied, warnings } = applyPreset(engine, preset);
      say(`dosya preset yüklendi: "${preset.name}" · aktif düğümler: ${applied.length}`);
      for (const w of warnings) say(`  uyarı: ${w}`);
      onGraphChanged();
    } catch (err) {
      say(`dosya preset HATA: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', color: '#889' }}>
      <span style={{ fontSize: 12 }}>preset:</span>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="slot adı"
        onKeyDown={(e) => e.key === 'Enter' && save()}
        style={{ width: 140, fontSize: 12, padding: '4px 8px', background: '#101018', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3 }}
      />
      <button
        type="button"
        onClick={save}
        style={{ fontSize: 12, padding: '4px 8px', background: '#1a1a22', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}
      >
        kaydet
      </button>
      <button
        type="button"
        onClick={exportFile}
        style={{ fontSize: 12, padding: '4px 8px', background: '#1a1a22', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}
      >
        dosya ↓
      </button>
      <label style={{ fontSize: 12, padding: '4px 8px', background: '#1a1a22', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}>
        dosya ↑
        <input
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = '';
          }}
        />
      </label>
      {slots.map((n) => (
        <span key={n} style={{ ...row, gap: 4 }}>
          <button type="button" onClick={() => load(n)} style={{ fontSize: 12, padding: '4px 8px', background: '#1a1a22', color: '#8ab', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}>
            {n}
          </button>
          <button
            type="button"
            title={`"${n}" slotunu sil`}
            onClick={() => remove(n)}
            style={{ fontSize: 10, padding: '4px 8px', background: 'none', color: '#667', border: 'none', cursor: 'pointer' }}
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

const FORCE_MODES = ['itme', 'çekim', 'vortex'];

function ForceControls({ engine }: { engine: Engine }) {
  const u = engine.simUniforms;
  const [mode, setMode] = useState(u.uForceMode.value);
  const [radius, setRadius] = useState(u.uForceRadius.value);
  const [strength, setStrength] = useState(u.uForceStrength.value);
  const [stiffness, setStiffness] = useState(u.uStiffness.value);
  const [grabStrength, setGrabStrength] = useState(u.uGrabStrength.value);

  const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 };

  return (
    <div style={{ ...row, flexWrap: 'wrap', color: '#889' }}>
      <span>kuvvet:</span>
      {FORCE_MODES.map((label, value) => (
        <button
          key={label}
          onClick={() => {
            u.uForceMode.value = value;
            setMode(value);
          }}
          style={{ fontWeight: mode === value ? 700 : 400 }}
        >
          {label}
        </button>
      ))}
      <Slider label="yarıçap" min={0.05} max={1} step={0.01} value={radius}
        onChange={(v) => { u.uForceRadius.value = v; setRadius(v); }} />
      <Slider label="şiddet" min={0} max={0.1} step={0.002} value={strength}
        onChange={(v) => { u.uForceStrength.value = v; setStrength(v); }} />
      <Slider label="yay" min={0.01} max={0.3} step={0.005} value={stiffness}
        onChange={(v) => { u.uStiffness.value = v; setStiffness(v); }} />
      <Slider label="grab (home)" min={0} max={0.5} step={0.01} value={grabStrength}
        onChange={(v) => { u.uGrabStrength.value = v; setGrabStrength(v); }} />
      <span style={{ color: '#667' }}>sapma ≈ {(strength / stiffness).toFixed(2)} birim</span>
    </div>
  );
}

function Slider({
  label, min, max, step, value, onChange,
}: {
  label: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        style={{ width: 90 }}
      />
      <span style={{ color: '#8ab', fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(3)}</span>
    </label>
  );
}

/**
 * Örnek sahnenin 2B çizimi. Geometri `ui/acilisSahnesi` içinde TEK yerde
 * durur; derinlik haritası da aynı tanımdan türer. Buradaki çizim sırası
 * (gök → zemin → binalar → küre) `acilisDerinligi` ile AYNI olmalı:
 * sonra çizilen önceki örter, derinlik de aynı örtmeyi uygular.
 */
function syntheticImage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ACILIS_EN;
  canvas.height = ACILIS_BOY;
  const ctx = canvas.getContext('2d')!;

  const sky = ctx.createLinearGradient(0, 0, 0, ACILIS_BOY);
  sky.addColorStop(0, GOK.ust);
  sky.addColorStop(1, GOK.alt);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, ACILIS_EN, ACILIS_BOY);

  ctx.fillStyle = ZEMIN.renk;
  ctx.fillRect(0, UFUK_Y, ACILIS_EN, ACILIS_BOY - UFUK_Y);
  for (const b of BINALAR) {
    ctx.fillStyle = b.renk;
    ctx.fillRect(b.x, UFUK_Y - b.boy, b.en, b.boy);
  }
  ctx.fillStyle = KURE.renk;
  ctx.beginPath();
  ctx.arc(KURE.x, KURE.y, KURE.r, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // onerror hands over a bare Event ("[object Event]"); give the log a reason.
    img.onerror = () => reject(new Error('görsel çözülemedi'));
    img.src = src;
  });
}
