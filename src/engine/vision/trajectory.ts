/**
 * SENTETİK YÖRÜNGE ÜRETECİ (render şeridi — Zeynep, Gün 4 öğleden sonra).
 *
 * NEDEN RENDER ŞERİDİNDE: Emre'nin Gün 5 poz çözücüsü (essential matrix +
 * RANSAC) BİLİNEN bir doğruluk verisine karşı ölçülmeli, yoksa "sanırım
 * çalışıyor" seviyesinde kalır. Bilinen yörünge + o yörüngeden görülen sahne
 * bir RENDER problemidir; bu yüzden üreteç bu şeritte ve Gün 5'ten ÖNCE
 * teslim edilir (plan: "bu küçük iş Gün 5'te Emre'nin tıkanmasını engelliyor").
 *
 * ── SÖZLEŞME (ARCHITECTURE.md · D.2 PoseTrack) ─────────────────────────────
 * Üretilen pozlar `PoseTrackRecord` ile BİREBİR aynı yöndedir:
 * **kamera→dünya** (`world_from_camera`). `t` kameranın DÜNYA konumudur;
 * `R` (quat xyzw, sağ el) kamera eksenlerini dünyaya götürür. İlk keyframe
 * IDENTITY DEĞİLDİR — dünya orijini D.2 gereği ilk keyframe'dir, bu yüzden
 * `toFirstKeyframeOrigin` bütün zinciri ilk kareye göre yeniden çerçeveler.
 *
 * ── KAMERA KONVANSİYONU ────────────────────────────────────────────────────
 * Kamera −z'ye bakar, +y yukarıdır (three.js / OpenGL). `lookAt` bu üçlüyü
 * kurar; çözücü tarafı ters yön istiyorsa eşleniği kendisi alır (D.2 kuralı:
 * kayıt asla camera_from_world tutmaz).
 *
 * ── ÜRETİLEN VERİ ──────────────────────────────────────────────────────────
 * 1. `generateOrbitTrajectory` — bilinen kamera yörüngesi (yay + yükseklik
 *    salınımı; saf daire DEĞİL, çünkü saf daire dejenere bir hareket verir ve
 *    essential matrix'in ölçek/derinlik belirsizliğini gizler).
 * 2. `generatePointCloudScene` — deterministik 3B nokta bulutu (sahne).
 * 3. `projectScene` — her poz için noktaların GÖRÜNTÜ izdüşümleri +
 *    görünürlük bayrağı. Emre'nin akış/poz zinciri bunu ham gözlem gibi
 *    tüketebilir; gürültü `pixelNoise` ile eklenir (RANSAC'ın gerçekten
 *    çalıştığını görmek için).
 *
 * Görüntü RENDER EDİLMEZ (piksel üretilmez): poz çözücüsünün girdisi nokta
 * eşleşmeleridir, doku değil. Görsel kare gerekirse ayrı bir iş — bu fazda
 * kapsam dışı (dürüstlük kaydı).
 */

import type { PoseTrackRecord } from './types.ts';

/** D.3 varsayılanı: 60° dikey görüş açısı (radyan). */
export const DEFAULT_FOV_Y = (60 * Math.PI) / 180;

export interface TrajectoryOptions {
  /** Keyframe sayısı. Hedef kapsam 8–20 (ARCHITECTURE.md D.8). */
  count?: number;
  /** Yörünge yarıçapı (metre). */
  radius?: number;
  /** Taranan toplam yay (radyan). Tam tur DEĞİL — 120° tipik el kamerası. */
  arc?: number;
  /** Dikey salınım genliği (metre): saf daireyi dejenere olmaktan çıkarır. */
  rise?: number;
  /** Kameranın baktığı nokta (dünya). */
  target?: [number, number, number];
  /** Kare aralığı (ms) — timeMs alanı. */
  frameMs?: number;
  /** Dikey görüş açısı (radyan). */
  fovY?: number;
}

/** 3×3 dönmeyi quaternion'a (x, y, z, w) çevirir — Shepperd, kararlı dal. */
function matrixToQuat(m: number[]): [number, number, number, number] {
  // m satır-major 3×3: [m00 m01 m02 m10 m11 m12 m20 m21 m22]
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

/** Quaternion (xyzw) → satır-major 3×3. `matrixToQuat`'ın tersi. */
export function quatToMatrix(q: [number, number, number, number]): number[] {
  const [x, y, z, w] = q;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  return [
    1 - 2 * (yy + zz), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (xx + zz), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (xx + yy),
  ];
}

/**
 * `eye`'dan `target`'a bakan KAMERA→DÜNYA dönmesi (satır-major 3×3).
 * Kolonlar kamera eksenlerinin dünya karşılığıdır: [right, up, backward];
 * kamera −z'ye baktığı için üçüncü kolon `backward = eye − target` yönüdür.
 */
function lookAtRotation(
  eye: [number, number, number],
  target: [number, number, number],
  worldUp: [number, number, number] = [0, 1, 0],
): number[] {
  const bx = eye[0] - target[0];
  const by = eye[1] - target[1];
  const bz = eye[2] - target[2];
  const bl = Math.hypot(bx, by, bz) || 1;
  const f: [number, number, number] = [bx / bl, by / bl, bz / bl];
  // right = up × backward
  let rx = worldUp[1] * f[2] - worldUp[2] * f[1];
  let ry = worldUp[2] * f[0] - worldUp[0] * f[2];
  let rz = worldUp[0] * f[1] - worldUp[1] * f[0];
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  // up = backward × right (zaten dik, normalize gerekmez ama sayısal emniyet)
  const ux = f[1] * rz - f[2] * ry;
  const uy = f[2] * rx - f[0] * rz;
  const uz = f[0] * ry - f[1] * rx;
  // Kolonlar: right, up, backward → satır-major dizilim.
  return [rx, ux, f[0], ry, uy, f[1], rz, uz, f[2]];
}

/**
 * Bilinen yörünge: `target` etrafında `arc` kadar yay + dikey salınım.
 *
 * Saf daire BİLEREK kullanılmıyor: sabit yarıçaplı düz daire, essential
 * matrix çözümünde dejenere yapılandırmalara yakındır (tüm hareket tek
 * düzlemde) ve çözücünün gerçekten çalıştığını gizler. `rise` ile eklenen
 * dikey bileşen üç boyutlu parallaks üretir.
 */
export function generateOrbitTrajectory(opts: TrajectoryOptions = {}): PoseTrackRecord[] {
  const count = opts.count ?? 12;
  const radius = opts.radius ?? 2.5;
  const arc = opts.arc ?? (120 * Math.PI) / 180;
  const rise = opts.rise ?? 0.35;
  const target = opts.target ?? [0, 0, 0];
  const frameMs = opts.frameMs ?? 250;
  const fovY = opts.fovY ?? DEFAULT_FOV_Y;

  const out: PoseTrackRecord[] = [];
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    const angle = -arc / 2 + arc * t;
    const eye: [number, number, number] = [
      target[0] + radius * Math.sin(angle),
      target[1] + rise * Math.sin(2 * Math.PI * t),
      target[2] + radius * Math.cos(angle),
    ];
    const R = matrixToQuat(lookAtRotation(eye, target));
    out.push({
      id: i,
      R,
      t: eye,
      timeMs: i * frameMs,
      // Sentetik veri METRİKTİR: d_metric = 1·d_pred + 0 (hizalama kimliktir).
      // Emre'nin ölçek çözücüsü bunu geri bulmalı — kimlik, doğru cevaptır.
      scaleA: 1,
      scaleB: 0,
      fovY,
    });
  }
  return out;
}

/** İki quaternion'un çarpımı (xyzw): q = a ∘ b. */
function quatMul(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatConj(q: [number, number, number, number]): [number, number, number, number] {
  return [-q[0], -q[1], -q[2], q[3]];
}

function quatRotate(
  q: [number, number, number, number],
  v: [number, number, number],
): [number, number, number] {
  const m = quatToMatrix(q);
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * D.2: **dünya orijini = ilk keyframe.** Ham yörünge dünya çerçevesindedir;
 * bu fonksiyon zinciri ilk kareye göre yeniden çerçeveler — ilk kaydın R'si
 * identity, t'si sıfır olur. Emre'nin çözücüsü tam olarak bu çerçevede
 * sonuç üretir, karşılaştırma başka türlü elmayla armut olur.
 */
export function toFirstKeyframeOrigin(poses: PoseTrackRecord[]): PoseTrackRecord[] {
  if (poses.length === 0) return [];
  const R0 = poses[0].R;
  const t0 = poses[0].t;
  const R0inv = quatConj(R0);
  return poses.map((p) => {
    const dt: [number, number, number] = [p.t[0] - t0[0], p.t[1] - t0[1], p.t[2] - t0[2]];
    return {
      ...p,
      R: quatMul(R0inv, p.R),
      t: quatRotate(R0inv, dt),
    };
  });
}

/** Deterministik sözde-rastgele (mulberry32) — sahne her koşuda aynı. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sentetik sahne: küre kabuğu + iç hacim karışımı. Saf düzlem BİLEREK yok —
 * düzlemsel sahne essential matrix için dejeneredir (homografi yeter) ve
 * çözücünün cheirality kontrolünü hiç sınamaz.
 */
export function generatePointCloudScene(count = 600, extent = 1, seed = 0x51ce4e): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1;
    const phi = rnd() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    // Yarısı kabukta, yarısı iç hacimde → derinlik çeşitliliği.
    const r = extent * (i % 2 === 0 ? 1 : 0.25 + 0.7 * rnd());
    out[i * 3] = Math.cos(phi) * s * r;
    out[i * 3 + 1] = u * r;
    out[i * 3 + 2] = Math.sin(phi) * s * r;
  }
  return out;
}

export interface ProjectedFrame {
  /** Poz id'si (PoseTrackRecord.id ile aynı). */
  id: number;
  /** Nokta başına piksel x (görünmeyenlerde NaN). */
  x: Float32Array;
  /** Nokta başına piksel y (görünmeyenlerde NaN). */
  y: Float32Array;
  /** 1 = kamera önünde ve kadraj içinde, 0 = değil. */
  visible: Uint8Array;
}

/**
 * Sahneyi her poza izdüşürür (pinhole, D.3 fovY + verilen çözünürlük).
 *
 * `p_cam = Rᵀ · (p_world − t)` — kayıt kamera→dünya olduğu için TERSİ burada
 * alınır (D.2 kuralı: ters yön gerekirse çağıran eşleniği alır; bu fonksiyon
 * o çağırandır).
 *
 * `pixelNoise` > 0 ise izdüşüm gauss gürültüsüyle bozulur: RANSAC'ın gerçekten
 * aykırı ayıkladığını görmek için gerekli. Gürültü DETERMİNİSTİKTİR.
 */
export function projectScene(
  poses: PoseTrackRecord[],
  points: Float32Array,
  width: number,
  height: number,
  pixelNoise = 0,
  seed = 0x9e0,
): ProjectedFrame[] {
  const rnd = mulberry32(seed);
  const n = points.length / 3;
  return poses.map((pose) => {
    const m = quatToMatrix(pose.R); // kamera→dünya
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const visible = new Uint8Array(n);
    // fy = (h/2) / tan(fovY/2); fx = fy (kare piksel varsayımı).
    const fy = height / 2 / Math.tan(pose.fovY / 2);
    const fx = fy;
    for (let i = 0; i < n; i++) {
      const dx = points[i * 3] - pose.t[0];
      const dy = points[i * 3 + 1] - pose.t[1];
      const dz = points[i * 3 + 2] - pose.t[2];
      // Rᵀ · d (satır-major m'in TRANSPOZU: kolonlarla çarp)
      const cx = m[0] * dx + m[3] * dy + m[6] * dz;
      const cy = m[1] * dx + m[4] * dy + m[7] * dz;
      const cz = m[2] * dx + m[5] * dy + m[8] * dz;
      // Kamera −z'ye bakar: önde olmak cz < 0 demektir.
      if (cz >= -1e-6) {
        x[i] = NaN;
        y[i] = NaN;
        visible[i] = 0;
        continue;
      }
      let px = width / 2 + (fx * cx) / -cz;
      let py = height / 2 - (fy * cy) / -cz;
      if (pixelNoise > 0) {
        // Box-Muller (tek örnek yeter; ikinci değer atılır).
        const u1 = Math.max(1e-12, rnd());
        const u2 = rnd();
        const g = Math.sqrt(-2 * Math.log(u1));
        px += pixelNoise * g * Math.cos(2 * Math.PI * u2);
        py += pixelNoise * g * Math.sin(2 * Math.PI * u2);
      }
      x[i] = px;
      y[i] = py;
      visible[i] = px >= 0 && px < width && py >= 0 && py < height ? 1 : 0;
    }
    return { id: pose.id, x, y, visible };
  });
}
