// E5.1 (Emre) — VİDEO DERİNLİK SAĞLAYICISI: luminance yerine MiDaS.
//
// NEDEN: video yolu bugüne kadar d_pred olarak PARLAKLIĞI kullanıyordu
// ("parlaklık = derinlik"). Açık renkli düz duvar "yakın", koyu bir yüz
// "uzak" çıkıyor — sahne fiziksel olarak yanlış. depth.ts'teki model
// (Depth Anything V2) fotoğraf yolunda zaten kullanılıyor; bu modül onu
// keyframe karelerine bağlar.
//
// KRİTİK DÖNÜŞÜM — DISPARITE ≠ MESAFE. `estimateDepth` sözleşmesi
// "0 = uzak, 1 = yakın" normalize DISPARITE verir. Füzyon ise d_pred'i
// MESAFE gibi kullanır: `fitScaleAlignment` d_metric ≈ a·d_pred + b uydurur
// ve scale.ts pozitif eğim bekler (negatif eğim → guven 0). Mesafe
// disparitenin TERSİDİR (metrik ≈ c/disparite); affine uydurma bir ters
// alma işlemini telafi EDEMEZ. Bu yüzden burada 1/d dönüşümü yapılır —
// yapılmazsa uydurma monoton ama sistematik olarak yanlış olurdu.
//
// UZAK KIRPMASI: normalize dispariteде 0'a yakın değerler (gökyüzü, çok
// uzak yüzey) 1/d'yi patlatır. Taban, verinin kendi ALT YÜZDELİĞİNDEN
// alınır (sabit eşik sahneye göre yanlış olurdu) — sonsuz yerine sonlu ve
// sahneye uyarlanmış bir "en uzak" değeri.
import type { DepthProvider } from './types.ts';
import { KEYFRAME_HEIGHT, KEYFRAME_WIDTH, type KeyframeFrame } from './videoPipe.ts';

/** Uzak kırpması için kullanılan alt yüzdelik (0..1). */
export const DISPARITY_FLOOR_PCT = 0.02;

/**
 * Normalize DİSPARİTEYİ (0 = uzak, 1 = yakın) mesafe-orantılı, [0,1]'e
 * ölçeklenmiş bir alana çevirir — SAF fonksiyon (model yok, test edilebilir).
 *
 * Çıktı MUTLAK metrik değildir; füzyondaki affine hizalama metriğe taşır.
 * Tek gereken monoton ARTAN olması (uzak → büyük) ve sonlu kalması.
 */
export function disparityToDistance(disparity: Float32Array): Float32Array {
  const n = disparity.length;
  const out = new Float32Array(n);
  if (n === 0) return out;

  // Alt yüzdelik: sıralama yerine kopya + sort (n ≈ 110k, tek sefer, yeterli).
  const sorted = Float32Array.from(disparity).sort();
  const floorIdx = Math.min(n - 1, Math.max(0, Math.floor(n * DISPARITY_FLOOR_PCT)));
  // Taban 0 olamaz (bölme patlar); veri tamamen 0 ise küçük bir sabite düş.
  const floor = Math.max(sorted[floorIdx], 1e-3);

  let max = 0;
  for (let i = 0; i < n; i++) {
    const d = 1 / Math.max(disparity[i], floor);
    out[i] = d;
    if (d > max) max = d;
  }
  // [0,1]'e ölçekle — luminance yolunun d_pred aralığıyla aynı büyüklük
  // mertebesinde kalsın (scale.ts'in guven formülü |a| aralığına bakıyor).
  if (max > 0) {
    for (let i = 0; i < n; i++) out[i] /= max;
  }
  return out;
}

/**
 * MiDaS destekli `DepthProvider`. Tek canvas yeniden kullanılır (kare başına
 * yalnız piksel yazımı + model çağrısı ayrılır).
 *
 * `estimateDepth` kaynak canvas boyutundan farklı bir ızgara dönerse en yakın
 * komşuyla keyframe ızgarasına indirgenir — füzyon d_pred'i keyframe piksel
 * koordinatıyla okur, boyut uyuşmazlığı sessiz kaymaya dönerdi.
 */
export function createMidasDepthProvider(
  width = KEYFRAME_WIDTH,
  height = KEYFRAME_HEIGHT,
): DepthProvider {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.createImageData(width, height);

  return async (frame: KeyframeFrame): Promise<Float32Array> => {
    const px = image.data;
    for (let k = 0, c = 0, p = 0; k < width * height; k++, c += 3, p += 4) {
      px[p] = Math.round(frame.rgb[c] * 255);
      px[p + 1] = Math.round(frame.rgb[c + 1] * 255);
      px[p + 2] = Math.round(frame.rgb[c + 2] * 255);
      px[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    // Dinamik import: model yükü YALNIZ video derinliği gerçekten istenince
    // ödenir (suite ve fotoğraf-only oturumlar bu maliyeti görmez).
    const { estimateDepth } = await import('../../depth.ts');
    const res = await estimateDepth(canvas);
    const dist = disparityToDistance(res.data);
    if (res.width === width && res.height === height) return dist;

    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const sy = Math.min(res.height - 1, Math.round((y * res.height) / height));
      for (let x = 0; x < width; x++) {
        const sx = Math.min(res.width - 1, Math.round((x * res.width) / width));
        out[y * width + x] = dist[sy * res.width + sx];
      }
    }
    return out;
  };
}
