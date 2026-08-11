import { useState, type CSSProperties } from 'react';
import { BUILT_IN_PRESETS } from '../shaders/presets';
import {
  applyRenderState,
  serializeRenderState,
  type RenderState,
  type RenderTargets,
} from '../shaders/renderPreset';

/**
 * Preset bölümü. Sahiplik: Zeynep.
 *
 * Hazır preset'ler koddan gelir (`presets.ts`) ve silinemez. Kullanıcının
 * kaydettikleri localStorage'da durur, sayfa yenilenince geri gelir.
 *
 * Preset uygulandıktan sonra `onApplied` çağrılır: paneldeki denetimler
 * başlangıç değerlerini mount anında uniform'dan okuduğu için, yeniden
 * mount edilmezlerse eski değerleri göstermeye devam ederler.
 */

const STORAGE_KEY = 'spatial-canvas.render-presets.v1';

interface StoredPreset {
  name: string;
  state: RenderState;
}

/** localStorage bozuk/dolu/kapalı olabilir — hiçbir durumda paneli düşürmez. */
function loadUserPresets(): StoredPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is StoredPreset => !!p && typeof p.name === 'string' && !!p.state,
    );
  } catch {
    return [];
  }
}

function persist(list: StoredPreset[]): string {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return '';
  } catch {
    return 'kaydedilemedi (localStorage kapalı ya da dolu)';
  }
}

const rowStyle: CSSProperties = { display: 'grid', gap: 4 };
const listRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 4,
};
const nameButtonStyle: CSSProperties = {
  font: 'inherit',
  flex: 1,
  textAlign: 'left',
  padding: '3px 6px',
  cursor: 'pointer',
  color: '#c8c8d4',
  background: '#1a1a22',
  border: '1px solid #26262e',
  borderRadius: 3,
};
const smallButtonStyle: CSSProperties = {
  font: 'inherit',
  padding: '3px 6px',
  cursor: 'pointer',
  color: '#c8c8d4',
  background: '#1a1a22',
  border: '1px solid #26262e',
  borderRadius: 3,
};

export function PresetSection({
  targets,
  onApplied,
}: {
  targets: RenderTargets;
  onApplied: () => void;
}) {
  const [userPresets, setUserPresets] = useState<StoredPreset[]>(loadUserPresets);
  const [note, setNote] = useState('');

  function apply(state: RenderState, name: string) {
    const { warnings } = applyRenderState(targets, state);
    onApplied();
    setNote(warnings.length ? `${name}: ${warnings[0]}` : `${name} yüklendi`);
  }

  function save() {
    const raw = window.prompt('preset adı:');
    const name = raw?.trim();
    if (!name) return;

    if (BUILT_IN_PRESETS.some((p) => p.name === name)) {
      setNote(`'${name}' hazır preset adı — başka bir ad seçin`);
      return;
    }
    const exists = userPresets.some((p) => p.name === name);
    if (exists && !window.confirm(`'${name}' zaten var, üzerine yazılsın mı?`)) return;

    const entry: StoredPreset = { name, state: serializeRenderState(targets) };
    const next = exists
      ? userPresets.map((p) => (p.name === name ? entry : p))
      : [...userPresets, entry];
    setUserPresets(next);
    setNote(persist(next) || `${name} kaydedildi`);
  }

  function remove(name: string) {
    if (!window.confirm(`'${name}' silinsin mi?`)) return;
    const next = userPresets.filter((p) => p.name !== name);
    setUserPresets(next);
    setNote(persist(next) || `${name} silindi`);
  }

  async function copyJson() {
    const json = JSON.stringify(serializeRenderState(targets), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setNote('JSON panoya kopyalandı');
    } catch {
      // Pano izni yoksa (ya da güvenli bağlam değilse) konsola bas — kaybolmasın.
      console.log(json);
      setNote('pano reddedildi — JSON konsola yazıldı');
    }
  }

  return (
    <div style={rowStyle}>
      {BUILT_IN_PRESETS.map(({ name, state }) => (
        <div key={name} style={listRowStyle}>
          <button type="button" style={nameButtonStyle} onClick={() => apply(state, name)}>
            {name}
          </button>
        </div>
      ))}

      {userPresets.map(({ name, state }) => (
        <div key={name} style={listRowStyle}>
          <button type="button" style={nameButtonStyle} onClick={() => apply(state, name)}>
            {name}
          </button>
          <button
            type="button"
            title="sil"
            style={smallButtonStyle}
            onClick={() => remove(name)}
          >
            ×
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" style={{ ...smallButtonStyle, flex: 1 }} onClick={save}>
          Kaydet
        </button>
        <button type="button" style={{ ...smallButtonStyle, flex: 1 }} onClick={copyJson}>
          JSON kopyala
        </button>
      </div>

      {note && <span style={{ color: '#667', fontSize: 11 }}>{note}</span>}
    </div>
  );
}
