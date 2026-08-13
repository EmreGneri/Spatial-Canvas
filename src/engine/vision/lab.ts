// GÜN D/1 — sentetik lab sahnesi. Eval harness (scripts/eval.mjs) ve
// verify-eval.mjs bu sahnede mevcut video depth boru hattının çekirdeğini
// ölçer. Kesme sırası (D.7): gerçek veri kümesi metrikleri gelene kadar
// ground-truth sentetiktir — deterministik olması zorunlu (aynı girdi, aynı
// hesap; test doğrular).

export interface SyntheticLab {
  luminance: Float32Array;
  gtDepth: Float32Array;
  gtFg: Float32Array;
  width: number;
  height: number;
}

/** Sol yarı NET ön plan (2px şerit — yüksek gradyan enerjisi), sağ yarı FLU
 *  arka plan (aynı min/max [0.15, 0.85] ve aynı parlaklık ortalaması 0.5,
 *  düşük frekans sinüs — gradyan enerjisi ~0). GT derinlik: sol 0.85, sağ 0.3,
 *  keskin sınır x = W/2. İki yarının parlaklık istatistikleri aynı olduğu için
 *  parlaklık vekili çözüm ÜRETEMEZ; yalnızca netlik (defocus) ipucu ayırır —
 *  focusBoost kolunun kanıtı (focus kapalıyken AbsRel/IoU kötüdür). */
export function makeSyntheticLab(width = 128, height = 128): SyntheticLab {
  const n = width * height;
  const luminance = new Float32Array(n);
  const gtDepth = new Float32Array(n);
  const gtFg = new Float32Array(n);
  const mid = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const net = x < mid;
      luminance[i] = net
        ? Math.floor(x / 2) % 2 === 0
          ? 0.85
          : 0.15
        : 0.5 + 0.35 * Math.sin((2 * Math.PI * x) / 16);
      gtDepth[i] = net ? 0.85 : 0.3;
      gtFg[i] = net ? 1 : 0;
    }
  }
  return { luminance, gtDepth, gtFg, width, height };
}