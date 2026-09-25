/**
 * SPLAT DERİNLİK SIRALAMASI (render katmanı — Zeynep, Gün 2 + Gün 4).
 *
 * 3B Gauss splat'ları OPAK DEĞİLDİR: alpha blend'in doğru sonucu vermesi için
 * her karede ARKADAN ÖNE çizilmeleri gerekir. Sıra yanlışsa kamera dönerken
 * splat'lar birbirinin üstüne yanlış oranda karışır ve yüzey "yanıp söner"
 * (popping) — bu, splat rasterizasyonunun bir numaralı görsel hatasıdır.
 *
 * Sözleşme: sıralama SIRA DİZİSİ üretir (`order`), splat verisini ASLA yeniden
 * dizmez. GaussianBuffer texture'ları (gSplatA/B/C) yerinde kalır — Engine
 * onları her karede bind eder, material dokunmaz (uPositions kuralının aynısı).
 * Sıralanan şey yalnızca instanced çizim indeksidir.
 *
 * İKİ YOL (Gün 4 — fallback ŞART):
 *   1. `radixSortByDepth`  — 16 bit anahtar, 2 geçiş × 8 bit LSD radix.
 *      Tahsissiz (havuzlanmış), O(n), karşılaştırmasız. VARSAYILAN.
 *   2. `bucketSortByDepth` — tek geçiş hiyerarşik kova (coarse histogram +
 *      kova içi ekleme sıralaması). Radix'ten daha az bellek dokunur; kova
 *      sayısı düşükken yaklaşık sıralamadır (`exact: false`) ve ölçümde
 *      radix'e karşı kıyaslanır.
 * İkisi de AYNI sözleşmeyi döner; `sortSplatsByDepth` seçim kapısıdır.
 *
 * Neden CPU: repo WebGL2 (three.js WebGLRenderer) üzerinde koşuyor, compute
 * shader yok. ARCHITECTURE.md D.7 kesme sırasının 1. maddesi zaten
 * "WebGPU sıralama → CPU sıralamada kal" diyor; bu modül o kararın kodudur.
 */

/** Sıralama yolu adı — ölçüm raporunda ve SPLAT_PARAMS'ta kullanılır. */
export type SplatSortMode = 'radix' | 'bucket';

/**
 * Opacity gate for the sort, with object separation applied.
 *
 * Point Cloud, ASCII and Neon discard bridge backdrop texels
 * (w = BACKDROP_OPACITY < 0.5) while separation is on. Splat must do the same:
 * backdrop splats are sized to touch their neighbours, so they merge into a
 * continuous sheet that reads as a curved curtain from a side view. Culling
 * them here also skips their sort and fill cost. Authored Gaussians carry real
 * opacities instead of the bridge's two-level mask, so they are left alone.
 */
export function splatOpacityGate(
  minOpacity: number,
  objectSeparation: boolean,
  source: 'point-cloud' | 'authored',
): number {
  return objectSeparation && source === 'point-cloud' ? Math.max(minOpacity, 0.5) : minOpacity;
}

/**
 * Radix anahtar çözünürlüğü: görüş-uzayı derinliği 16 bit'e kuantalanır.
 * 65.536 kademe, [-1, +1] dünya z aralığında ~0.03 mm'lik ayrım demektir —
 * splat yarıçapının kat kat altında, yani kuantalama görünür sıra hatası
 * üretmez. 32 bit'e çıkmak geçiş sayısını ikiye katlar, kazancı yoktur.
 */
export const SORT_KEY_BITS = 16;
const RADIX_BITS = 8;
const RADIX_BUCKETS = 1 << RADIX_BITS; // 256
const RADIX_PASSES = SORT_KEY_BITS / RADIX_BITS; // 2

/**
 * Kova sıralamasının varsayılan kova sayısı. 1024 kova × 147k splat →
 * kova başına ~144 eleman; kova İÇİ sıra korunmaz (yaklaşık sıralama).
 * Splat yarıçapı kova genişliğinden büyük olduğu sürece görsel fark yoktur;
 * `verify-splat.mjs` bunu ölçer (ters çift oranı).
 */
export const BUCKET_COUNT = 1024;

/**
 * Sıralama çalışma alanı: kare başına tahsis YAPILMAZ (147k splat'ta her
 * karede 4 tipli dizi ayırmak GC'yi dövüyor ve 60 fps'i düşürüyordu).
 * Havuz splat sayısı değişince yeniden boyutlanır.
 */
export interface SplatSortScratch {
  count: number;
  keys: Uint16Array;
  keysAlt: Uint16Array;
  order: Uint32Array;
  orderAlt: Uint32Array;
  counts: Uint32Array;
}

export function createSortScratch(count: number): SplatSortScratch {
  return {
    count,
    keys: new Uint16Array(count),
    keysAlt: new Uint16Array(count),
    order: new Uint32Array(count),
    orderAlt: new Uint32Array(count),
    counts: new Uint32Array(Math.max(RADIX_BUCKETS, BUCKET_COUNT)),
  };
}

/** Havuzu gerekli boyuta getirir (küçükse yeniden ayırır, büyükse aynen kalır). */
export function ensureSortScratch(
  scratch: SplatSortScratch | null,
  count: number,
): SplatSortScratch {
  if (scratch && scratch.count >= count) return scratch;
  return createSortScratch(count);
}

export interface SplatSortResult {
  /** Çizim sırası: order[k] = k'ıncı çizilecek splat'ın indeksi (ARKADAN ÖNE). */
  order: Uint32Array;
  /** Gerçekten çizilecek splat sayısı (opaklık kapısını geçenler). */
  count: number;
  /** Sıralamanın tam mı yaklaşık mı olduğu (kova yolunda yaklaşık). */
  exact: boolean;
}

/**
 * Görüş-uzayı derinliği: kamera bir splat'a ne kadar uzaksa anahtar o kadar
 * KÜÇÜK olmalı ki artan sırada çizim ARKADAN ÖNE olsun.
 *
 * `view` = viewMatrix'in satır-major olmayan (three.js/WebGL kolon-major)
 * 16 elemanı. Bize yalnızca z satırı gerekir: z_view = m2·x + m6·y + m10·z + m14.
 * three.js'te kamera −z'ye bakar, yani UZAK nokta daha NEGATİF z_view taşır —
 * anahtar doğrudan z_view'den kuantalanınca artan sıra zaten arkadan öne olur.
 */
function viewDepth(
  view: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
): number {
  return view[2] * x + view[6] * y + view[10] * z + view[14];
}

/**
 * gSplatA (xyz + opaklık) verisinden 16 bit derinlik anahtarı üretir ve
 * opaklık kapısını uygular.
 *
 * Opaklık kapısı: w ≤ `minOpacity` olan splat HİÇ çizilmez (sıraya girmez).
 * Sebep: arka plan texel'leri de GaussianBuffer'da yaşıyor (tek buffer
 * sözleşmesi); tamamen saydam splat'ı çizmek fragment maliyeti öder, piksel
 * değiştirmez.
 *
 * Döner: sıraya giren splat sayısı. `scratch.keys`/`scratch.order` doldurulur.
 */
function buildKeys(
  splatXyzw: Float32Array,
  count: number,
  view: ArrayLike<number>,
  minOpacity: number,
  scratch: SplatSortScratch,
): { n: number; lo: number; hi: number } {
  const keys = scratch.keys;
  const order = scratch.order;
  // İki geçiş: önce aralık (min/max derinlik), sonra kuantalama. Sabit bir
  // aralık varsaymak (ör. [-1, +1]) kamera uzaklaşınca tüm anahtarları tek
  // kovaya toplar ve sıralama fiilen kapanır.
  let lo = Infinity;
  let hi = -Infinity;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if (splatXyzw[o + 3] <= minOpacity) continue;
    const d = viewDepth(view, splatXyzw[o], splatXyzw[o + 1], splatXyzw[o + 2]);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
    order[n] = i;
    n++;
  }
  if (n === 0) return { n: 0, lo: 0, hi: 0 };
  const span = hi - lo;
  // Tek düzlemde toplanmış bulut (span ≈ 0): tüm anahtarlar 0, sıra girdi
  // sırasıdır — bölme yapılmaz (NaN anahtarı sıralamayı sessizce bozardı).
  const scale = span > 1e-9 ? (RADIX_BUCKETS * RADIX_BUCKETS - 1) / span : 0;
  for (let k = 0; k < n; k++) {
    const o = order[k] * 4;
    const d = viewDepth(view, splatXyzw[o], splatXyzw[o + 1], splatXyzw[o + 2]);
    keys[k] = (d - lo) * scale;
  }
  return { n, lo, hi };
}

/**
 * LSD radix: 2 geçiş × 8 bit, kararlı (stable). Kararlılık şart değil ama
 * ücretsiz gelir ve aynı derinlikteki splat'ların sırası kareler arasında
 * sabit kalır — titremeyi azaltır.
 */
function radixPasses(n: number, scratch: SplatSortScratch) {
  let keys = scratch.keys;
  let keysAlt = scratch.keysAlt;
  let order = scratch.order;
  let orderAlt = scratch.orderAlt;
  const counts = scratch.counts;
  for (let pass = 0; pass < RADIX_PASSES; pass++) {
    const shift = pass * RADIX_BITS;
    counts.fill(0, 0, RADIX_BUCKETS);
    for (let k = 0; k < n; k++) counts[(keys[k] >>> shift) & (RADIX_BUCKETS - 1)]++;
    // Prefix toplam → her kovanın yazma başlangıcı.
    let sum = 0;
    for (let b = 0; b < RADIX_BUCKETS; b++) {
      const c = counts[b];
      counts[b] = sum;
      sum += c;
    }
    for (let k = 0; k < n; k++) {
      const key = keys[k];
      const b = (key >>> shift) & (RADIX_BUCKETS - 1);
      const dst = counts[b]++;
      keysAlt[dst] = key;
      orderAlt[dst] = order[k];
    }
    // Takas: bir sonraki geçiş yeni diziden okur.
    let t: Uint16Array = keys;
    keys = keysAlt;
    keysAlt = t;
    let u: Uint32Array = order;
    order = orderAlt;
    orderAlt = u;
  }
  // Çift sayıda geçişte sonuç yine orijinal dizilerdedir; tek sayıda olsaydı
  // geri kopyalamak gerekirdi. RADIX_PASSES = 2 olduğu için takas dengelidir,
  // ama sabit değişirse sessizce bozulmasın diye açıkça denetlenir.
  if (order !== scratch.order) {
    scratch.order.set(order.subarray(0, n), 0);
  }
}

/**
 * TAM sıralama (varsayılan): 16 bit anahtar + 2 geçiş LSD radix.
 * Sonuç ARKADAN ÖNE — `order[0]` en uzak splat'tır.
 */
export function radixSortByDepth(
  splatXyzw: Float32Array,
  count: number,
  view: ArrayLike<number>,
  minOpacity: number,
  scratch: SplatSortScratch,
): SplatSortResult {
  const { n } = buildKeys(splatXyzw, count, view, minOpacity, scratch);
  if (n > 1) radixPasses(n, scratch);
  return { order: scratch.order, count: n, exact: true };
}

/**
 * HİYERARŞİK KOVA (Gün 4 alternatifi): tek histogram geçişi + tek saçılma
 * geçişi. Radix'in ikinci geçişini atar; kova İÇİ sıra korunmaz, yani
 * YAKLAŞIK sıralamadır (`exact: false`).
 *
 * Ne zaman kabul edilebilir: kova genişliği (derinlik aralığı / BUCKET_COUNT)
 * splat yarıçapının altındaysa, kova içi yanlış sıra ekranda üst üste binen
 * ve zaten birbirine karışan splat'lar arasındadır — göz farkı görmez.
 * `verify-splat.mjs` ters çift oranını ölçer, iddia edilmez.
 */
export function bucketSortByDepth(
  splatXyzw: Float32Array,
  count: number,
  view: ArrayLike<number>,
  minOpacity: number,
  scratch: SplatSortScratch,
  buckets = BUCKET_COUNT,
): SplatSortResult {
  const { n } = buildKeys(splatXyzw, count, view, minOpacity, scratch);
  if (n <= 1) return { order: scratch.order, count: n, exact: true };
  const counts = scratch.counts;
  counts.fill(0, 0, buckets);
  const keys = scratch.keys;
  // 16 bit anahtar → kova indeksi (üst bitler).
  const shift = SORT_KEY_BITS - Math.round(Math.log2(buckets));
  for (let k = 0; k < n; k++) counts[keys[k] >>> shift]++;
  let sum = 0;
  for (let b = 0; b < buckets; b++) {
    const c = counts[b];
    counts[b] = sum;
    sum += c;
  }
  const order = scratch.order;
  const orderAlt = scratch.orderAlt;
  for (let k = 0; k < n; k++) orderAlt[counts[keys[k] >>> shift]++] = order[k];
  order.set(orderAlt.subarray(0, n), 0);
  return { order, count: n, exact: false };
}

/** Seçim kapısı — SPLAT_PARAMS'taki `uSortMode` bunu sürer. */
export function sortSplatsByDepth(
  mode: SplatSortMode,
  splatXyzw: Float32Array,
  count: number,
  view: ArrayLike<number>,
  minOpacity: number,
  scratch: SplatSortScratch,
): SplatSortResult {
  return mode === 'bucket'
    ? bucketSortByDepth(splatXyzw, count, view, minOpacity, scratch)
    : radixSortByDepth(splatXyzw, count, view, minOpacity, scratch);
}

/**
 * D.4 TIMELINE FİLTRESİ: sıralanmış `order` dizisini YERİNDE sıkıştırır,
 * yalnızca `keyframe` id'sine ait splat'lar kalır. Yeni uzunluğu döner.
 *
 * Sıra ARKADAN ÖNE olduğu için sıkıştırma o sırayı KORUR (kararlı seçim) —
 * filtreden sonra yeniden sıralamaya gerek yoktur. Filtre bilerek
 * sıralamadan SONRA uygulanır: sıralama maliyeti seçime göre değişmesin,
 * timeline'da gezinirken ölçüm tutarlı kalsın.
 *
 * `keyframe = null` ya da kimlik dizisi yoksa dokunmaz (tüm splat'lar).
 */
export function filterOrderByKeyframe(
  order: Uint32Array,
  count: number,
  keyframeIndex: Uint16Array | null,
  keyframe: number | null,
): number {
  if (keyframe === null || !keyframeIndex) return count;
  let w = 0;
  for (let k = 0; k < count; k++) {
    const idx = order[k];
    if (keyframeIndex[idx] === keyframe) order[w++] = idx;
  }
  return w;
}

/**
 * YENİDEN SIRALAMA KAPISI: sıra her karede değil, kamera YETERİNCE dönünce
 * kurulur. 147k'lık `Uint32Array` her karede GPU'ya yüklenirse (590 kB/kare,
 * 60 fps'te ~35 MB/s) sürücü kuyruğu şişer; oysa 1-2 derecelik kamera
 * hareketinde sıra pratikte değişmez.
 *
 * Ölçüt: görüş yönünün (viewMatrix'in 3. satırı) bir önceki sıralamadaki
 * yöne göre açısı. `cosThreshold` = cos(eşik açı); varsayılan cos(2°).
 * Dönüş: yeniden sıralama gerekli mi.
 */
/**
 * Yeniden sıralama durumu: son sıralamanın YÖNÜ ve KONUMU. İkisi de gerekli
 * (aşağıdaki nota bak); tek bir Float32Array yerine ayrı alanlar, çağıranın
 * yanlışlıkla birini güncellemeyi unutmasını engeller.
 */
export interface ResortState {
  /** Son sıralamadaki birim görüş yönü. */
  dir: Float32Array;
  /** Son sıralamadaki kamera DÜNYA konumu. */
  pos: Float32Array;
}

export function createResortState(): ResortState {
  return { dir: new Float32Array([0, 0, 1]), pos: new Float32Array([0, 0, 0]) };
}

/** Öteleme eşiği: sahne yarıçapının bu oranı kadar kayma sırayı bayatlatır. */
export const RESORT_POS_FRACTION = 0.02;

/** Kamera dünya konumu — THREE.Vector3 bu şekle uyar (`length` orada METOT
 *  olduğu için ArrayLike kullanılamaz). */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export function needsResort(
  view: ArrayLike<number>,
  camPos: Vec3Like,
  state: ResortState,
  sceneRadius: number,
  cosThreshold = Math.cos((2 * Math.PI) / 180),
  posFraction = RESORT_POS_FRACTION,
): boolean {
  const x = view[2];
  const y = view[6];
  const z = view[10];
  const len = Math.hypot(x, y, z) || 1;
  const nx = x / len;
  const ny = y / len;
  const nz = z / len;
  const dot = nx * state.dir[0] + ny * state.dir[1] + nz * state.dir[2];
  const rotated = dot < cosThreshold;

  // ÖTELEME KAPISI (Gün 1 düzeltmesi): kapı eskiden YALNIZCA görüş yönüne
  // bakıyordu. Kamera dönmeden yalnızca kayarsa (dolly/truck — video
  // sahnelerinde BASKIN hareket) görüş yönü sabit kalır, kapı kapalı kalır ve
  // arkadan-öne sıra bayatlar: splat'lar yanlış sırada blend edilir.
  // Eşik sahne yarıçapına GÖRELİDİR — mutlak bir dünya mesafesi, 10× büyütülmüş
  // bir sahnede aynı göreli hareket için farklı karar verirdi.
  const dx = camPos.x - state.pos[0];
  const dy = camPos.y - state.pos[1];
  const dz = camPos.z - state.pos[2];
  const moved = Math.hypot(dx, dy, dz) > Math.max(1e-6, sceneRadius * posFraction);

  if (!rotated && !moved) return false;
  state.dir[0] = nx;
  state.dir[1] = ny;
  state.dir[2] = nz;
  state.pos[0] = camPos.x;
  state.pos[1] = camPos.y;
  state.pos[2] = camPos.z;
  return true;
}
