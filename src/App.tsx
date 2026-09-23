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
import { type TrackedTarget, type TrackerModu } from './engine/vision/tracker';
import { TrackerClient } from './engine/vision/trackerClient';
import { isitLiveModel, liveDepthKullanilabilir, startLiveDepth } from './engine/vision/liveDepth';
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
const toolButton: CSSProperties = {
  // `font` KISAYOLU DEĞİL: React, aynı render'da kısayol (`font`) ile tekil
  // alanı (`fontSize`) birlikte güncelleyince uyarı basıyor ve stil
  // güncellemeleri sıraya bağlı hale geliyor. Aile ayrı, boyut ayrı yazılır.
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '4px 10px',
  background: '#1a1a22',
  color: '#c8c8d4',
  // Kenarlık de UZUN yazımla: toggle'lar yalnız `borderColor`'ı değiştiriyor,
  // taban `border` kısayolu olsaydı React aynı uyarıyı basardı (kısayol ile
  // tekil alan aynı elemanda karışmamalı).
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#26262e',
  borderRadius: 3,
  cursor: 'pointer',
};

function toggleButton(active: boolean, accent: string): CSSProperties {
  return active
    ? { ...toolButton, background: accent, color: '#fff', borderColor: accent }
    : toolButton;
}

/** Gruplar arası ince ayraç — şerit sardığında da grupları ayırır. */
const toolDivider: CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: '#26262e',
  margin: '0 2px',
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
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
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
  /** Tanılama: RMBG maskesini overlay olarak göster (model mi, morf mu?). */
  const [showMask, setShowMask] = useState(false);
  /** Tracker HUD overlay açık mı (Gün 2: mock veri — gerçek tracker.ts
   *  bağlantısı akşam sync'inde takılır). */
  const [trackerOn, setTrackerOn] = useState(false);
  /** Tracker modu: 'ozellik' kontrast kümeleri (model yok) · 'nesne' COCO
   *  tespiti (etiketli kutular). HUD panelindeki seçiciden değişir. */
  const [trackerMod, setTrackerMod] = useState<TrackerModu>('ozellik');
  const [useTextureColor, setUseTextureColor] = useState(true);
  const [fps, setFps] = useState(0);
  /** GÜN 6: WebM kayıt süresi — döngüsel butonla değiştirilir (5/10/20). */
  const [webmSec, setWebmSec] = useState(5);
  /** Editör dışından graf kurulduğunda (preset yükleme) editörü tazele. */
  const [graphTick, setGraphTick] = useState(0);
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
    const textureType = engine.simTextureLabel;
    setLog((prev) => [
      ...prev,
      `engine hazır · ${engine.positionCount.toLocaleString('tr-TR')} parçacık slotu · sim RT: ${textureType} · sürükle-döndür`,
      'point cloud material → shaders/pointCloudMaterial (soft particle, additive)',
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

  const say = (line: string) => setLog((prev) => [...prev, line]);

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
    clearTimer();
    luminanceActiveRef.current = false;
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
    try {
      const t0 = performance.now();
      await loadDepthModel();
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
        const fgRatio = fgCount / seg.mask.length;
        const hasFg = fgCount > 0 && fgRatio <= 0.92;
        if (fgCount > 0 && !hasFg) {
          say(`nesne ayırma: RMBG kareyi tümüyle ön plan saydı (%${(100 * fgRatio).toFixed(0)}) — maske atlandı`);
        }
        if (hasFg) {
          mask = seg.mask;
          maskW = seg.width;
          maskH = seg.height;
          maskLoadedRef.current = true;
          say(`nesne ayırma (RMBG)      ${Math.round(performance.now() - t2)} ms  (${maskW}x${maskH})`);
          setSegment(true);
          engineRef.current!.setObjectSeparation(true);
        } else {
          say('nesne ayırma: RMBG boş maske üretti — maske atlandı (tüm sahne)');
          setSegment(false);
          engineRef.current!.setObjectSeparation(false);
        }
      } catch (err) {
        say(`nesne ayırma atlandı (${err instanceof Error ? err.message : String(err)}) — maske olmadan devam`);
        setSegment(false);
        engineRef.current!.setObjectSeparation(false);
      }

      // Depth ARTIK maskeyi görüyor (GÜN E, bulgu 1).
      const t1 = performance.now();
      const depth = await estimateDepth(
        source,
        mask ? { subjectMask: { data: mask, width: maskW, height: maskH } } : {},
      );
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
      say(`HATA: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  /** Kamera/video: depth modeli yok, parlaklık = yükseklik. */
  function startLuminanceLoop(source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement, label: string) {
    clearTimer(); // kaynağı bırakmaz — teardownSource'u çağıran taraf yapar
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
        source.requestVideoFrameCallback(tick);
        if (!scheduled) {
          scheduled = true;
          processFrame();
        }
      };
      source.requestVideoFrameCallback(tick);
    } else {
      // rVFC desteklenmeyen tarayıcı: eski interval davranışı (kare kimliği
      // yok, smoothing yine de titremeyi önler).
      timerRef.current = window.setInterval(processFrame, 100);
    }
  }

  function stopLuminanceLoop() {
    luminanceActiveRef.current = false;
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
   * TAŞINMAYAN (bilinçli): kişisel repodaki video maskesi tazeleme, kalite
   * seçici UI ve istatistik paneli — hepsi kendi makinesini getiriyor.
   * Buradaki iş "video derinliği gerçek olsun"du.
   */
  function startVideoDepth(video: HTMLVideoElement, label: string) {
    startLuminanceLoop(video, label);
    let iptal = false;
    liveDepthStopRef.current = () => {
      iptal = true;
    };
    void liveDepthKullanilabilir().then((varMi) => {
      if (iptal || videoRef.current !== video) return;
      if (!varMi) {
        say('canlı derinlik: WebGPU yok — parlaklık vekiliyle devam');
        return;
      }
      let devraldi = false;
      let sayac = 0;
      let sonLog = performance.now();
      liveDepthStopRef.current = startLiveDepth(
        video,
        (d) => {
          if (!devraldi) {
            devraldi = true;
            stopLuminanceLoop();
            say('canlı derinlik: model devraldı (depth-anything-v2-small · fp16)');
          }
          engineRef.current?.setDepth(d.data, d.width, d.height);
          sayac++;
          const simdi = performance.now();
          if (simdi - sonLog > 3000) {
            say(`canlı derinlik · ${(sayac / ((simdi - sonLog) / 1000)).toFixed(1)} Hz · ${d.width}x${d.height}`);
            sayac = 0;
            sonLog = simdi;
          }
        },
        {
          onError: (err, ardisik) =>
            say(`canlı derinlik hatası (${ardisik}/3): ${err instanceof Error ? err.message : String(err)}`),
          onVazgec: () => {
            say('canlı derinlik: ardışık 3 hata — parlaklık vekiline dönüldü');
            liveDepthStopRef.current = null;
            if (videoRef.current === video) startLuminanceLoop(video, label);
          },
        },
      );
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
    setSegment(next);
    engineRef.current!.setObjectSeparation(next);
    say(`nesne ayırma: ${next ? 'AÇIK (arka plan parçacıkları atılır — sadece büst)' : 'kapalı (tüm sahne, arka plan karartılır)'}`);
    if (!next) return;
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
      setSegment(false);
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
    teardownSource(); // önce açık video/stream varsa bırak
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      videoRef.current = video;
      await video.play();
      setCameraOn(true);
      engineRef.current!.mediaType = 'camera';
      // Tur 12 (şikayet 1): kamera da canlı renk dokusu olarak bağlanır —
      // önceki resmin hayaleti parçacıklarda kalmaz.
      lastPhotoRef.current = null;
      lastDepthRef.current = null;
      maskLoadedRef.current = false;
      // Gün 8: fotoğraf maskesi bu kaynakta geçersiz — nesne ayırma canlı
      // shader bayrağıyla birlikte kapatılır (UI "AÇIK" yalanı söylemesin).
      setSegment(false);
      engineRef.current!.setObjectSeparation(false);
      engineRef.current!.setVideoSource(video);
      startVideoDepth(video, 'kamera');
      say('kamera açık · canlı luminance height map');
    } catch (err) {
      say(`HATA kamera: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleFile(file: File) {
    if (file.type.startsWith('video/')) {
      teardownSource();
      setCameraOn(false);
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.src = url;
      videoRef.current = video;
      engineRef.current!.mediaType = 'upload';
      await video.play();
      // Tur 12 (şikayet 1): video canlı renk dokusu olarak bağlanır —
      // resimden videoya geçişte parçacık renklerinde resim hayaleti kalmaz.
      lastPhotoRef.current = null;
      lastDepthRef.current = null;
      maskLoadedRef.current = false;
      // Gün 8: fotoğraf maskesi bu kaynakta geçersiz — nesne ayırma canlı
      // shader bayrağıyla birlikte kapatılır (UI "AÇIK" yalanı söylemesin).
      setSegment(false);
      engineRef.current!.setObjectSeparation(false);
      engineRef.current!.setVideoSource(video);
      say(`video yüklendi · ${file.name} · luminance yolu (model yok)`);
      startVideoDepth(video, 'video');
    } else if (file.type.startsWith('image/')) {
      teardownSource(); // canlı döngü varsa dursun, tek kare depth'e geç
      setCameraOn(false);
      const url = URL.createObjectURL(file);
      engineRef.current!.mediaType = 'upload';
      try {
        await run(await loadImage(url));
      } finally {
        URL.revokeObjectURL(url);
      }
    } else {
      say(`desteklenmiyor: ${file.type || file.name}`);
    }
  }

  /**
   * GÜN 8: mod değiştirmenin TEK kapısı — ModeSelector, ControlPanel ve
   * graf editörü hep buraya düşer. Sıra: ① material takası (Engine'in tek
   * bilinen yolu, eskisini dispose etmez) ② Engine.selectRenderMode →
   * graf params.mode güncellenir (graf = tek doğruluk kaynağı) ③ UI state
   * ④ editör tazelenir — üç kol da birbirinin değişikliğini görür.
   */
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

  /**
   * GÜN 7 KABLOSU: canlı video/kamera → tek dünya sahnesi → splat modu.
   * Akış: keyframe yakala (256×192, zaman kapılı 8 kare) → flow (Shi-Tomasi +
   * LK) → chainPoseTrack (8-nokta + RANSAC + cheirality) → fuseVideoFrames
   * (ölçek üçgenlemeden) → kamera görüşüne sığdır → Engine.setGaussians →
   * splat moduna geç. DÜRÜSTLÜK: yoğun derinlik = luminance (model video
   * yolunda çalışmaz — App tasarımı); şekil fiziği gerçektir (üçgenleme),
   * d_pred yalnız splat yerleşim marjıdır (videoPipe docstring, kayıt 1-3).
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
    <div style={{ padding: 24, display: 'grid', gap: 16, justifyItems: 'start' }}>
      {/* `font` kısayolu + `fontSize` birlikte kullanılınca React her
          yeniden çizimde uyarı basıyordu (konsolda onlarca satır). */}
      <h1 style={{ fontFamily: 'inherit', fontWeight: 'inherit', fontSize: 18, margin: 0 }}>spatial-canvas · Gün A — ACES + bloom + FXAA + sis (global look)</h1>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', maxWidth: 640 }}>
        {/* KAYNAK */}
        <button
          style={toolButton}
          disabled={busy}
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
            disabled={busy}
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                await handleFile(file);
                e.target.value = '';
              }
            }}
          />
        </label>
        <button style={toggleButton(cameraOn, '#357')} disabled={busy} onClick={toggleCamera}>
          {cameraOn ? 'kamerayı kapat' : 'kamera'}
        </button>
        <span style={toolDivider} />
        {/* ANALİZ */}
        <button
          style={toolButton}
          disabled={busy}
          onClick={fuseVideoToSplat}
          title="videodan keyframe yakala → flow + poz + füzyon → 3B splat sahnesi (Gün 7 kablosu)"
        >
          video → 3B
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
        <button
         type="button"
         style={toolButton}
         disabled={!engine}
         onClick={() => {
         const canvas = engineRef.current?.renderer.domElement;
         if (!canvas) return;
         // WebGL çizim tamponu compositing sonrası geçersizdir
         // (preserveDrawingBuffer kapalı): yakalamadan HEMEN ÖNCE, aynı
         // görevde bir kare çizilmezse PNG boş iner. Kancayı export
         // modülü çağırır — ölçekli yol da aynı tampondan okur.
         exportPNG(canvas, 'spatial-canvas', {
           onBeforeCapture: () => engineRef.current?.renderFrame(),
         })
          .then(() => say('PNG indirildi'))
          .catch((e) => say(`PNG HATA: ${e instanceof Error ? e.message : String(e)}`));
         }}
        >
         PNG
        </button>
        {/* E1 — sahneyi standart 3DGS .ply olarak dışa aktar. Üretilen dosya
            SuperSplat/PlayCanvas gibi görüntüleyicilerde açılır; çıktı
            uygulamanın içinde hapis kalmaz. Splat yoksa buton çalışmaz. */}
        <button
         type="button"
         style={toolButton}
         disabled={!engine}
         title="sahneyi 3D Gaussian Splat (.ply) olarak indir — SuperSplat vb. açar"
         onClick={() => {
           const snap = engineRef.current?.gaussianSnapshot();
           if (!snap) {
             say('PLY: sahnede splat yok (önce "video → 3B" çalıştır)');
             return;
           }
           try {
             exportPly({ ...snap, flatten: SPLAT_FLATTEN }, 'spatial-canvas');
             say(`PLY indirildi · ${snap.count.toLocaleString('tr-TR')} splat`);
           } catch (e) {
             say(`PLY HATA: ${e instanceof Error ? e.message : String(e)}`);
           }
         }}
        >
         PLY
        </button>
        <button
         type="button"
         style={toolButton}
         disabled={!engine}
         onClick={() => {
         const canvas = engineRef.current?.renderer.domElement;
         if (!canvas) return;
         say('WebM kaydı başladı...');
         exportWebM(canvas, { durationSec: webmSec })
          .then(() => say(`WebM indirildi (${webmSec} sn)`))
          .catch((e) => say(`WebM HATA: ${e instanceof Error ? e.message : String(e)}`));
         }}
        >
         WebM ({webmSec}sn)
        </button>
        <button
         type="button"
         disabled={!engine}
         onClick={() => { setWebmSec(webmSec === 5 ? 10 : webmSec === 10 ? 20 : 5); }}
         style={{ ...toolButton, fontSize: 11, padding: '4px 7px', background: 'none', color: '#667', borderColor: 'transparent' }}
         title="süreyi değiştir: 5/10/20 sn"
        >
         ⏱
        </button>
        <span style={{ color: fps >= 30 ? '#6a6' : '#c66', fontSize: 12, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>
         {fps} fps
        </span>
        </div>

      {/* İpucu şeridi: eskiden butonların ARASINDAydı ve dar pencerede
          kırpılıyordu — kendi satırına alındı. */}
      <span style={{ color: '#667', fontSize: 12, marginTop: -8 }}>
        görsel/video sürükle-bırak · tıklayıp döndür · hover = kuvvet
      </span>

      <div
        ref={containerRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        style={{ width: 640, height: 420, border: '1px solid #222', background: '#000', position: 'relative' }}
      >
        {/* Tracker HUD — maske overlay'iyle AYNI desen: motor canvas'ının
            üstünde, WebGL sahnesinin dışında. Kapalıyken hiç mount edilmez,
            rAF döngüsü de çalışmaz. Gün 2 akşam sync: mock veri yerine
            gerçek tracker.ts — kaynak yoksa (fotoğraf modu) boş dizi döner. */}
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
      {engine && <ModeSelector engine={engine} materials={materials} mode={mode} onChange={changeMode} onReset={() => say('sıfırlandı: efektler, look ve kamera başlangıç değerlerinde (görsel korundu)')} />}
      {engine && <NodeGraphEditor engine={engine} graphTick={graphTick} onRenderModeChange={changeMode} />}
      {/* GÜN 6-7 (render şeridi): capture akışı + metrik paneli. İkisi de
          kendi durumunu tutar; Engine'e yalnızca imzalı API'den yazarlar
          (setGaussians / setPoseTrack / setSelectedKeyframe). */}
      {engine && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260, flex: '1 1 260px' }}>
            <CapturePanel engine={engine} setMode={changeMode} onLog={say} />
          </div>
          <div style={{ minWidth: 260, flex: '1 1 260px' }}>
            <MetricsPanel />
          </div>
        </div>
      )}
      {engine && <PresetControls engine={engine} say={say} onGraphChanged={() => setGraphTick((t) => t + 1)} />}
      {engine && <ForceControls engine={engine} />}
      <pre style={{ margin: 0, color: '#8ab', whiteSpace: 'pre-wrap' }}>{log.join('\n')}</pre>
      {engine && (
        <ControlPanel
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
        />
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
    img.onerror = reject;
    img.src = src;
  });
}
