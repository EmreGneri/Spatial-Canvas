import { useState, type CSSProperties } from 'react';
import type { Color } from 'three';
import type { GrainPassUniforms } from '../shaders/grainPass';
import type { PointCloudMaterial } from '../shaders/pointCloudMaterial';
import { CHAR_SETS, type AsciiMaterial } from '../shaders/asciiMaterial';
import type { RenderMode } from './ModeSelector';

/**
 * Render katmanının canlı kontrolleri. Sahiplik: Zeynep.
 *
 * Desen: her denetim uniform.value'ya DOĞRUDAN yazar; React state yalnızca
 * yanındaki sayısal/hex etiketi tazeler. Sahne, composer, material yeniden
 * kurulmaz. State her denetimin kendi içinde durduğu için bir slider'ı
 * oynatmak diğerlerini de re-render etmez.
 *
 * Mod bölümleri: yalnızca aktif render modunun grubu görünür. Grup unmount
 * olup geri geldiğinde denetimler başlangıç değerlerini yine uniform'dan
 * okur — kaynak doğruluk uniform'da, panelde değil.
 */

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
  gap: 12,
  alignContent: 'start',
  // Bölüm sayısı arttı; kısa ekranda panel kendi içinde kaysın.
  overflowY: 'auto',
};

const headingStyle: CSSProperties = {
  color: '#8ab',
  fontWeight: 600,
  paddingTop: 4,
  borderTop: '1px solid #26262e',
};

const rowStyle: CSSProperties = { display: 'grid', gap: 4 };
const labelRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between' };
const valueStyle: CSSProperties = { color: '#8ab' };

/** Tek sayısal uniform. State burada durur — panelin tamamı re-render olmaz. */
function Slider({
  uniform,
  label,
  min,
  max,
  step,
  digits = 2,
}: {
  uniform: { value: number };
  label: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
}) {
  const [value, setValue] = useState(uniform.value);
  return (
    <label style={rowStyle}>
      <span style={labelRowStyle}>
        {label}
        <span style={valueStyle}>{value.toFixed(digits)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          uniform.value = v; // sahneye tek dokunuş: uniform yazımı
          setValue(v);
        }}
      />
    </label>
  );
}

/**
 * vec3 renk uniform'u. THREE.Color yerinde mutasyona uğrar — uniform'un
 * tuttuğu obje aynı kalır, material yeniden derlenmez.
 *
 * Renk uzayı: getHexString() çalışma uzayından sRGB'ye çevirir, set() ters
 * yöne. Gidiş-dönüş tutarlı, seçicide görünen renk ekrandakiyle aynı.
 */
function ColorInput({ color, label }: { color: Color; label: string }) {
  const [hex, setHex] = useState(() => `#${color.getHexString()}`);
  return (
    <label style={rowStyle}>
      <span style={labelRowStyle}>
        {label}
        <span style={valueStyle}>{hex}</span>
      </span>
      <input
        type="color"
        value={hex}
        style={{ width: '100%', height: 24, padding: 0, border: 'none', background: 'none' }}
        onChange={(e) => {
          color.set(e.target.value); // yerinde: uniform.value objesi değişmez
          setHex(e.target.value);
        }}
      />
    </label>
  );
}

/**
 * Karakter seti seçici. Seçili değer material'dan okunur — panel mod
 * değişiminde unmount olduğu için kendi hatırladığına güvenemez.
 */
function CharSetSelect({ material }: { material: AsciiMaterial }) {
  const [chars, setChars] = useState(() => material.charSet);
  return (
    <label style={rowStyle}>
      <span style={labelRowStyle}>
        Char Set
        <span style={valueStyle}>{[...chars].length}</span>
      </span>
      <select
        value={chars}
        style={{ font: 'inherit', background: '#1a1a22', color: '#c8c8d4', border: '1px solid #26262e', padding: '3px 4px' }}
        onChange={(e) => {
          material.setCharSet(e.target.value); // atlası yeniden üretir
          setChars(e.target.value);
        }}
      >
        {CHAR_SETS.map(({ label, chars: c }) => (
          <option key={label} value={c}>
            {label} · {c.trim()}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ControlPanel({
  grain,
  points,
  ascii,
  mode,
}: {
  grain: GrainPassUniforms;
  points: PointCloudMaterial;
  ascii: AsciiMaterial;
  mode: RenderMode;
}) {
  const firstHeading: CSSProperties = { ...headingStyle, borderTop: 'none', paddingTop: 0 };
  return (
    <aside style={panelStyle}>
      {mode === 'points' && (
        <>
          <strong style={firstHeading}>Point Cloud</strong>
          <Slider uniform={points.uniforms.uPointSize} label="Point Size" min={2} max={20} step={0.1} digits={1} />
          <Slider uniform={points.uniforms.uSizeJitter} label="Size Jitter" min={0} max={1} step={0.01} />
          <Slider uniform={points.uniforms.uSoftness} label="Softness" min={0} max={1} step={0.01} />
          <Slider uniform={points.uniforms.uBrightness} label="Brightness" min={0} max={3} step={0.01} />
          <ColorInput color={points.uniforms.uNearColor.value} label="Near Color" />
          <ColorInput color={points.uniforms.uFarColor.value} label="Far Color" />
        </>
      )}

      {mode === 'ascii' && (
        <>
          <strong style={firstHeading}>ASCII</strong>
          <CharSetSelect material={ascii} />
          <Slider uniform={ascii.uniforms.uPointSize} label="Point Size" min={8} max={40} step={0.5} digits={1} />
          <Slider uniform={ascii.uniforms.uSizeJitter} label="Size Jitter" min={0} max={1} step={0.01} />
          <Slider uniform={ascii.uniforms.uDepthBias} label="Depth Bias" min={-0.5} max={0.5} step={0.01} />
          <Slider uniform={ascii.uniforms.uCharRandom} label="Char Random" min={0} max={1} step={0.01} />
          <Slider uniform={ascii.uniforms.uBgOpacity} label="Bg Opacity" min={0} max={1} step={0.01} />
          <ColorInput color={ascii.uniforms.uColor.value} label="Color" />
          <ColorInput color={ascii.uniforms.uBgColor.value} label="Bg Color" />
        </>
      )}

      <strong style={headingStyle}>Grain / Grading</strong>
      <Slider uniform={grain.uGrainAmount} label="Grain Amount" min={0} max={0.3} step={0.005} />
      <Slider uniform={grain.uGrainSpeed} label="Grain Speed" min={0} max={5} step={0.05} />
      <Slider uniform={grain.uVignette} label="Vignette" min={0} max={1.5} step={0.01} />
      <Slider uniform={grain.uContrast} label="Contrast" min={0.5} max={2} step={0.01} />
      <Slider uniform={grain.uSaturation} label="Saturation" min={0} max={1.5} step={0.01} />
    </aside>
  );
}
