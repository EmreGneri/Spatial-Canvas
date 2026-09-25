import { useEffect, useState, type CSSProperties } from 'react';
import { BUILT_IN_PRESETS } from '../shaders/presets';
import { kapakSil, kapakUret, kapakYaz, kapaklariOku, kaynakDinle, yerTutucu } from './presetOnizleme';
import { bosluk, dugme as temaDugme, renk, yaricap, yazi, yuzey } from './tema';
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
  sahne,
  filtre = '',
}: {
  targets: RenderTargets;
  onApplied: () => void;
  /** Kütüphane panelindeki arama kutusu — isimle süzer. */
  filtre?: string;
  /** Kapak üretmek için sahne. Verilmezse kütüphane yalnız yer tutucu gösterir. */
  sahne?: {
    canvas: HTMLCanvasElement;
    renderFrame: () => void;
    serialize: () => RenderState;
    /** Mod değiştirmenin GÜNCEL referansı — `targets.setMode` bayatlıyor. */
    setMode?: (m: RenderState['mode']) => void;
  };
}) {
  const [userPresets, setUserPresets] = useState<StoredPreset[]>(loadUserPresets);
  const [note, setNote] = useState('');
  const [kapaklar, setKapaklar] = useState(kapaklariOku);
  // Kaynak (fotoğraf/video/kamera) değişince kapaklar bu sahneyi temsil
  // etmez: kütüphane yer tutucuya döner.
  useEffect(() => kaynakDinle(() => setKapaklar(kapaklariOku())), []);
  const [uretiliyor, setUretiliyor] = useState<string | null>(null);

  const tumPresetler = [
    ...BUILT_IN_PRESETS.map((p) => ({ ...p, hazir: true })),
    ...userPresets.map((p) => ({ ...p, hazir: false })),
  ];
  const gorunenler = filtre.trim()
    ? tumPresetler.filter((p) => p.name.toLocaleLowerCase('tr').includes(filtre.trim().toLocaleLowerCase('tr')))
    : tumPresetler;

  /**
   * Preset uygulanınca kapağı da tazelenir: bir sonraki karede sahne yeni
   * hâlini çizmiş olur (uniform'lar senkron yazılıyor ama GPU karesi bir
   * sonraki rAF'ta oluşuyor).
   */
  function apply(state: RenderState, name: string) {
    const { warnings } = applyRenderState(targets, state);
    onApplied();
    setNote(warnings.length ? `${name}: ${warnings[0]}` : `${name} yüklendi`);
    if (sahne) {
      window.setTimeout(() => {
        const url = kapakUret(sahne.canvas, sahne.renderFrame);
        if (url) setKapaklar(kapakYaz(name, url));
      }, 90);
    }
  }

  /**
   * Tüm kütüphanenin kapağını üretir: her preset uygulanır, kare alınır,
   * sonunda BAŞLANGIÇ DURUMU geri yüklenir — kullanıcı sahnesini kaybetmez.
   */
  async function hepsiniUret() {
    if (!sahne || uretiliyor) return;
    const oncesi = sahne.serialize();
    try {
      for (const { name, state } of tumPresetler) {
        setUretiliyor(name);
        applyRenderState(targets, state);
        await new Promise((r) => window.setTimeout(r, 110));
        const url = kapakUret(sahne.canvas, sahne.renderFrame);
        if (url) setKapaklar(kapakYaz(name, url));
      }
      setNote(`${tumPresetler.length} önizleme üretildi`);
    } finally {
      applyRenderState(targets, oncesi);
      // MOD KOŞULSUZ geri alınır. `applyRenderState` modu yalnız
      // `state.mode !== targets.mode` iken uygular; `targets` bu döngü
      // boyunca BAYAT (React yeniden render etmediği için `targets.mode`
      // hâlâ başlangıç modu). Geri yüklemede koşul bu yüzden atlanıyordu ve
      // sahne son preset'in modunda kalıyordu — ölçüldü: başlangıç 'points',
      // üretim sonrası motor 'neon'.
      (sahne.setMode ?? targets.setMode)?.(oncesi.mode);
      onApplied();
      setUretiliyor(null);
    }
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
    setKapaklar(kapakSil(name));
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
    <div style={{ display: 'grid', gap: bosluk.s }}>
      {/* İnce sütunda tek kolon: 228 px'de iki kapak yan yana sıkışıyordu. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: bosluk.s }}>
        {gorunenler.map(({ name, state, hazir }) => {
          const kapak = kapaklar[name];
          return (
            <div key={name} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => apply(state, name)}
                title={hazir ? `hazır preset: ${name}` : `kendi preset'in: ${name}`}
                style={{
                  ...yuzey(2, yaricap.kart),
                  padding: 0,
                  width: '100%',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  display: 'grid',
                  gap: 0,
                  opacity: uretiliyor && uretiliyor !== name ? 0.5 : 1,
                }}
              >
                <span
                  style={{
                    display: 'block',
                    aspectRatio: '192 / 120',
                    background: kapak ? `center/cover no-repeat url(${kapak})` : yerTutucu(state),
                    position: 'relative',
                  }}
                >
                  {!kapak && (
                    <span style={yerTutucuEtiketi}>önizleme yok</span>
                  )}
                  {uretiliyor === name && <span style={yerTutucuEtiketi}>üretiliyor…</span>}
                </span>
                <span style={kartAdi}>{name}</span>
              </button>
              {!hazir && (
                <button type="button" title="sil" style={silDugmesi} onClick={() => remove(name)}>
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: bosluk.xs, flexWrap: 'wrap' }}>
        <button type="button" style={{ ...temaDugme(false), flex: 1 }} onClick={save}>
          kaydet
        </button>
        <button type="button" style={{ ...temaDugme(false), flex: 1 }} onClick={copyJson}>
          JSON
        </button>
        {sahne && (
          <button
            type="button"
            style={{ ...temaDugme(false), width: '100%' }}
            disabled={uretiliyor !== null}
            title="her preset'i sırayla uygulayıp kapağını üretir; sonunda mevcut görünüme geri döner"
            onClick={hepsiniUret}
          >
            {uretiliyor ? `önizleme üretiliyor · ${uretiliyor}` : '⟳ önizlemeleri üret'}
          </button>
        )}
      </div>

      {filtre.trim() && gorunenler.length === 0 && (
        <span style={{ color: renk.metinSilik, fontSize: yazi.kucuk }}>"{filtre}" ile eşleşen preset yok</span>
      )}
      {note && <span style={{ color: renk.metinSilik, fontSize: yazi.kucuk }}>{note}</span>}
    </div>
  );
}

const kartAdi: CSSProperties = {
  display: 'block',
  padding: `${bosluk.s}px ${bosluk.s}px`,
  fontSize: yazi.kucuk,
  color: renk.metin,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** Kapağı olmayan preset bunu taşır — sahte görüntü gerçekmiş gibi durmasın. */
const yerTutucuEtiketi: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 6,
  textAlign: 'center',
  fontSize: 9.5,
  letterSpacing: 0.3,
  color: 'rgba(255,255,255,0.75)',
  textShadow: '0 1px 3px rgba(0,0,0,0.8)',
};

const silDugmesi: CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  width: 22,
  height: 22,
  minHeight: 0,
  padding: 0,
  borderRadius: yaricap.kontrol,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'rgba(255,255,255,0.18)',
  background: 'rgba(10,12,16,0.72)',
  color: renk.metinSolgun,
  fontSize: 13,
  lineHeight: 1,
  cursor: 'pointer',
};
