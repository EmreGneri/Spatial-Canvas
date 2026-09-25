import { useState, type CSSProperties } from 'react';
import type { RenderState, RenderTargets } from '../shaders/renderPreset';
import { PresetSection } from './PresetSection';
import { bosluk, cam, MONO, renk, SANS, yaricap, yazi } from './tema';

/**
 * KÜTÜPHANE PANELİ — üç sütunlu düzenin ORTA sütunu.
 *
 * NEDEN AYRI PANEL: preset'ler efekt rafının 07. kartının içinde duruyordu;
 * kapak görmek için önce kartı açmak gerekiyordu ve kapaklar 140 px'lik bir
 * sütuna sıkışıyordu. Referans düzende kütüphane KENDİ sütunu — göz sahneden
 * kütüphaneye, oradan efekt rafına akıyor.
 *
 * Arama alanı burada: 26 preset'te isimle aramak, ızgarada gözle taramaktan
 * hızlı.
 */
export function KutuphanePaneli({
  targets,
  onApplied,
  sahne,
}: {
  targets: RenderTargets;
  onApplied: () => void;
  sahne?: {
    canvas: HTMLCanvasElement;
    renderFrame: () => void;
    serialize: () => RenderState;
    setMode?: (m: RenderState['mode']) => void;
  };
}) {
  const [arama, setArama] = useState('');

  return (
    <section style={panel}>
      <header style={baslik}>
        <span>kütüphane</span>
        <span style={{ fontFamily: MONO, fontSize: yazi.kucuk, color: renk.metinSilik }}>preset</span>
      </header>

      <input
        type="text"
        value={arama}
        onChange={(e) => setArama(e.target.value)}
        placeholder="preset ara…"
        style={aramaKutusu}
      />

      <div style={{ overflowY: 'auto', display: 'grid', gap: bosluk.s, alignContent: 'start' }}>
        <PresetSection targets={targets} onApplied={onApplied} sahne={sahne} filtre={arama} />
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
