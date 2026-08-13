/**
 * PARÇACIK SAMPLER (veri katmanı, CPU).
 *
 * Önceki turun %60/%25/%15 bütçe ayırması (ön/arka yüz + duvar) 384×384
 * ızgarasından sırayla satır/indeks çaldığı için GPGPU parçacık mimarisinde
 * ön yüzeyde yatay boşluklar ve yırtılmalar oluşuyordu — 2B grid uzamsal
 * olarak bölünemez. Bütçe ayırma tamamen kaldırıldı: 147.456 parçacığın
 * TAMAMI ön yüzeyde 1:1 kesintisiz grid olarak örneklenir (her texel kendi
 * grid konumunda, aUv sürekliliği bozulmaz, hiçbir piksel/satır sökülmez).
 *
 * Derinlik detayı depth.ts'te üretilir (ROI stretch + Sobel kabartma); bu
 * modül yalnızca grid'i örnekler:
 *   z = (d − 0.5)·range + kavis + kenar dökümü.
 * Kavis EVRENSELDİR (subject-agnostic): Z_kavis = α · sqrt(max(0, 1 − R²)) ·
 * w_fg — elipsoit, dünya merkezine oturur ve ön plan maskesiyle (w_fg)
 * sınırlanır; kafa/insan varsayımı yoktur, her tür özne (nesne, araç,
 * manzara) aynı yüzey kavisleştirmesini alır. Yandan bakıldığında tek
 * katman hissini azaltmak için siluet SINIRININ (boundaryDistance haritası)
 * iç bandındaki parçacıklar EDGE_WALL_Z'ye yumuşak lerp ile arkaya DÖKÜLÜR —
 * ∂M'den içeri gittikçe azalan kademeli dolgu; merkezden dışa elipsoidal
 * sönümlemeyle arkada dik kutu değil oval kaide oluşur. Kadraj (grid)
 * kenarları sınır DEĞİLDİR: çerçevenin kestiği siluet düz kalır, prizma
 * duvarı oluşmaz (silhouette.ts kararı).
 *
 * GPU transferi yapmaz; çıktı N×4 xyzα'dır: w kanalı texel sahibinin tohumu
 * değil, İKİ SEVİYELİ OPAKLIKTIR (Tur 11: w = 1 ön plan, w = BACKDROP_OPACITY
 * arka plan — 0 yoktur, her texel nokta taşır). α, depth değerinden değil
 * GEOMETRİK SİLUETTEN gelir
 * (silhouette.ts: delik doldurma + bileşen analizi + sert binary maske) —
 * yüzdeki koyu gölgeler/siyah saç siluet içinde kaldıkça α = 0 yapılmaz.
 *  TUR 9 (TARİHÇE — Tur 11'de AŞILDI): arka plan pikselleri için nokta
 *  üretilmezdi; maske = 0 texel ölüydü: (x, y, 0, 0), depth/kavis/döküm
 *  hesabı atlanırdı; siluet sınırı sert bıçak kesimiydi.
 *  TUR 10: (a) İNCE KABUK — en dış siluet pikselleri ön yüzlerinin en az
 *  THIN_SHELL_Z (0.05) arkasına düşer; profil açısında kağıt inceliğinde iç
 *  boşluk görünmez. (b) 2-KATMANLI MİMARİ — oklüzyon deliğini (öznenin
 *  arkasındaki boşluk) doldurmak için AYRI arka plan katmanı üretilir
 *  (sampleBackdropPositions): siluet bölgesi, çevredeki gerçek arka plandan
 *  push-pull inpaint edilmiş duvar derinliğinde BACKDROP_OPACITY (0.4) ile
 *  noktalar taşır; yana dönüşte zifiri siyah boşluk yerine yumuşak duvar
 *  devamı görünür. Ön plan sert binary sözleşmesi DEĞİŞMEZ — katman ayrı
 *  texture'da yaşar.
 *  TUR 11 (tek buffer): 2-katmanlı mimari KALDIRILDI. Maske = 0 texel artık
 *  ÖLÜ DEĞİLDİR — her texel nokta taşır: siluet içi ön plan (w = 1, kendi
 *  derinliği/kavisi), siluet dışı ARKA PLAN noktası (w = BACKDROP_OPACITY,
 *  gerçek arka plan derinliği, sabit BACKDROP_Z_PIN arkada). Ayrı backdrop
 *  texture'ı, render'da material/uPositions takası ve BACKDROP_Z_PUSH ile
 *  oynamak ortadan kalktı: fg + bg TEK GPGPU buffer'ında yaşar, render tek
 *  draw call'dır. Arka plan texel'leri fotoğrafın GERÇEK arka plan
 *  pikselleri olduğu için inpaint'e gerek yoktur — renkler uImageTexture
 *  (sampleImageGrid) ile aynı remap üzerinden fotoğraftan gelir; öznenin
 *  arkasındaki boşluk ön plan kabuğu (kenar dökümü + ince kabuk) ve sabit
 *  arka plan düzlemi tarafından kapanır.
 * Boyut/karakter jitter'ı için tohum üretimi render shader'larına
 * aUv hash'i olarak taşındı (pointCloudMaterial.ts, asciiMaterial.ts).
 * Sözleşmeler (ARCHITECTURE.md): aUv grid, y-flip (yalnızca upload'da),
 * z ∈ [-1, +1].
 */

import { buildSilhouette } from './silhouette.ts';

export const VOLUME_GRID_SIZE = 384;

/**
 * Kenar dökümü hedef z'si: siluet sınırındaki band arkaya doğru çekilir
 * (yan bakışta ön yüzeyin arkasındaki boşluk yerine dolu kütle görünür).
 */
export const EDGE_WALL_Z = -0.8;

/**
 * İnce kabuk (Tur 10): en dış siluet pikselleri ön yüzlerinin (döküm öncesi
 * z) en az bu kadar ARKASINA düşer — profil açısında kağıt inceliğinde iç
 * boşluk görünmez. Kadraj kenarı sönümü dökümü zayıflatan bölgelerde bile
 * kabuk garantilidir.
 */
export const THIN_SHELL_Z = 0.05;
/** İnce kabuk bandı: siluet sınırına bu kadar yakın (piksel) pikseller kabuğa girer. */
const THIN_SHELL_PX = 3;

/**
 * Arka plan noktası opaklığı (Tur 11 — tek buffer): siluet DIŞINDAKİ her
 * texel bir arka plan noktası taşır (w = BACKDROP_OPACITY). Ön plan (1.0)
 * ile aynı grid'de, aynı texture'da yaşar; render shader'ı w'yi alpha
 * çarpanı yapar. 0.4 = duvar belirgin ama öznenin önüne geçmez.
 */
export const BACKDROP_OPACITY = 0.4;
/**
 * Arka plan düzlemi sabiti (Tur 11): arka plan noktalarının z'si
 * (d − 0.5)·range − BACKDROP_Z_PIN olarak SABİTLENİR — duvar, ön plan
 * kabuğunun kenar dökümüyle aynı z düzlemine düşüp parıldamasın diye tüm
 * grid için arka sınıra sabit mesafede tutulur. Ayar kolu DEĞİLDİR (Tur 11
 * kararı): katmanlar tek buffer'da olduğundan z uyumsuzluğu kaynağı yoktur.
 */
const BACKDROP_Z_PIN = 0.15;

/**
 * Kenar dökümü yarıçapı (siluet bbox yarı eksenlerinin min'ine oran):
 * d1 = BACK_FILL_DEPTH · min(rx, ry) içindeki parçacıklar sınıra yaklaştıkça
 * arkaya dökülür; sınırın ötesinde kalan gövde içi (yüz, alın) dokunulmaz.
 */
const BACK_FILL_DEPTH = 0.35;

const DEFAULT_WORLD_HEIGHT = 2;
const DEFAULT_DEPTH_RANGE = 2;
const DEFAULT_CURVATURE = 0.1;
/**
 * Oval kaide sönümü: arka dökümün gücü figürün ağırlık merkezinden dışarı
 * doğru elipsoidal sönümlenir — merkezde tam, kenarlara doğru BUST_ROUND
 * oranında sığlaşır (dik kutu duvarı yerine oval kaide).
 */
const BUST_ROUND = 0.5;
/** Elipsoidal sönümün başladığı normalize mesafe (bbox yarı ekseni cinsinden). */
const BUST_FADE_LO = 0.55;
/** Elipsoidal sönümün tamamlandığı normalize mesafe. */
const BUST_FADE_HI = 1.15;
/** Sönümde dikey bileşenin ağırlığı: üst/alt kenarlar yanlardan önce sığlaşır. */
const BUST_VERT_WEIGHT = 0.65;

/** Ön plan maskesi (kavis eşiği): w_fg = smoothstep(0.2, 0.7, depth). */
const FG_MASK_NEAR = 0.2;
const FG_MASK_FAR = 0.7;

/**
 * Önem tabanlı örnekleme güvenlik sınırları: arka plan yoğunluğu ortalamanın
 * %15'inin altına düşmez, ön plan (yüz) yoğunluğu standart gridin en fazla
 * 2.5 katı olur (buffers.ts'teki SAMPLE_MIN/MAX_DENSITY ile aynı değerler).
 */
const SAMPLE_MIN_DENSITY = 0.15;
const SAMPLE_MAX_DENSITY = 2.5;

/**
 * Fg maskesi (segmentation) önem ağırlığı (Gün B): depth+center+contrast
 * formülüne maskenin kattığı ek terim. Maske = 1 ön plan bölgesi → +0.4
 * önem — "yüz/ön plan" garantisi; duvara yapışık özne veya derinlik
 * ayrımı yapan arka plan maskenin güveniyle yoğunlaşır. Yoğunluk ortalama
 * normalizasyonu + SAMPLE_MIN/MAX_DENSITY clamp'ı arkasından geçtiği için
 * skala güvenlidir.
 */
const FG_IMPORTANCE_WEIGHT = 0.4;

export interface VolumeSampleOptions {
  /** Grid boyutu (kare). Varsayılan 384. */
  gridSize?: number;
  /** Bulut dünya yüksekliği. Varsayılan 2 (POINTS_WORLD_HEIGHT). */
  worldHeight?: number;
  /** z aralığı (POINTS_DEPTH_RANGE). Varsayılan 2. */
  depthRange?: number;
  /** Elipsoit kavis şiddeti (α). 0 = düz. Varsayılan 0.1. */
  curvature?: number;
  /**
   * Ön plan nesne maskesi (0..1, depth ile aynı çözünürlük/boyut): siluete
   * AND edilir — yalnızca maske ≥ 0.5 olan pikseller ön plan adayıdır.
   * Opsiyonel (segmentation.ts çıktısı).
   */
  foregroundMask?: Float32Array;
  /** Önem tabanlı örnekleme (sadece örnekleme koordinatını büker, grid sürekliliği bozulmaz). Varsayılan açık. */
  importanceSampling?: boolean;
}

/**
 * Depth haritasından 3B parçacık konumlarını üretir. Çıktı: N×4 Float32Array
 * (parçacık başına x, y, z, α). Grid 1:1 kesintisizdir: texel (i,j)'nin xy'si
 * kendi grid konumudur; önem remap'i yalnızca hangi depth pikselinin
 * örneklendiğini büker.
 *
 * w kanalı (α): GEOMETRİK siluetten (silhouette.ts) örneklenen SERT BINARY
 * opaklık — delik doldurma sonrası siluet içi 1, dışı tam 0. Arka plan
 * texel'leri ÖLÜ DEĞİLDİR (Tur 11): siluet dışı her texel, gerçek arka
 * plan derinliğinde BACKDROP_Z_PIN arkada ve BACKDROP_OPACITY opaklıkla
 * bir nokta taşır — tek buffer, render tek draw call.
 */
export function sampleVolumePositions(
  depth: Float32Array,
  depthWidth: number,
  depthHeight: number,
  opts: VolumeSampleOptions = {},
): Float32Array {
  const grid = opts.gridSize ?? VOLUME_GRID_SIZE;
  const n = grid * grid;
  const halfH = (opts.worldHeight ?? DEFAULT_WORLD_HEIGHT) / 2;
  const halfW = (depthWidth / depthHeight) * halfH;
  const range = opts.depthRange ?? DEFAULT_DEPTH_RANGE;
  const curvature = opts.curvature ?? DEFAULT_CURVATURE;
  const out = new Float32Array(n * 4);
  const remap =
    opts.importanceSampling === false
      ? null
      : buildImportanceRemap(depth, depthWidth, depthHeight, opts.foregroundMask ?? null);
  // Siluet: delik doldurma + gradyan kesme + bileşen analizi + satır dolgusu
  // + SERT BINARY alpha/isForeground (Tur 9) ve siluet sınırına mesafe (dist).
  // α hem opaklık hem kavis maskesi; dist kenar dökümünü besler. Opsiyonel
  // nesne maskesi (segmentation.ts) siluete AND edilir — subject-agnostic ön
  // plan izolasyonu; maske < 0.5 arka plan hiçbir geometri kuralıyla ön plana
  // diriltilemez (perde/çanak oluşmaz).
  const { alpha, dist } = buildSilhouette(
    depth,
    depthWidth,
    depthHeight,
    opts.foregroundMask ?? null,
  );
  // Kaide geometrisi: siluetin ağırlık merkezi + yarı eksenleri (döküm
  // sönümünün merkezi) her görüntü için siluet geometrisinden hesaplanır —
  // özne neredeyse oraya oturur, önceden sabitlenmiş UV yok. Kafa/insan
  // varsayımı YOKTUR: aynı hesaplama her özne şekline uygulanır.
  const body = computeBodyGeometry(alpha, depthWidth, depthHeight, halfH);
  const d1 = body ? BACK_FILL_DEPTH * Math.min(body.rx, body.ry) : 0;

  for (let j = 0; j < grid; j++) {
    const v = 1 - (j + 0.5) / grid;
    // Önem remap'i örnekleme KOORDİNATINI büker; grid ve aUv sözleşmesi aynı
    // kalır. t = (j+0.5)/N: yukarıdan aşağı, CDF de o yönde kurulur.
    const t = (j + 0.5) / grid;
    const y = remap ? remap.yOf(t) - 0.5 : t * depthHeight - 0.5;
    const ry = (v - 0.5) * 2;
    for (let i = 0; i < grid; i++) {
      const u = (i + 0.5) / grid;
      const x = remap ? remap.xOf(u) - 0.5 : u * depthWidth - 0.5;
      const o = (j * grid + i) * 4;
      const wx = (u - 0.5) * 2 * halfW;
      const wy = (v - 0.5) * halfH * 2;
      out[o] = wx;
      out[o + 1] = wy;
      // SERT BINARY ön plan kapısı (Tur 9): bilinear örnekleme + 0.5 eşiği —
      // çıktı {0, 1}; siluet sınırındaki alt-piksel kesişimleri temiz kesilir.
      const a = sampleBilinear(alpha, depthWidth, depthHeight, x, y) >= 0.5 ? 1 : 0;
      if (a < 0.5) {
        // TUR 11 (tek buffer): arka plan texel'i ÖLÜ DEĞİLDİR. Gerçek arka
        // plan derinliğinde, BACKDROP_Z_PIN arkada, BACKDROP_OPACITY ile bir
        // nokta taşır — fotoğrafın kendi arka planı (duvar/zemin), öznenin
        // önüne geçmeyecek opaklıkta. Kavis/döküm/kabuk hesabı yapılmaz
        // (düz duvar); z yine [-1, +1] sözleşmesine kırpılır.
        const d = sampleBilinear(depth, depthWidth, depthHeight, x, y);
        out[o + 2] = Math.min(1, Math.max(-1, (d - 0.5) * range - BACKDROP_Z_PIN));
        out[o + 3] = BACKDROP_OPACITY;
        continue;
      }
      const d = sampleBilinear(depth, depthWidth, depthHeight, x, y);
      // Depth terimi: (d − 0.5)·range — z aralığı sabit sözleşme
      // (POINTS_DEPTH_RANGE = 2, dünya z ∈ [−1, +1]).
      let z = (d - 0.5) * range;
      // Ön plan maskesi: depth arttıkça kavis güçlenir, arka plan düz kalır.
      const wFg = smoothstep(FG_MASK_NEAR, FG_MASK_FAR, d);
      if (curvature > 0) {
        // Z_kavis = α · sqrt(max(0, 1 − R²)) · w_fg. Elipsoit merkezi (0,0)
        // (dünya merkezi), yarı eksenler halfW/halfH; R dünya koordinatında
        // normalize edilir. EVRENSEL formül: insan varsayımı yoktur, her özne
        // (nesne, araç, manzara) aynı yüzey kavisleştirmesini alır.
        const rx = (u - 0.5) * 2;
        const r2 = rx * rx + ry * ry;
        z += curvature * Math.sqrt(Math.max(0, 1 - r2)) * wFg;
      }
      // İnce kabuk (Tur 10): kabuk ön yüzün (döküm öncesi z) en az
      // THIN_SHELL_Z ARKASINA iner — kenar dökümü buna eklenir.
      const zFront = z;
      // Siluet sınırına mesafe (piksel): kenar dökümü ve ince kabuk ortak
      // kullanır (dist haritası; kadrajı dolduran ön plan içi INF kalır).
      const dPx = body ? sampleBilinear(dist, depthWidth, depthHeight, x, y) : 0;
      // Kenar dökümü (oval backing): siluet SINIRINA mesafeye (dist)
      // bağlı olarak z arkaya bükülür — sınırda hedefe tam döküm, d1'e
      // ulaşınca etkisiz. Sabit kutu sınırı yerine döküm gücü figürün ağırlık
      // merkezinden dışarı doğru elipsoidal sönümlenir (dikey bileşen daha
      // güçlü: üst/alt kenarlar yanlardan önce sığlaşır) — arkada dik açılı
      // prizma değil, oval kaide oluşur; iç bölgeler ve görünmez arka plan
      // (α = 0) dokunulmaz.
      if (body && d1 > 0 && a > 0.001) {
        const dW = (dPx / depthWidth) * 2 * halfW;
        const fill = 1 - Math.min(1, dW / d1);
        if (fill > 0) {
          const dxE = (wx - body.cx) / body.rx;
          const dyE = (wy - body.cy) / body.ry;
          const round =
            1 -
            BUST_ROUND *
              (BUST_VERT_WEIGHT * smoothstep(BUST_FADE_LO, BUST_FADE_HI, Math.abs(dyE)) +
                (1 - BUST_VERT_WEIGHT) * smoothstep(BUST_FADE_LO, BUST_FADE_HI, Math.abs(dxE)));
          // Hunileşmeyi engelle: fill'e smoothstep + sönüm çarpanı — döküm
          // z'yi aniden EDGE_WALL_Z'ye çekmez; lineer dikleşme yerine kenara
          // doğru yumuşayan kademe uygulanır (maks güç 0.35·).
          // Kadraj kenar sönümü: grid kenarlarına (u/v ≈ 0 veya 1) yapışık
          // piksellerde döküm gücü sıfırlanır — çerçeve boyunca kare prizma
          // duvarı oluşmaz; siluet bbox'ı kadrajın içindeyse döküm tam güçle
          // devam eder.
          const edgeFade = Math.min(u, Math.min(1 - u, Math.min(v, 1 - v))) * 4.0;
          const edgeFactor = Math.min(1.0, edgeFade);
          const fillSmooth = smoothstep(0, 1, fill) * 0.35 * edgeFactor;
          z += (EDGE_WALL_Z - z) * fillSmooth * round;
        }
      }
      // THIN SHELL (Tur 10): en dış siluet pikselleri (dist ≤ THIN_SHELL_PX)
      // ön yüzlerinin en az THIN_SHELL_Z arkasına düşer — döküm gücü kadraj
      // kenarı sönümüyle zayıflayan bölgelerde bile profil açısında kağıt
      // inceliğinde iç boşluk görünmez. Döküm zaten daha arkaya çektiyse
      // min() korur.
      if (dPx <= THIN_SHELL_PX) z = Math.min(z, zFront - THIN_SHELL_Z);
      // z aralığı sözleşmesi: her zaman [-1, +1], orijine ortalı kalır.
      out[o + 2] = Math.min(1, Math.max(-1, z));
      // Opaklık: SERT BINARY siluet (0 veya 1 — Tur 9). Siluet içi (gölge,
      // siyah saç dahil) tam 1; arka plan texel'leri yukarıda BACKDROP_OPACITY
      // ile yazılır ve buraya asla ulaşmaz. shader'lar bu değeri alpha
      // çarpanı yapar (Tur 11: w iki seviyelidir — 1 ön plan, 0.4 arka plan).
      out[o + 3] = a;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// GÖRSEL RENK ÖRNEKLEYİCİ (Tur 11): fotoğraf RGB'sini, konumlarla BİREBİR
// aynı grid/remap sözleşmesi üzerinden 384×384'lük renk texture'ına taşır.
//
// Önem tabanlı örnekleme (buildImportanceRemap) örnekleme koordinatını
// büktüğü için fotoğraf GPU'da HAM bind edilip shader'da aUv ile okunamaz —
// texel (i,j) konumda hangi depth pikselini örnekliyorsa renkte de AYNI
// pikseli okumalıdır. Bu fonksiyon remap'i depth üzerinden aynı şekilde
// kurar, rgb'yi o koordinatta bilinear örnekler (imgW/depthW ölçeğiyle).
// Çıktı N×3 Float32Array (0..1); buffers.ts bunu RGBA8 texture'a yazar ve
// render shader'ı uImageTexture adıyla aUv'de okur — her parçacık kendi
// fotoğraf pikselinin rengini taşır (varsayılan mavi derinlik rampası yerine).
// ---------------------------------------------------------------------------

export interface ImageSampleOptions {
  /** Grid boyutu (kare). Varsayılan 384 — sampleVolumePositions ile aynı. */
  gridSize?: number;
  /** Önem remap'i — sampleVolumePositions ile BİREBİR aynı ayar (hizalama). */
  importanceSampling?: boolean;
  /**
   * Ön plan maskesi — sampleVolumePositions ile BİREBİR aynı girdi (hizalama):
   * renk grid'i konum grid'iyle aynı remap'i kurmalıdır, aksi halde renkler
   * parçacıklardan kayar. Opsiyonel.
   */
  foregroundMask?: Float32Array;
}

/**
 * Fotoğraf RGB'sini konum grid'iyle aynı eşleme üzerinden örnekler.
 * `depth` remap'in kaynağıdır (yoğunluk), renk verisi `rgb`dir; ikisinin
 * en-boy oranı aynı olmalıdır (letterbox kırpımı bunu garantiler).
 */
export function sampleImageGrid(
  rgb: Float32Array,
  imgW: number,
  imgH: number,
  depth: Float32Array,
  depthW: number,
  depthH: number,
  opts: ImageSampleOptions = {},
): Float32Array {
  const grid = opts.gridSize ?? VOLUME_GRID_SIZE;
  const n = grid * grid;
  const out = new Float32Array(n * 3);
  const remap =
    opts.importanceSampling === false
      ? null
      : buildImportanceRemap(depth, depthW, depthH, opts.foregroundMask ?? null);
  // Depth koordinatını fotoğraf uzayına ölçekle: aspect aynı olduğundan
  // yalnızca çözünürlük oranı gerekir.
  const sx = imgW / depthW;
  const sy = imgH / depthH;
  for (let j = 0; j < grid; j++) {
    // t = (j+0.5)/N: yukarıdan aşağı, CDF de o yönde kurulur (konumlarla
    // birebir — texel hizası bozulursa renkler parçacıklardan kayar).
    const t = (j + 0.5) / grid;
    const y = remap ? remap.yOf(t) * sy - 0.5 : t * imgH - 0.5;
    for (let i = 0; i < grid; i++) {
      const u = (i + 0.5) / grid;
      const x = remap ? remap.xOf(u) * sx - 0.5 : u * imgW - 0.5;
      const o = (j * grid + i) * 3;
      sampleBilinearRgb(rgb, imgW, imgH, x, y, out, o);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// BAKILI OKLÜZYON (Gün C — 3D okunurluk).
//
// Tek fotoğraftan gerçek ışık taşıması hesaplanamaz; bu iki fonksiyon depth
// haritasından UCUZ bir oklüzyon yaklaşımı üretir: bir piksel, çevresindeki
// piksellerden ne kadar DAHA GERİDEYSE o kadar kapalıdır (göz çukuru, çene
// altı, saç sınırı, kol-gövde arası). Yönlü ışık + fresnel tek başına yüzeyi
// kabartma gibi göstermiyordu; çukur karartması derinliği okutan asıl sinyaldir.
//
// Çıktı, renk grid'inin ALPHA kanalında taşınır (buffers.fillImageColorTexture)
// — ek texture, ek bant genişliği ve ek draw call yok. Video dokusunda alpha
// = 1 olduğu için efekt kendiliğinden kapanır.
// ponytail: gerçek AO değil, depth farkı sezgiseli; SSAO gerekirse GPU'da
// derinlik tamponundan kurulur.
// ---------------------------------------------------------------------------

/** Örnekleme yarıçapları (depth genişliğine oran) — mikro + orta ölçek çukur. */
const AO_RADII = [0.004, 0.01, 0.02];
/** Bu depth farkı tam kapanma sayılır (0..1 depth uzayında). */
const AO_FALLOFF = 0.08;
/** Kapanmanın karartma kazancı ve en koyu değeri. */
const AO_GAIN = 1.6;
const AO_MIN = 0.35;

/**
 * Depth haritasından oklüzyon haritası (0..1; 1 = açık, AO_MIN = en koyu).
 * 8 yön × 3 yarıçap, kenarlar kelepçeli; sonuç hafif blur'lanır (tap
 * gürültüsü yüzeyde benek bırakmasın).
 */
export function computeAoMap(depth: Float32Array, w: number, h: number): Float32Array {
  if (depth.length !== w * h) {
    throw new RangeError(`computeAoMap: depth boyutu (${depth.length}) ${w}x${h} ile uyuşmuyor`);
  }
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  const radii = AO_RADII.map((r) => Math.max(1, Math.round(r * w)));
  const taps = dirs.length * radii.length;
  const occ = new Float32Array(depth.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = depth[y * w + x];
      let sum = 0;
      for (const r of radii) {
        for (const [dx, dy] of dirs) {
          const nx = Math.min(w - 1, Math.max(0, x + dx * r));
          const ny = Math.min(h - 1, Math.max(0, y + dy * r));
          // Komşu daha YAKIN (depth büyük) ise merkezi kapatır.
          const diff = depth[ny * w + nx] - c;
          if (diff > 0) sum += Math.min(1, diff / AO_FALLOFF);
        }
      }
      occ[y * w + x] = sum / taps;
    }
  }
  const smooth = boxBlur(occ, w, h, 1);
  for (let i = 0; i < smooth.length; i++) {
    smooth[i] = Math.min(1, Math.max(AO_MIN, 1 - smooth[i] * AO_GAIN));
  }
  return smooth;
}

/**
 * Oklüzyonu konum/renk grid'iyle BİREBİR aynı remap üzerinden grid'e taşır
 * (hizalama kuralı: sampleImageGrid ile aynı girdiler). Çıktı N² (0..1).
 */
export function sampleAoGrid(
  depth: Float32Array,
  depthW: number,
  depthH: number,
  opts: ImageSampleOptions = {},
): Float32Array {
  const grid = opts.gridSize ?? VOLUME_GRID_SIZE;
  const out = new Float32Array(grid * grid);
  const ao = computeAoMap(depth, depthW, depthH);
  const remap =
    opts.importanceSampling === false
      ? null
      : buildImportanceRemap(depth, depthW, depthH, opts.foregroundMask ?? null);
  for (let j = 0; j < grid; j++) {
    const t = (j + 0.5) / grid;
    const y = remap ? remap.yOf(t) - 0.5 : t * depthH - 0.5;
    for (let i = 0; i < grid; i++) {
      const u = (i + 0.5) / grid;
      const x = remap ? remap.xOf(u) - 0.5 : u * depthW - 0.5;
      out[j * grid + i] = sampleBilinear(ao, depthW, depthH, x, y);
    }
  }
  return out;
}

/** 3 kanallı (interleaved rgb) bilinear örnekleme; taşmalar kenara kelepçeli. */
function sampleBilinearRgb(
  map: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  out: Float32Array,
  o: number,
) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0));
  const ty = Math.min(1, Math.max(0, y - y0));
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  for (let c = 0; c < 3; c++) {
    const p00 = map[(y0 * w + x0) * 3 + c];
    const p10 = map[(y0 * w + x1) * 3 + c];
    const p01 = map[(y1 * w + x0) * 3 + c];
    const p11 = map[(y1 * w + x1) * 3 + c];
    out[o + c] = p00 * w00 + p10 * w10 + p01 * w01 + p11 * w11;
  }
}

// ---------------------------------------------------------------------------
// Kaide geometrisi (evrensel, subject-agnostic): siluet maskesinin (α ≥ 0.5)
// ağırlık merkezi + sınır kutusu yarı eksenleri. Kenar dökümünün (oval
// backing) sönüm merkezi olarak kullanılır. Kafa/insan varsayımı YOKTUR —
// aynı hesaplama her özne şekline uygulanır.
// ---------------------------------------------------------------------------

export interface BodyGeometry {
  /** Maske ağırlık merkezi (dünya koordinatı, x) — oval sönüm merkezi. */
  cx: number;
  /** Maske ağırlık merkezi (dünya koordinatı, y). */
  cy: number;
  /** Elipsoid yarı ekseni (x, dünya). Dejenere durumlarda küçük tutulur. */
  rx: number;
  /** Elipsoid yarı ekseni (y, dünya). Dejenere durumlarda küçük tutulur. */
  ry: number;
}

export function computeBodyGeometry(
  alpha: Float32Array,
  w: number,
  h: number,
  halfH: number,
): BodyGeometry | null {
  const halfW = (w / h) * halfH;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let hit = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = alpha[y * w + x];
      if (m < 0.5) continue;
      const wx = (x / w - 0.5) * 2 * halfW;
      const wy = (1 - (y + 0.5) / h - 0.5) * 2 * halfH;
      sx += wx * m;
      sy += wy * m;
      sw += m;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
      hit = true;
    }
  }
  if (!hit || sw <= 0) return null;
  return {
    cx: sx / sw,
    cy: sy / sw,
    rx: Math.max(0.01, (maxX - minX) / 2),
    ry: Math.max(0.01, (maxY - minY) / 2),
  };
}

// ---------------------------------------------------------------------------
// Önem tabanlı örnekleme (buffers.ts'ten taşındı — GPU katmanı yalnızca
// transfer yapar; bu mekanikler CPU katmanının işi).
// ---------------------------------------------------------------------------

export interface UvRemap {
  /** q ∈ [0,1] → depth sütun koordinatı (0..w−1). */
  xOf(q: number): number;
  /** t ∈ [0,1] (üstten alta) → depth satır koordinatı (0..h−1). */
  yOf(t: number): number;
}

export function buildImportanceRemap(
  depth: Float32Array,
  w: number,
  h: number,
  fgMask?: Float32Array | null,
): UvRemap {
  // Boyut güvenliği: fgMask depth ile aynı çözünürlükte olmalı (Engine setDepth
  // resample + dilate eder; burada yalnızca sözleşmeyi denetleriz — sessiz
  // yanlış sonuç yerine RangeError).
  if (fgMask && fgMask.length !== w * h) {
    throw new RangeError(
      `buildImportanceRemap: fgMask boyutu (${fgMask.length}) depth ile aynı olmalı (${w * h})`,
    );
  }
  const smooth = boxBlur(depth, w, h, 2);
  // Foreground centroid: segmask varsa "center" terimi kadraj merkezine değil
  // ÖZNENİN kütle merkezine göre hesaplanır. Sabit kadraj-merkezi bükmesi
  // kenarda duran/çerçeveye dayanan öznenin yoğunluğunu eritiyordu ("çok orta
  // fokuslu"); maske yoksa eski davranış aynen korunur.
  let fcx = w / 2;
  let fcy = h / 2;
  if (fgMask) {
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let i = 0; i < fgMask.length; i++) {
      const f = fgMask[i];
      if (f > 0) {
        sx += (i % w) * f;
        sy += ((i / w) | 0) * f;
        sw += f;
      }
    }
    if (sw > 0) {
      fcx = sx / sw;
      fcy = sy / sw;
    }
  }
  const im = new Float32Array(w * h);
  for (let i = 0; i < im.length; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    const dx = x / w - fcx / w;
    const dy = y / h - fcy / h;
    const center = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
    const contrast = Math.abs(depth[i] - smooth[i]);
    const fg = fgMask ? Math.min(1, Math.max(0, fgMask[i])) : 0;
    im[i] = 0.5 * depth[i] + 0.3 * center + 0.2 * contrast + FG_IMPORTANCE_WEIGHT * fg;
  }
  const density = boxBlur(im, w, h, 2);
  let sum = 0;
  for (const v of density) sum += v;
  const mean = sum / density.length || 1;
  for (let i = 0; i < density.length; i++) {
    density[i] = Math.min(
      SAMPLE_MAX_DENSITY,
      Math.max(SAMPLE_MIN_DENSITY, density[i] / mean),
    );
  }
  const cx = new Float64Array(w);
  const cy = new Float64Array(h);
  for (let i = 0; i < density.length; i++) {
    cx[i % w] += density[i];
    cy[(i / w) | 0] += density[i];
  }
  const cdfX = makeCdf(cx);
  const cdfY = makeCdf(cy);
  return { xOf: (q) => invCdf(cdfX, q), yOf: (t) => invCdf(cdfY, t) };
}

/** Sütun/satır toplamlarından [0,1]'e birikimli dağılım; son hücre tam 1. */
function makeCdf(bin: Float64Array): Float64Array {
  const cdf = new Float64Array(bin.length);
  let total = 0;
  for (const v of bin) total += v;
  if (total <= 0) {
    // Sıfır önem (düz grid gibi): doğrusal fallback = eski davranış.
    for (let i = 0; i < cdf.length; i++) cdf[i] = i / Math.max(1, cdf.length - 1);
    return cdf;
  }
  let acc = 0;
  for (let i = 0; i < cdf.length; i++) {
    acc += bin[i];
    cdf[i] = acc / total;
  }
  cdf[cdf.length - 1] = 1;
  return cdf;
}

/** q'yu CDF üzerinde ikili aramayla bulur; komşular arası lineer interpolasyon. */
function invCdf(cdf: Float64Array, q: number): number {
  const n = cdf.length;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < q) lo = mid + 1;
    else hi = mid;
  }
  const prev = lo === 0 ? 0 : cdf[lo - 1];
  const span = cdf[lo] - prev;
  // Son hücrede (q=1) interpolasyon lo+1'e taşar — sözleşme [0, n−1]; grid
  // koordinatı u = (i+0.5)/N hiçbir zaman tam 1 olmasa da uç değer kelepçeli.
  return Math.min(n - 1, span > 0 ? lo + (q - prev) / span : lo);
}

/** Bilinear örnekleme; grid dışı taşmalar kenara kelepçelenir. */
function sampleBilinear(
  map: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0));
  const ty = Math.min(1, Math.max(0, y - y0));
  const top = map[y0 * w + x0] * (1 - tx) + map[y0 * w + x1] * tx;
  const bot = map[y1 * w + x0] * (1 - tx) + map[y1 * w + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

/** GLSL-style smoothstep: e0 altı 0, e1 üstü 1, arada Hermite geçiş. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Ayrık kutu blur (x sonra y) — küçük kernel yeterli. */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        s += src[row + Math.min(w - 1, Math.max(0, x + dx))];
      }
      tmp[row + x] = s / k;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        s += tmp[Math.min(h - 1, Math.max(0, y + dy)) * w + x];
      }
      out[y * w + x] = s / k;
    }
  }
  return out;
}
