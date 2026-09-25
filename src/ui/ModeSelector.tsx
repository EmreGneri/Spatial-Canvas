import { useState } from 'react';
import type { CSSProperties } from 'react';
import { dugme as temaDugme } from './tema';
import type { Engine } from '../engine';
import type { PointCloudMaterial } from '../shaders/pointCloudMaterial';
import type { AsciiMaterial } from '../shaders/asciiMaterial';
import type { NeonWireMaterial } from '../shaders/neonWireMaterial';
import type { SolidMaterial } from '../shaders/solidMaterial';
import type * as THREE from 'three';

/**
 * Render modu seçici. Sahiplik: Zeynep.
 *
 * Material'lar App'te bir kez üretilir (useMemo) ve burada yalnızca takas
 * edilir — her tıkta yeniden yaratılmaz. Takas tek yoldan yapılır:
 * `engine.setPointsMaterial()`. Doğrudan `engine.points.material`'a yazmak
 * çalışmaz; Engine `uPositions`'ı kendi tuttuğu referansa yazdığı için yeni
 * material konum alamaz (ARCHITECTURE.md · Point Cloud Sözleşmesi).
 */

export type RenderMode = 'points' | 'ascii' | 'neon' | 'solid' | 'splat' | 'crystal';

export interface RenderModeMaterials {
  points: PointCloudMaterial;
  ascii: AsciiMaterial;
  neon: NeonWireMaterial;
  solid: SolidMaterial;
  /** 5. mod (Gün D): instanced Gauss splat — kendi çizim nesnesi vardır. */
  splat: THREE.ShaderMaterial;
  /** 6. mod (Gün 2): kristal/cam — solid ile aynı kabuk mesh'ini kullanır. */
  crystal: THREE.ShaderMaterial;
}

const MODES: { id: RenderMode; label: string }[] = [
  { id: 'points', label: 'Point Cloud' },
  { id: 'ascii', label: 'ASCII' },
  { id: 'neon', label: 'Neon' },
  { id: 'solid', label: 'Solid' },
  { id: 'splat', label: 'Splat' },
  { id: 'crystal', label: 'Crystal' },
];

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  // Z3: satır sarmıyordu; telefonda 786 px'e uzayıp kadrajı taşırıyordu.
  flexWrap: 'wrap',
  maxWidth: '100%',
  fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  fontSize: 12,
};

/**
 * Mod düğmeleri tema dilini kullanır (tasarim-kurallari.md · Fitts +
 * Benzerlik): yükseklik 32 px, yarıçap `tema.yaricap.kontrol`, etkin hâl
 * dolguyla. Eskiden kendi stili vardı: 28 px ve 3 px yarıçap — ölçümde hem
 * hedef boyu hem yarıçap kademesi ihlaliydi.
 */
function buttonStyle(active: boolean): CSSProperties {
  return { ...temaDugme(active), cursor: active ? 'default' : 'pointer' };
}

export function ModeSelector({
  engine,
  materials,
  mode,
  onChange,
  onReset,
}: {
  engine: Engine;
  materials: RenderModeMaterials;
  mode: RenderMode;
  onChange: (mode: RenderMode) => void;
  /** Sıfırlama sonrası kabuk (App) log/gösterge tazelemek isterse. */
  onReset?: () => void;
}) {
  function select(next: RenderMode) {
    // Aynı moda tekrar tıklamak boşuna takas: Engine giden material'ı dispose
    // ettiği için, aktif material'ı dispose edip yerine kendisini koyardı.
    if (next === mode) return;
    engine.setPointsMaterial(materials[next]);
    onChange(next);
  }

  return (
    <div style={rowStyle}>

      {MODES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={mode === id}
          style={buttonStyle(mode === id)}
          onClick={() => select(id)}
        >
          {label}
        </button>
      ))}
      {/* SIFIRLA — efekt kollarıyla oynadıktan sonra başlangıç noktasına
          dönmenin tek yolu. Medyayı ve grafı SİLMEZ: yalnız render/pass/look/
          sim parametreleri ve kamera pozu başa döner (Engine.resetRenderParams
          docstring'i). Yeni bir görsele geçmeden önce buna basmak, önceki
          görselin ayarlarının yeni görsele taşınmasını engeller. */}
      <button
        type="button"
        title="efektleri ve kamerayı başlangıca döndür (görsel silinmez)"
        style={{
          ...buttonStyle(false),
          marginLeft: 8,
          borderColor: '#3a3a46',
        }}
        onClick={() => {
          engine.resetRenderParams();
          onReset?.();
        }}
      >
        ↺
      </button>
      <LivePhotoControls engine={engine} />
      <FlatVideoToggle engine={engine} />
    </div>
  );
}

/**
 * DÜZ VİDEO — kaynağı 3B'ye çevirmeden gösterir (`Engine.setFlatVideo`).
 *
 * Render modu DEĞİL, gösterim tercihi: açıkken 3B kolları (bulut/splat/
 * kabuk) gizlenir, kapanınca seçili mod aynen geri gelir. Mod sözleşmesine,
 * ParamDef'e ve preset'e dokunmaz.
 *
 * NE İŞE YARAR: tracker HUD ekrandaki kareyi izler; 3B bulut her derinlik
 * güncellemesinde yeniden yerleştiği için izlenecek kalıcı özellik kalmıyor.
 * Düz karede bina köşesi/tabela saniyelerce yerinde durur — kutular gerçek
 * nesnelere oturur.
 */
function FlatVideoToggle({ engine }: { engine: Engine }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={on}
      title="düz video: kaynağı 3B'ye çevirmeden göster (tracker'ın gerçek nesneleri takip etmesi için)"
      style={{ ...buttonStyle(on), marginLeft: 8 }}
      onClick={() => {
        const next = !on;
        setOn(next);
        engine.setFlatVideo(next);
      }}
    >
      ▭ düz
    </button>
  );
}

/**
 * "Canlı fotoğraf" paralaks sway (viral sprint, Gün 4 — Zeynep).
 *
 * Yeni render modu DEĞİL: `Engine.setAutoSway` kamerayı AÇILDIĞI ANDAKİ
 * pozun etrafında sallar (Emre, Gün 3-4) — cameraHome'a dokunmaz, elle
 * sürüklerken durur. Hız kolu sway açıkken de geçer: setAutoSway opts'u
 * aç/kapa durumu değişmese bile uygular.
 *
 * HIZLI PROTOTİP: ad-hoc local state, ParamDef yok, preset'e KAYDOLMAZ
 * (sprint kararı) — sayfa yenilenince kapalı başlar.
 */
function LivePhotoControls({ engine }: { engine: Engine }) {
  const [on, setOn] = useState(false);
  const [speed, setSpeed] = useState(1);

  function toggle() {
    const next = !on;
    setOn(next);
    engine.setAutoSway(next, { speed });
  }

  function changeSpeed(next: number) {
    setSpeed(next);
    if (on) engine.setAutoSway(true, { speed: next });
  }

  return (
    <>
      <button
        type="button"
        aria-pressed={on}
        title="canlı fotoğraf: kamera hafifçe salınır (elle sürüklerken durur, kapatınca açılış pozuna döner)"
        style={{ ...buttonStyle(on), marginLeft: 8 }}
        onClick={toggle}
      >
        ◍ canlı
      </button>
      <label title="salınım hızı" style={{ display: 'flex', gap: 4, alignItems: 'center', color: on ? '#889' : '#556' }}>
        <input
          type="range"
          min={0.3}
          max={2.5}
          step={0.1}
          value={speed}
          disabled={!on}
          onChange={(e) => changeSpeed(Number(e.target.value))}
          style={{ width: 70 }}
        />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{speed.toFixed(1)}×</span>
      </label>
    </>
  );
}
