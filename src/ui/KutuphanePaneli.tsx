import { useState, type CSSProperties } from 'react';
import type { RenderTargets } from '../shaders/renderPreset';
import { PresetSection } from './PresetSection';
import { bosluk, cam, dugme, renk, SANS, yaricap, yazi } from './tema';

export function KutuphanePaneli({
  targets,
  onApplied,
  sahne,
  desktop,
  activePreset,
  onBeforeApply,
  onUndo,
}: {
  targets: RenderTargets;
  onApplied: () => void;
  desktop: boolean;
  activePreset: string | null;
  onBeforeApply: (name: string) => void;
  onUndo: () => void;
  sahne?: {
    canvas: HTMLCanvasElement;
    renderFrame: () => void;
    captureRestore: () => () => void;
  };
}) {
  const [arama, setArama] = useState('');
  const [previewing, setPreviewing] = useState(false);

  return (
    <section aria-label="Presetler" style={desktop ? { ...panel, position: 'relative', top: 0, maxHeight: '100%', boxSizing: 'border-box' } : panel}>
      <header style={baslik}>
        <span>Presetler</span>
        <button type="button" style={dugme(false)} disabled={!activePreset || previewing}
          onClick={onUndo} title="Presetleri denemeden önceki görünüme dön">
          Geri al
        </button>
      </header>

      <input
        type="text"
        value={arama}
        onChange={(e) => setArama(e.target.value)}
        placeholder="preset ara…"
        style={aramaKutusu}
      />

      <div style={{ overflowY: 'auto', display: 'grid', gap: bosluk.s, alignContent: 'start' }}>
        <PresetSection targets={targets} onApplied={onApplied} sahne={sahne} filtre={arama}
          activePreset={activePreset} onBeforeApply={onBeforeApply} onPreviewing={setPreviewing} />
      </div>
    </section>
  );
}

const panel: CSSProperties = {
  ...cam({ blur: 26, radius: yaricap.panel }),
  // Efekt rafıyla aynı davranış: sütunda yapışır, KENDİ içinde kaydırılır.
  // Böylece sayfa kaymadan kütüphane gezilir, canvas yerinde kalır.
  position: 'sticky',
  top: 12,
  maxHeight: 'calc(100vh - 120px)',
  padding: bosluk.s,
  display: 'grid',
  gridTemplateRows: 'auto auto minmax(0, 1fr)',
  gap: bosluk.s,
  minHeight: 0,
  fontFamily: SANS,
};

const baslik: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: `${bosluk.xs}px ${bosluk.xs}px 0`,
  fontSize: yazi.baslik,
  fontWeight: 600,
  letterSpacing: -0.1,
  color: renk.metin,
};

const aramaKutusu: CSSProperties = {
  fontFamily: SANS,
  fontSize: yazi.govde,
  width: '100%',
  boxSizing: 'border-box',
};
