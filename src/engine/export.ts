/**
 * EXPORT MODÜLÜ (Gün 6 — Emre).
 *
 * PNG export: canvas.toBlob — mevcut frame'i indirir.
 * WebM export: MediaRecorder + canvas.captureStream — belirli süre kaydeder.
 *
 * DİKKAT (düzeltildi): renderer `preserveDrawingBuffer` olmadan kurulu, yani
 * WebGL çizim tamponu tarayıcı kareyi kompozit ettikten SONRA geçersizdir.
 * "Senkron çağırıyoruz" yetmez — senkronluk tıklamaya göredir, çizime göre
 * değil; tıklama son kareden sonra gelir ve `toBlob` boş/şeffaf PNG verirdi.
 * Çözüm: `onBeforeCapture` ile yakalamadan hemen önce, aynı görevde bir kare
 * çizdirilir (App bunu `engine.renderFrame()` ile bağlar).
 *
 * WebM bu sorundan etkilenmez: `captureStream` kareleri kompozisyon anında
 * alır, tampon geçerliyken.
 */

/**
 * Canvas'ın o anki içeriğini PNG olarak indirir.
 * GÜN 6 (opt): scale > 1 → canvas yeniden çizilir (yüksek çözünürlük çıktı).
 */
export interface PNGExportOptions {
  /** 0 = orijinal boyut; 1..4 = ölçek (ör. 2 = 2x daha büyük kare). Varsayılan 0. */
  scale?: number;
  /**
   * Yakalamadan hemen ÖNCE, aynı görevde çağrılır — bir kare çizdirmek için.
   * Verilmezse `preserveDrawingBuffer` olmayan bir renderer'da çıktı boş olur.
   */
  onBeforeCapture?: () => void;
}

export async function exportPNG(
  canvas: HTMLCanvasElement,
  filename = 'spatial-canvas',
  opts: PNGExportOptions = {},
): Promise<void> {
  const scale = opts.scale ?? 0;
  // Tamponu tazele. Ölçekli yolda da ŞART: drawImage de aynı geçersiz
  // tampondan okur, yoksa büyütülmüş kopya da boş çıkar.
  opts.onBeforeCapture?.();
  if (scale > 1) {
    // Upscale: mevcut frame'i daha büyük canvas'a ölçekle. WebGL buffer'ı
    // önce okumak istemeyiz (sync) — canvas'ı yeniden çizeriz, video/point
    // cloud statik değilse pikselleşme böylece azalır.
    const big = document.createElement('canvas');
    big.width = Math.round(canvas.width * scale);
    big.height = Math.round(canvas.height * scale);
    const ctx = big.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, big.width, big.height);
    canvas = big as HTMLCanvasElement;
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('toBlob başarısız'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.png`;
      a.click();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
}

export interface WebMExportOptions {
  /** Kayıt süresi (saniye). Varsayılan 5. */
  durationSec?: number;
  /** Bit hızı (bps). Varsayılan 8_000_000 (8 Mbps). */
  videoBitsPerSecond?: number;
}

/**
 * Canvas akışını WebM olarak kaydeder ve indirir.
 * MediaRecorder desteklenmiyorsa hata fırlatır.
 */
export function exportWebM(
  canvas: HTMLCanvasElement,
  opts: WebMExportOptions = {},
): Promise<void> {
  const durationSec = opts.durationSec ?? 5;
  const videoBitsPerSecond = opts.videoBitsPerSecond ?? 8_000_000;

  if (typeof MediaRecorder === 'undefined') {
    return Promise.reject(new Error('MediaRecorder desteklenmiyor'));
  }
  if (!canvas.captureStream) {
    return Promise.reject(new Error('canvas.captureStream desteklenmiyor'));
  }

  const stream = canvas.captureStream(60);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve, reject) => {
    recorder.onerror = (e) => reject(new Error(`MediaRecorder: ${e.error?.message ?? 'bilinmeyen'}`));
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spatial-canvas-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      resolve();
    };
    recorder.start();
    setTimeout(() => recorder.stop(), durationSec * 1000);
  });
}

// ---------------------------------------------------------------------------
// GAUSS SPLAT DIŞA AKTARIMI (.ply) — E1
//
// NEDEN: ürettiğimiz sahne bugün uygulamanın içinde hapis. Standart 3DGS
// `.ply` yazınca SuperSplat, PlayCanvas ve diğer görüntüleyicilerde açılır;
// hem profesyonel kullanım hem paylaşım yolu açılır.
//
// KAYNAK: veri kopyası TUTULMAZ — GaussianBuffer texture'larının CPU tarafı
// (DataTexture.image.data) zaten elimizde, oradan okunur.
// ---------------------------------------------------------------------------

/**
 * Küresel harmoniklerin 0. derece katsayısı. 3DGS `.ply` rengi doğrudan RGB
 * değil, SH DC katsayısı olarak saklar: c = 0.5 + SH_C0 · f_dc.
 */
const SH_C0 = 0.28209479177387814;

/** Bizim splat (D.1): a=[xyz, opaklık] · b=[normal, ölçek] · c=[rgb, AO]. */
export interface SplatPlySource {
  a: Float32Array;
  b: Float32Array;
  /** 0..1 aralığında renk (texture'da RGBA8 olsa da burada normalize). */
  c: Float32Array | Uint8Array;
  count: number;
  /** Normal ekseninin yassılık oranı (shaders/splatMaterial · SPLAT_FLATTEN). */
  flatten: number;
}

/**
 * GaussianBuffer'ı ikili (binary little-endian) 3DGS `.ply`'ına çevirir.
 *
 * ── DEĞER DÖNÜŞÜMLERİ (format böyle istiyor, bizde ham hâlleri var) ────────
 * opaklık → logit        (görüntüleyici sigmoid uygular)
 * ölçek   → log          (görüntüleyici exp uygular)
 * renk    → SH DC        f_dc = (c − 0.5) / SH_C0
 * normal  → quaternion   Formatta yönelim quaternion'dur; bizde normal +
 *                        tek ölçek var. Shader'ın kurduğu dönmenin aynısı
 *                        yazılır: +z eksenini normale götüren dönme, ölçekler
 *                        (s, s, s·ε) — yani surfel yassılığı korunur.
 *
 * ── EKSEN ÇEVİRİMİ ────────────────────────────────────────────────────────
 * Bizim dünya three.js düzenindedir (y yukarı, kamera −z'ye bakar); 3DGS
 * ekosistemi COLMAP düzenini bekler. X ekseni etrafında 180° döndürülür:
 * konum ve normal (x, −y, −z) olur. Aksi hâlde sahne görüntüleyicide baş
 * aşağı açılır. Dönüşüm normale de uygulanır, yoksa yönelim konumla
 * tutarsız kalır.
 */
export function gaussiansToPly(src: SplatPlySource): Blob {
  const n = src.count;
  const FIELDS = 17; // x y z · nx ny nz · f_dc(3) · opacity · scale(3) · rot(4)
  const header =
    'ply\n' +
    'format binary_little_endian 1.0\n' +
    `element vertex ${n}\n` +
    'property float x\nproperty float y\nproperty float z\n' +
    'property float nx\nproperty float ny\nproperty float nz\n' +
    'property float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n' +
    'property float opacity\n' +
    'property float scale_0\nproperty float scale_1\nproperty float scale_2\n' +
    'property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n' +
    'end_header\n';

  const body = new Float32Array(n * FIELDS);
  const renkOlcek = src.c instanceof Uint8Array ? 1 / 255 : 1;

  for (let i = 0; i < n; i++) {
    const o4 = i * 4;
    const o = i * FIELDS;

    // Eksen çevirimi: X etrafında 180° (y ve z işaret değiştirir).
    const x = src.a[o4];
    const y = -src.a[o4 + 1];
    const z = -src.a[o4 + 2];
    let nx = src.b[o4];
    let ny = -src.b[o4 + 1];
    let nz = -src.b[o4 + 2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;

    // +z'yi normale götüren en kısa dönme. n ≈ (0,0,−1) dalı ayrı: orada
    // formül 0/0'a düşer, herhangi bir dik eksen etrafında 180° seçilir.
    let qw: number;
    let qx: number;
    let qy: number;
    let qz: number;
    if (nz < -0.999999) {
      qw = 0;
      qx = 1;
      qy = 0;
      qz = 0;
    } else {
      qw = 1 + nz;
      qx = -ny;
      qy = nx;
      qz = 0;
      const ql = Math.hypot(qw, qx, qy, qz) || 1;
      qw /= ql;
      qx /= ql;
      qy /= ql;
      qz /= ql;
    }

    // Opaklık logit'i: 0 ve 1 sonsuza gider, kelepçelenir.
    const a = Math.min(1 - 1e-6, Math.max(1e-6, src.a[o4 + 3]));
    const opacity = Math.log(a / (1 - a));

    // Ölçek: düzlem eksenleri s, normal ekseni s·ε (surfel). log olarak yazılır.
    const s = Math.max(1e-8, src.b[o4 + 3]);
    const sFlat = Math.max(1e-8, s * src.flatten);
    const logS = Math.log(s);
    const logSFlat = Math.log(sFlat);

    body[o] = x;
    body[o + 1] = y;
    body[o + 2] = z;
    body[o + 3] = nx;
    body[o + 4] = ny;
    body[o + 5] = nz;
    body[o + 6] = (src.c[o4] * renkOlcek - 0.5) / SH_C0;
    body[o + 7] = (src.c[o4 + 1] * renkOlcek - 0.5) / SH_C0;
    body[o + 8] = (src.c[o4 + 2] * renkOlcek - 0.5) / SH_C0;
    body[o + 9] = opacity;
    body[o + 10] = logS;
    body[o + 11] = logS;
    body[o + 12] = logSFlat;
    // INRIA sırası: rot_0 = w, sonra x, y, z.
    body[o + 13] = qw;
    body[o + 14] = qx;
    body[o + 15] = qy;
    body[o + 16] = qz;
  }

  return new Blob([new TextEncoder().encode(header), body.buffer], {
    type: 'application/octet-stream',
  });
}

/** `.ply` dosyasını indirir. Splat yoksa hata fırlatır — sessizce boş dosya
 *  indirmek kullanıcıya "oldu" der, olmamıştır. */
export function exportPly(src: SplatPlySource, filename = 'spatial-canvas'): void {
  if (src.count <= 0) throw new Error('exportPly: sahnede splat yok');
  const url = URL.createObjectURL(gaussiansToPly(src));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.ply`;
  a.click();
  URL.revokeObjectURL(url);
}
