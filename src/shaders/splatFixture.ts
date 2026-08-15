/**
 * SPLAT SPIKE VERİSİ (render katmanı — Zeynep, Gün 1).
 *
 * Gün 1'in amacı rasterizer'ı Emre'nin füzyonunu BEKLEMEDEN ayağa kaldırmak:
 * elle yazılmış sabit bir Gauss kümesiyle instanced quad + yönlü elips
 * fragment'ini doğrulamak. Bu dosya o sabit veriyi üretir; üretimde
 * (Gün 7 füzyonu geldiğinde) yerini gerçek GaussianBuffer alır — sözleşme
 * (D.1) aynı olduğu için material'da tek satır değişmez.
 *
 * KABUL ÖLÇÜTÜ (Gün 1): ekranda gerçek ANİZOTROPİK splat'lar olmalı ve kamera
 * dönünce elipsler doğru yönelmeli. Küre kabuğu bunun en dürüst düzeneğidir:
 * normaller dışa bakar, yani siluet kenarındaki splat'lar kameraya YANDAN
 * gelir ve ince çizgiye dönmek ZORUNDADIR. Yönelim yanlış kurulmuşsa (normal
 * yok sayılıp hep ekrana paralel disk çizilirse) kenarda yuvarlak kalırlar —
 * hata gözle anında görülür.
 */

/**
 * D.1 GaussianBuffer'ın CPU tarafı. Üç kanal grubu, splat başına 4'er değer:
 *   a: xyz (dünya) + opaklık
 *   b: normal.xyz (birim) + ölçek (dünya yarıçapı)
 *   c: rgb + AO (0..1)
 * Texture'a taşıma `engine/splats.ts` işidir — bu tip GPU bilmez.
 *
 * D.4 — `keyframeIndex` (Gün 7): splat başına kaynak keyframe sırası
 * (timeline filtresi için). GPU'ya GİTMEZ — material/sıralama bundan
 * habersizdir; timeline filtreleme CPU tarafında okur (render tarafı
 * dokunulmadı — Zeynep onayı beklenmeden, D.4 sözleşmesi imzalı).
 */
export interface GaussianBufferData {
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
  /** D.4 — splat başına kaynak keyframe id (0..keyframeCount-1). */
  keyframeIndex: Uint16Array;
  count: number;
}

export function createGaussianBufferData(count: number): GaussianBufferData {
  return {
    a: new Float32Array(count * 4),
    b: new Float32Array(count * 4),
    c: new Float32Array(count * 4),
    keyframeIndex: new Uint16Array(count),
    count,
  };
}

/**
 * Deterministik sözde-rastgele (mulberry32). Sabit tohum: spike sahnesi her
 * açılışta AYNI görünür — "bazen düzeliyor" tipi hata avı imkânsız olmasın.
 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gün 1 spike sahnesi: yarıçapı `radius` olan küre kabuğunda `count` Gauss.
 *
 * - Konum: Fibonacci küresi (altın açı) — düzgün dağılım, kümelenme yok.
 * - Normal: dışa bakan birim vektör (kabuk normali). Siluet kenarındaki
 *   splat'ın kameraya göre yandan gelmesi bu satırdan doğar.
 * - Ölçek: taban ölçeğin ±%40'ı kadar rastgele — anizotropi gözle ayırt
 *   edilebilsin diye (hepsi eşit olsaydı yönelim hatası fark edilmezdi).
 * - Renk: normalden türetilen küresel gradyan (yön → renk), böylece yanlış
 *   yönelmiş bir splat renk süreksizliği olarak da belli olur.
 * - Opaklık: kutuplara doğru hafif azalır; sıralama kapısının (minOpacity)
 *   gerçekten iş gördüğü bir aralık üretir.
 */
export function buildSpikeSphere(
  count = 1000,
  radius = 0.9,
  baseScale = 0.045,
  seed = 0x5eed,
): GaussianBufferData {
  const out = createGaussianBufferData(count);
  const rnd = mulberry32(seed);
  const golden = Math.PI * (3 - Math.sqrt(5)); // altın açı
  for (let i = 0; i < count; i++) {
    // Fibonacci küresi: y düzgün [-1, 1], çember açısı altın açıyla döner.
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const nx = Math.cos(theta) * r;
    const ny = y;
    const nz = Math.sin(theta) * r;

    const o = i * 4;
    out.a[o] = nx * radius;
    out.a[o + 1] = ny * radius;
    out.a[o + 2] = nz * radius;
    // Opaklık: ekvatorda tam, kutupta 0.45 — kapı testine aralık bırakır.
    out.a[o + 3] = 0.45 + 0.55 * (1 - Math.abs(y));

    out.b[o] = nx;
    out.b[o + 1] = ny;
    out.b[o + 2] = nz;
    out.b[o + 3] = baseScale * (0.6 + 0.8 * rnd());

    // Yön → renk: normalin [-1,1] bileşenleri 0..1'e taşınır.
    out.c[o] = 0.5 + 0.5 * nx;
    out.c[o + 1] = 0.5 + 0.5 * ny;
    out.c[o + 2] = 0.5 + 0.5 * nz;
    out.c[o + 3] = 1; // AO nötr (spike'ta oklüzyon yok)
  }
  return out;
}

/**
 * Gün 2 ölçek testi: `count` kadar Gauss'u küp hacme deterministik dağıtır.
 * Küre kabuğu 147k'da fazla seyrek kalıyor (tek katman); sıralama ve blend
 * yükünü gerçekçi ölçmek için ÜST ÜSTE BİNEN splat'lar gerekir — hacim
 * dolgusu tam olarak bunu üretir (her pikselde onlarca örtüşme).
 *
 * Bu bir GÖRSEL hedef değil, PERFORMANS düzeneğidir: Gün 2'nin "147k splat,
 * kabul edilebilir FPS, sıralama hatası kaynaklı yanıp sönme yok" ölçütü
 * bunun üzerinde ölçülür.
 */
export function buildStressVolume(
  count = 147456,
  extent = 0.9,
  baseScale = 0.02,
  seed = 0xc0ffee,
): GaussianBufferData {
  const out = createGaussianBufferData(count);
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const x = (rnd() * 2 - 1) * extent;
    const y = (rnd() * 2 - 1) * extent;
    const z = (rnd() * 2 - 1) * extent;
    out.a[o] = x;
    out.a[o + 1] = y;
    out.a[o + 2] = z;
    out.a[o + 3] = 0.25 + 0.5 * rnd();
    // Normal: rastgele birim yön (rejeksiyonsuz — kutup yığılması bu testte
    // önemsiz, deterministiklik önemli).
    const u = rnd() * 2 - 1;
    const phi = rnd() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    out.b[o] = Math.cos(phi) * s;
    out.b[o + 1] = u;
    out.b[o + 2] = Math.sin(phi) * s;
    out.b[o + 3] = baseScale * (0.5 + rnd());
    out.c[o] = 0.35 + 0.6 * rnd();
    out.c[o + 1] = 0.35 + 0.6 * rnd();
    out.c[o + 2] = 0.4 + 0.6 * rnd();
    out.c[o + 3] = 1;
  }
  return out;
}
