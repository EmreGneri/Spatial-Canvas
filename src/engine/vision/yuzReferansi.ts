/**
 * YÜZ REFERANSI — MediaPipe Face Landmarker çıktısından geometrik referanslar.
 *
 * Bu modül SAF'tır: MediaPipe'ı import etmez, DOM'a dokunmaz — Node'daki
 * verify betikleri gerçek landmark fikstürleriyle (eval-out/yuz/*.json) ve
 * sentetik dizilerle çalıştırabilsin. Tarayıcı tarafı `yuzTespit.ts`'tedir.
 *
 * Koordinatlar NORMALİZE (0..1) görüntü uzayıdır, y aşağı. Derinlik haritası
 * letterbox dolgusu kırpılmış tam kadraj olduğu için (depth.ts · cropDepth)
 * depth pikseli = (x·w, y·h) — ayrıca dönüşüm gerekmez.
 *
 * Landmark indeksleri MediaPipe canonical face mesh'inden: 10/152/234/454
 * FACE_LANDMARKS_FACE_OVAL bağlantı listesinin uçları (paket bundle'ından
 * okundu; YUZ_OVAL_INDEKSLERI aynı liste), 1 = burun ucu.
 * `verify-yuz-referansi` [R2] gerçek fotoğrafta burun ucunun oval'in önünde
 * (z küçük = kameraya yakın) olduğunu doğrular — indeks varsayımı test altında.
 */
export interface Nokta2 {
  x: number;
  y: number;
}

export interface YuzReferansi {
  burun: Nokta2;
  cene: Nokta2;
  /** Oval'in en üst landmark'ı (alın çizgisi; saç/tepe DEĞİL). */
  alin: Nokta2;
  /** Görüntü uzayında SOLDAKİ yanak kenarı (x küçük) — indeks tarafına bağlı değil. */
  yanakSol: Nokta2;
  yanakSag: Nokta2;
  /** Yüz ovali bbox'ı (normalize). */
  oval: { x0: number; y0: number; x1: number; y1: number };
  /** yanakSag.x − yanakSol.x */
  yuzGenislik: number;
  /** cene.y − alin.y */
  yuzYukseklik: number;
  /**
   * Baş dönüşü (yaw) VEKİLİ: burun ucunun yanak orta noktasına göre yanal
   * ofseti / yarı yüz genişliği, [−1, 1]. 0 = tam karşıdan. Faz 1'de yalnız
   * ölçülür/loglanır, geometriye girmez (spec · Dürüst sınırlar).
   */
  yawOrani: number;
  landmarkSayisi: number;
}

export const LM_BURUN_UCU = 1;
export const LM_ALIN = 10;
export const LM_CENE = 152;
export const LM_YANAK_A = 234;
export const LM_YANAK_B = 454;

/** FACE_LANDMARKS_FACE_OVAL uç noktaları (36 indeks, saat yönünde, 10'dan başlar). */
export const YUZ_OVAL_INDEKSLERI: readonly number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

/** MediaPipe 468 (irissiz) veya 478 landmark döndürür; daha azı geçersiz. */
const MIN_LANDMARK = 468;

export function yuzReferansiKur(landmarks: readonly Nokta2[]): YuzReferansi | null {
  if (landmarks.length < MIN_LANDMARK) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const i of YUZ_OVAL_INDEKSLERI) {
    const p = landmarks[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const a = landmarks[LM_YANAK_A];
  const b = landmarks[LM_YANAK_B];
  // Sol/sağ GÖRÜNTÜYE göre: aynalı selfie'de indeks tarafı ters döner, x dönmez.
  const yanakSol = a.x <= b.x ? a : b;
  const yanakSag = a.x <= b.x ? b : a;
  const burun = landmarks[LM_BURUN_UCU];
  // burun oval listesinde değil, ayrıca kontrol edilir.
  if (!Number.isFinite(burun.x) || !Number.isFinite(burun.y)) return null;
  const cene = landmarks[LM_CENE];
  const alin = landmarks[LM_ALIN];
  const yuzGenislik = yanakSag.x - yanakSol.x;
  const yuzYukseklik = cene.y - alin.y;
  if (!(yuzGenislik > 0) || !(yuzYukseklik > 0)) return null;
  const yaw = (burun.x - (yanakSol.x + yanakSag.x) / 2) / (yuzGenislik / 2);
  return {
    burun: { x: burun.x, y: burun.y },
    cene: { x: cene.x, y: cene.y },
    alin: { x: alin.x, y: alin.y },
    yanakSol: { x: yanakSol.x, y: yanakSol.y },
    yanakSag: { x: yanakSag.x, y: yanakSag.y },
    oval: { x0, y0, x1, y1 },
    yuzGenislik,
    yuzYukseklik,
    yawOrani: Math.max(-1, Math.min(1, yaw)),
    landmarkSayisi: landmarks.length,
  };
}
