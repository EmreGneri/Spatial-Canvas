import { Fragment, useState, type CSSProperties } from 'react';
import type { Color, IUniform } from 'three';
import type { ParamDef } from '../engine/params';
import { GRAIN_PARAMS, type GrainPassUniforms } from '../shaders/grainPass';
import { POINTS_PARAMS, type PointCloudMaterial } from '../shaders/pointCloudMaterial';
import { ASCII_PARAMS, CHAR_SETS, type AsciiMaterial } from '../shaders/asciiMaterial';
import { NEON_PARAMS, type NeonWireMaterial } from '../shaders/neonWireMaterial';
import { SOLID_PARAMS, type SolidMaterial } from '../shaders/solidMaterial';
import { type SplatMaterial } from '../shaders/splatMaterial';
import { CRYSTAL_PARAMS, type CrystalMaterial } from '../shaders/crystalMaterial';
import { FEEDBACK_PARAMS, type FeedbackPassUniforms } from '../shaders/feedbackPass';
import { CHROMATIC_PARAMS, type ChromaticPassUniforms } from '../shaders/chromaticPass';
import { BLOOM_PARAMS, type BloomPassUniforms } from '../shaders/bloomPass';
import { LOOK_PARAMS, type LookUniforms } from '../shaders/look';
import type { RenderTargets } from '../shaders/renderPreset';
import { PresetSection } from './PresetSection';
import type { RenderMode } from './ModeSelector';

/**
 * Render katmanının canlı kontrolleri. Sahiplik: Zeynep.
 *
 * Denetimler ARTIK ELLE YAZILMIYOR: her bölüm ilgili `ParamDef[]` listesinden
 * üretilir (POINTS_PARAMS, ASCII_PARAMS, NEON_PARAMS, FEEDBACK_PARAMS,
 * CHROMATIC_PARAMS, GRAIN_PARAMS). Bir shader'a uniform eklemek için listeye
 * satır eklemek yeterli — panel kendiliğinde algılar, bu dosyaya dokunulmaz.
 * Aynı listeler preset serileştirmesini de sürdüğü için ikisi ayrışamaz.
 *
 * Desen değişmedi: her denetim uniform.value'ya DOĞRUDAN yazar; React state
 * yalnızca yanındaki sayısal/hex etiketi tazeler. Sahne yeniden kurulmaz ve
 * state her denetimin kendi içinde durduğu için bir slider diğerlerini
 * re-render etmez.
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

/**
 * ParamDef adım büyüklüğü taşımıyor; aralıktan türetilir. Ham aralık/200
 * değeri 1-2-5×10^k basamağına yuvarlanır, yoksa 0.00015 gibi okunamayan
 * adımlar çıkar.
 */
function niceStep(min: number, max: number): number {
  const span = Math.abs(max - min) || 1;
  const raw = span / 200;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const multiplier = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return multiplier * magnitude;
}

/** Etiket ondalığı adımdan gelir: 0.001 adım → 3 hane. */
function digitsFor(step: number): number {
  return Math.max(0, Math.min(4, Math.ceil(-Math.log10(step))));
}

/** Tek sayısal uniform. State burada durur — panelin tamamı re-render olmaz. */
function Slider({
  uniform,
  label,
  min,
  max,
  step,
  digits,
}: {
  uniform: { value: number };
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
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
 * Bir parametre listesini denetimlere çevirir. Listede olup uniform'da
 * karşılığı olmayan anahtar SESSİZCE ATLANIR — liste ve shader ayrı ellerden
 * güncellenebildiği için panel bundan düşmemeli.
 */
function ParamGroup({
  defs,
  uniforms,
}: {
  defs: ParamDef[];
  uniforms: Record<string, IUniform>;
}) {
  return (
    <>
      {defs.map((def) => {
        const uniform = uniforms[def.key];
        if (!uniform) return null;

        if (def.kind === 'color') {
          const value = uniform.value as Color | undefined;
          if (!value || typeof value.getHexString !== 'function') return null;
          return <ColorInput key={def.key} color={value} label={def.label} />;
        }

        if (typeof uniform.value !== 'number') return null;
        const min = def.min ?? 0;
        const max = def.max ?? 1;
        const step = niceStep(min, max);
        return (
          <Slider
            key={def.key}
            uniform={uniform as { value: number }}
            label={def.label}
            min={min}
            max={max}
            step={step}
            digits={digitsFor(step)}
          />
        );
      })}
    </>
  );
}

/** Uniform arayüzlerini ParamGroup'un beklediği sözlüğe daraltır. */
function asRecord(uniforms: object): Record<string, IUniform> {
  return uniforms as unknown as Record<string, IUniform>;
}

/**
 * Karakter seti seçici. ParamDef ile ifade edilemez: `uCharSet` uniform'u
 * hücre sayısıdır, karakterlerin kendisi material API'sinde (setCharSet).
 * Seçili değer material'dan okunur — panel mod değişiminde unmount olduğu
 * için kendi hatırladığına güvenemez.
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
  neon,
  solid,
  splat,
  crystal,
  feedback,
  chromatic,
  bloom,
  look,
  mode,
  setMode,
  syncKey = 0,
}: {
  grain: GrainPassUniforms;
points: PointCloudMaterial;
  ascii: AsciiMaterial;
  neon: NeonWireMaterial;
  solid: SolidMaterial;
  /** Gün 8: splat preset grubu (renderPreset serileştirmesi). */
  splat?: SplatMaterial;
  /** Gün 2: crystal modu — ParamDef'lerden slider üretilir. */
  crystal?: CrystalMaterial;
  /** Feedback pass zincire eklenmemişse verilmez — bölüm de çıkmaz. */
  feedback?: FeedbackPassUniforms;
  /** Chromatic pass zincire eklenmemişse verilmez — bölüm de çıkmaz. */
  chromatic?: ChromaticPassUniforms;
  /** Gün A: bloom sözlüğü (BLOOM_PARAMS). */
  bloom?: BloomPassUniforms;
  /** Gün A: global look köprüsü (LOOK_PARAMS — ACES exposure + fog). */
  look?: LookUniforms;
  mode: RenderMode;
  /** Preset mod değiştirdiğinde çağrılır; takas Engine'den geçer. */
  setMode?: (mode: RenderMode) => void;
  /**
   * Bumped by the owner when something outside this panel rewrote uniforms
   * ("↺ sıfırla", graph editor, graph preset). Same reason as `revision`.
   */
  syncKey?: number;
}) {
  const firstHeading: CSSProperties = { ...headingStyle, borderTop: 'none', paddingTop: 0 };

  // Preset uygulandığında denetim grupları YENİDEN MOUNT edilir. Slider ve
  // renk seçicileri başlangıç değerini mount anında uniform'dan okur; remount
  // olmazsa uniform değişse de panel eski sayıyı göstermeye devam eder.
  const [revision, setRevision] = useState(0);

  const targets: RenderTargets = { mode, points, ascii, neon, solid, splat, crystal, grain, feedback, chromatic, setMode };

  return (
    <aside style={panelStyle}>
      <strong style={firstHeading}>Presets</strong>
      <PresetSection targets={targets} onApplied={() => setRevision((r) => r + 1)} />

      <Fragment key={`${revision}:${syncKey}`}>
        {mode === 'points' && (
          <>
            <strong style={headingStyle}>Point Cloud</strong>
            <ParamGroup defs={POINTS_PARAMS} uniforms={asRecord(points.uniforms)} />
          </>
        )}

        {mode === 'ascii' && (
          <>
            <strong style={headingStyle}>ASCII</strong>
            <CharSetSelect material={ascii} />
            <ParamGroup defs={ASCII_PARAMS} uniforms={asRecord(ascii.uniforms)} />
          </>
        )}

        {mode === 'neon' && (
          <>
            <strong style={headingStyle}>Neon</strong>
            <ParamGroup defs={NEON_PARAMS} uniforms={asRecord(neon.uniforms)} />
          </>
        )}

        {mode === 'solid' && (
          <>
            <strong style={headingStyle}>Solid</strong>
            <ParamGroup defs={SOLID_PARAMS} uniforms={asRecord(solid.uniforms)} />
          </>
        )}

        {mode === 'crystal' && crystal && (
          <>
            <strong style={headingStyle}>Crystal</strong>
            <ParamGroup defs={CRYSTAL_PARAMS} uniforms={asRecord(crystal.uniforms)} />
          </>
        )}

        {feedback && (
          <>
            <strong style={headingStyle}>Feedback</strong>
            <ParamGroup defs={FEEDBACK_PARAMS} uniforms={asRecord(feedback)} />
          </>
        )}

        {chromatic && (
          <>
            <strong style={headingStyle}>Chromatic</strong>
            <ParamGroup defs={CHROMATIC_PARAMS} uniforms={asRecord(chromatic)} />
          </>
        )}

        {bloom && (
          <>
            <strong style={headingStyle}>Bloom</strong>
            <ParamGroup defs={BLOOM_PARAMS} uniforms={asRecord(bloom)} />
          </>
        )}

        {look && (
          <>
            <strong style={headingStyle}>Look (ACES + sis)</strong>
            <ParamGroup defs={LOOK_PARAMS} uniforms={asRecord(look)} />
          </>
        )}

        <strong style={headingStyle}>Grain / Grading</strong>
        <ParamGroup defs={GRAIN_PARAMS} uniforms={asRecord(grain)} />
      </Fragment>
    </aside>
  );
}
