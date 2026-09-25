import { Fragment, useState, type CSSProperties , type ReactNode } from 'react';
import type { Color, IUniform } from 'three';
import type { ParamDef } from '../engine/params';
import { GRAIN_PARAMS, type GrainPassUniforms } from '../shaders/grainPass';
import { POINTS_PARAMS, type PointCloudMaterial } from '../shaders/pointCloudMaterial';
import { ASCII_PARAMS, CHAR_SETS, type AsciiMaterial } from '../shaders/asciiMaterial';
import { NEON_PARAMS, type NeonWireMaterial } from '../shaders/neonWireMaterial';
import { SOLID_PARAMS, type SolidMaterial } from '../shaders/solidMaterial';
import { SPLAT_PARAMS, type SplatMaterial } from '../shaders/splatMaterial';
import { CRYSTAL_PARAMS, type CrystalMaterial } from '../shaders/crystalMaterial';
import { FEEDBACK_PARAMS, type FeedbackPassUniforms } from '../shaders/feedbackPass';
import { CHROMATIC_PARAMS, type ChromaticPassUniforms } from '../shaders/chromaticPass';
import { BLOOM_PARAMS, type BloomPassUniforms } from '../shaders/bloomPass';
import { LOOK_PARAMS, type LookUniforms } from '../shaders/look';
import { serializeRenderState, type RenderTargets } from '../shaders/renderPreset';
import { PresetSection } from './PresetSection';
import { useDarEkran } from './useDarEkran';
import { bosluk, cam, dugme as temaDugme, led, MONO, renk, SANS, yaricap, yazi, yuzey } from './tema';
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

/**
 * Z3 (mobil düzen): panel masaüstünde sağda SABİT durur. Dar ekranda sabit
 * kalsaydı 375 px'lik kadrajın 220 px'ini yiyip sahnenin üstüne binerdi —
 * orada akışa girer, tam genişlik alır ve katlanabilir (varsayılan kapalı:
 * telefonda önce sahne görünsün, ayarlar isteyene açılsın).
 */
const panelStyle: CSSProperties = {
  // Çalışma alanının SAĞ sütunu: ekrana çivilenmiş (fixed) değil, sütunun
  // içinde yaşar. Kendi içinde kaydırılır — sayfa kaymadan efektler gezilir,
  // canvas yerinde kalır.
  position: 'sticky',
  top: 12,
  maxHeight: 'calc(100vh - 120px)',
  width: '100%',
  padding: 10,
  boxSizing: 'border-box',
  ...cam({ blur: 26, radius: yaricap.panel }),
  fontFamily: SANS,
  fontSize: 12,
  display: 'grid',
  gap: 6,
  alignContent: 'start',
  overflowY: 'auto',
  // Kaydırma sırasında kartlar panelin kenarına yapışmasın.
  scrollbarGutter: 'stable',
};

const rafBasligi: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: `${bosluk.xs}px ${bosluk.xs}px ${bosluk.s}px`,
  fontSize: yazi.baslik,
  fontWeight: 600,
  letterSpacing: -0.1,
  color: renk.metin,
};

function kartBasligi(acik: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: `${bosluk.m}px ${bosluk.m}px`,
    minHeight: 40,
    background: 'none',
    borderWidth: 0,
    color: renk.metin,
    fontFamily: SANS,
    fontSize: yazi.orta,
    cursor: 'pointer',
    textAlign: 'left',
    opacity: acik ? 1 : 0.92,
  };
}

const darPanelStyle: CSSProperties = {
  position: 'static',
  width: '100%',
  maxWidth: '100%',
  height: 'auto',
  maxHeight: '60vh',
  boxSizing: 'border-box',
  padding: 10,
  ...cam({ blur: 22, radius: yaricap.panel }),
  fontFamily: SANS,
  fontSize: 12,
  display: 'grid',
  gap: 8,
  alignContent: 'start',
  overflowY: 'auto',
};

const darAcKapaStyle: CSSProperties = {
  ...temaDugme(false),
  width: '100%',
  textAlign: 'left',
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
  engine,
  setModeGuncel,
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
  /** Kapak üretimi için sahne (verilmezse kütüphane yalnız yer tutucu gösterir). */
  engine?: { renderer: { domElement: HTMLCanvasElement }; renderFrame: () => void };
  /** Mod değiştirmenin GÜNCEL referansı (uzun işlerde bayatlamayan). */
  setModeGuncel?: (m: RenderMode) => void;
}) {
  const firstHeading: CSSProperties = { ...headingStyle, borderTop: 'none', paddingTop: 0 };

  // Preset uygulandığında denetim grupları YENİDEN MOUNT edilir. Slider ve
  // renk seçicileri başlangıç değerini mount anında uniform'dan okur; remount
  // olmazsa uniform değişse de panel eski sayıyı göstermeye devam eder.
  const [revision, setRevision] = useState(0);
  // Z3: dar ekranda panel akışa girer ve katlanır; masaüstünde davranış aynı.
  const dar = useDarEkran();
  const [darAcik, setDarAcik] = useState(false);
  /**
   * EFEKT RAFI — aynı anda TEK kart açık. Eskiden bütün gruplar alt alta
   * açıktı: sağ panel sonu gelmeyen bir slider listesiydi ve aranan kol
   * kaydırmadan bulunamıyordu. Kartlar kapalıyken raf tek ekrana sığar.
   */
  const [acikKart, setAcikKart] = useState<string | null>('render');

  const targets: RenderTargets = { mode, points, ascii, neon, solid, splat, crystal, grain, feedback, chromatic, setMode };
  // Preset kütüphanesi artık ORTA sütunda (KutuphanePaneli); raf yalnız
  // efekt modüllerini taşır.

  if (dar && !darAcik) {
    return (
      <aside style={{ width: '100%' }}>
        <button type="button" style={darAcKapaStyle} onClick={() => setDarAcik(true)}>
          ◧ efektler · {mode} ▸
        </button>
      </aside>
    );
  }

  /** Aktif render modunun kart içeriği ve adı (mod değişince kart da değişir). */
  const modKarti = (): { ad: string; icerik: ReactNode } => {
    if (mode === 'ascii') return { ad: 'ASCII', icerik: (<><CharSetSelect material={ascii} /><ParamGroup defs={ASCII_PARAMS} uniforms={asRecord(ascii.uniforms)} /></>) };
    if (mode === 'neon') return { ad: 'Neon', icerik: <ParamGroup defs={NEON_PARAMS} uniforms={asRecord(neon.uniforms)} /> };
    if (mode === 'solid') return { ad: 'Solid', icerik: <ParamGroup defs={SOLID_PARAMS} uniforms={asRecord(solid.uniforms)} /> };
    if (mode === 'crystal' && crystal) return { ad: 'Crystal', icerik: <ParamGroup defs={CRYSTAL_PARAMS} uniforms={asRecord(crystal.uniforms)} /> };
    if (mode === 'splat' && splat) return { ad: 'Splat', icerik: <ParamGroup defs={SPLAT_PARAMS} uniforms={asRecord(splat.uniforms)} /> };
    return { ad: 'Point Cloud', icerik: <ParamGroup defs={POINTS_PARAMS} uniforms={asRecord(points.uniforms)} /> };
  };
  const mk = modKarti();

  const kartlar: { id: string; ad: string; ozet: string; etkin: boolean; icerik: ReactNode }[] = [
    { id: 'render', ad: mk.ad, ozet: 'render modu', etkin: true, icerik: mk.icerik },
    ...(feedback ? [{ id: 'feedback', ad: 'Feedback', ozet: `${FEEDBACK_PARAMS.length} kol`, etkin: degismis(FEEDBACK_PARAMS, asRecord(feedback)), icerik: <ParamGroup defs={FEEDBACK_PARAMS} uniforms={asRecord(feedback)} /> }] : []),
    ...(chromatic ? [{ id: 'chromatic', ad: 'Chromatic', ozet: `${CHROMATIC_PARAMS.length} kol`, etkin: degismis(CHROMATIC_PARAMS, asRecord(chromatic)), icerik: <ParamGroup defs={CHROMATIC_PARAMS} uniforms={asRecord(chromatic)} /> }] : []),
    ...(bloom ? [{ id: 'bloom', ad: 'Bloom', ozet: `${BLOOM_PARAMS.length} kol`, etkin: degismis(BLOOM_PARAMS, asRecord(bloom)), icerik: <ParamGroup defs={BLOOM_PARAMS} uniforms={asRecord(bloom)} /> }] : []),
    ...(look ? [{ id: 'look', ad: 'Look', ozet: 'ACES + sis', etkin: degismis(LOOK_PARAMS, asRecord(look)), icerik: <ParamGroup defs={LOOK_PARAMS} uniforms={asRecord(look)} /> }] : []),
    { id: 'grain', ad: 'Grain / Grading', ozet: `${GRAIN_PARAMS.length} kol`, etkin: degismis(GRAIN_PARAMS, asRecord(grain)), icerik: <ParamGroup defs={GRAIN_PARAMS} uniforms={asRecord(grain)} /> },
  ];

  return (
    <aside style={dar ? darPanelStyle : panelStyle}>
      {dar && (
        <button type="button" style={darAcKapaStyle} onClick={() => setDarAcik(false)}>
          efektler ▾
        </button>
      )}
      <div style={rafBasligi}>
        <span>efektler</span>
        <span style={{ fontFamily: MONO, fontSize: yazi.kucuk, color: renk.metinSilik }}>{kartlar.length} modül</span>
      </div>

      <Fragment key={`${revision}:${syncKey}`}>
        {kartlar.map((k, i) => (
          <EfektKarti
            key={k.id}
            no={i + 1}
            ad={k.ad}
            ozet={k.ozet}
            etkin={k.etkin}
            acik={acikKart === k.id}
            onTikla={() => setAcikKart((a) => (a === k.id ? null : k.id))}
          >
            {k.icerik}
          </EfektKarti>
        ))}
      </Fragment>
    </aside>
  );
}

/**
 * Tek efekt kartı: kapalıyken bir satır (numara · LED · ad · özet), açıkken
 * kolları gösterir. Kart içi açılma (inline expand) seçildi — modal ya da
 * ayrı panel, kolu çevirirken sahneyi görmeyi engellerdi.
 */
function EfektKarti({
  no, ad, ozet, etkin, acik, onTikla, children,
}: {
  no: number; ad: string; ozet: string; etkin: boolean; acik: boolean; onTikla: () => void; children: ReactNode;
}) {
  return (
    <section style={{ ...yuzey(acik ? 2 : 1), overflow: 'hidden' }}>
      <button type="button" onClick={onTikla} style={kartBasligi(acik)} aria-expanded={acik}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: renk.metinSilik, width: 16 }}>
          {String(no).padStart(2, '0')}
        </span>
        <span style={led(etkin)} />
        <span style={{ flex: 1, textAlign: 'left', fontWeight: 500 }}>{ad}</span>
        <span style={{ fontSize: yazi.kucuk, color: renk.metinSilik }}>{ozet}</span>
        <span style={{ color: renk.metinSilik, fontSize: yazi.orta, transform: acik ? 'rotate(90deg)' : 'none', transition: 'transform 160ms ease' }}>›</span>
      </button>
      {acik && (
        <div style={{ display: 'grid', gap: bosluk.m, padding: `0 ${bosluk.m}px ${bosluk.m}px` }}>{children}</div>
      )}
    </section>
  );
}

/** Bir grubun kolları varsayılandan sapmış mı — kartın LED'i bunu gösterir. */
function degismis(defs: ParamDef[], uniforms: Record<string, { value: unknown }>): boolean {
  return defs.some((d) => {
    const v = uniforms[d.key]?.value;
    if (typeof v !== 'number' || typeof d.default !== 'number') return false;
    return Math.abs(v - d.default) > 1e-6;
  });
}
