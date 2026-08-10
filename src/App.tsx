import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { estimateDepth, loadDepthModel, luminanceHeightMap } from './depth';
import { Engine } from './engine';
import { ControlPanel } from './ui/ControlPanel';
import { createPointCloudMaterial } from './shaders/pointCloudMaterial';
import { createAsciiMaterial } from './shaders/asciiMaterial';
import { ModeSelector, type RenderMode } from './ui/ModeSelector';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
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
    () => ({ points: createPointCloudMaterial(), ascii: createAsciiMaterial() }),
    [],
  );
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const engine = new Engine(containerRef.current!);
    engineRef.current = engine;
    setEngine(engine);
    // Render katmanının shader'ı yer tutucunun yerine geçer (başlangıç modu).
    // Engine yer tutucuyu dispose eder; uPositions'ı her karede o yazar.
    engine.setPointsMaterial(materials.points);
    const textureType = engine.simTextureLabel;
    setLog((prev) => [
      ...prev,
      `engine hazır · ${engine.positionCount.toLocaleString('tr-TR')} parçacık slotu · sim RT: ${textureType} · sürükle-döndür`,
      'point cloud material → shaders/pointCloudMaterial (soft particle, additive)',
    ]);
    const fpsTimer = window.setInterval(() => setFps(engine.fps), 1000);
    return () => {
      clearInterval(fpsTimer);
      teardownSource();
      // engine.dispose() yalnızca o an takılı material'ı bırakır; takılı
      // olmayan mod ekranda hiç görünmediyse de GPU kaynağı tutar.
      engine.dispose();
      materials.points.dispose();
      materials.ascii.dispose();
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

      engineRef.current!.setDepth(depth.data, depth.width, depth.height);
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
    let lastLog = 0;
    const step = () => {
      // Video ilk kareyi çözmeden drawImage boş/hatalı çizer.
      if (source instanceof HTMLVideoElement && source.readyState < 2) return;
      const t0 = performance.now();
      const hm = luminanceHeightMap(source, 256);
      engineRef.current!.setDepth(hm.data, hm.width, hm.height);
      if (performance.now() - lastLog > 2000) {
        lastLog = performance.now();
        say(`luminance · ${label} · ${Math.round(performance.now() - t0)} ms`);
      }
    };
    step();
    timerRef.current = window.setInterval(step, 100);
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
      await video.play();
      say(`video yüklendi · ${file.name} · luminance yolu (model yok)`);
      startLuminanceLoop(video, 'video');
    } else if (file.type.startsWith('image/')) {
      teardownSource(); // canlı döngü varsa dursun, tek kare depth'e geç
      setCameraOn(false);
      const url = URL.createObjectURL(file);
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
        <span style={{ color: '#667', fontSize: 12 }}>görsel/video sürükle-bırak · tıklayıp döndür · hover = kuvvet</span>
        <span style={{ color: fps >= 30 ? '#6a6' : '#c66', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          {fps} fps
        </span>
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
      {engine && <ForceControls engine={engine} />}
      <pre style={{ margin: 0, color: '#8ab', whiteSpace: 'pre-wrap' }}>{log.join('\n')}</pre>
      {engine && (
        <ControlPanel
          grain={engine.grainUniforms}
          points={materials.points}
          ascii={materials.ascii}
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
const FORCE_MODES = ['itme', 'çekim', 'vortex'];

function ForceControls({ engine }: { engine: Engine }) {
  const u = engine.simUniforms;
  const [mode, setMode] = useState(u.uForceMode.value);
  const [radius, setRadius] = useState(u.uForceRadius.value);
  const [strength, setStrength] = useState(u.uForceStrength.value);
  const [stiffness, setStiffness] = useState(u.uStiffness.value);

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
