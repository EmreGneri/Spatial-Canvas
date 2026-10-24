// DAViD (Microsoft, ICCV 2025, MIT) insan derinliğini sahne derinliğine kaynaştırır.
// Saf CPU, DOM yok: node testinden (verify-david-fuzyon) doğrudan çalışır.
import { resampleBilinear } from '../reconstruction/silhouette.ts';

export const DAVID_SINIR = {
  /** Uydurma yalnız bu kadar emin maske pikselinde (DAViD yumuşak maskesi). */
  cekirdek: 0.9,
  /** Çekirdek karenin bundan azını kaplıyorsa kişi yok sayılır (füzyon atlanır). */
  minMaskeOrani: 0.01,
  /** Sağlam yayılım için yüzdelikler (uç kuyruklar: kol/saç/maske sızıntısı). */
  altYuzde: 0.1,
  ustYuzde: 0.9,
};

export interface DavidFuzyonSonucu {
  data: Float32Array;
  olcek: number;
  kayma: number;
  /** Çekirdekte sahne ↔ DAViD Pearson ilişkisi (tanı; negatifse füzyon reddedilir). */
  korelasyon: number;
  cekirdekOrani: number;
}

function yuzdelik(sirali: Float64Array, p: number) {
  return sirali[Math.floor(p * (sirali.length - 1))];
}

/**
 * DAViD ham düzlemini ([S×S]) letterbox iç dikdörtgenine kırpıp hedef ızgaraya örnekler.
 * KUTUP ÖLÇÜLDÜ (2026-10-24, HUUpP portresi, CPU fp32): ham derinlik zaten YAKIN = BÜYÜK
 * (öne uzanan el en parlak, arka plan en koyu; tüm kare 0.418..0.429). Resmî runtime'daki
 * `is_inverse` (-1) bu yüzden UYGULANMAZ; yanlış kutup füzyondaki korelasyon kapısında reddedilir.
 */
export function davidCiktisiniCoz(
  ham: Float32Array, S: number, rect: { x: number; y: number; w: number; h: number }, w: number, h: number,
): Float32Array {
  const kirp = new Float32Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) kirp[y * rect.w + x] = ham[(rect.y + y) * S + rect.x + x];
  return rect.w === w && rect.h === h ? kirp : resampleBilinear(kirp, rect.w, rect.h, w, h);
}

/**
 * Kişi maskesi içinde sahne derinliğini DAViD şekliyle değiştirir.
 *
 * KONUM ve GENLİK sahneden, ŞEKİL DAViD'den: çekirdek piksellerde
 *   ölçek = yayılım(sahne) / yayılım(DAViD)   (yayılım = p90 − p10)
 *   kayma = medyan(sahne) − ölçek · medyan(DAViD)
 * En küçük kareler BİLEREK kullanılmadı: ölçek = r·σs/σd, yani sahne kişiyi düz
 * gördüğü ölçüde (r düşük) DAViD'in rölyefini geri küçültür — düzeltmek istediğimiz
 * düzlüğü geri getirir (aynı gözlem: depth.ts mergeSubjectDetail başlığı). Toplam
 * kalınlık zaten silüetten (stretch + zSpan) gelir; burada yalnız şekil değişir.
 *
 * Karışım: out = m·uydurulmuş + (1−m)·sahne (m = DAViD yumuşak maskesi) → kenar tüylenir.
 * Reddetme (null → çağıran sahne derinliğiyle devam eder): boyut dışı NaN, çekirdek
 * < %1, DAViD çekirdekte sabit, ya da ilişki negatif (kutup/çıktı bozuk).
 */
export function davidFuzyon(
  sahne: Float32Array, david: Float32Array, maske: Float32Array, w: number, h: number,
): DavidFuzyonSonucu | null {
  const n = w * h;
  if (sahne.length !== n || david.length !== n || maske.length !== n) {
    throw new Error(`davidFuzyon: boyut uyuşmazlığı (${sahne.length}, ${david.length}, ${maske.length} ≠ ${n})`);
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(david[i]) || !Number.isFinite(maske[i])) return null;
    if (maske[i] >= DAVID_SINIR.cekirdek) idx.push(i);
  }
  const cekirdekOrani = idx.length / n;
  if (cekirdekOrani < DAVID_SINIR.minMaskeOrani || idx.length < 16) return null;
  const s = Float64Array.from(idx, (i) => sahne[i]).sort();
  const d = Float64Array.from(idx, (i) => david[i]).sort();
  const yayD = yuzdelik(d, DAVID_SINIR.ustYuzde) - yuzdelik(d, DAVID_SINIR.altYuzde);
  const yayS = yuzdelik(s, DAVID_SINIR.ustYuzde) - yuzdelik(s, DAVID_SINIR.altYuzde);
  if (!(yayD > 1e-9)) return null;
  let ms = 0, md = 0;
  for (const i of idx) { ms += sahne[i]; md += david[i]; }
  ms /= idx.length; md /= idx.length;
  let pay = 0, vs = 0, vd = 0;
  for (const i of idx) {
    const a = sahne[i] - ms, b = david[i] - md;
    pay += a * b; vs += a * a; vd += b * b;
  }
  const korelasyon = vs > 0 && vd > 0 ? pay / Math.sqrt(vs * vd) : 0;
  if (korelasyon < 0) return null;
  const olcek = yayS / yayD;
  const kayma = yuzdelik(s, 0.5) - olcek * yuzdelik(d, 0.5);
  const data = Float32Array.from(sahne);
  for (let i = 0; i < n; i++) {
    const m = Math.min(1, Math.max(0, maske[i]));
    if (m === 0) continue;
    const f = Math.min(1, Math.max(0, olcek * david[i] + kayma));
    data[i] = m * f + (1 - m) * sahne[i];
  }
  return { data, olcek, kayma, korelasyon, cekirdekOrani };
}
