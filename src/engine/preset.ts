import type * as THREE from 'three';
import { POSITION_TEXTURE_SIZE } from './buffers';
import type { Graph } from './graph';
import { collectParams, applyParams, type ParamDef, type ParamValues } from './params';
import { SIM_PARAMS } from './simulation';
import { GRAIN_PARAMS } from '../shaders/grainPass';
import { FEEDBACK_PARAMS } from '../shaders/feedbackPass';
import { CHROMATIC_PARAMS } from '../shaders/chromaticPass';
import { BLOOM_PARAMS } from '../shaders/bloomPass';
import { LOOK_PARAMS } from '../shaders/look';

/**
 * PRESET ŞEMASI v1 (Gün 4 — ARCHITECTURE.md ile birebir).
 *
 * Preset = graf + parametreler. İki ayrı durum ağacı tutulmaz: parametreler
 * graf düğümlerinin üstünde durur (node.params), toPreset engine durumundan
 * tazeler, applyPreset grafı geri kurar ve düğüm parametrelerini uniform'lara
 * yazar. Medya gömülmez — yalnızca türü yazılır (synthetic | upload | camera),
 * upload içeriği geri yüklenemez, o anki görsel korunur.
 *
 * Sürüm kararı: yalnızca PRESET_VERSION kabul edilir. Bilinmeyen sürüm
 * SESSİZCE AÇILMAZ — hata döner, sahneye dokunulmaz (eski preset yanlış
 * yorumlanıp sahneyi bozmasın). Bilinmeyen ALANLAR ise atlasılır: applyParams
 * yalnızca bilinen anahtarları uygular, asla çökmez.
 */

export const PRESET_VERSION = 1;

export type MediaType = 'synthetic' | 'upload' | 'camera';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export interface PresetV1 {
  version: typeof PRESET_VERSION;
  name: string;
  mediaType: MediaType;
  /** Parçacık ızgara boyutu (kayıt anındaki POSITION_TEXTURE_SIZE). */
  gridSize: number;
  camera: CameraPose;
  graph: Graph;
}

export type Preset = PresetV1;

/**
 * toPreset'ün okuduğu engine yüzeyi — dar tutulur ki Node tarafında WebGL'siz
 * sahte engine ile round-trip testi yapılabilsin (scripts/verify-preset.mjs).
 */
export interface PresetSource {
  mediaType: MediaType;
  /** Aktif render modu adı ('points' | 'ascii' | 'neon' | 'solid'). */
  renderMode: string;
  getCameraPose(): CameraPose;
  currentGraph: Graph;
  simUniforms: Record<string, THREE.IUniform>;
  grainUniforms: Record<string, THREE.IUniform>;
  feedbackUniforms: Record<string, THREE.IUniform>;
  chromaticUniforms: Record<string, THREE.IUniform>;
  /** Gün A: bloom sözlüğü + global look köprüsü (output düğümü kolları). */
  bloomUniforms: Record<string, THREE.IUniform>;
  lookUniforms: Record<string, THREE.IUniform>;
  /** Aktif render modunun güncel parametre DEĞERLERİ (defs + material). */
  activeRenderParams(): ParamValues;
}

export interface PresetTarget extends PresetSource {
  setGraph(graph: Graph): { active: Set<string>; warnings: string[] };
  setCameraPose(pose: CameraPose): void;
}

export interface ApplyResult {
  /** Aktif düğüm tipleri (log için, sırasız). */
  applied: string[];
  warnings: string[];
}

/** Engine durumundan preset üretir — düğüm parametreleri anlık değerlerle tazelenir. */
export function toPreset(source: PresetSource, name: string): Preset {
  const graph: Graph = {
    nodes: source.currentGraph.nodes.map((node) => {
      let params: ParamValues = { ...node.params };
      if (node.type === 'particles') {
        params = collectParams(SIM_PARAMS, source.simUniforms);
      } else if (node.type === 'feedback') {
        // Post-pass zinciri: feedback + chromatic + bloom + grain parametreleri
        // aynı düğümde yaşar (Engine.setGraph ile birebir eşleşen düz sözlük).
        params = {
          ...collectParams(GRAIN_PARAMS, source.grainUniforms),
          ...collectParams(FEEDBACK_PARAMS, source.feedbackUniforms),
          ...collectParams(CHROMATIC_PARAMS, source.chromaticUniforms),
          ...collectParams(BLOOM_PARAMS, source.bloomUniforms),
        };
      } else if (node.type === 'output') {
        // Gün A: output düğümü global look kollarını taşır (exposure + fog).
        params = collectParams(LOOK_PARAMS, source.lookUniforms);
      } else if (node.type === 'renderer') {
        params = { mode: source.renderMode, ...source.activeRenderParams() };
      }
      return { ...node, params };
    }),
    edges: source.currentGraph.edges.map((e) => ({ ...e })),
  };
  return {
    version: PRESET_VERSION,
    name,
    mediaType: source.mediaType,
    gridSize: POSITION_TEXTURE_SIZE,
    camera: source.getCameraPose(),
    graph,
  };
}

/**
 * Preset'i sahneye geri uygular. Sıra: graf kurulur (mode + pass'ler +
 * parametreler), sonra kamera. Sürüm uyuşmazlığında hata fırlatılır,
 * sahneye hiç dokunulmaz; alan düzeyindeki bilinmeyenler atlasılır.
 */
export function applyPreset(target: PresetTarget, preset: Preset): ApplyResult {
  if (preset.version !== PRESET_VERSION) {
    throw new Error(
      `preset sürümü uyuşmuyor: ${preset.version} (beklenen ${PRESET_VERSION}) — açılmadı`,
    );
  }
  const warnings: string[] = [];
  if (preset.gridSize !== POSITION_TEXTURE_SIZE) {
    warnings.push(
      `preset ${preset.gridSize}×${preset.gridSize} grid ile kaydedilmiş, motor ${POSITION_TEXTURE_SIZE}×${POSITION_TEXTURE_SIZE} kullanıyor (ızgara çalışma zamanında değişmez)`,
    );
  }
  const { active, warnings: graphWarnings } = target.setGraph(preset.graph);
  warnings.push(...graphWarnings);
  target.setCameraPose(preset.camera);
  // mediaType KOPYALANMAZ. Medya geri yüklenmiyor (şema gereği gömülmüyor), o
  // yüzden alanı preset'ten yazmak motoru yalancı duruma sokardı: ekranda
  // sentetik görsel dururken mediaType 'camera' olur ve bir sonraki kayıt
  // yanlış türü yazar. Fark varsa yalnızca uyarılır.
  if (preset.mediaType !== target.mediaType) {
    warnings.push(
      `preset '${preset.mediaType}' medyasıyla kaydedilmiş, şu anki kaynak '${target.mediaType}' — medya preset'e gömülmez, görsel korundu`,
    );
  }
  return { applied: [...active], warnings };
}

// ---------------------------------------------------------------------------
// localStorage slotları (tarayıcı) + JSON dosya indirme/yükleme (Gün 6).
// File indirme paylaşım + yedek; slotlar çalışma zamanı hızlı erişim.
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'spatial-canvas.preset.';

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // gizlilik modu vb. — slotlar o zaman çalışmaz, uygulama yine çalışır
  }
}

export function saveSlot(name: string, preset: Preset): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_PREFIX + name, JSON.stringify(preset));
    return true;
  } catch {
    return false; // kota dolu / gizli mod — kaydetmek uygulamayı düşürmesin
  }
}

export function loadSlot(name: string): Preset | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(STORAGE_PREFIX + name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Preset;
    return parsed.version === PRESET_VERSION ? parsed : null;
  } catch {
    return null; // bozuk JSON — slotu açmaya kalkışıp patlamak yok
  }
}

export function deleteSlot(name: string): void {
  storage()?.removeItem(STORAGE_PREFIX + name);
}

export function listSlots(): string[] {
  const store = storage();
  if (!store) return [];
  const names: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) names.push(key.slice(STORAGE_PREFIX.length));
  }
  return names.sort();
}

/**
 * Preset'i JSON dosyası olarak indirir (taşınabilir — paylaşım/backup).
 * `downloadPresetFile` doğrudan <a download> tetikler.
 */
export function downloadPresetFile(preset: Preset): void {
  const json = JSON.stringify(preset, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `spatial-canvas-${(preset.name || 'preset').replace(/[^\w\-]+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * JSON dosyasından preset'i okur — sürümü doğrular (applyPreset'in açtığı
 * path). Yükleme başarısızsa null döner; çağıran mesajı gösterir.
 */
export function parsePresetFile(file: File): Promise<Preset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('dosya okunamadı'));
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Preset;
        if (parsed.version !== PRESET_VERSION) {
          reject(
            new Error(`preset sürümü ${parsed.version}, beklenen ${PRESET_VERSION}`),
          );
          return;
        }
        resolve(parsed);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('bozuk JSON'));
      }
    };
    reader.readAsText(file);
  });
}
