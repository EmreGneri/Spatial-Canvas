import { useCallback, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Engine } from '../engine';
import { buildFusionScene, captureKeyframes, VIDEO_FOV_Y } from '../engine/vision/videoPipe';
import type { RenderMode } from './ModeSelector';

/**
 * CAPTURE AKIŞI (render/UI katmanı — Zeynep, Gün 6).
 *
 * Kullanıcının TEK ekrandan videodan 3B sahneye gitmesini sağlar:
 *   video seç → keyframe yakala → poz zinciri + füzyon → 3B harita → timeline
 *
 * ── NEDEN AŞAMA GÖSTERGESİ ─────────────────────────────────────────────────
 * Boru hattı saniyeler sürüyor (yakalama video süresine bağlı, akış+poz
 * CPU'da). Tek bir "yükleniyor" göstergesi kullanıcıya hangi adımın yavaş
 * olduğunu ya da hangi adımın PATLADIĞINI söylemez. Aşamalar ayrı ayrı
 * raporlanır ve sayılar (keyframe, eşleşme, başarısız poz) ekranda kalır —
 * "sanırım çalıştı" yerine ölçülebilir sonuç.
 *
 * ── DÜRÜSTLÜK KURALI ───────────────────────────────────────────────────────
 * Boru hattı BAŞARISIZ olabilir (dokusuz duvar, donuk video, yetersiz
 * parallaks — ARCHITECTURE.md D.8). Panel bunu gizlemez: keyframe sayısı,
 * akış eşleşmesi ve BAŞARISIZ POZ sayısı her koşuda gösterilir; ölçek
 * hizalaması çözülemediyse (`scale = null`) bu açıkça yazılır — sahne yine
 * çizilir ama "metrik" olduğu İDDİA EDİLMEZ.
 */

type Stage = 'idle' | 'decoding' | 'capturing' | 'solving' | 'ready' | 'error';

const STAGE_LABEL: Record<Stage, string> = {
  idle: 'hazır',
  decoding: 'video açılıyor',
  capturing: 'keyframe yakalanıyor',
  solving: 'akış + poz + füzyon',
  ready: 'sahne hazır',
  error: 'hata',
};

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
  border: '1px solid #26262e',
  borderRadius: 4,
  background: '#101014',
  fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  fontSize: 12,
  color: '#c8c8d4',
};

const buttonStyle: CSSProperties = {
  font: 'inherit',
  padding: '4px 10px',
  background: '#1a1a22',
  color: '#c8c8d4',
  border: '1px solid #26262e',
  borderRadius: 3,
  cursor: 'pointer',
};

const headingStyle: CSSProperties = { color: '#8ab', fontSize: 12, letterSpacing: 0.4 };

export interface CaptureStats {
  keyframes: number;
  flowMatches: number;
  poseFails: number;
  splats: number;
  scaleA: number | null;
  scaleB: number | null;
  /** Hizalama artığının RMS'i — çözüldü ama KÖTÜ çözüldüyse burada görünür. */
  scaleRmse: number | null;
  ms: number;
}

export function CapturePanel({
  engine,
  setMode,
  onLog,
}: {
  engine: Engine;
  setMode: (mode: RenderMode) => void;
  onLog?: (line: string) => void;
}) {
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState('');
  const [stats, setStats] = useState<CaptureStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showTraj, setShowTraj] = useState(true);
  const [maxFrames, setMaxFrames] = useState(8);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const say = useCallback(
    (line: string) => {
      onLog?.(line);
    },
    [onLog],
  );

  const run = useCallback(
    async (file: File) => {
      setError(null);
      setStats(null);
      setStage('decoding');
      setProgress(file.name);
      const t0 = performance.now();
      try {
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(file);
        urlRef.current = url;
        const video = document.createElement('video');
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        videoRef.current = video;
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('video açılamadı (codec?)'));
        });
        // Yakalama oynatma sırasında yapılır: rVFC yalnızca çizilen karede
        // tetiklenir, durağan videodan kare gelmez (videoPipe kaydı).
        await video.play().catch(() => {
          throw new Error('video oynatılamadı (autoplay engeli?)');
        });

        setStage('capturing');
        setProgress(`0 / ${maxFrames} keyframe`);
        const frames = await captureKeyframes(video, { maxFrames, intervalMs: 250 });
        video.pause();
        setProgress(`${frames.length} / ${maxFrames} keyframe`);
        if (frames.length < 2) {
          throw new Error(
            `yalnızca ${frames.length} keyframe yakalandı — poz zinciri en az 2 kare ister (video çok kısa ya da donuk)`,
          );
        }

        setStage('solving');
        setProgress('optik akış → poz → füzyon');
        // Senkron ve ağır: bir kare bekleyip UI'ın "solving" durumunu
        // boyamasına izin ver, yoksa kullanıcı donmuş sanır.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const scene = buildFusionScene(frames, VIDEO_FOV_Y);

        engine.setGaussians(scene.data);
        engine.setPoseTrack(scene.poses);
        engine.setTrajectoryVisible(showTraj);
        engine.setSelectedKeyframe(null);
        setSelected(null);
        setMode('splat');

        const ms = performance.now() - t0;
        const s: CaptureStats = {
          keyframes: scene.stats.keyframes,
          flowMatches: scene.stats.flowMatches,
          poseFails: scene.stats.poseFails,
          splats: scene.data.count,
          scaleA: scene.scale ? scene.scale.scaleA : null,
          scaleB: scene.scale ? scene.scale.scaleB : null,
          scaleRmse: scene.scale ? scene.scale.rmse : null,
          ms,
        };
        setStats(s);
        setStage('ready');
        setProgress('');
        say(
          `capture: ${s.keyframes} keyframe · ${s.flowMatches} akış eşleşmesi · ${s.poseFails} poz hatası · ${s.splats.toLocaleString('tr-TR')} splat · ${Math.round(ms)} ms`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStage('error');
        setProgress('');
        say(`capture HATA: ${msg}`);
      }
    },
    [engine, maxFrames, setMode, say, showTraj],
  );

  const kfCount = engine.keyframeCount;

  return (
    <div style={panelStyle}>
      <strong style={headingStyle}>capture · video → 3B harita</strong>

      <label style={{ ...buttonStyle, display: 'inline-block', textAlign: 'center' }}>
        video seç
        <input
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void run(f);
            e.target.value = '';
          }}
        />
      </label>

      <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#889' }}>
        keyframe
        <input
          type="range"
          min={2}
          max={20}
          step={1}
          value={maxFrames}
          onChange={(e) => setMaxFrames(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{maxFrames}</span>
      </label>

      {/* AŞAMA — hangi adımdayız, sayıyla */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background:
              stage === 'ready' ? '#6a6' : stage === 'error' ? '#c66' : stage === 'idle' ? '#445' : '#dc6',
          }}
        />
        <span style={{ color: stage === 'error' ? '#c66' : '#889' }}>{STAGE_LABEL[stage]}</span>
        {progress && <span style={{ color: '#667' }}>· {progress}</span>}
      </div>

      {error && (
        <div style={{ color: '#c66', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', color: '#889' }}>
          <span>keyframe</span>
          <span style={{ color: '#c8c8d4' }}>{stats.keyframes}</span>
          <span>akış eşleşmesi</span>
          <span style={{ color: '#c8c8d4' }}>{stats.flowMatches.toLocaleString('tr-TR')}</span>
          <span>poz hatası</span>
          <span style={{ color: stats.poseFails > 0 ? '#dc6' : '#c8c8d4' }}>{stats.poseFails}</span>
          <span>splat</span>
          <span style={{ color: '#c8c8d4' }}>{stats.splats.toLocaleString('tr-TR')}</span>
          <span>ölçek</span>
          <span style={{ color: stats.scaleA === null ? '#dc6' : '#c8c8d4' }}>
            {stats.scaleA === null
              ? 'çözülemedi — d_pred ölçeğinde (metrik DEĞİL)'
              : `a=${stats.scaleA.toFixed(4)} b=${stats.scaleB!.toFixed(4)} · rmse=${stats.scaleRmse!.toFixed(4)}`}
          </span>
          <span>süre</span>
          <span style={{ color: '#c8c8d4' }}>{Math.round(stats.ms)} ms</span>
        </div>
      )}

      {/* TIMELINE — D.4 keyframe filtresi + frustum vurgusu */}
      {kfCount > 0 && (
        <>
          <strong style={headingStyle}>timeline · keyframe filtresi</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button
              type="button"
              style={{
                ...buttonStyle,
                padding: '2px 8px',
                background: selected === null ? '#8ab' : '#1a1a22',
                color: selected === null ? '#101014' : '#c8c8d4',
              }}
              onClick={() => {
                setSelected(null);
                engine.setSelectedKeyframe(null);
              }}
            >
              hepsi
            </button>
            {Array.from({ length: kfCount }, (_, i) => (
              <button
                key={i}
                type="button"
                style={{
                  ...buttonStyle,
                  padding: '2px 8px',
                  background: selected === i ? '#ffd166' : '#1a1a22',
                  color: selected === i ? '#101014' : '#c8c8d4',
                }}
                onClick={() => {
                  setSelected(i);
                  engine.setSelectedKeyframe(i);
                }}
              >
                {i}
              </button>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#889' }}>
            <input
              type="checkbox"
              checked={showTraj}
              onChange={(e) => {
                setShowTraj(e.target.checked);
                engine.setTrajectoryVisible(e.target.checked);
              }}
            />
            yörünge + frustum göster
          </label>
        </>
      )}
    </div>
  );
}
