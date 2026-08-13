import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { estimateDepth, loadDepthModel, luminanceHeightMap } from './depth';
import { segmentForeground } from './engine/reconstruction/segmentation';
import { Engine } from './engine';
import { ControlPanel } from './ui/ControlPanel';
import { createPointCloudMaterial, POINTS_PARAMS } from './shaders/pointCloudMaterial';
import { createAsciiMaterial, ASCII_PARAMS } from './shaders/asciiMaterial';
import { createNeonWireMaterial, NEON_PARAMS } from './shaders/neonWireMaterial';
import { ModeSelector, type RenderMode } from './ui/ModeSelector';
import { NodeGraphEditor } from './ui/NodeGraphEditor';
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
import { exportPNG, exportWebM } from './engine/export';

/**
 * Video/kamera luminance yolunda temporal smoothing katsayısı (kalite kararı):
 * luminance her karede home'a 1:1 yazılır; video codec gürültüsü parçacıkların
 * Z'sini her karede dürttüğünde bulut sürekli titriyordu. lerp ile geçen kareye
 * sabitlenir — gürültü ölür, gerçek hareket akışkan kalır. Küçük tutulur.
 */
const LUMINANCE_SMOOTHING_ALPHA = 0.1;

export default function App() {  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
    }),
    [],
  );
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [segment, setSegment] = useState(false);
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

  useEffect(() => {
    const engine = new Engine(containerRef.current!);
    engineRef.current = engine;
    setEngine(engine);    // Render katmanının shader'ı yer tutucunun yerine geçer (başlangıç modu).
    // Engine yer tutucuyu dispose eder; uPositions'ı her karede o yazar.
    // Modların parametre tanımları da kaydedilir — preset serileştirmesi bunları okur.
    engine.registerRenderMode('points', materials.points, POINTS_PARAMS);
    engine.registerRenderMode('ascii', materials.ascii, ASCII_PARAMS);
    engine.registerRenderMode('neon', materials.neon, NEON_PARAMS);
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
      // Sahiplik: bu material'lar burada üretildi, burada bırakılır.
      // Engine yalnızca kendi yer tutucusunu dispose eder (Engine.setPointsMaterial).
      engine.dispose();
      materials.points.dispose();
      materials.ascii.dispose();
      materials.neon.dispose();
      setEngine(null);
    };
  }, [materials]);

  const say = (line: string) => setLog((prev) => [...prev, line]);

  /**
   * Neon modu depth haritasını kendi vertex shader'ında Sobel'liyor, ama Engine
   * yalnızca uPositions'ı yazıyor — depth'i biz bağlıyoruz. setDepth() boyut
   * değişince YENİ bir texture üretiyor, o yüzden her çağrıdan sonra tazelenir.
   */
  function pushDepthToNeon() {
    materials.neon.setDepthTexture(engineRef.current?.depthTexture ?? null);
  }

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
  }

  async function run(source: HTMLCanvasElement | HTMLImageElement) {
    setBusy(true);
    try {
      const t0 = performance.now();
      await loadDepthModel();
      say(`model yüklendi            ${Math.round(performance.now() - t0)} ms`);

      const t1 = performance.now();
      const depth = await estimateDepth(source);
      say(`çıkarım                  ${Math.round(performance.now() - t1)} ms  (${depth.width}x${depth.height})`);

      // Opsiyonel nesne/arka plan ayırma (RMBG): maske depth ile aynı görsel
      // alanı kapsar (letterbox + kırpım) ama boyutu farklıdır; Engine maskeyi
      // depth boyutuna örnekler ve siluete AND eder.
      let mask: Float32Array | undefined;
      let maskW = 0;
      let maskH = 0;
      lastPhotoRef.current = source;
      lastDepthRef.current = { data: depth.data, width: depth.width, height: depth.height };
      maskLoadedRef.current = false;
      if (segment) {
        const t2 = performance.now();
        const seg = await segmentForeground(source);
        mask = seg.mask;
        maskW = seg.width;
        maskH = seg.height;
        maskLoadedRef.current = true;
        say(`nesne ayırma (RMBG)      ${Math.round(performance.now() - t2)} ms  (${maskW}x${maskH})`);
      }
      // TUR 11: fotoğrafın kendisi de parçacık renklerine bağlanır (görev 1 —
      // varsayılan mavi rampa yerine orijinal RGB). Kamera/video yolu bu
      // çağrıyı yapmaz → shader'lar derinlik rampasına düşer.
      engineRef.current!.setPhoto(source);
      engineRef.current!.setDepth(depth.data, depth.width, depth.height, mask, maskW, maskH);
      pushDepthToNeon();
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
      // Video ilk kareyi çözmeden drawImage boş/hatalı çizer.
      if (source instanceof HTMLVideoElement && source.readyState < 2) return;
      const t0 = performance.now();
      const hm = luminanceHeightMap(source, 256, {
        // GÜN 6: kenar kabartma + merkez vurgu — yüz hatları 3D'de belirgin,
        // özne arka plandan ayrışır. Varsayılanlar flu hal için ayarlı; video
        // gürültüsü smoothing + temporal lerp ile bastırılır.
        edgeStrength: 0.35,
        centerBoost: 0.5,
      });
      const data = hm.data;
      if (prev && prev.length === data.length) {
        // Temporal smoothing: yeni kareyi geçmişe yapıştır. Düşük alpha kısa
        // süreli parlaklık sıçramalarını sönümler, yavaş ışık değişimini bırakır.
        for (let i = 0; i < data.length; i++) {
          data[i] = prev[i] + LUMINANCE_SMOOTHING_ALPHA * (data[i] - prev[i]);
        }
        prev.set(data); // bir sonraki karenin geçmişi = bugünkü smoothed kare
      } else {
        prev = new Float32Array(data); // ilk kare / yeni boyut: ham + kopya
      }
      engineRef.current!.setDepth(data, hm.width, hm.height);
      pushDepthToNeon();
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
      const d = lastDepthRef.current;
      engineRef.current!.setDepth(d.data, d.width, d.height, seg.mask, seg.width, seg.height);
      pushDepthToNeon(); // maske silueti değiştirir → neon kenarları tazelenmeli
      maskLoadedRef.current = true;
    } catch (err) {
      say(`HATA nesne ayırma: ${err instanceof Error ? err.message : String(err)}`);
      engineRef.current!.setObjectSeparation(false);
      setSegment(false);
    } finally {
      setBusy(false);
    }
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
      engineRef.current!.setVideoSource(video);
      startLuminanceLoop(video, 'kamera (model yok)');
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
      engineRef.current!.setVideoSource(video);
      say(`video yüklendi · ${file.name} · luminance yolu (model yok)`);
      startLuminanceLoop(video, 'video');
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

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16, justifyItems: 'start' }}>
      <h1 style={{ font: 'inherit', fontSize: 18, margin: 0 }}>spatial-canvas · Gün 3 — GPGPU parçacık simülasyonu</h1>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
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
        <input
          type="file"
          accept="image/*,video/*"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              await handleFile(file);
              e.target.value = '';
            }
          }}
        />
        <button disabled={busy} onClick={toggleCamera}>
          {cameraOn ? 'kamerayı kapat' : 'kamera'}
        </button>
        <button disabled={busy} onClick={toggleSegment} style={segment ? { background: '#2a3', color: '#fff', border: '1px solid #2a3' } : undefined}>
          nesne ayırma: {segment ? 'AÇIK' : 'kapalı'}
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
        <span style={{ color: '#667', fontSize: 12 }}>görsel/video sürükle-bırak · tıklayıp döndür · hover = kuvvet</span>
        <span style={{ color: fps >= 30 ? '#6a6' : '#c66', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
         {fps} fps
        </span>
        <button
         type="button"
         disabled={!engine}
         onClick={() => {
         const canvas = engineRef.current?.renderer.domElement;
         if (!canvas) return;
         exportPNG(canvas, 'spatial-canvas', {
           onBeforeCapture: () => engineRef.current?.renderFrame(),
         })
          .then(() => say('PNG indirildi'))
          .catch((e) => say(`PNG HATA: ${e instanceof Error ? e.message : String(e)}`));
         }}
         style={{ fontSize: 12, padding: '3px 10px', background: '#1a1a22', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}
        >
         PNG
        </button>
        <button
         type="button"
         disabled={!engine}
         onClick={() => {
         const canvas = engineRef.current?.renderer.domElement;
         if (!canvas) return;
         say('WebM kaydı başladı...');
         exportWebM(canvas, { durationSec: webmSec })
          .then(() => say(`WebM indirildi (${webmSec} sn)`))
          .catch((e) => say(`WebM HATA: ${e instanceof Error ? e.message : String(e)}`));
         }}
         style={{ fontSize: 12, padding: '3px 10px', background: '#1a1a22', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}
        >
         WebM ({webmSec}sn)
        </button>
        <button
         type="button"
         disabled={!engine}
         onClick={() => { setWebmSec(webmSec === 5 ? 10 : webmSec === 10 ? 20 : 5); }}
         style={{ fontSize: 11, padding: '2px 6px', background: 'none', color: '#667', border: 'none', cursor: 'pointer' }}
         title="süreyi değiştir: 5/10/20 sn"
        >
         ⏱
        </button>
        </div>

      <div
        ref={containerRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        style={{ width: 640, height: 420, border: '1px solid #222', background: '#000' }}
      />
      {engine && <ModeSelector engine={engine} materials={materials} mode={mode} onChange={setMode} />}
      {engine && <NodeGraphEditor engine={engine} graphTick={graphTick} />}
      {engine && <PresetControls engine={engine} say={say} onGraphChanged={() => setGraphTick((t) => t + 1)} />}
      {engine && <ForceControls engine={engine} />}
      <pre style={{ margin: 0, color: '#8ab', whiteSpace: 'pre-wrap' }}>{log.join('\n')}</pre>
      {engine && (
        <ControlPanel
          grain={engine.grainUniforms}
          points={materials.points}
          ascii={materials.ascii}
          neon={materials.neon}
          setMode={(next) => {
            engine.setPointsMaterial(materials[next]);
            setMode(next);
          }}
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
