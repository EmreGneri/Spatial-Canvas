// E5.1 (Emre) — VİDEO DERİNLİK SAĞLAYICISI: luminance yerine MiDaS.
//
// NEDEN: video yolu bugüne kadar d_pred olarak PARLAKLIĞI kullanıyordu
// ("parlaklık = derinlik"). Açık renkli düz duvar "yakın", koyu bir yüz
// "uzak" çıkıyor — sahne fiziksel olarak yanlış. depth.ts'teki model
// (Depth Anything V2) fotoğraf yolunda zaten kullanılıyor; bu modül onu
// keyframe karelerine bağlar.
//
// SÖZLEŞME — d_pred DİSPARİTEDİR (büyük = yakın), mesafe DEĞİL.
// `estimateDepth` zaten "0 = uzak, 1 = yakın" normalize disparite veriyor ve
// füzyon (E5.4) uydurmayı TERS DERİNLİK uzayında yapıyor: 1/z = a·d + b.
// Bu yüzden burada dönüşüm YOK — model çıktısı doğrudan geçer.
//
// TARİHÇE (aynı hatayı tekrarlamamak için): ilk sürüm burada 1/d alıp
// [0,1]'e yeniden normalize ediyordu. İki sonucu oldu: (1) `out /= max`
// adımı, max uzak kırpmasından geldiği için tüm sahneyi aralığın dibine
// sıkıştırıp RÖLYEFİ EZDİ (video sahnesi düz panoya döndü); (2) uydurma
// mesafe uzayında kaldığı için MiDaS parlaklıkla aynı kalitede uydu
// (rmse/|a| ≈ 2.3 vs 1.95) ve eğim işareti koşudan koşuya döndü.
// Affine belirsizlik disparite uzayında yaşar — çözüm de orada olmalı.
import type { DepthProvider } from './types.ts';
import { KEYFRAME_HEIGHT, KEYFRAME_WIDTH, type KeyframeFrame } from './videoPipe.ts';

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
    if (res.width === width && res.height === height) return res.data;

    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const sy = Math.min(res.height - 1, Math.round((y * res.height) / height));
      for (let x = 0; x < width; x++) {
        const sx = Math.min(res.width - 1, Math.round((x * res.width) / width));
        out[y * width + x] = res.data[sy * res.width + sx];
      }
    }
    return out;
  };
}
