import * as THREE from 'three';
// Uzantılı import (repo kuralı: reconstruction/* ile aynı): bu modülün SAF
// kısmı (frustumCorners) Node testinden doğrudan çağrılıyor — uzantısız
// belirteci Node çözemez.
import type { PoseTrackRecord } from '../engine/vision/types.ts';
import { quatToMatrix } from '../engine/vision/trajectory.ts';

/**
 * KEYFRAME / YÖRÜNGE GÖRSELLEŞTİRME (render katmanı — Zeynep, Gün 5).
 *
 * Poz zincirini (D.2 `PoseTrackRecord`) sahnede GÖRÜNÜR kılar: her keyframe
 * için kamera frustum'u, aralarında yörünge çizgisi, seçili keyframe vurgusu.
 *
 * ── NEDEN GEREKLİ ──────────────────────────────────────────────────────────
 * Poz çözücüsünün çıktısı sayı yığınıdır; ters çevrilmiş bir dönme ya da
 * kayan bir ölçek metriklerde "biraz kötü" görünür ama sahnede ANINDA
 * belli olur (frustum'lar sahnenin içine bakmak yerine dışa bakar, yörünge
 * kendi üstüne katlanır). Gün 5'in asıl işi bu geri bildirim döngüsüdür.
 *
 * ── SÖZLEŞME (D.2) ─────────────────────────────────────────────────────────
 * Kayıt **kamera→dünya**'dır: `p_world = R · p_cam + t`, `t` kameranın dünya
 * konumu. Frustum köşeleri kamera uzayında kurulur ve bu dönüşümle dünyaya
 * taşınır. Ters yön (camera_from_world) BURADA ALINMAZ — kayıt zaten doğru
 * yöndedir; tersini almak frustum'ları orijine göre aynalar (Gün 5'in en
 * olası hatası, bu yüzden yazılı).
 *
 * Kamera −z'ye bakar (three.js/OpenGL): frustum ucu −z'dedir.
 *
 * ── ÇİZİM ──────────────────────────────────────────────────────────────────
 * Tek `LineSegments` (frustum kafesleri) + tek `Line` (yörünge). Keyframe
 * başına ayrı nesne YOK: 20 keyframe × 8 kenar = 160 segment tek buffer'da,
 * tek draw call. `depthTest` açık — frustum'lar bulutun arkasına düşer,
 * öznenin önüne geçip görüşü kapatmaz.
 */

/** Frustum ucunun kameradan uzaklığı (dünya birimi) — görünürlük için kısa. */
const FRUSTUM_DEPTH = 0.35;
/** Yörünge çizgisi rengi. */
const TRAJECTORY_COLOR = 0x4fd6c8;
/** Frustum rengi (seçili olmayan). */
const FRUSTUM_COLOR = 0x6b7a99;
/** Seçili keyframe frustum rengi. */
const SELECTED_COLOR = 0xffd166;

/** Frustum başına kenar sayısı: 4 ışın + 4 taban kenarı = 8 segment. */
const EDGES_PER_FRUSTUM = 8;

export interface TrajectoryOverlay {
  /** Sahneye eklenecek kök nesne. */
  group: THREE.Group;
  /**
   * Pozları yeniden çizer. `aspect` görüntü en-boy oranıdır (frustum genişliği
   * ondan gelir); `selectedId` null ise vurgu yok.
   */
  update(poses: PoseTrackRecord[], aspect: number, selectedId: number | null): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

/**
 * Kamera uzayındaki frustum köşelerini dünyaya taşır.
 * `p_world = R · p_cam + t` (D.2 yönü).
 */
function toWorld(m: number[], t: readonly number[], p: readonly number[]): [number, number, number] {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + t[0],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + t[1],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + t[2],
  ];
}

/**
 * Tek keyframe'in frustum köşelerini üretir: tepe (kamera merkezi) + 4 taban
 * köşesi. Taban `FRUSTUM_DEPTH` kadar ÖNDE, yani kamera uzayında z = −d.
 */
export function frustumCorners(
  pose: PoseTrackRecord,
  aspect: number,
  depth = FRUSTUM_DEPTH,
): { apex: [number, number, number]; base: Array<[number, number, number]> } {
  const m = quatToMatrix(pose.R);
  const halfH = Math.tan(pose.fovY / 2) * depth;
  const halfW = halfH * aspect;
  const apex = toWorld(m, pose.t, [0, 0, 0]);
  const base: Array<[number, number, number]> = [
    toWorld(m, pose.t, [-halfW, -halfH, -depth]),
    toWorld(m, pose.t, [halfW, -halfH, -depth]),
    toWorld(m, pose.t, [halfW, halfH, -depth]),
    toWorld(m, pose.t, [-halfW, halfH, -depth]),
  ];
  return { apex, base };
}

export function createTrajectoryOverlay(): TrajectoryOverlay {
  const group = new THREE.Group();
  group.visible = false;
  // Yörüngenin/frustum'ların post-pass'lerden etkilenmemesi gerekmez (aynı
  // sahnede yaşarlar); ama saydam splat'lardan SONRA çizilsinler ki
  // blend sırası onları yutmasın.
  group.renderOrder = 20;

  const frustumGeo = new THREE.BufferGeometry();
  const frustumMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
  });
  const frustums = new THREE.LineSegments(frustumGeo, frustumMat);
  frustums.frustumCulled = false;
  group.add(frustums);

  const pathGeo = new THREE.BufferGeometry();
  const pathMat = new THREE.LineBasicMaterial({ color: TRAJECTORY_COLOR, transparent: true, opacity: 0.75 });
  const path = new THREE.Line(pathGeo, pathMat);
  path.frustumCulled = false;
  group.add(path);

  // Havuzlar: keyframe sayısı değişince yeniden ayrılır, yoksa yerinde yazılır.
  let posBuf = new Float32Array(0);
  let colBuf = new Float32Array(0);
  let pathBuf = new Float32Array(0);

  function update(poses: PoseTrackRecord[], aspect: number, selectedId: number | null) {
    const n = poses.length;
    if (n === 0) {
      frustumGeo.setDrawRange(0, 0);
      pathGeo.setDrawRange(0, 0);
      return;
    }
    const segs = n * EDGES_PER_FRUSTUM;
    const verts = segs * 2;
    if (posBuf.length !== verts * 3) {
      posBuf = new Float32Array(verts * 3);
      colBuf = new Float32Array(verts * 3);
      frustumGeo.setAttribute('position', new THREE.BufferAttribute(posBuf, 3));
      frustumGeo.setAttribute('color', new THREE.BufferAttribute(colBuf, 3));
    }
    if (pathBuf.length !== n * 3) {
      pathBuf = new Float32Array(n * 3);
      pathGeo.setAttribute('position', new THREE.BufferAttribute(pathBuf, 3));
    }

    const sel = new THREE.Color(SELECTED_COLOR);
    const norm = new THREE.Color(FRUSTUM_COLOR);
    let v = 0;
    for (let i = 0; i < n; i++) {
      const pose = poses[i];
      const { apex, base } = frustumCorners(pose, aspect);
      const c = selectedId !== null && pose.id === selectedId ? sel : norm;
      const push = (p: readonly number[]) => {
        posBuf[v * 3] = p[0];
        posBuf[v * 3 + 1] = p[1];
        posBuf[v * 3 + 2] = p[2];
        colBuf[v * 3] = c.r;
        colBuf[v * 3 + 1] = c.g;
        colBuf[v * 3 + 2] = c.b;
        v++;
      };
      // 4 ışın: tepe → taban köşeleri
      for (let k = 0; k < 4; k++) {
        push(apex);
        push(base[k]);
      }
      // 4 taban kenarı (kapalı dörtgen)
      for (let k = 0; k < 4; k++) {
        push(base[k]);
        push(base[(k + 1) % 4]);
      }
      pathBuf[i * 3] = pose.t[0];
      pathBuf[i * 3 + 1] = pose.t[1];
      pathBuf[i * 3 + 2] = pose.t[2];
    }
    (frustumGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (frustumGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (pathGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    frustumGeo.setDrawRange(0, verts);
    pathGeo.setDrawRange(0, n);
    frustumGeo.computeBoundingSphere();
    pathGeo.computeBoundingSphere();
  }

  return {
    group,
    update,
    setVisible(vis: boolean) {
      group.visible = vis;
    },
    dispose() {
      frustumGeo.dispose();
      frustumMat.dispose();
      pathGeo.dispose();
      pathMat.dispose();
    },
  };
}
