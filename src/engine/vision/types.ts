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
  /**
   * E1.2 — poz kaynağı etiketi: bu kaydın pozunun nereden geldiği
   * ('essential' çözüm | 'donme-fallback' cheirality 0 | 'basarisiz' <8 eşleşme).
   * İlk kayıt (identity) için naif 'essential'. D6 teşhis/gate'lerinde okunur.
   */
  kaynak?: PoseKaynak;
  /** E1.2 — bu kayıt dejenere hareketten mi üretildi (cheirality 0). */
  dejenere?: boolean;
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

// ────────────────────────────────────────────────────────────────────────────
// E1.2 — YAKALAMA SÖZLEŞMELERİ. Bu commit'ten sonra types.ts SALT-OKUNURDUR;
// değişiklik yalnızca plan onayıyla yapılır. Alanlar "minimum"dur — yeni alan
// eklemek sözleşme bozmaz, ama kaldırmak/tiplendirmeyi değiştirmek bozar.
// ────────────────────────────────────────────────────────────────────────────

/** Derinlik sağlayıcı sözleşmesi: keyframe karesinden yoğun derinlik
 *  (Float32Array, satır 0 = üst) dönen ASENKRON işlev. D5'te MiDaS bağlanır;
 *  bugün video yolu `luminanceDepthProvider` (senkron) varsayılanını kullanır —
 *  D5 onu bu sözleşmeye saran asenkron bir provider ile değiştirir. */
export type DepthProvider = (frame: {
  timeMs: number;
  lum: Float32Array;
  rgb: Float32Array;
}) => Promise<Float32Array>;

/** Bir poz kaydının NEREDEN geldiği. */
export type PoseKaynak = 'essential' | 'donme-fallback' | 'basarisiz';

/** recoverPose başarı sözleşmesi. Başarısızlıkta null döner (F2 davranışı:
 *  cheirality 0 = dejenere — çöp poz üretilmez, çağıran dürüstçe işler). */
export interface PoseResult {
  /** Dönme — kamera→dünya, satır-öncelikli 3×3 (X_camB = R·X_camA + t). */
  R: Float32Array;
  /** Öteleme YÖNÜ (|t|=1 — essential matrix ölçek vermez, Gün 6'nın işi). */
  t: Float32Array;
  /** Başarılı çözüm her zaman 'essential'dır. */
  kaynak: PoseKaynak;
  /** Başarılı çözüm dejenere değildir. */
  dejenere: boolean;
  /** İçerdeki (inlier) eşleşme sayısı. */
  inlierSayisi: number;
  /** inlierSayisi / toplam eşleşme. */
  inlierOrani: number;
  /** Cheirality oyu (D6 gate'leri kullanır). */
  cheiralityVotes?: number;
  /** RANSAC içerdeki maskesi (inlierCount ile aynı uzunlukta). */
  inlierMask?: Uint8Array;
}

/** Ölçek hizalaması red gerekçeleri (D4'te gate'lere dönüşür). */
export type ScaleRed = 'baz-yok' | 'parallaks-yetersiz' | 'ucgenleme-yetersiz' | 'isin-acisi-dar';

/** Ölçek hizalaması kararı: gecerli (a·d_pred + b) ya da gecersiz + sebep. */
export type ScaleVerdict =
  | { durum: 'gecerli'; a: number; b: number; rmse: number; guven: number }
  | { durum: 'gecersiz'; sebep: ScaleRed };

/** Yakalama tanısı (E1.2'de naif 'iyi'; D6'da gate'lere bağlanır). */
export type Teshis = 'iyi' | 'doku-yetersiz' | 'parallaks-yok' | 'olcek-cozulemedi';

/** buildFusionScene çıktısındaki teşhis paketi — yakalamanın ne olduğunu
 *  sayılarla anlatır (D6 değerlendirme/gate paneli bunu okur). */
export interface CaptureDiagnostics {
  /** Yakalanan keyframe sayısı. */
  keyframeSayisi: number;
  /** Çift başına eşleşme sayısının medyanı (doku zenginliği vekili). */
  medyanEslesme: number;
  /** Pozu çözülebilen çiftlerin oranı (0..1; 0 çift yoksa 0). */
  pozBasariOrani: number;
  /** Çiftlerin kaynak dağılımı (essential | donme-fallback | basarisiz). */
  pozKaynakDagilimi: Record<PoseKaynak, number>;
  /** Tüm eşleşmelerin |akış| büyüklüğü medyanı (px) — parallaks vekili. */
  medyanParallaksPx: number;
  /** Çözülen çiftlerin ortalama |t|'si (ölçek YOK — birim baz uzunluğu). */
  bazUzunlugu: number;
  /** Ölçek hizalaması kararı (E1.2 naif: null → ucgenleme-yetersiz). */
  olcek: ScaleVerdict;
  /** Yakalama tanısı (E1.2 naif: 'iyi'). */
  teshis: Teshis;
  /**
   * E5.1 — d_pred'in NEREDEN geldiği. Sözleşmeye EKLENDİ (alan ekleme
   * sözleşme bozmaz; kaldırma/tip değiştirme bozar). 'luminance' değeri
   * "kaba derinlik" demektir: model yüklenemedi ya da DOM yok, parlaklık
   * vekil olarak kullanıldı — sessiz geri düşüş bırakılmaz, UI etiketleyebilir.
   */
  derinlikKaynagi?: 'midas' | 'luminance';
}