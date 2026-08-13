// GÜN D (Gün 0 sözleşmesi) — CV fazı veri tipleri. ARCHITECTURE.md
// "Gün D — CV Dönüşümü" bölümündeki sözleşmelerin kod karşılığı.
// Yazan: veri katmanı (Emre). Render katmanı bunları tüketir; sahne düzeni
// üzerinde tek başına değişiklik yapamaz (sessiz sapma yok).

/** D.2 — PoseTrack sözleşmesi: bağımsız keyframe kamera kaydı. */
export interface PoseTrackRecord {
  /** Keyframe sıra numarası. İlk kayıt her zaman 0'dır. */
  id: number;
  /**
   * Dönme — quaternion (x, y, z, w), SAĞ EL kuralı.
   * YÖN: kamera→dünya (`world_from_camera`). Bir kamera-uzayı noktası dünyaya
   * `p_world = R · p_cam + t` ile gider; poz zinciri (Gün 5) bu yöne göre
   * yazılır. Ters yön gerekiyorsa çağıran eşleniği alır — kayıt asla
   * `camera_from_world` tutmaz.
   */
  R: [number, number, number, number];
  /** Öteleme — metre, y-up. Kayıt zamanındaki kameranın DÜNYA konumu. */
  t: [number, number, number];
  /** Video zaman damgası — milisaniye. */
  timeMs: number;
  /**
   * Ölçek hizalamasının EĞİMİ: `d_metric ≈ scaleA · d_pred + scaleB` (Gün 4,
   * keyframe başına en küçük karelerle çözülür).
   */
  scaleA: number;
  /** Aynı hizalamanın KAYMASI (offset). İkisi birlikte hizalamayı geri kurar. */
  scaleB: number;
  /** Dikey görüş açısı — radyan (D.3: varsayılan 60° dikey). */
  fovY: number;
}

/** D.3 — intrinsik varsayımı: telefon FOV'u bilinmez, ParamDef'e girer. */
export interface CameraIntrinsics {
  fovYRad: number;
}

/** D.6 — akış noktası: Shi-Tomasi köşe + piramidal LK çıktısı. */
export interface FlowPoint {
  /** Kaynak karedeki x (piksel). */
  x: number;
  /** Kaynak karedeki y (piksel). */
  y: number;
  /** Yatay akış bileşeni (piksel). */
  u: number;
  /** Dikey akış bileşeni (piksel). */
  v: number;
  /** 1 = izlenebilir, 0 = oklüzyon/iz kaybı. */
  status: 0 | 1;
}

// ────────────────────────────────────────────────────────────────────────────
// D.5 — metrik rapor sözleşmesi (eval-out/report.json)
// ────────────────────────────────────────────────────────────────────────────

/** Rapor satırlarının hangi boru hattına ait olduğu. */
export type MetricColumn = 'depth' | 'seg' | 'pose' | 'timing';

/**
 * D.5 — ablasyon kolları (sabit YEDİ). Değer = kolun o çalışmadaki ayarı;
 * `null` ise kol o çalışmada UYGULANMADI (uygulama sırası beklemede) —
 * asılsız sayı üretilmez.
 *
 * Gün D/1: `edgeStrength` yedinci kol olarak sözleşmeye alındı. Gerekçe:
 * eval harness bu kolu gerçekten ölçüyor (işaretli mikro rölyef), rapor
 * `params` bloğu da onu taşıyor — şema dışı anahtar sessiz sapmadır.
 */
export interface AblationArms {
  ao: number | null;
  focusBoost: number | null;
  edgeStrength: number | null;
  letterbox_vs_distort: number | null;
  importanceSampling: number | null;
  depthSmoothing: number | null;
  foregroundStretch: number | null;
}

/** D.5 — tek metrik sonucu. value her zaman sayı; anlamı metric adında. */
export interface EvalResultRow {
  metric: string;
  value: number;
  dataset: string;
  split: string;
  column: MetricColumn;
}

/** D.5 — eval-out/report.json şeması. UI (metrik paneli) bu dosyayı okur. */
export interface EvalReport {
  run: string;
  date: string;
  commit: string;
  params: AblationArms;
  results: EvalResultRow[];
}

/** D.2 — vizyon modülünün ortak girişi: RGB veya luminance karesi. */
export interface VisionFrame {
  /** Ham luminance (0..1, satır 0 = üst) — depth boru hattının Node çekirdeği. */
  luminance: Float32Array;
  width: number;
  height: number;
}