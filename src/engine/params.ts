import * as THREE from 'three';

/**
 * RENDER PARAMETRE SÖZLEŞMESİ (Gün 4 — ARCHITECTURE.md ile birebir).
 *
 * Her material/pass KENDİ parametre tanımını dışa verir. Serializasyon
 * (preset) bu listeyi yürür; uniform adlarını bilmez, sırayı material
 * sahibi belirler. Yeni bir uniform eklendiğinde tek yapılacak şey listeye
 * satır eklemek — preset otomatik kapsar.
 *
 * Tanım: { key: uniform adı, label: UI etiketi, min/max: slider aralığı,
 *          default: ilk değer, kind: 'number' (varsayılan) | 'color' }
 */
export interface ParamDef {
  key: string;
  label: string;
  min?: number;
  max?: number;
  default: number;
  kind?: 'number' | 'color';
}

/** Serileştirilmiş değerler: sayı doğrudan, renk '#rrggbb'. */
export type ParamValues = Record<string, number | string>;

/** '#' + hex → THREE.Color. Çözülemezse varsayılan. */
function parseColor(hex: string | number): THREE.Color {
  try {
    return new THREE.Color(hex);
  } catch {
    return new THREE.Color(0xffffff);
  }
}

/** Uniform sözlüğündeki değerleri tanım listesine göre toplar (okuma). */
export function collectParams(
  defs: ParamDef[],
  uniforms: Record<string, THREE.IUniform>,
): ParamValues {
  const out: ParamValues = {};
  for (const def of defs) {
    const uniform = uniforms[def.key];
    if (!uniform) continue;
    const value = uniform.value;
    if (def.kind === 'color') {
      if (value instanceof THREE.Color) out[def.key] = `#${value.getHexString()}`;
    } else if (typeof value === 'number') {
      out[def.key] = value;
    }
  }
  return out;
}

/**
 * Değerleri uniform'lara uygular (yazma). Bilinmeyen anahtarlar ve tür
 * uyuşmazlıkları ATLANIR, asla patlamaz: eski bir preset'te uniform
 * silinmişse (ya da yeni bir alan eklenmişse) sorunsuz açılır.
 * Dönen sayı = kaç parametre uygulandı (log için).
 */
export function applyParams(
  defs: ParamDef[],
  uniforms: Record<string, THREE.IUniform>,
  values: ParamValues,
): number {
  let applied = 0;
  for (const def of defs) {
    const value = values[def.key];
    if (value === undefined) continue;
    const uniform = uniforms[def.key];
    if (!uniform) continue;
    if (def.kind === 'color') {
      if (typeof value === 'string') {
        // In place: ControlPanel's ColorInput and the material keep a reference
        // to this THREE.Color. Swapping the object would leave the picker
        // editing an orphan after reset / graph apply.
        if (uniform.value instanceof THREE.Color) uniform.value.set(parseColor(value));
        else uniform.value = parseColor(value);
        applied++;
      }
    } else if (typeof value === 'number') {
      uniform.value = value;
      applied++;
    }
  }
  return applied;
}
