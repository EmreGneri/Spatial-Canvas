import { useState, type CSSProperties } from 'react';
import type { GrainPassUniforms } from '../shaders/grainPass';

/**
 * Grain/vignette pass'inin canlı kontrolleri. Sahiplik: Zeynep.
 *
 * Slider'lar uniform.value'ya doğrudan yazar — React state yalnızca paneldeki
 * sayısal etiketi tazeler. Sahne, composer, pass zinciri re-render görmez.
 */

type SliderKey = 'uGrainAmount' | 'uGrainSpeed' | 'uVignette' | 'uContrast' | 'uSaturation';

const SLIDERS: { key: SliderKey; label: string; min: number; max: number; step: number }[] = [
  { key: 'uGrainAmount', label: 'Grain Amount', min: 0, max: 0.3, step: 0.005 },
  { key: 'uGrainSpeed', label: 'Grain Speed', min: 0, max: 5, step: 0.05 },
  { key: 'uVignette', label: 'Vignette', min: 0, max: 1.5, step: 0.01 },
  { key: 'uContrast', label: 'Contrast', min: 0.5, max: 2, step: 0.01 },
  { key: 'uSaturation', label: 'Saturation', min: 0, max: 1.5, step: 0.01 },
];

const panelStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  height: '100%',
  width: 220,
  padding: '16px 14px',
  boxSizing: 'border-box',
  background: '#101014',
  borderLeft: '1px solid #26262e',
  color: '#c8c8d4',
  fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  fontSize: 12,
  display: 'grid',
  gap: 14,
  alignContent: 'start',
};

export function ControlPanel({ uniforms }: { uniforms: GrainPassUniforms }) {
  // Başlangıç değerleri uniform'lardan okunur; state sadece etiketleri besler.
  const [values, setValues] = useState<Record<SliderKey, number>>(() => ({
    uGrainAmount: uniforms.uGrainAmount.value,
    uGrainSpeed: uniforms.uGrainSpeed.value,
    uVignette: uniforms.uVignette.value,
    uContrast: uniforms.uContrast.value,
    uSaturation: uniforms.uSaturation.value,
  }));

  return (
    <aside style={panelStyle}>
      <strong style={{ color: '#8ab', fontWeight: 600 }}>grain / vignette</strong>
      {SLIDERS.map(({ key, label, min, max, step }) => (
        <label key={key} style={{ display: 'grid', gap: 4 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>
            {label}
            <span style={{ color: '#8ab' }}>{values[key].toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={values[key]}
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              uniforms[key].value = v; // sahneye tek dokunuş: uniform yazımı
              setValues((prev) => ({ ...prev, [key]: v }));
            }}
          />
        </label>
      ))}
    </aside>
  );
}
