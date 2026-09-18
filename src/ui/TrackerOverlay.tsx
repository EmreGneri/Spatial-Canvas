import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { TRACKER_HEIGHT, TRACKER_WIDTH } from '../engine/vision/tracker';
import type { TrackedTarget } from '../engine/vision/tracker';

/**
 * Tracker HUD overlay — render katmanı (Zeynep). Sprint "viral özellik",
 * Gün 1.
 *
 * WebGL sahnesine GİRMEZ: motor canvas'ının üstüne bindirilen ayrı bir 2D
 * <canvas> (App'teki RMBG maske overlay'iyle aynı desen). uPositions, node
 * graph, preset, registerRenderMode — hiçbiri etkilenmez. Ayarlar bu sprint
 * bilinçli olarak ad-hoc local state; preset'e kaydolmaz.
 *
 * Veri sözleşmesi: `TrackedTarget` (Emre, `engine/vision/tracker.ts`) —
 * {id,x,y,w,h}, tracker'ın kendi çözünürlüğünde (TRACKER_WIDTH×HEIGHT)
 * piksel uzayı. Overlay kendi ekran boyutuna ölçekler.
 *
 * HIZLI PROTOTİP: `getTargets` verilmezse sahte (mock) hedefler çizer —
 * Gün 1'de çizim mantığı gerçek tracker'ı beklemeden çalışsın diye. Gün 2
 * entegrasyonunda App `getTargets={() => tracker.step(video)}` geçirir.
 */

type BoxStyle = 'brackets' | 'box' | 'both';

interface HudSettings {
  accent: string;
  /** shadowBlur (px, ekran uzayı). 0 = glow kapalı. */
  glow: number;
  style: BoxStyle;
  maxTargets: number;
  /** Kaynak alanının yüzdesi — bunun altındaki kutular çizilmez. */
  minAreaPct: number;
  labels: boolean;
  links: boolean;
}

const DEFAULT_SETTINGS: HudSettings = {
  accent: '#39ff88',
  glow: 10,
  style: 'brackets',
  maxTargets: 24,
  minAreaPct: 0.2,
  labels: true,
  links: true,
};

/** Bağlantı çizgisi en fazla bu mesafedeki merkezler arasında (overlay
 *  köşegeninin oranı) çekilir. */
const LINK_DIST_FRAC = 0.22;
const HUD_FONT = '10px ui-monospace, "Cascadia Mono", Consolas, monospace';

export function TrackerOverlay({
  getTargets,
  sourceWidth = TRACKER_WIDTH,
  sourceHeight = TRACKER_HEIGHT,
}: {
  /** Her karede çağrılır. Yoksa mock hedefler kullanılır. */
  getTargets?: () => TrackedTarget[];
  /** Hedef koordinatlarının piksel uzayı (varsayılan: tracker çözünürlüğü). */
  sourceWidth?: number;
  sourceHeight?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [settings, setSettings] = useState<HudSettings>(DEFAULT_SETTINGS);
  const [panelOpen, setPanelOpen] = useState(true);
  const [count, setCount] = useState(0);

  // rAF döngüsü prop/state değişiminde yeniden kurulmasın — son değerler
  // ref'ten okunur.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const getTargetsRef = useRef(getTargets);
  getTargetsRef.current = getTargets;
  const sourceRef = useRef({ w: sourceWidth, h: sourceHeight });
  sourceRef.current = { w: sourceWidth, h: sourceHeight };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mock = createMockTargets();
    let raf = 0;
    let lastCount = -1;

    const frame = (time: number) => {
      raf = requestAnimationFrame(frame);

      // Canvas çözünürlüğü = görüntülenen boyut × DPR (bulanık çizgi yok).
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      const pxW = Math.max(1, Math.round(cssW * dpr));
      const pxH = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const s = settingsRef.current;
      const src = sourceRef.current;
      const raw = getTargetsRef.current ? getTargetsRef.current() : mock(time, src.w, src.h);
      const minArea = (s.minAreaPct / 100) * src.w * src.h;
      const targets = raw.filter((t) => t.w * t.h >= minArea).slice(0, s.maxTargets);

      drawHud(ctx, targets, s, cssW / src.w, cssH / src.h, cssW, cssH);

      if (targets.length !== lastCount) {
        lastCount = targets.length;
        setCount(targets.length);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const set = <K extends keyof HudSettings>(key: K, value: HudSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  return (
    <>
      <canvas ref={canvasRef} style={overlayStyle} />
      <div style={panelStyle(settings.accent)}>
        <button type="button" onClick={() => setPanelOpen((o) => !o)} style={headerStyle}>
            <span style={{ color: settings.accent }}>●</span> TRACKER · {count}
          {getTargets ? '' : ' · mock'} {panelOpen ? '▾' : '▸'}
        </button>
        {panelOpen && (
          <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
            <Row label="accent">
              <input type="color" value={settings.accent} onChange={(e) => set('accent', e.target.value)} style={colorStyle} />
            </Row>
            <Row label={`glow ${settings.glow}`}>
              <input type="range" min={0} max={30} value={settings.glow} onChange={(e) => set('glow', Number(e.target.value))} style={sliderStyle} />
            </Row>
            <Row label="style">
              <select value={settings.style} onChange={(e) => set('style', e.target.value as BoxStyle)} style={selectStyle}>
                <option value="brackets">brackets</option>
                <option value="box">box</option>
                <option value="both">both</option>
              </select>
            </Row>
            <Row label={`max ${settings.maxTargets}`}>
              <input type="range" min={1} max={64} value={settings.maxTargets} onChange={(e) => set('maxTargets', Number(e.target.value))} style={sliderStyle} />
            </Row>
            <Row label={`min area ${settings.minAreaPct.toFixed(1)}%`}>
              <input type="range" min={0} max={5} step={0.1} value={settings.minAreaPct} onChange={(e) => set('minAreaPct', Number(e.target.value))} style={sliderStyle} />
            </Row>
            <Row label="labels">
              <input type="checkbox" checked={settings.labels} onChange={(e) => set('labels', e.target.checked)} />
            </Row>
            <Row label="links">
              <input type="checkbox" checked={settings.links} onChange={(e) => set('links', e.target.checked)} />
            </Row>
          </div>
        )}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={rowStyle}>
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      {children}
    </label>
  );
}

/** Tüm HUD'u çizer. sx/sy: kaynak piksel → overlay CSS pikseli. */
function drawHud(
  ctx: CanvasRenderingContext2D,
  targets: TrackedTarget[],
  s: HudSettings,
  sx: number,
  sy: number,
  viewW: number,
  viewH: number,
) {
  const boxes = targets.map((t) => ({ id: t.id, x: t.x * sx, y: t.y * sy, w: t.w * sx, h: t.h * sy }));

  ctx.save();
  ctx.strokeStyle = s.accent;
  ctx.fillStyle = s.accent;
  ctx.shadowColor = s.accent;
  ctx.shadowBlur = s.glow;
  ctx.lineCap = 'square';

  // 1) Bağlantı çizgileri — kutuların ALTINDA, soluk.
  if (s.links && boxes.length > 1) {
    const maxD = LINK_DIST_FRAC * Math.hypot(viewW, viewH);
    ctx.lineWidth = 1;
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      const ax = a.x + a.w / 2;
      const ay = a.y + a.h / 2;
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        const bx = b.x + b.w / 2;
        const by = b.y + b.h / 2;
        const d = Math.hypot(bx - ax, by - ay);
        if (d > maxD) continue;
        ctx.globalAlpha = 0.5 * (1 - d / maxD);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // 2) Kutular + köşe parantezleri + merkez artı.
  for (const b of boxes) {
    if (s.style !== 'brackets') {
      ctx.globalAlpha = s.style === 'both' ? 0.35 : 1;
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.globalAlpha = 1;
    }
    if (s.style !== 'box') {
      ctx.lineWidth = 2;
      drawBrackets(ctx, b.x, b.y, b.w, b.h);
    }
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy);
    ctx.lineTo(cx + 3, cy);
    ctx.moveTo(cx, cy - 3);
    ctx.lineTo(cx, cy + 3);
    ctx.stroke();
  }

  // 3) Etiketler — glow'suz (okunurluk), koyu zemin üstünde.
  if (s.labels) {
    ctx.shadowBlur = 0;
    ctx.font = HUD_FONT;
    ctx.textBaseline = 'bottom';
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const t = targets[i];
      const text = `#${String(t.id).padStart(2, '0')} ${Math.round(t.x + t.w / 2)},${Math.round(t.y + t.h / 2)}`;
      const tw = ctx.measureText(text).width;
      const lx = Math.min(Math.max(0, b.x), viewW - tw - 4);
      const ly = b.y > 14 ? b.y - 2 : b.y + b.h + 13;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#000';
      ctx.fillRect(lx, ly - 11, tw + 4, 12);
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.accent;
      ctx.fillText(text, lx + 2, ly);
    }
  }
  ctx.restore();
}

/** Dört köşede L biçimli parantez. Kol uzunluğu kısa kenarın ~%25'i. */
function drawBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const k = Math.max(4, Math.min(16, Math.min(w, h) * 0.25));
  const r = x + w;
  const btm = y + h;
  ctx.beginPath();
  ctx.moveTo(x, y + k);
  ctx.lineTo(x, y);
  ctx.lineTo(x + k, y);
  ctx.moveTo(r - k, y);
  ctx.lineTo(r, y);
  ctx.lineTo(r, y + k);
  ctx.moveTo(r, btm - k);
  ctx.lineTo(r, btm);
  ctx.lineTo(r - k, btm);
  ctx.moveTo(x + k, btm);
  ctx.lineTo(x, btm);
  ctx.lineTo(x, btm - k);
  ctx.stroke();
}

/**
 * Sahte hedefler — Lissajous yörüngelerde dolaşan kutular. Arada bir hedef
 * "kaybolup" yeni ID ile geri gelir: gerçek tracker'daki ID devri ve
 * titrek boyut, HUD'da nasıl göründüğü önceden görülsün diye.
 */
function createMockTargets() {
  const N = 14;
  const seeds = Array.from({ length: N }, (_, i) => ({
    fx: 0.00011 + 0.00007 * ((i * 37) % 11),
    fy: 0.00013 + 0.00005 * ((i * 53) % 13),
    px: i * 1.7,
    py: i * 2.3,
    size: 0.05 + 0.1 * (((i * 29) % 17) / 17),
    id: i + 1,
  }));
  let nextId = N + 1;
  let lastEpoch = -1;
  return (time: number, w: number, h: number): TrackedTarget[] => {
    // ~3 sn'de bir sıradaki hedef yeni ID alır.
    const epoch = Math.floor(time / 3000);
    if (epoch !== lastEpoch) {
      if (lastEpoch !== -1) seeds[epoch % N].id = nextId++;
      lastEpoch = epoch;
    }
    return seeds.map((sd) => {
      const cx = (0.5 + 0.4 * Math.sin(time * sd.fx + sd.px)) * w;
      const cy = (0.5 + 0.38 * Math.sin(time * sd.fy + sd.py)) * h;
      const jitter = 1 + 0.12 * Math.sin(time * 0.004 + sd.px);
      const bw = sd.size * w * jitter;
      const bh = sd.size * h * 1.3 * jitter;
      return { id: sd.id, x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    });
  };
}

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};

function panelStyle(accent: string): CSSProperties {
  return {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 190,
    boxSizing: 'border-box',
    padding: 6,
    background: 'rgba(10, 10, 14, 0.82)',
    border: `1px solid ${accent}55`,
    borderRadius: 3,
    color: '#c8c8d4',
    fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
    fontSize: 11,
  };
}

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 80px',
  alignItems: 'center',
  justifyItems: 'end',
  gap: 6,
};

const headerStyle: CSSProperties = {
  font: 'inherit',
  width: '100%',
  textAlign: 'left',
  padding: 0,
  background: 'none',
  border: 'none',
  color: '#c8c8d4',
  cursor: 'pointer',
  letterSpacing: 0.5,
};

const colorStyle: CSSProperties = { width: 36, height: 18, padding: 0, border: '1px solid #26262e', background: 'none' };

const selectStyle: CSSProperties = {
  font: 'inherit',
  background: '#1a1a22',
  color: '#c8c8d4',
  border: '1px solid #26262e',
  borderRadius: 3,
};

const sliderStyle: CSSProperties = { width: 80, margin: 0 };
