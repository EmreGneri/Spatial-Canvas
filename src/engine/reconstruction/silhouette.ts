/**
 * SİLUET MASKESİ (CPU katmanı, bağımsız — hiçbir modüle bağlanmaz).
 *
 * Ön plan izolasyonu depth değerinden çıkarılan BINARY maskeye değil,
 * geometrik bütünlüğe dayanır:
 *   1. Eşik: d ≥ SILHOUETTE_BIN_LO → aday. Eşik 0.05'tir — ince el/parmak
 *      yapıları eşiğe takılıp silinmesin diye düşük tutulur; arka plan
 *      gürültüsü ise geometri kurallarıyla elenir. Opsiyonel nesne maskesi
 *      (segmentation.ts: subject-agnostic ön plan) verildiyse MASKE
 *      OTORİTEDİR: adaylık YALNIZCA maske ≥ 0.5 koşuludur, depth eşiği
 *      devre dışı kalır. Sebep: maske özneyi doğru bulduğunda derinliği
 *      düşük kalan bölge (koyu saç, arkaya giden kol) depth eşiğine takılıp
 *      siliniyordu — depth maskeyi cezalandırıyordu. Sızma koruması eşikte
 *      değil, 6. maddedeki SON AND'dedir.
 *   2. Morfolojik kapanış (dilate + erode): siluet İÇİNDEKİ delikler ve ince
 *      kırılmalar kapatılır. Kapanışla gelen pikseller "filled" işaretlenir:
 *      derinlik sürekliliği denetiminde köprü görevi görürler (iç delikler
 *      gradyan kesme yüzünden bileşeni parçalamaz).
 *   3. Bileşen analizi (4-komşu sel) + gövde birleştirme: bağlantı DERİNLİK
 *      SÜREKLİLİĞİYLE veya MASKE GÜVENİYLE kurulur — komşu iki aday pikselin
 *      depth farkı GRADIENT_BREAK (0.15)'i aşıyorsa sel o yöne ilerlemez,
 *      MEĞER Kİ iki piksel de nesne maskesinin içinde (≥ 0.5) olsun: gerçek
 *      bir uzuv (kalkık kol) yüzden öne çıktığı için 0.15'i aşar ve maske
 *      güveni olmadan "severed" sayılıp eleniyordu. Böylece eşiğe sızan arka
 *      plan (duvar/zemin — maskesi düşüktür) özneye
 *      BİRLEŞEMEZ: derinlik sıçramasıyla ayrışır, ayrı bileşen olarak ele
 *      alınır. Çekirdek seçilir (çerçeveye değmeyen en büyük; yoksa yalnızca
 *      ALT kenara değen en büyük; yoksa en büyük). Çerçeveye değmek ELEME
 *      GEREKÇESİ DEĞİLDİR: havaya kalkıp üst kenara değen kol gibi uzuvlar
 *      ana gövdeyle satır/sütun örtüşmesi veya yakınlıkla (NEAR_PX) katılır.
 *      Gradyan kesmesiyle ayrışan ve maskede DOĞRUDAN bitişik kalan
 *      bileşenler ("touching") ayrıca katılamaz: |Δd| ≤ 0.15 sürekliliği
 *      olmayan yapışık bloklar (önünde durduğu duvar) kural kümelerine
 *      takılmadan elenir. Gerçek maske boşluğuyla ayrılan parçalar (koyu
 *      gölge) için yakınlık kuralları eskisi gibi çalışır.
 *   4. Satır boşluk dolgusu (yerel gap-fill): birleşik bbox içinde her
 *      satırda iki ön plan parçası ARASINDA kalan ve genişliği MAX_GAP_FILL
 *      (20) pikseli aşmayan boşluklar doldurulur — koyu kol-baş gölgesi gibi
 *      dar iç boşluklar kapanır; geniş açık havalar asla perde gibi
 *      doldurulmaz.
 *   5. Kalkık uzuv köprüsü: siluet bbox'unun üst çeyreğinde yer alan ve ana
 *      kütleye PROXIMITY_BRIDGE_PX'ten yakın duran bağımsız bileşenler
 *      (havaya kalkan el/bilek) ZORUNLU katılır — kol ile saç arasındaki koyu
 *      gölge bileşeni kesse bile el gövdeden koparılmaz. Radyal sönümleme
 *      YOKTUR: siluet içi hiçbir piksel α'dan delinmez.
 *   6. SERT BINARY çıktı (Tur 9): tüy/yumuşatma YOKTUR. alpha ve
 *      isForeground tam olarak {0, 1} değerleri taşır — arka plan (0)
 *      hiçbir aşamada kısmi opaklık alamaz. Opsiyonel nesne maskesi
 *      (segmentation.ts) GÜVEN SINIRIDIR: tüm geometri kuralları
 *      (morfolojik kapanış, bileşen birleştirme, satır boşluk dolgusu)
 *      bittikten SONRA maskeye bir kez daha AND uygulanır — kapanış veya
 *      satır dolgusu arka plan pikselini (maske < 0.5) asla ön plana
 *      diriltemez (beyaz duvar saç arasından sızmaz, perde oluşmaz).
 *   7. Çıktılar: alpha (sert binary 0..1), isForeground (aynı bilginin
 *      Uint8Array hali — sampler'ın "maske = 0 → nokta üretme" kapısı) ve
 *      dist (binary içinde siluet SINIRINA mesafe, piksel; dışarıda 0) —
 *      sampler dist'i kenar ekstrüzyonu (side-wall back-fill) için
 *      kullanır. Kadraj (grid) kenarı SINIR SAYILMAZ: çerçevenin kestiği
 *      siluet düz kalır, arkaya dökülmez (kare prizma duvarı oluşmaz);
 *      yalnızca gerçek arka plana komşu pikseller dış kontur sayılır.
 */

/** Binary eşiği: bu derinliğin altı arka plandır (ince uzuvları korur). */
export const SILHOUETTE_BIN_LO = 0.05;
/**
 * Derinlik gradyan kesmesi: komşu iki aday pikselin depth farkı bu değeri
 * aşarsa maskede bitişik olsalar bile aynı bileşene BAĞLANMAZLAR — eşiğe
 * sızan arka plan (duvar/zemin) özneye gradyan sürekliliği olmadan
 * yapışamaz; bileşen düzeyinde ayrı ele alınır.
 */
export const GRADIENT_BREAK = 0.15;
/** Kapanış yarıçapı: bu boyuttan küçük delikler/kırılmalar birleştirilir. */
const CLOSE_RADIUS = 5;
/** Bileşen birleştirme yakınlığı (px): gövdeye bu kadar yakın parçalar katılır. */
const NEAR_PX = 12;
/**
 * Kalkık uzuv köprüsü (px): üst çeyrekte yer alan ve ana kütleye bu mesafeye
 * kadar yakın duran bağımsız bileşenler (havaya kalkan el/bilek) ZORUNLU
 * katılır — saç ile el arasındaki koyu gölge bileşeni kesse bile el gövdeden
 * koparılmaz. Maske şişirme kullanılmaz: kol, yakınlık kuralıyla korunur.
 */
const PROXIMITY_BRIDGE_PX = 50;
/** Satır boşluk dolgusu tavanı (px): bundan dar iç boşluklar kapatılır. */
const MAX_GAP_FILL = 20;

/** RMBG maskesi genişletme yarıçapı (piksel, maskenin KENDİ çözünürlüğünde):
 *  nesne maskesinin sert 0.5 kesimi öznenin İÇİNE düşen RMBG hatalarını
 *  (yüz/el kenarı delikleri) bıçak gibi keser; bu güven marjı o hatayı
 *  dengeler (Tur 10). */
export const MASK_DILATE_RADIUS = 4;
/** Genişletilmiş maskenin kenarına uygulanan yumuşatma yarıçapı (Tur 10):
 *  AND eşiğinin (0.5) denk geldiği kontur, genişletilmiş bölgenin TAM
 *  sınırında değil içinde yumuşak geçer. */
export const MASK_FEATHER_RADIUS = 2;

/**
 * Nesne maskesini (0..1) morfolojik olarak genişletir ve kenarını yumuşatır.
 * segmentForeground (segmentation.ts) çıktısına, maskenin KENDİ
 * çözünürlüğünde uygulanır — siluet AND'i (buildSilhouette) ve sert binary
 * sözleşmesi AYNEN kalır, yalnızca "güven sınırı" burada gevşetilir:
 * RMBG'nin öznenin içine düşen < 0.5 hataları (yüz/el kenarı) genişletilmiş
 * marj sayesinde ön plan adayı olmaya devam eder; uzak arka plan yine 0
 * kalır (perde koruması sürer).
 *
 * `dilateRadius` (varsayılan MASK_DILATE_RADIUS): maskeyi depth uzayına
 * ölçekleyip ÇAĞIRAN taraf (Engine.setDepth) burada ölçek-orantılı yarıçap
 * verir — bilinear küçültmenin yumuşattığı band genişliği ölçekle büyür;
 * sabit 4px ince uzuvları yine kaybettirirdi ("sadece orta").
 */
/**
 * GÜN E (bulgu 12) — maskeyi EN BÜYÜK bağlı bileşene indirger (4-komşu, eşik
 * 0.5). RMBG bazı karelerde özneye bitişik OLMAYAN arka plan yapılarını da ön
 * plan sayıyor (ayna selfie'sinde kapı kasası/zemin); bunlar öznenin bbox'ını
 * kadrajın tamamına şişirdiği için özne-kırpma çıkarımı (depth.ts) devreye
 * giremiyordu. Bitişik olan kirlenme (özneye yapışık duvar) bu adımla
 * TEMİZLENMEZ — o siluet katmanının işi; burada yalnızca kopuk parçalar düşer.
 * Özne tek parça olduğunda çıktı değişmez.
 */
export function keepLargestComponent(mask: Float32Array, w: number, h: number): Float32Array {
  const n = w * h;
  const id = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const sizes: number[] = [];
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (mask[s] < 0.5 || id[s] >= 0) continue;
    let sp = 0;
    stack[sp++] = s;
    id[s] = next;
    let size = 0;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0 && mask[p - 1] >= 0.5 && id[p - 1] < 0) { id[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] >= 0.5 && id[p + 1] < 0) { id[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] >= 0.5 && id[p - w] < 0) { id[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] >= 0.5 && id[p + w] < 0) { id[p + w] = next; stack[sp++] = p + w; }
    }
    sizes.push(size);
    next++;
  }
  if (next <= 1) return mask; // tek parça (ya da boş) — kopya bile çıkarma
  let big = 0;
  for (let i = 1; i < next; i++) if (sizes[i] > sizes[big]) big = i;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = id[i] === big ? mask[i] : 0;
  return out;
}

export function dilateAndFeatherMask(
  mask: Float32Array,
  w: number,
  h: number,
  dilateRadius: number = MASK_DILATE_RADIUS,
): Float32Array {
  const dilated = new Float32Array(mask.length);
  minMaxPass(mask, dilated, w, h, dilateRadius, true, true);
  const tmp = new Float32Array(mask.length);
  minMaxPass(dilated, tmp, w, h, dilateRadius, false, true);
  return boxBlur(tmp, w, h, MASK_FEATHER_RADIUS);
}

export interface SilhouetteResult {
  /**
   * Sert binary opaklık haritası: {0, 1} — siluet içi 1, dışı (arka plan)
   * tam 0. Tüy geçişi YOKTUR (Tur 9): arka plan pikseli asla kısmi
   * opaklık alamaz, shader'da hiçbir silik halka/perde görünmez.
   */
  alpha: Float32Array;
  /**
   * Aynı bilginin Uint8Array hali — sampler'ın "maske = 0 → nokta
   * üretme" kapısının doğrudan kaynağı (arka plan texel'leri ölüdür).
   */
  isForeground: Uint8Array;
  /** Binary içinde siluet sınırına uzaklık (piksel); dışarıda 0. */
  dist: Float32Array;
}

export function buildSilhouette(
  depth: Float32Array,
  w: number,
  h: number,
  foregroundMask?: Float32Array | null,
): SilhouetteResult {
  const mask = new Float32Array(depth.length);
  for (let i = 0; i < mask.length; i++) {
    // Aday (MASKE OTORİTEDİR): nesne maskesi verildiyse adaylık YALNIZCA
    // maskeye bakar. Eskiden ek olarak depth ≥ SILHOUETTE_BIN_LO aranırdı;
    // maske özneyi doğru bulsa bile derinliği düşük kalan bölge (koyu saç,
    // arkaya giden kol) o eşikte siliniyordu — yani depth, maskeyi
    // CEZALANDIRIYORDU. Maske YOKSA depth eşiği aynen kalır (0.05 — ince
    // el/parmak korunur, arka plan gürültüsü geometri kurallarıyla elenir).
    // Sızma koruması bu satırda değil, fonksiyon sonundaki SON AND'dedir.
    mask[i] =
      !foregroundMask
        ? depth[i] >= SILHOUETTE_BIN_LO
          ? 1
          : 0
        : foregroundMask[i] >= 0.5
          ? 1
          : 0;
  }
  // Kapanışla gelen pikselleri işaretle: gradyan sürekliliği denetiminde
  // köprü olurlar (siluet İÇİNDEKİ koyu delikler bileşeni parçalamaz).
  const orig = mask.slice();
  closeHoles(mask, w, h, CLOSE_RADIUS);
  const filled = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] >= 0.5 && orig[i] < 0.5) filled[i] = 1;
  }
  keepForeground(mask, w, h, depth, filled, foregroundMask ?? null);
  // SON AND (Tur 9): nesne maskesi güven sınırıdır — morfolojik kapanışın,
  // bileşen birleştirmenin veya satır boşluk dolgusunun dirilttiği hiçbir
  // arka plan pikseli (maske < 0.5) ön plana dönemez. Beyaz duvar saç
  // arasından sızmaz, perde/çanak oluşmaz. (Kenar kazancının kaynağı dilate —
  // buraya eşik gevşetme YOK.)
  if (foregroundMask) {
    for (let i = 0; i < mask.length; i++) {
      if (foregroundMask[i] < 0.5) mask[i] = 0;
    }
  }
  const isForeground = new Uint8Array(mask.length);
  const alpha = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    isForeground[i] = mask[i] >= 0.5 ? 1 : 0;
    alpha[i] = isForeground[i];
  }
  const dist = boundaryDistance(mask, w, h);
  return { alpha, isForeground, dist };
}

/** Dilate → erode (ayrılabilir min/max geçişleri). Sert yüzey deliklerini kapatır. */
function closeHoles(mask: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(mask.length);
  minMaxPass(mask, tmp, w, h, r, true, true); // dilate x
  minMaxPass(tmp, mask, w, h, r, false, true); // dilate y
  minMaxPass(mask, tmp, w, h, r, true, false); // erode x
  minMaxPass(tmp, mask, w, h, r, false, false); // erode y
}

/** Ayrılabilir min/max geçişi (kenarlar kelepçeli). */
function minMaxPass(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
  takeMax: boolean,
) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = takeMax ? -Infinity : Infinity;
      if (horizontal) {
        const row = y * w;
        for (let d = -r; d <= r; d++) {
          const v = src[row + Math.min(w - 1, Math.max(0, x + d))];
          acc = takeMax ? (v > acc ? v : acc) : (v < acc ? v : acc);
        }
      } else {
        for (let d = -r; d <= r; d++) {
          const v = src[Math.min(h - 1, Math.max(0, y + d)) * w + x];
          acc = takeMax ? (v > acc ? v : acc) : (v < acc ? v : acc);
        }
      }
      dst[y * w + x] = acc;
    }
  }
}

/** Ayrık kutu blur (x sonra y) — kenarlar kelepçeli (Tur 10 maske tüyü). */
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

/**
 * Bileşen seçimi + gövde birleştirme + satır boşluk dolgusu:
 * - Sel (4-komşu) DERİNLİK SÜREKLİLİĞİYLE veya MASKE GÜVENİYLE ilerler: komşu
 *   fark GRADIENT_BREAK'i aşarsa bağlantı kurulmaz — meğer ki iki piksel de
 *   nesne maskesinin içinde (≥ 0.5) olsun (gerçek uzuv kurtulur, maskesi
 *   düşük duvar kurtulmaz); filled pikseller (kapanışla gelen iç delikler)
 *   her koşulda köprüdür.
 * - Çekirdek: (1) çerçeveye değmeyen en büyük bileşen, (2) yoksa yalnızca
 *   alt kenara değen en büyük (zemin teması güvenilir), (3) yoksa en büyük.
 *   TAM KADRAJ KORUMASI: adaylar en büyük bileşenin %10'una ulaşmalıdır —
 *   özne çerçeveyi dolduruyorsa (bust fotoğrafı) 1-2 piksellik gürültü
 *   benekleri çekirdeği çalıp dev gövdeyi silemez.
 * - Katılım (iteratif, birleşik bbox büyüdükçe yeni adaylar eklenebilir):
 *   bir bileşen şu durumlarda ana gövdeye katılır —
 *     a) X ve Y'de örtüşüyorsa (kenar temasına bakılmaz: üst kenara değen
 *        kalkık kol dahil olur),
 *     b) Y'de örtüşüyor ve X'te NEAR_PX'ten yakınsa,
 *     c) X'te örtüşüyor ve Y'de NEAR_PX'ten yakınsa (baş üstünde havada
 *        duran uzuv),
 *     d) yalnızca alt kenara değiyor, Y'de örtüşüyor ve X'te yakınsa
 *        (kadrajın altından çıkan gövde),
 *     e) üst çeyrekte yer alıyor ve X/Y'de PROXIMITY_BRIDGE_PX'ten yakınsa
 *        (kalkık kol/el — saç gölgesi bileşeni kesse bile korunur).
 *   Gradyan kesmesiyle ayrışan ve maskede DOĞRUDAN bitişik kalan bileşenler
 *   ("touching") yukarıdaki hiçbir kurala başvuramaz: |Δd| ≤ 0.15 sürekliliği
 *   olmayan yapışık blok elenir (önünde duran duvar/zemin gövdeye yapışıp
 *   silueti kirletemez). Gerçek maske boşluğuyla ayrılanlar (koyu gölge)
 *   yakınlık kurallarından eskisi gibi yararlanır.
 * - Satır boşluk dolgusu: satır içinde iki ön plan parçası arasındaki
 *   boşluk MAX_GAP_FILL'den darsa kapatılır; geniş açık hava (kol-baş
 *   arası gökyüzü gibi) doldurulmaz — perde/webbing oluşmaz.
 * - Radyal sönümleme YOKTUR: maskelenmiş siluet bbox'ının İÇİNDEKİ hiçbir
 *   piksel α'dan delinemez — kafa üstü ve köşeler her koşulda korunur.
 */
function keepForeground(
  mask: Float32Array,
  w: number,
  h: number,
  depth: Float32Array,
  filled: Uint8Array,
  foregroundMask: Float32Array | null,
) {
  const n = mask.length;
  const compId = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const touchL: boolean[] = [];
  const touchR: boolean[] = [];
  const touchT: boolean[] = [];
  const touchB: boolean[] = [];
  const boxes: { minX: number; maxX: number; minY: number; maxY: number }[] = [];
  const pixels: number[][] = [];
  const stack = new Int32Array(n);
  let nextId = 0;

  // Bağlantı: kapanış köprüsü (iç delik dolgusu) VEYA depth gradyan sürekliliği
  // VEYA MASKE GÜVENİ — iki pikselin İKİSİ de nesne maskesinin içindeyse
  // (≥ 0.5) bağlantı kurulur. Sebep: gerçek bir uzuv (havaya kalkmış kol)
  // yüzden ÖNE çıktığı için |Δd| GRADIENT_BREAK'i (0.15) aşıyor, bileşen
  // "severed" sayılıp eleniyordu (kullanıcı fotoğrafında kol + kürk siliniyor).
  // Duvar reddi KORUNUR: duvarın maskesi düşüktür, maske kolu bu koşulu
  // açamaz — gradyan eşiği duvar/zemin için tek başına hâlâ karar vericidir.
  // Maske yoksa davranış AYNEN eskisi gibidir.
  const connected = (p: number, q: number) =>
    filled[p] ||
    filled[q] ||
    Math.abs(depth[p] - depth[q]) <= GRADIENT_BREAK ||
    (foregroundMask !== null && foregroundMask[p] >= 0.5 && foregroundMask[q] >= 0.5);

  for (let i = 0; i < n; i++) {
    if (mask[i] < 0.5 || compId[i] >= 0) continue;
    let sp = 0;
    stack[sp++] = i;
    compId[i] = nextId;
    const list: number[] = [];
    let size = 0;
    let l = false;
    let r = false;
    let t = false;
    let b = false;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      list.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      if (x === 0) l = true;
      if (x === w - 1) r = true;
      if (y === 0) t = true;
      if (y === h - 1) b = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] >= 0.5 && compId[p - 1] < 0 && connected(p, p - 1)) {
        compId[p - 1] = nextId;
        stack[sp++] = p - 1;
      }
      if (x < w - 1 && mask[p + 1] >= 0.5 && compId[p + 1] < 0 && connected(p, p + 1)) {
        compId[p + 1] = nextId;
        stack[sp++] = p + 1;
      }
      if (y > 0 && mask[p - w] >= 0.5 && compId[p - w] < 0 && connected(p, p - w)) {
        compId[p - w] = nextId;
        stack[sp++] = p - w;
      }
      if (y < h - 1 && mask[p + w] >= 0.5 && compId[p + w] < 0 && connected(p, p + w)) {
        compId[p + w] = nextId;
        stack[sp++] = p + w;
      }
    }
    sizes.push(size);
    touchL.push(l);
    touchR.push(r);
    touchT.push(t);
    touchB.push(b);
    boxes.push({ minX, maxX, minY, maxY });
    pixels.push(list);
    nextId++;
  }

  if (nextId === 0) return; // tamamen arka plan

  // Çekirdek seçimi: çerçeveye değmeyen en büyük → yalnızca alt kenara
  // değen en büyük → en büyük. Kenara değmek tek başına itibarsızlaştırmaz.
  // TAM KADRAJ KORUMASI (Tur 9): özne çerçevenin tamamını dolduruyorsa (bust
  // fotoğrafı gibi — derinlik sürekliliği duvarı özneye kaynaştırır) tek dev
  // bileşen dört kenara da değer; içerideki 1-2 piksellik gürültü benekleri
  // "çerçeveye değmeyen en büyük" seçimini çalıp bütün sahneyi silebilir.
  // Adayların en büyük bileşenin %10'una ulaşması gerekir: benekler elenir,
  // gerçek özne (sahneye göre iri) ve tam kadraj gövde aday kalır.
  const borderFree = (c: number) =>
    !touchL[c] && !touchR[c] && !touchT[c] && !touchB[c];
  const bottomOnly = (c: number) =>
    touchB[c] && !touchL[c] && !touchR[c] && !touchT[c];
  let largestAll = 0;
  for (let c = 0; c < nextId; c++) {
    if (sizes[c] > largestAll) largestAll = sizes[c];
  }
  const minCoreSize = largestAll * 0.1;
  let core = -1;
  for (let c = 0; c < nextId; c++) {
    if (!borderFree(c)) continue;
    if (sizes[c] < minCoreSize) continue;
    if (core < 0 || sizes[c] > sizes[core]) core = c;
  }
  if (core < 0) {
    for (let c = 0; c < nextId; c++) {
      if (!bottomOnly(c)) continue;
      if (sizes[c] < minCoreSize) continue;
      if (core < 0 || sizes[c] > sizes[core]) core = c;
    }
  }
  if (core < 0) {
    core = 0;
    for (let c = 1; c < nextId; c++) {
      if (sizes[c] > sizes[core]) core = c;
    }
  }

  const overlapsX = (a: typeof boxes[0], b: typeof boxes[0]) =>
    a.minX <= b.maxX && a.maxX >= b.minX;
  const overlapsY = (a: typeof boxes[0], b: typeof boxes[0]) =>
    a.minY <= b.maxY && a.maxY >= b.minY;
  const gapX = (a: typeof boxes[0], b: typeof boxes[0]) =>
    Math.max(0, Math.max(a.minX - b.maxX - 1, b.minX - a.maxX - 1));
  const gapY = (a: typeof boxes[0], b: typeof boxes[0]) =>
    Math.max(0, Math.max(a.minY - b.maxY - 1, b.minY - a.maxY - 1));

  // Gradyan sürekliliği denetimi: adayın çekirdeğe maskede DOĞRUDAN bitişik
  // olup olmadığını ve bitişiklik noktalarında |Δd| ≤ 0.15 sürekliliği
  // bulunup bulunmadığını piksel listesi üzerinden tarar.
  const contactCheck = (c: number) => {
    let touching = false;
    for (let k = 0; k < pixels[c].length; k++) {
      const p = pixels[c][k];
      const x = p % w;
      const y = (p / w) | 0;
      const qs: number[] = [];
      if (x > 0) qs.push(p - 1);
      if (x < w - 1) qs.push(p + 1);
      if (y > 0) qs.push(p - w);
      if (y < h - 1) qs.push(p + w);
      for (const q of qs) {
        if (compId[q] !== core) continue;
        touching = true;
        if (connected(p, q)) return { touching: true, continuous: true };
      }
    }
    return { touching, continuous: false };
  };

  // Gövde birleştirme (iteratif).
  const keepIds = new Set<number>([core]);
  let bx = boxes[core];
  for (let iter = 0; iter < 5; iter++) {
    let changed = false;
    for (let c = 0; c < nextId; c++) {
      if (keepIds.has(c)) continue;
      const b = boxes[c];
      const xO = overlapsX(b, bx);
      const yO = overlapsY(b, bx);
      const gX = gapX(b, bx);
      const gY = gapY(b, bx);
      // Kalkık uzuv köprüsü: bileşen siluet bbox'unun üst çeyreğinde yer
      // alıyor ve ana kütleye iki eksende de PROXIMITY_BRIDGE_PX'ten yakınsa
      // ZORUNLU katılır — kol ile saç arasındaki koyu gölge bileşeni kesse
      // bile el/bilek gövdeden koparılmaz.
      const upperQuarter =
        (b.minY + b.maxY) / 2 <= bx.minY + (bx.maxY - bx.minY) / 4;
      // Gradyan kesmesiyle ayrışan, maskede DOĞRUDAN bitişik kalan ve hiçbir
      // temas noktasında süreklilik taşımayan bileşen ("severed contact")
      // hiçbir kurala başvuramaz — önünde duran duvar/zemin gövdeye
      // yapışamaz. filled köprüler (iç delik kapanışı) süreklilik sayılır.
      const { touching, continuous } = contactCheck(c);
      const severed = touching && !continuous;
      const joins =
        !severed &&
        ((xO && yO) ||
          (yO && gX <= NEAR_PX) ||
          (xO && gY <= NEAR_PX) ||
          (bottomOnly(c) && yO && gX <= NEAR_PX) ||
          (upperQuarter && gX <= PROXIMITY_BRIDGE_PX && gY <= PROXIMITY_BRIDGE_PX));
      if (!joins) continue;
      keepIds.add(c);
      bx = {
        minX: Math.min(bx.minX, b.minX),
        maxX: Math.max(bx.maxX, b.maxX),
        minY: Math.min(bx.minY, b.minY),
        maxY: Math.max(bx.maxY, b.maxY),
      };
      changed = true;
    }
    if (!changed) break;
  }

  // Seçilen bileşenleri maskede tut, gerisini temizle.
  for (let p = 0; p < n; p++) {
    if (compId[p] < 0 || !keepIds.has(compId[p])) mask[p] = 0;
  }

  // Satır boşluk dolgusu (yerel gap-fill): satır içinde iki parça ARASINDA
  // kalan ve MAX_GAP_FILL'i aşmayan boşluklar kapatılır; geniş açıklıklar
  // (kol-baş arası gökyüzü) olduğu gibi boş kalır — yapay perde oluşmaz.
  for (let y = bx.minY; y <= bx.maxY; y++) {
    const rowStart = y * w;
    let prev = -1;
    for (let x = bx.minX; x <= bx.maxX; x++) {
      if (mask[rowStart + x] < 0.5) continue;
      if (prev >= 0) {
        const gap = x - prev - 1;
        if (gap > 0 && gap <= MAX_GAP_FILL) {
          for (let g = prev + 1; g < x; g++) mask[rowStart + g] = 1;
        }
      }
      prev = x;
    }
  }
}

/**
 * Siluet sınırına uzaklık (chamfer 3-4, iki geçiş). Binary içinde her
 * piksel EN DIŞ birleşik kontura (outer contour) olan minimum mesafeyi
 * alır; dışarısı 0 kalır.
 *
 * Sınır, grid kenarına bağlı arka plana (dışarı) komşu olan maske
 * pikselleridir — İÇ boşluklar/gölgeler sınır DEĞİLDİR: yüz veya gövde
 * içindeki parlaklık düşüşleri dist = 0 tetiklemez, kenar dökümü yalnızca
 * en dış çevreye uygulanır. KADRAJ (grid) KENARI SINIR SAYILMAZ: çerçevenin
 * kestiği siluet pikselleri düz kalır (arka yüzleri kadraj duvarına
 * dönüşmez); maskenin dışındaki gerçek arka plana komşuluk tek sınırdır.
 */
function boundaryDistance(mask: Float32Array, w: number, h: number): Float32Array {
  // Dışarı işareti: grid kenarından başlayan arka plan seli (4-komşu).
  // Maske içinde kalan 0'lar (iç boşluklar) bu sel tarafından işaretlenmez.
  const outside = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (mask[p] >= 0.5) continue;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        outside[p] = 1;
        queue[tail++] = p;
      }
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0 && !outside[p - 1] && mask[p - 1] < 0.5) {
      outside[p - 1] = 1;
      queue[tail++] = p - 1;
    }
    if (x < w - 1 && !outside[p + 1] && mask[p + 1] < 0.5) {
      outside[p + 1] = 1;
      queue[tail++] = p + 1;
    }
    if (y > 0 && !outside[p - w] && mask[p - w] < 0.5) {
      outside[p - w] = 1;
      queue[tail++] = p - w;
    }
    if (y < h - 1 && !outside[p + w] && mask[p + w] < 0.5) {
      outside[p + w] = 1;
      queue[tail++] = p + w;
    }
  }
  const INF = 1e9;
  const dist = new Float32Array(mask.length);
  for (let i = 0; i < dist.length; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    const touchesOutside =
      (x > 0 && outside[i - 1]) ||
      (x < w - 1 && outside[i + 1]) ||
      (y > 0 && outside[i - w]) ||
      (y < h - 1 && outside[i + w]);
    // Kadraj kenarı burada BİLEREK yok: grid sınırı dış kontur değildir.
    dist[i] = mask[i] >= 0.5 && !touchesOutside ? INF : 0;
  }
  // ileri geçiş: üstten alta, soldan sağa
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const p = row + x;
      if (dist[p] === 0) continue;
      if (y > 0) dist[p] = Math.min(dist[p], dist[p - w] + 1);
      if (x > 0) dist[p] = Math.min(dist[p], dist[p - 1] + 1);
      if (y > 0 && x > 0) dist[p] = Math.min(dist[p], dist[p - w - 1] + 1.41421356);
      if (y > 0 && x < w - 1) dist[p] = Math.min(dist[p], dist[p - w + 1] + 1.41421356);
    }
  }
  // geri geçiş: alttan üste, sağdan sola
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const p = row + x;
      if (dist[p] === 0) continue;
      if (y < h - 1) dist[p] = Math.min(dist[p], dist[p + w] + 1);
      if (x < w - 1) dist[p] = Math.min(dist[p], dist[p + 1] + 1);
      if (y < h - 1 && x < w - 1) dist[p] = Math.min(dist[p], dist[p + w + 1] + 1.41421356);
      if (y < h - 1 && x > 0) dist[p] = Math.min(dist[p], dist[p + w - 1] + 1.41421356);
    }
  }
  // INF BİLEREK KORUNUR: erişilemeyen iç kısım (ör. dış konturu olmayan tüm
  // ön plan) sampler'da fill = 1 − min(1, INF/d1) = 0 üretir — kadrajı
  // dolduran ön plan hiçbir yerde dökülmez. INF'yi 0'a çevirmek iç kısmı
  // "sınıra 0 mesafe" (tam döküm hedefi) gibi davrandırırdı.
  return dist;
}

/**
 * Merkez-hizalı bilinear yeniden örnekleme: src (srcW×srcH) → dstW×dstH.
 * Maske/depth gibi haritaları iki farklı çözünürlük arasında taşır (ör.
 * segmentation çıktısı → depth boyutu). Kaynak koordinat sınırlarına
 * kelepçelenir; çıktı [0, 1] aralığı korunmaz — saf uzamsal yeniden örnekleme.
 */
export function resampleBilinear(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const out = new Float32Array(dstW * dstH);
  for (let j = 0; j < dstH; j++) {
    const sy = ((j + 0.5) * srcH) / dstH - 0.5;
    const y0 = Math.min(srcH - 1, Math.max(0, Math.floor(sy)));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const ty = Math.min(1, Math.max(0, sy - y0));
    for (let i = 0; i < dstW; i++) {
      const sx = ((i + 0.5) * srcW) / dstW - 0.5;
      const x0 = Math.min(srcW - 1, Math.max(0, Math.floor(sx)));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const tx = Math.min(1, Math.max(0, sx - x0));
      const top = src[y0 * srcW + x0] * (1 - tx) + src[y0 * srcW + x1] * tx;
      const bot = src[y1 * srcW + x0] * (1 - tx) + src[y1 * srcW + x1] * tx;
      out[j * dstW + i] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}
