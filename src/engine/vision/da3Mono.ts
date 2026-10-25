// Depth Anything 3 (DA3Mono-Large, Apache-2.0) için saf ön/son işleme.
//
// V2'den FARKI (V3'ün ilk denemesinin kötü çıkmasının kodla doğrulanan sebebi):
//  - V2 göreli DİSPARİTE verir (yakın = büyük). DA3 DERİNLİK verir (yakın = küçük).
//    Hattın tamamı (germe, yakın-kuyruk kıskacı, eşikler) V2'nin disparite
//    karakterine göre ayarlı; ham DA3 verilirse yön ters ya da dağılım yanlış olur.
//  - Doğrusal -derinlik washed-out kalır; SAF 1/derinlik ise yakın kuyruğu aşırı
//    uzatır (ölçüm, 6 gerçek fotoğraf, p1–p99 normalize sonrası: çarpıklık
//    (p90-p50)/(p50-p10) 1.0–9.0 ve medyan 0.05–0.44; V2'de 0.4–4.8 ve 0.17–0.56).
//    Bu kuyruk germe/kıskaç eşiklerini bozar ve özneyi 3B'de düzleştirir.
//    Çözüm 1/(d + k·medyan(d)): sıralama değişmez (Spearman aynı, V2 ile 0.89–0.95),
//    dağılım V2 aralığına iner (k=0.5: çarpıklık 0.6–3.4, medyan 0.23–0.57).
//  - Model ayrıca bir gökyüzü olasılığı verir; gökyüzü derinliği uç değerlere
//    savrulur, bu yüzden disparite hesabında en uzak seviyeye sabitlenir.

export const DA3_MEAN = [0.485, 0.456, 0.406] as const;
export const DA3_STD = [0.229, 0.224, 0.225] as const;
export const DA3_PATCH = 14;
export const SKY_THRESHOLD = 0.5;
/** Disparite kayması: 1/(d + SHIFT_K·medyan(d)). Ölçekten bağımsız (göreli derinlik). */
export const SHIFT_K = 0.5;

/** RGBA (canvas/RawImage) -> CHW float32, ImageNet normalizasyonu. */
export function da3Preprocess(rgba: ArrayLike<number>, w: number, h: number, channels = 4): Float32Array {
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = (rgba[i * channels + c] / 255 - DA3_MEAN[c]) / DA3_STD[c];
  }
  return out;
}

/** Piksellerin `p`. yüzdeliği (sıralamasız histogramla değil, kopya sıralamayla; küçük diziler için). */
function percentile(a: Float32Array, p: number): number {
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)))];
}

/** Kayma tam model karesinde hesaplanır; letterbox kırpımından sonra medyan değişir. */
export function da3DisparityShift(depth: Float32Array, shiftK = SHIFT_K): number {
  return shiftK > 0 ? shiftK * percentile(depth, 50) : 0;
}

/**
 * DA3 derinliği (+ gökyüzü olasılığı) -> V2 benzeri göreli disparite.
 * Yakın = büyük. Çıktının ölçeği keyfidir; çağıran `normalizeDepth` uygular.
 * `sky` verilmezse gökyüzü işlenmez.
 *
 * `shiftK`: fotoğraf yolu için 0.5 (görsel dağılımı V2'ye yaklaştırır). SfM'e afin
 * hizalanan yollar (`1/z = a·d + b`) 0 vermeli: kayma ters-derinlikle afin ilişkiyi bozar.
 */
export function da3ToDisparity(depth: Float32Array, sky?: Float32Array | null, shiftK = SHIFT_K): Float32Array {
  // Yakın uçta 1/d patlamasın: %0,5'lik yüzdeliğin altı sabitlenir.
  const floor = Math.max(1e-3, percentile(depth, 0.5));
  const shift = da3DisparityShift(depth, shiftK);
  const out = new Float32Array(depth.length);
  let minNonSky = Infinity;
  for (let i = 0; i < depth.length; i++) {
    out[i] = 1 / (Math.max(depth[i], floor) + shift);
    if (!(sky && sky[i] > SKY_THRESHOLD) && out[i] < minNonSky) minNonSky = out[i];
  }
  if (sky && Number.isFinite(minNonSky)) {
    for (let i = 0; i < out.length; i++) if (sky[i] > SKY_THRESHOLD) out[i] = minNonSky;
  }
  return out;
}

/**
 * Çıktı makul mu? Dağıtılmış/bozuk indirme, yanlış girdi ya da WebGPU hatası
 * NaN/sabit/tamamen-gökyüzü çıktı verirse V2'ye düşülür (sonuç ASLA daha kötü olmasın).
 */
export function da3Plausible(depth: Float32Array, sky?: Float32Array | null): boolean {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of depth) {
    if (!Number.isFinite(v)) return false;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (!(mn > 0) || !(mx > mn * 1.2)) return false;
  if (sky) {
    let n = 0;
    for (const v of sky) if (v > SKY_THRESHOLD) n++;
    if (n / sky.length > 0.9) return false;
  }
  return true;
}
