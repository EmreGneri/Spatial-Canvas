import type * as THREE from 'three';
import { POSITION_TEXTURE_SIZE } from './buffers';
import type { Graph } from './graph';
import { collectParams, applyParams, type ParamDef, type ParamValues } from './params';
import { SIM_PARAMS } from './simulation';
import { GRAIN_PARAMS } from '../shaders/grainPass';

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
  /** Aktif render modu adı ('points' | 'ascii'). */
  renderMode: string;
  getCameraPose(): CameraPose;
  currentGraph: Graph;
  simUniforms: Record<string, THREE.IUniform>;
  grainUniforms: Record<string, THREE.IUniform>;
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
        params = collectParams(GRAIN_PARAMS, source.grainUniforms);
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
  target.mediaType = preset.mediaType;
  return { applied: [...active], warnings };
}

// ---------------------------------------------------------------------------
// localStorage slotları (tarayıcı). Dosya indirme/yükleme Gün 6'da gelir.
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
  store.setItem(STORAGE_PREFIX + name, JSON.stringify(preset));
  return true;
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
