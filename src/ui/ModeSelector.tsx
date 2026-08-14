import type { CSSProperties } from 'react';
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

export type RenderMode = 'points' | 'ascii' | 'neon' | 'solid' | 'splat';

export interface RenderModeMaterials {
  points: PointCloudMaterial;
  ascii: AsciiMaterial;
  neon: NeonWireMaterial;
  solid: SolidMaterial;
  /** 5. mod (Gün D): instanced Gauss splat — kendi çizim nesnesi vardır. */
  splat: THREE.ShaderMaterial;
}

const MODES: { id: RenderMode; label: string }[] = [
  { id: 'points', label: 'Point Cloud' },
  { id: 'ascii', label: 'ASCII' },
  { id: 'neon', label: 'Neon' },
  { id: 'solid', label: 'Solid' },
  { id: 'splat', label: 'Splat' },
];

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  fontSize: 12,
};

function buttonStyle(active: boolean): CSSProperties {
  return {
    font: 'inherit',
    padding: '4px 10px',
    cursor: active ? 'default' : 'pointer',
    color: active ? '#101014' : '#c8c8d4',
    background: active ? '#8ab' : '#1a1a22',
    border: `1px solid ${active ? '#8ab' : '#26262e'}`,
    borderRadius: 3,
  };
}

export function ModeSelector({
  engine,
  materials,
  mode,
  onChange,
}: {
  engine: Engine;
  materials: RenderModeMaterials;
  mode: RenderMode;
  onChange: (mode: RenderMode) => void;
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
      <span style={{ color: '#667' }}>mod:</span>
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
    </div>
  );
}
