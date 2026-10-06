import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { TRACKER_HEIGHT, TRACKER_WIDTH } from '../engine/vision/tracker';
import type { DetectionStatus, TrackedTarget, TrackerModu } from '../engine/vision/tracker';

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
  /** En büyük hedef "LOCK" olarak vurgulanır, diğerleri söner. */
  lock: boolean;
  /** Sol üstte Inspector tarzı sayaç bloğu. */
  readout: boolean;
}

const DEFAULT_SETTINGS: HudSettings = {
  accent: '#39ff88',
  glow: 10,
  style: 'brackets',
  maxTargets: 24,
  minAreaPct: 0.2,
  labels: true,
  links: true,
  lock: true,
  readout: true,
};

/**
 * GÜN 3 (görsel cila) — kutular üç ZAMANLI durum taşır, çünkü tracker
 * verisi kendi başına HUD için fazla sert:
 *
 * 1. YUMUŞATMA: `tracker.ts` her 3. karede hesaplar (everyNFrames), aradaki
 *    karelerde AYNI kutuyu döndürür — ham çizim 20 Hz'de zıplıyor. Kutu
 *    hedefe üstel olarak yaklaşır: aradaki kareler boş geçmez, kayma akar.
 * 2. KİLİTLENME: yeni ID büyükten küçüğe toplanarak gelir (acquire) —
 *    Emre'nin ölçtüğü ID devri (~%21 tek karelik) böylece kaza değil,
 *    kasıt gibi okunur.
 * 3. KAYBOLMA: hedef düşünce kutu hemen silinmez, hayalet olarak söner.
 */
const SMOOTH_TAU = 0.06;
const ACQUIRE_MS = 260;
const LOST_FADE_MS = 220;

/** Bağlantı çizgisi en fazla bu mesafedeki merkezler arasında (overlay
 *  köşegeninin oranı) çekilir. */
const LINK_DIST_FRAC = 0.22;
const HUD_FONT = '10px ui-monospace, "Cascadia Mono", Consolas, monospace';

export function TrackerOverlay({
  getTargets,
  sourceWidth = TRACKER_WIDTH,
  sourceHeight = TRACKER_HEIGHT,
  mod = 'ozellik',
  onModChange,
  getDetectionStatus,
  getGeneration,
}: {
  /** Her karede çağrılır. Yoksa mock hedefler kullanılır. */
  getTargets?: () => TrackedTarget[];
  /** Hedef koordinatlarının piksel uzayı (varsayılan: tracker çözünürlüğü). */
  sourceWidth?: number;
  sourceHeight?: number;
  /** 'ozellik' = kontrast kümeleri · 'nesne' = COCO tespiti (etiketli). */
  mod?: TrackerModu;
  onModChange?: (m: TrackerModu) => void;
  getDetectionStatus?: () => DetectionStatus;
  getGeneration?: () => number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [settings, setSettings] = useState<HudSettings>(DEFAULT_SETTINGS);
  const [panelOpen, setPanelOpen] = useState(true);
  const [count, setCount] = useState(0);
  const [detectionStatus, setDetectionStatus] = useState<DetectionStatus>({ phase: 'idle', error: null });
  const detectionStatusRef = useRef(detectionStatus);

  // rAF döngüsü prop/state değişiminde yeniden kurulmasın — son değerler
  // ref'ten okunur.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const getTargetsRef = useRef(getTargets);
  getTargetsRef.current = getTargets;
  const getDetectionStatusRef = useRef(getDetectionStatus);
  getDetectionStatusRef.current = getDetectionStatus;
  const getGenerationRef = useRef(getGeneration);
  getGenerationRef.current = getGeneration;
  const sourceRef = useRef({ w: sourceWidth, h: sourceHeight });
  sourceRef.current = { w: sourceWidth, h: sourceHeight };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mock = createMockTargets();
    const states = new Map<number, TrackState>();
    let lastGeneration = getGenerationRef.current?.();
    let raf = 0;
    let lastCount = -1;
    let lastTime = 0;

    const frame = (time: number) => {
      raf = requestAnimationFrame(frame);
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
      lastTime = time;

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
      const generation = getGenerationRef.current?.();
      if (generation !== lastGeneration) {
        // Source and mode changes must discard ghosts from the previous frame space.
        states.clear();
        lastGeneration = generation;
      }
      const raw = getTargetsRef.current ? getTargetsRef.current() : mock(time, src.w, src.h);
      const minArea = (s.minAreaPct / 100) * src.w * src.h;
      const targets = raw.filter((t) => t.w * t.h >= minArea).slice(0, s.maxTargets);

      const live = syncStates(states, targets, time, dt);
      drawHud(ctx, live, s, cssW / src.w, cssH / src.h, cssW, cssH, src);

      if (targets.length !== lastCount) {
        lastCount = targets.length;
        setCount(targets.length);
      }
      const nextStatus = getDetectionStatusRef.current?.();
      if (nextStatus && (detectionStatusRef.current.phase !== nextStatus.phase ||
        detectionStatusRef.current.error !== nextStatus.error)) {
        detectionStatusRef.current = nextStatus;
        setDetectionStatus(nextStatus);
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
            {mod === 'nesne' && detectionStatus.phase === 'idle' ? ' · waiting' : ''}
            {mod === 'nesne' && detectionStatus.phase === 'loading' ? ' · loading' : ''}
            {mod === 'nesne' && detectionStatus.phase === 'error' ? ' · error' : ''}
          {getTargets ? '' : ' · mock'} {panelOpen ? '▾' : '▸'}
        </button>
        {panelOpen && (
          <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
            {mod === 'nesne' && detectionStatus.phase === 'error' && (
              <div role="alert" title={detectionStatus.error ?? undefined} style={{ color: '#ff8d8d', fontSize: 11, overflowWrap: 'anywhere' }}>
                Detection failed. Check WebGPU and local model assets. {detectionStatus.error}
              </div>
            )}
            <Row label="mod">
              <select
                value={mod}
                onChange={(e) => onModChange?.(e.target.value as TrackerModu)}
                disabled={!onModChange}
                title="özellik: kontrast noktaları (model yok) · nesne: COCO tespiti (insan, araba, köpek...)"
                style={selectStyle}
              >
                <option value="ozellik">özellik</option>
                <option value="nesne">nesne</option>
              </select>
            </Row>
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
            <Row label="lock">
              <input type="checkbox" checked={settings.lock} onChange={(e) => set('lock', e.target.checked)} />
            </Row>
            <Row label="readout">
              <input type="checkbox" checked={settings.readout} onChange={(e) => set('readout', e.target.checked)} />
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

/** Bir hedefin ekrandaki (zamana yayılmış) hali — kaynak piksel uzayında. */
interface TrackState extends TrackedTarget {
  born: number;
  /** Hedef bu kareden beri yok; null ise canlı. */
  lostAt: number | null;
}

/**
 * Durum haritasını bu karenin hedefleriyle eşitler ve çizilecek listeyi
 * döndürür: kutular hedefe üstel yaklaşır, yeni ID'ler `born` ile işaretlenir,
 * düşen hedefler hemen silinmez (hayalet söner), süresi dolanlar atılır.
 */
function syncStates(
  states: Map<number, TrackState>,
  targets: TrackedTarget[],
  time: number,
  dt: number,
): TrackState[] {
  // Kare hızından bağımsız üstel yaklaşma (60 Hz'de de 120 Hz'de de aynı
  // görünür süre) — simülasyondaki uDtScale ile aynı felsefe.
  const k = dt > 0 ? 1 - Math.exp(-dt / SMOOTH_TAU) : 1;
  const seen = new Set<number>();

  for (const t of targets) {
    seen.add(t.id);
    const prev = states.get(t.id);
    if (!prev) {
      states.set(t.id, { ...t, born: time, lostAt: null });
      continue;
    }
    prev.x += (t.x - prev.x) * k;
    prev.y += (t.y - prev.y) * k;
    prev.w += (t.w - prev.w) * k;
    prev.h += (t.h - prev.h) * k;
    prev.label = t.label;
    prev.score = t.score;
    prev.lostAt = null; // geri geldi (aynı ID) — hayaletten canlıya döner
  }

  const out: TrackState[] = [];
  for (const [id, st] of states) {
    if (!seen.has(id)) {
      st.lostAt ??= time;
      if (time - st.lostAt > LOST_FADE_MS) {
        states.delete(id);
        continue;
      }
    }
    out.push(st);
  }
  return out;
}

/** Hedefin görünürlük katsayısı: toplanırken 0→1, kaybolurken 1→0. */
function stateAlpha(st: TrackState, time: number): number {
  const appear = Math.min(1, (time - st.born) / ACQUIRE_MS);
  const fade = st.lostAt === null ? 1 : Math.max(0, 1 - (time - st.lostAt) / LOST_FADE_MS);
  return appear * fade;
}

/** Tüm HUD'u çizer. sx/sy: kaynak piksel → overlay CSS pikseli. */
function drawHud(
  ctx: CanvasRenderingContext2D,
  states: TrackState[],
  s: HudSettings,
  sx: number,
  sy: number,
  viewW: number,
  viewH: number,
  src: { w: number; h: number },
) {
  const time = performance.now();
  // LOCK = en büyük CANLI hedef. Hayalet kilit almaz (kaybolan kutu
  // "kilitli" görünürse HUD yalan söyler).
  let lockId = -1;
  let lockArea = 0;
  for (const st of states) {
    if (st.lostAt !== null) continue;
    const area = st.w * st.h;
    if (area > lockArea) {
      lockArea = area;
      lockId = st.id;
    }
  }

  const boxes = states.map((st) => {
    const alpha = stateAlpha(st, time);
    // Toplanma anında kutu biraz büyük başlar ve yerine oturur.
    const grow = 1 + 0.35 * (1 - Math.min(1, (time - st.born) / ACQUIRE_MS));
    const w = st.w * sx * grow;
    const h = st.h * sy * grow;
    const cx = (st.x + st.w / 2) * sx;
    const cy = (st.y + st.h / 2) * sy;
    return { id: st.id, x: cx - w / 2, y: cy - h / 2, w, h, alpha, srcX: st.x + st.w / 2, srcY: st.y + st.h / 2, live: st.lostAt === null, label: st.label, score: st.score };
  });

  ctx.save();
  ctx.strokeStyle = s.accent;
  ctx.fillStyle = s.accent;
  ctx.shadowColor = s.accent;
  ctx.shadowBlur = s.glow;
  ctx.lineCap = 'square';

  // 1) Bağlantı çizgileri — kutuların ALTINDA, soluk. Hayaletler bağlanmaz:
  //    ölü hedefe giden çizgi ağı olduğundan kalabalık gösterir.
  if (s.links) {
    const linked = boxes.filter((b) => b.live);
    const maxD = LINK_DIST_FRAC * Math.hypot(viewW, viewH);
    ctx.lineWidth = 1;
    for (let i = 0; i < linked.length; i++) {
      const a = linked[i];
      const ax = a.x + a.w / 2;
      const ay = a.y + a.h / 2;
      for (let j = i + 1; j < linked.length; j++) {
        const b = linked[j];
        const bx = b.x + b.w / 2;
        const by = b.y + b.h / 2;
        const d = Math.hypot(bx - ax, by - ay);
        if (d > maxD) continue;
        ctx.globalAlpha = 0.5 * (1 - d / maxD) * Math.min(a.alpha, b.alpha);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // 2) Kutular + köşe parantezleri + merkez artı. LOCK açıkken kilitli
  //    hedef tam parlaklıkta, ötekiler geri çekilir — göz nereye bakacağını
  //    bilir (screenshot'taki Inspector hiyerarşisi).
  for (const b of boxes) {
    const isLock = s.lock && b.id === lockId;
    const emphasis = s.lock ? (isLock ? 1 : 0.45) : 1;
    const a = b.alpha * emphasis;
    if (s.style !== 'brackets') {
      ctx.globalAlpha = a * (s.style === 'both' ? 0.35 : 1);
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }
    if (s.style !== 'box') {
      ctx.globalAlpha = a;
      ctx.lineWidth = isLock ? 2.5 : 2;
      drawBrackets(ctx, b.x, b.y, b.w, b.h);
    }
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.globalAlpha = a;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy);
    ctx.lineTo(cx + 3, cy);
    ctx.moveTo(cx, cy - 3);
    ctx.lineTo(cx, cy + 3);
    ctx.stroke();
    // LOCK'un nişangâhı kenarlara uzanır — kutuyu sahnede "hedeflenmiş"
    // gösterir.
    if (isLock) {
      ctx.globalAlpha = a * 0.35;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(b.x, cy);
      ctx.moveTo(b.x + b.w, cy);
      ctx.lineTo(viewW, cy);
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, b.y);
      ctx.moveTo(cx, b.y + b.h);
      ctx.lineTo(cx, viewH);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // 3) Etiketler — glow'suz (okunurluk), koyu zemin üstünde.
  if (s.labels) {
    ctx.shadowBlur = 0;
    ctx.font = HUD_FONT;
    ctx.textBaseline = 'bottom';
    for (const b of boxes) {
      const isLock = s.lock && b.id === lockId;
      // NESNE modunda sınıf adı kimlikten ÖNCE gelir: HUD'un cevaplaması
      // gereken ilk soru "bu ne", ikincisi "hangisi". Özellik modunda sınıf
      // yoktur, eski biçim (ID + koordinat) aynen korunur.
      const text = b.label
        ? `${isLock ? 'LOCK ' : ''}${b.label.toUpperCase()} #${String(b.id).padStart(2, '0')}${b.score ? ` ${Math.round(b.score * 100)}%` : ''}`
        : `${isLock ? 'LOCK ' : ''}#${String(b.id).padStart(2, '0')} ${Math.round(b.srcX)},${Math.round(b.srcY)}`;
      const tw = ctx.measureText(text).width;
      const lx = Math.min(Math.max(0, b.x), viewW - tw - 4);
      const ly = b.y > 14 ? b.y - 2 : b.y + b.h + 13;
      ctx.globalAlpha = b.alpha * 0.6;
      ctx.fillStyle = '#000';
      ctx.fillRect(lx, ly - 11, tw + 4, 12);
      ctx.globalAlpha = b.alpha * (s.lock && !isLock ? 0.55 : 1);
      ctx.fillStyle = s.accent;
      ctx.fillText(text, lx + 2, ly);
    }
    ctx.globalAlpha = 1;
  }

  // 4) Sol üst sayaç bloğu — Inspector estetiği: ne izlendiği yazılı olsun.
  if (s.readout) {
    const liveCount = boxes.filter((b) => b.live).length;
    drawReadout(ctx, s.accent, [
      `TRK ${String(liveCount).padStart(2, '0')}`,
      s.lock && lockId !== -1 ? `LOCK #${String(lockId).padStart(2, '0')}` : 'LOCK --',
      `SRC ${src.w}×${src.h}`,
    ]);
  }
  ctx.restore();
}

/** Sol üst köşedeki sabit bilgi bloğu (glow'suz, koyu zeminli satırlar). */
function drawReadout(ctx: CanvasRenderingContext2D, accent: string, lines: string[]) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.font = HUD_FONT;
  ctx.textBaseline = 'top';
  const pad = 4;
  const lineH = 13;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#000';
  ctx.fillRect(8, 8, w, lines.length * lineH + pad * 2);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = accent;
  lines.forEach((l, i) => ctx.fillText(l, 8 + pad, 8 + pad + i * lineH));
  // Blok kenarı: ince sol çizgi — panel gibi dursun, kutu gibi değil.
  ctx.fillRect(8, 8, 1, lines.length * lineH + pad * 2);
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
    padding: 8,
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
  gap: 4,
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
