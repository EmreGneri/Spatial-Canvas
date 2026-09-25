import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { estimateDepth, loadDepthModel, luminanceHeightMap, resetLuminanceState } from './depth';
import { segmentForeground } from './engine/reconstruction/segmentation';
import { Engine } from './engine';
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
import { KutuphanePaneli } from './ui/KutuphanePaneli';
import { serializeRenderState } from './shaders/renderPreset';
import { maskeKarari } from './ui/maskeKarari';
import { useDarEkran } from './ui/useDarEkran';
import { bosluk, cam, dugme as temaDugme, led, MONO, renk, SANS, yaricap, yazi, yuzey } from './ui/tema';
import { YetenekUyarisi } from './ui/YetenekUyarisi';
import { Egitim3D } from './ui/Egitim3D';
import { type TrackedTarget, type TrackerModu } from './engine/vision/tracker';
import { TrackerClient } from './engine/vision/trackerClient';
import {
  isitLiveModel, liveDepthKullanilabilir, maskeKacirmaOrani,
  maskeYenilenmeliMi, startLiveDepth, ustPercentilEsigi, type LiveDepthResult,
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
/** A new segmentation pass blocks the shared GPU queue, so refresh only on drift. */
const VIDEO_MASK_MIN_REFRESH_MS = 15_000;
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
function calismaAlani(dar: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: dar ? 'minmax(0, 1fr)' : 'minmax(360px, 1fr) minmax(0, 228px) minmax(0, 296px)',
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
    gap: dar ? 6 : 10,
    width: '100%',
    maxWidth: 'min(960px, 100%)',
    boxSizing: 'border-box',
    padding: dar ? '8px 10px' : '10px 14px',
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
  const [cameraOn, setCameraOn] = useState(false);
  const [segment, setSegment] = useState(false);
  const segmentRef = useRef(false);
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
  const [egitimDosya, setEgitimDosya] = useState<File | null>(null);
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
  const lastDepthRef = useRef<{ data: Float32Array; width: number; height: number } | null>(null);
  /** Bu kaynak için maske zaten üretildi mi? (video/kamera yollarında sıfırlanır) */
  const maskLoadedRef = useRef(false);
  /** Maske overlay canvas'ı ve görünürlük aynası — async yollardan (run,
   *  toggleSegment) drawMaskOverlay çağrılır; state'i beklemez. */
  const segOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const maskOverlayOnRef = useRef(false);

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
    if (import.meta.env.DEV) (window as unknown as { __engine?: Engine }).__engine = engine;    // Render katmanının shader'ı yer tutucunun yerine geçer (başlangıç modu).
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
    // Every pending async source path (photo inference, camera prompt, video
    // decode, live-depth start) sees this and stops before writing anything.
    sourceGenRef.current++;
    clearTimer();
    luminanceActiveRef.current = false;
    cancelLuminanceFrame();
    // Canlı model derinliği sürücüsü de bırakılır — yeni kaynak eski
    // sürücüyle çakışmasın (iki döngü aynı GPU kuyruğunda çekişir).
    liveDepthStopRef.current?.();
    liveDepthStopRef.current = null;
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

  async function run(source: HTMLCanvasElement | HTMLImageElement) {
    setBusy(true);
    // Captured after the caller's teardownSource. A stale result must not
    // write depth, mask, photo or segmentation settings over a newer source.
    const isCurrent = captureGeneration(sourceGenRef);
    try {
      const t0 = performance.now();
      await loadDepthModel();
      if (!isCurrent()) return;
      say(`model yüklendi            ${Math.round(performance.now() - t0)} ms`);

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
      lastPhotoRef.current = source;
      maskLoadedRef.current = false;
      const t2 = performance.now();
      try {
        const seg = await segmentForeground(source);
        if (!isCurrent()) return;
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
        const karar = maskeKarari(fgCount / seg.mask.length);
        if (karar.sebep) say(karar.sebep);
        if (karar.tip === 'kullan') {
          mask = seg.mask;
          maskW = seg.width;
          maskH = seg.height;
          maskLoadedRef.current = true;
          say(`nesne ayırma (IS-Net)    ${Math.round(performance.now() - t2)} ms  (${maskW}x${maskH})`);
        }
        updateSegment(karar.ayirmaAcik);
        engineRef.current!.setObjectSeparation(karar.ayirmaAcik);
      } catch (err) {
        if (!isCurrent()) return;
        say(`nesne ayırma atlandı (${err instanceof Error ? err.message : String(err)}) — maske olmadan devam`);
        updateSegment(false);
        engineRef.current!.setObjectSeparation(false);
      }

      // Depth ARTIK maskeyi görüyor (GÜN E, bulgu 1).
      const t1 = performance.now();
      const depth = await estimateDepth(
        source,
        mask ? { subjectMask: { data: mask, width: maskW, height: maskH } } : {},
      );
      if (!isCurrent()) return;
      say(
        `çıkarım                  ${Math.round(performance.now() - t1)} ms  (${depth.width}x${depth.height})` +
          (mask ? ' · özne maskesi kullanıldı' : ' · maskesiz'),
      );
      lastDepthRef.current = { data: depth.data, width: depth.width, height: depth.height };

      // TUR 11: fotoğrafın kendisi de parçacık renklerine bağlanır (görev 1 —
      // varsayılan mavi rampa yerine orijinal RGB). Kamera/video yolu bu
      // çağrıyı yapmaz → shader'lar derinlik rampasına düşer.
      engineRef.current!.setPhoto(source);
      engineRef.current!.setDepth(depth.data, depth.width, depth.height, mask, maskW, maskH);
      if (maskOverlayOnRef.current) drawMaskOverlay();
      say('depth → engine · point cloud konumları positionTexture\'dan okunur');
    } catch (err) {
      if (isCurrent()) say(`HATA: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
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

    const processFrame = () => {
      scheduled = false;
      // Model devraldıysa vekil susar (rVFC zinciri kendi kendini besler).
      if (!luminanceActiveRef.current) return;
      // Video ilk kareyi çözmeden drawImage boş/hatalı çizer.
      if (source instanceof HTMLVideoElement && source.readyState < 2) return;
      const t0 = performance.now();
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
    const id = window.setTimeout(isit, 1500);
    return () => {
      iptal = true;
      clearTimeout(id);
    };
  }, []);

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
    const isCurrent = captureGeneration(sourceGenRef);
    startLuminanceLoop(video, label);
    let iptal = false;
    let videoMask: { data: Float32Array; width: number; height: number } | null = null;
    let maskBusy = false;
    let maskUnavailable = false;
    let maskErrors = 0;
    let invalidMasks = 0;
    let maskNextRetryAt = 0;
    let maskBaseline: number | null = null;
    let lastMaskAttempt = -Infinity;
    let maskRevision = 0;
    let requestedRevision = segmentRevisionRef.current;
    let lastDepth: LiveDepthResult | null = null;
    // The mask only sets particle opacity. Re-applying the last depth lets a
    // mask that arrives while the video is paused take effect immediately.
    const applyDepth = (d: LiveDepthResult) => {
      const mask = segmentRef.current ? videoMask : null;
      engineRef.current?.setDepth(d.data, d.width, d.height,
        mask?.data, mask?.width, mask?.height, d.colorFrame);
    };
    const syncMaskRequest = () => {
      if (requestedRevision === segmentRevisionRef.current) return;
      requestedRevision = segmentRevisionRef.current;
      maskRevision++;
      videoMask = null;
      maskBaseline = null;
      maskUnavailable = false;
      maskErrors = 0;
      invalidMasks = 0;
      maskNextRetryAt = 0;
      lastMaskAttempt = -Infinity;
    };
    const captureMask = () => {
      syncMaskRequest();
      if (label !== 'video' || !segmentRef.current || iptal || maskBusy || maskUnavailable ||
        performance.now() < maskNextRetryAt || videoRef.current !== video) return;
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
      maskBusy = true;
      lastMaskAttempt = performance.now();
      const revision = maskRevision;
      // Capture before awaiting GPU work; the mask must describe one stable frame.
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) { maskBusy = false; maskUnavailable = true; return; }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // segmentForeground kendi içinde GPU sırasına girer (segmentation.ts) —
      // burada ikinci kez sarmalamak kuyruğu KİLİTLERDİ (yeniden girişli
      // değil, depth.ts:~112).
      void segmentForeground(canvas)
        .then((result) => {
          if (iptal || videoRef.current !== video || revision !== maskRevision) return;
          let foreground = 0;
          for (const value of result.mask) if (value >= 0.5) foreground++;
          const coverage = foreground / result.mask.length;
          if (coverage < 0.08 || coverage >= 0.92) {
            videoMask = null;
            maskBaseline = null;
            invalidMasks++;
            maskNextRetryAt = performance.now() + Math.min(60_000, 15_000 * 2 ** (invalidMasks - 1));
            say(`video maskesi güvenilir değil (%${(coverage * 100).toFixed(0)} ön plan); sonra yeniden denenecek`);
            return;
          }
          videoMask = { data: result.mask, width: result.width, height: result.height };
          maskBaseline = null;
          invalidMasks = 0;
          maskErrors = 0;
          maskNextRetryAt = 0;
          say(`video özne maskesi hazır · ${(coverage * 100).toFixed(0)}% ön plan`);
          if (lastDepth) applyDepth(lastDepth);
        })
        .catch((err) => {
          if (iptal || revision !== maskRevision) return;
          say(`video maskesi atlandı: ${err instanceof Error ? err.message : String(err)}`);
          videoMask = null;
          maskBaseline = null;
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
        say('canlı derinlik: WebGPU yok — parlaklık vekiliyle devam');
        return;
      }
      say(`canlı derinlik başlıyor · video ${video.videoWidth}x${video.videoHeight} · ${video.duration.toFixed(1)} sn`);
      let devraldi = false;
      let sayac = 0;
      let ageTotalMs = 0;
      let ageMaxMs = 0;
      let sonLog = performance.now();
      const stopDriver = startLiveDepth(
        video,
        (d) => {
          if (!devraldi) {
            devraldi = true;
            stopLuminanceLoop();
            say('canlı derinlik: model devraldı (depth-anything-v2-small · fp16)');
          }
          syncMaskRequest();
          lastDepth = d;
          applyDepth(d);
          const mask = segmentRef.current ? videoMask : null;
          if (!mask && segmentRef.current) {
            captureMask();
          } else if (mask && !maskBusy &&
            (maskBaseline === null || performance.now() - lastMaskAttempt >= VIDEO_MASK_MIN_REFRESH_MS)) {
            const threshold = ustPercentilEsigi(d.data, 25);
            const miss = maskeKacirmaOrani(d.data, d.width, d.height,
              mask.data, mask.width, mask.height, threshold);
            if (maskBaseline === null) maskBaseline = miss;
            else if (maskeYenilenmeliMi(miss, maskBaseline)) captureMask();
          }
          sayac++;
          if (video.currentTime >= d.mediaTime) {
            const ageMs = (video.currentTime - d.mediaTime) * 1000;
            ageTotalMs += ageMs;
            ageMaxMs = Math.max(ageMaxMs, ageMs);
          }
          const simdi = performance.now();
          if (simdi - sonLog > 3000) {
            say(`canlı derinlik · ${(sayac / ((simdi - sonLog) / 1000)).toFixed(1)} Hz · ${d.width}x${d.height} · kare yaşı ${Math.round(ageTotalMs / sayac)} ms (maks ${Math.round(ageMaxMs)})`);
            sayac = 0;
            ageTotalMs = 0;
            ageMaxMs = 0;
            sonLog = simdi;
          }
        },
        {
          // No `maskeAl`: a mask must not alter live video depth, or mask
          // arrival would move the geometry. The driver keeps looped masks;
          // only a user seek shows a different subject.
          onDiscontinuity: (reason) => {
            if (reason === 'seek') {
              maskRevision++;
              videoMask = null;
              maskBaseline = null;
              maskUnavailable = false;
              maskErrors = 0;
              invalidMasks = 0;
              maskNextRetryAt = 0;
              lastMaskAttempt = -Infinity;
            }
          },
          onError: (err, ardisik) =>
            say(`canlı derinlik hatası (${ardisik}/3): ${err instanceof Error ? err.message : String(err)}`),
          onVazgec: () => {
            say('canlı derinlik: ardışık 3 hata — parlaklık vekiline dönüldü');
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
  async function toggleSegment() {
    const next = !segment;
    updateSegment(next);
    engineRef.current!.setObjectSeparation(next);
    say(`nesne ayırma: ${next ? 'AÇIK (arka plan parçacıkları atılır — sadece büst)' : 'kapalı (tüm sahne, arka plan karartılır)'}`);
    if (!next) return;
    // Video: request a mask now instead of waiting for a new depth frame,
    // which never comes while paused. A stale callback ignores the call.
    videoMaskRequestRef.current?.();
    if (maskLoadedRef.current || !lastPhotoRef.current || !lastDepthRef.current) return;
    // Maske yok — fotoğraf yüklüyken buton sonradan açıldı: şimdi ayır.
    setBusy(true);
    try {
      const t2 = performance.now();
      const seg = await segmentForeground(lastPhotoRef.current);
      say(`nesne ayırma (RMBG)      ${Math.round(performance.now() - t2)} ms  (${seg.width}x${seg.height})`);
      // GÜN E (bulgu 1): önbellekteki depth MASKE-KÖR hesaplandı (buton o an
      // kapalıydı). Maske geldiğine göre depth yeniden çıkarılır — yoksa bu
      // yolda stretch/eğim aşamaları düzeltmeden yararlanamazdı.
      const d = await estimateDepth(lastPhotoRef.current, {
        subjectMask: { data: seg.mask, width: seg.width, height: seg.height },
      });
      lastDepthRef.current = { data: d.data, width: d.width, height: d.height };
      engineRef.current!.setDepth(d.data, d.width, d.height, seg.mask, seg.width, seg.height);
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
    if (!engineRef.current?.foregroundMask) {
      say('maskeyi göster: bu kaynakta maske yok (video/kamera ya da nesne ayırma kapalı)');
    }
  }, [showMask, engine]);

  /** RMBG maskesini (Engine'de işlenmiş hali: resample + dilate) gri tonlama
   *  overlay olarak çizer — "model mi morf mu" tanısı için (K1/K3 ayarını
   *  görsel doğrulamak). Maske yoksa (video/kamera) overlay temizlenir. */
  function drawMaskOverlay() {
    const canvas = segOverlayRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const mask = engine.foregroundMask;
    const dt = engine.depthTexture;
    if (!mask || !dt) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const dims = dt.image as { width: number; height: number };
    const w = dims.width;
    const h = dims.height;
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
      // Tur 12 (şikayet 1): kamera da canlı renk dokusu olarak bağlanır —
      // önceki resmin hayaleti parçacıklarda kalmaz.
      lastPhotoRef.current = null;
      lastDepthRef.current = null;
      maskLoadedRef.current = false;
      // Gün 8: fotoğraf maskesi bu kaynakta geçersiz — nesne ayırma canlı
      // shader bayrağıyla birlikte kapatılır (UI "AÇIK" yalanı söylemesin).
      updateSegment(false);
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
    const isVideo = file.type.startsWith('video/');
    if (!isVideo && !file.type.startsWith('image/')) {
      say(`desteklenmiyor: ${file.type || file.name}`);
      return;
    }
    teardownSource(); // canlı döngü varsa dursun
    setCameraOn(false);
    setVideoDosya(null);
    engineRef.current!.mediaType = 'upload';
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
        engineRef.current!.setObjectSeparation(false);
        engineRef.current!.setVideoSource(video);
        say(`video yüklendi · ${file.name} · model gelene kadar geçici parlaklık önizlemesi`);
        startVideoDepth(video, 'video');
      } else {
        const image = await loadImage(url);
        if (!isCurrent()) return;
        await run(image); // tek kare depth; run kendi hatasını raporlar
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
    engine.setPointsMaterial(materials[next]);
    engine.selectRenderMode(next);
    setMode(next);
    setGraphTick((t) => t + 1);
    // Solid kabuk fotoğraf-only: sessiz fallback yerine sebebi söylenir.
    if (next === 'solid' && !engine.solidAvailable) {
      say('solid: kabuk yok (fotoğraf gerekir) — nokta bulutunda kalındı');
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
        say(`video → 3B: keyframe yetersiz (${frames.length}) — video oynuyor mu?`);
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
          (scene.scale ? `ölçek a=${scene.scale.scaleA.toFixed(3)} b=${scene.scale.scaleB.toFixed(3)}` : 'ölçek yok (üçgenleme yetersiz — d_pred ölçeği)') +
          ` · ${scene.stats.flowMatches} eşleşme · ${Math.round(performance.now() - t0)} ms`,
      );
    } catch (err) {
      say(`video → 3B HATA: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

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
        <span style={{ fontFamily: MONO, fontSize: 10, color: renk.metinSilik, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.06)' }}>
          v{__APP_VERSION__}
        </span>
        <span style={toolDivider} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: renk.metinSolgun }}>
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
            run(syntheticImage());
          }}
        >
          sentetik görsel
        </button>
        <label style={{ ...toolButton, display: 'inline-flex', gap: 6, alignItems: 'center' }} title="görsel ya da video seç (sürükle-bırak da çalışır)">
          dosya…
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
        <button style={toggleButton(cameraOn, '#357')} disabled={busy || !!egitimDosya} onClick={toggleCamera}>
          {cameraOn ? 'kamerayı kapat' : 'kamera'}
        </button>
        <span style={toolDivider} />
        {/* ANALİZ */}
        <button
          style={toolButton}
          disabled={busy || !!egitimDosya}
          onClick={fuseVideoToSplat}
          title="videodan keyframe yakala → flow + poz + füzyon → 3B splat sahnesi (Gün 7 kablosu)"
        >
          video → 3B
        </button>
        <button
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
              ? 'hızlı 3B harita sürüyor — bitince eğitilebilir'
              : videoDosya
                ? 'videodan gerçek 3D Gaussian Splat eğit (WebGPU, birkaç dakika)'
                : 'önce video yükle'
          }
        >
          3D eğit
        </button>
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
        <span style={toolDivider} />
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
      <div style={calismaAlani(dar)}>
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
          <Egitim3D dosya={egitimDosya} onKapat={() => setEgitimDosya(null)} say={say} />
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
              if (m === 'nesne') say('tracker: nesne modu — ilk tespit modeli yüklerken birkaç saniye sürebilir');
            }}
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
              onChange={changeMode}
              onReset={() => { say('sıfırlandı: efektler, look ve kamera başlangıç değerlerinde (görsel korundu)'); refreshPanel(); }}
            />
          }
          cikti={<ExportBar engine={engine} say={say} />}
        />
      )}
      </div>

      {/* KÜTÜPHANE — orta sütun, ince. Eskiden efekt rafının 07. kartının
          içindeydi: kapak görmek için önce kartı açmak gerekiyordu ve
          kapaklar dar bir sütuna sıkışıyordu. */}
      {engine && (
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
      )}

      {/* EFEKTLER — sağ sütun, kaydırmalı akordeon. */}
      {engine && (
        <ControlPanel
          engine={engine}
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
      )}
      </div>

      {engine && <NodeGraphEditor engine={engine} graphTick={graphTick} onRenderModeChange={changeMode} onParamsApplied={refreshPanel} />}
      {/* GÜN 6-7 (render şeridi): capture akışı + metrik paneli. İkisi de
          kendi durumunu tutar; Engine'e yalnızca imzalı API'den yazarlar
          (setGaussians / setPoseTrack / setSelectedKeyframe). */}
      {engine && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
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
      {engine && <PresetControls engine={engine} say={say} onGraphChanged={() => { setGraphTick((t) => t + 1); refreshPanel(); }} />}
      {engine && <ForceControls engine={engine} />}
      <pre style={{
        margin: 0, color: renk.metinSolgun, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        maxWidth: 'min(960px, 100%)', boxSizing: 'border-box', width: '100%',
        fontFamily: MONO, fontSize: 11, lineHeight: 1.6, maxHeight: 180, overflowY: 'auto',
        ...yuzey(1), padding: bosluk.m,
      }}>{log.join('\n')}</pre>
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
        style={{ width: 140, fontSize: 12, padding: '3px 6px', background: '#101018', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3 }}
      />
      <button
        type="button"
        onClick={save}
        style={{ fontSize: 12, padding: '3px 10px', background: '#1a1a22', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}
      >
        kaydet
      </button>
      <button
        type="button"
        onClick={exportFile}
        style={{ fontSize: 12, padding: '3px 10px', background: '#1a1a22', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}
      >
        dosya ↓
      </button>
      <label style={{ fontSize: 12, padding: '3px 10px', background: '#1a1a22', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}>
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
          <button type="button" onClick={() => load(n)} style={{ fontSize: 12, padding: '3px 10px', background: '#1a1a22', color: '#8ab', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}>
            {n}
          </button>
          <button
            type="button"
            title={`"${n}" slotunu sil`}
            onClick={() => remove(n)}
            style={{ fontSize: 10, padding: '2px 6px', background: 'none', color: '#667', border: 'none', cursor: 'pointer' }}
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

/** Şekiller farklı ölçeklerde — depth çıktısının düz olmadığı görülsün. */
function syntheticImage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#9dc3e6');
  sky.addColorStop(1, '#e8d9b0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, 380, 512, 132);
  for (const [x, w, h] of [[40, 70, 160], [150, 90, 240], [300, 60, 120], [400, 100, 300]]) {
    ctx.fillStyle = '#5a5a68';
    ctx.fillRect(x, 380 - h, w, h);
  }
  ctx.fillStyle = '#c94f4f';
  ctx.beginPath();
  ctx.arc(256, 430, 60, 0, Math.PI * 2);
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
