import * as THREE from 'three';
import type { ParamDef } from '../engine/params';

/**
 * GLOBAL LOOK SÖZLEŞMESİ (Gün A — görüntü kalitesi, render katmanı).
 *
 * Tonemapping (ACES), exposure ve sis gibi SAHNE GENELİ görünüm ayarları
 * tek bir köprü üzerinden yaşar: `Engine.lookUniforms`. Engine her karede
 * bu köprüyü üç render material'ına (points/ascii/neon) ve OutputPass'e
 * işler; UI/preset yalnızca köprüyü okur/yazar.
 *
 * Graf karşılığı: `output` düğümü. Düğüm "sonuca dokunmaz" olmaktan çıkar —
 * ekran çıktısının global görünüm kollarını taşır (Gün A sözleşme değişikliği,
 * CHANGELOG). Giriş kenarı kesilirse hiçbir şey olmaz: look kolları output
 * düğümünün kendisinde yaşar, aktiflik gerektirmez (output varsayılan grafta
 * her zaman aktif).
 */

export interface LookUniforms {
  /** 0.2..3 — ACES exposure (OutputPass tonemapping öncesi). */
  uExposure: { value: number };
  /** 0..0.2 — üstel sis yoğunluğu; 0 = kapalı (görünüm değişmez). */
  uFogDensity: { value: number };
  /** Sis rengi — kamera uzaklığıyla karışma rengi (tipik: koyu hâkim renk). */
  uFogColor: { value: THREE.Color };
}

/** Parametre sözleşmesi (Gün 4): output düğümünün preset'e giren kolları. */
export const LOOK_PARAMS: ParamDef[] = [
  { key: 'uExposure', label: 'ışık gücü', min: 0.2, max: 3, default: 1 },
  // Üst sınır 0.06: shader 1 - exp(-d²·k) üstel — d>10'da 0.2 anında %100 sis'e
  // düşerdi, kayan değerler ya 0 ya 1 olurdu. 0.06 ile 2..8 uzaklık bandı okunur.
  { key: 'uFogDensity', label: 'sis', min: 0, max: 0.06, default: 0 },
  { key: 'uFogColor', label: 'sis rengi', min: 0, max: 1, default: 0, kind: 'color' },
];

export function createLookUniforms(): LookUniforms {
  return {
    uExposure: { value: 1 },
    uFogDensity: { value: 0 },
    // Arka plana oturan koyu mavi — sis açılınca sahne derinliği okunur,
    // parlak duvar büstü yutmaz.
    uFogColor: { value: new THREE.Color(0.02, 0.03, 0.07) },
  };
}