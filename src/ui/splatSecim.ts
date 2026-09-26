/**
 * SPLAT TEMİZLEME — SEÇİM MANTIĞI. DOM'suz, Node'dan test edilir.
 *
 * NEDEN VAR: eğitim/füzyon sonrası sahnede havada duran "floater" Gaussian'lar
 * ve arka plan artığı kalıyor; çıktı (PLY, PNG, klip) kirli çıkıyor. Otomatik
 * filtre DENENDİ ve başarısız oldu (Emre'nin raporu: üç filtre de ya gerçek
 * içeriği siliyor ya floater'ı azaltmıyor) — bu yüzden ELLE seçim tek yol.
 *
 * GİRDİ SÖZLEŞMESİ: `xyzw` = GaussianBuffer'ın gSplatA'sı (x, y, z, opaklık),
 * splat başına 4 float. Bu modül onu YAZMAZ, yalnız okur; yazma `silmeUygula`
 * / `geriAl` üzerinden ve yalnız OPAKLIK kanalında olur. Konum asla değişmez —
 * silme geri alınabilir kalır ve sıralama girdisi (splatSort) aynı diziyi
 * okumaya devam eder.
 *
 * SİLME = OPAKLIK 0. Diziden gerçekten çıkarmak (filtreleme) denendi ve
 * bırakıldı: indeksler kayar, D.4 keyframe kimliği ve sıralama scratch'i
 * geçersizleşir, geri alma imkânsızlaşır. Opaklık kapısı (splatSort ·
 * `minOpacity`) 0 opaklıklı splat'ı HİÇ sıraya almaz — çizim maliyeti de
 * kalkar, yani "gerçekten silinmiş" gibi davranır.
 */

export type SecimAraci = 'firca' | 'lasso' | 'kure';

/**
 * Varsayılan opaklık kapısı. GERÇEK kapı motordan gelir
 * (`Engine.splatOpacityThreshold`): nesne ayırma açıkken 0.50'ye çıkıyor ve
 * köprü doldurucusunun 0.40 opaklıklı 140 bin arka plan splat'ı o anda ZATEN
 * çizilmiyor. Sabit 0.02 ile çalışmak onları "seçilebilir" sayar, sayaç
 * yalan söyler ve silme ekranda hiçbir şey değiştirmez. Bu sabit yalnız
 * kapının bilinmediği hâl için.
 */
export const GORUNUR_ESIGI = 0.02;

/**
 * Ekran uzayı izdüşümü. `viewProj` three.js `Matrix4.elements` (KOLON-major).
 * Çıktı: splat başına [x_px, y_px, wClip]. wClip ≤ 0 → kameranın ARKASINDA.
 *
 * Kadraj DIŞI splat de yazılır (kırpma seçimde yapılır): kırpmayı burada
 * yapmak, lasso'nun kadraj kenarından taşan poligonunu bozardı.
 */
export function ekranaProjekte(
  xyzw: Float32Array,
  count: number,
  viewProj: ArrayLike<number>,
  genislik: number,
  yukseklik: number,
  hedef?: Float32Array,
): Float32Array {
  const out = hedef && hedef.length >= count * 3 ? hedef : new Float32Array(count * 3);
  const m = viewProj;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const x = xyzw[o];
    const y = xyzw[o + 1];
    const z = xyzw[o + 2];
    // Kolon-major: clip.x = m[0]x + m[4]y + m[8]z + m[12]
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    const k = i * 3;
    out[k + 2] = cw;
    if (cw === 0) {
      out[k] = NaN;
      out[k + 1] = NaN;
      continue;
    }
    // NDC → piksel. Ekran y AŞAĞI artar, NDC y YUKARI — işaret ters çevrilir.
    out[k] = (cx / cw * 0.5 + 0.5) * genislik;
    out[k + 1] = (1 - (cy / cw * 0.5 + 0.5)) * yukseklik;
  }
  return out;
}

/** Kameranın önünde, kadrajda ve görünür opaklıkta mı? */
function secilebilir(
  ekran: Float32Array,
  xyzw: Float32Array,
  i: number,
  genislik: number,
  yukseklik: number,
  pay: number,
  esik: number,
): boolean {
  if (xyzw[i * 4 + 3] <= esik) return false; // zaten silinmiş/çizilmiyor
  const k = i * 3;
  if (!(ekran[k + 2] > 0)) return false; // kameranın arkası
  const x = ekran[k];
  const y = ekran[k + 1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= -pay && x <= genislik + pay && y >= -pay && y <= yukseklik + pay;
}

/**
 * FIRÇA: ekranda (x, y) merkezli `yaricapPx` daire içine düşen splat'lar.
 * Daire testi kare kökten kaçınmak için karesel yapılır (147k splat × her
 * pointermove).
 */
export function fircaSecimi(
  ekran: Float32Array,
  xyzw: Float32Array,
  count: number,
  genislik: number,
  yukseklik: number,
  x: number,
  y: number,
  yaricapPx: number,
  esik = GORUNUR_ESIGI,
): Int32Array {
  const r2 = yaricapPx * yaricapPx;
  const bulunan: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!secilebilir(ekran, xyzw, i, genislik, yukseklik, yaricapPx, esik)) continue;
    const k = i * 3;
    const dx = ekran[k] - x;
    const dy = ekran[k + 1] - y;
    if (dx * dx + dy * dy <= r2) bulunan.push(i);
  }
  return Int32Array.from(bulunan);
}

/**
 * Nokta poligonun içinde mi — ışın atma (ray casting), tek eksende.
 * Kenar üstündeki nokta belirsizdir; lasso için önemsiz.
 */
export function poligonIcinde(poligon: ArrayLike<number>, x: number, y: number): boolean {
  const n = poligon.length / 2;
  if (n < 3) return false;
  let ic = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poligon[i * 2];
    const yi = poligon[i * 2 + 1];
    const xj = poligon[j * 2];
    const yj = poligon[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ic = !ic;
  }
  return ic;
}

/** LASSO: serbest çizilen kapalı poligonun içine düşen splat'lar. */
export function lassoSecimi(
  ekran: Float32Array,
  xyzw: Float32Array,
  count: number,
  genislik: number,
  yukseklik: number,
  poligon: ArrayLike<number>,
  esik = GORUNUR_ESIGI,
): Int32Array {
  if (poligon.length < 6) return new Int32Array(0);
  // Sınırlayıcı kutu ön-testi: poligon genelde kadrajın küçük bir parçası,
  // ışın atmayı 147k kez koşturmak gereksiz.
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let p = 0; p < poligon.length; p += 2) {
    if (poligon[p] < x0) x0 = poligon[p];
    if (poligon[p] > x1) x1 = poligon[p];
    if (poligon[p + 1] < y0) y0 = poligon[p + 1];
    if (poligon[p + 1] > y1) y1 = poligon[p + 1];
  }
  const bulunan: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!secilebilir(ekran, xyzw, i, genislik, yukseklik, 0, esik)) continue;
    const k = i * 3;
    const x = ekran[k];
    const y = ekran[k + 1];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    if (poligonIcinde(poligon, x, y)) bulunan.push(i);
  }
  return Int32Array.from(bulunan);
}

/**
 * İMLEÇ ALTINDAKİ SPLAT (küre aracının merkezi): `yaricapPx` içindeki
 * splat'lardan kameraya EN YAKIN olanı. `null` = orada splat yok.
 *
 * En yakın olanı seçmek şart: fırça dairesinin içinde hem öznenin yüzeyi hem
 * arkasındaki floater olabilir; kullanıcı gördüğü şeye tıkladığını sanır.
 */
export function enYakinSplat(
  ekran: Float32Array,
  xyzw: Float32Array,
  count: number,
  genislik: number,
  yukseklik: number,
  x: number,
  y: number,
  yaricapPx: number,
  esik = GORUNUR_ESIGI,
): number | null {
  const r2 = yaricapPx * yaricapPx;
  let en = -1;
  let enW = Infinity;
  for (let i = 0; i < count; i++) {
    if (!secilebilir(ekran, xyzw, i, genislik, yukseklik, yaricapPx, esik)) continue;
    const k = i * 3;
    const dx = ekran[k] - x;
    const dy = ekran[k + 1] - y;
    if (dx * dx + dy * dy > r2) continue;
    if (ekran[k + 2] < enW) { enW = ekran[k + 2]; en = i; }
  }
  return en < 0 ? null : en;
}

/**
 * Ekrandaki `yaricapPx`'in, verilen görünüm derinliğindeki DÜNYA karşılığı.
 *
 * Türetme: M = P·V ve V katı (dönme+öteleme) olduğu için M'in 3×3 kısmının
 * 0. SATIRI P00 · R'nin 0. satırıdır; R satırları birim olduğundan o satırın
 * normu |P00|'dır. Δndc.x = P00·δ/wClip ve Δpx = Δndc.x·genişlik/2 →
 *   δ = 2·Δpx·wClip / (|P00|·genişlik)
 * Yani küre yarıçapı fırça yarıçapıyla AYNI BİRİMDE kalır (piksel), ama
 * derinliğe göre doğru dünya ölçüsüne çevrilir — uzaktaki floater için küre
 * büyür, yakındaki yüzey için küçülür.
 */
export function ekranYaricapiniDunyaya(
  viewProj: ArrayLike<number>,
  wClip: number,
  yaricapPx: number,
  genislik: number,
): number {
  const p00 = Math.hypot(viewProj[0], viewProj[4], viewProj[8]);
  if (!(p00 > 0) || !(genislik > 0)) return 0;
  return (2 * yaricapPx * Math.abs(wClip)) / (p00 * genislik);
}

/**
 * KÜRE: dünya uzayında `merkez` çevresinde `yaricap` içindeki splat'lar.
 * Ekran araçlarının aksine ARKADAKİNİ ALMAZ — floater'ı özneden ayırmanın tek
 * yolu derinliği hesaba katmaktır (fırça, siluetin arkasındaki yüzeyi de
 * silerdi).
 */
export function kureSecimi(
  xyzw: Float32Array,
  count: number,
  merkez: readonly [number, number, number],
  yaricap: number,
  esik = GORUNUR_ESIGI,
): Int32Array {
  const r2 = yaricap * yaricap;
  const bulunan: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if (xyzw[o + 3] <= esik) continue;
    const dx = xyzw[o] - merkez[0];
    const dy = xyzw[o + 1] - merkez[1];
    const dz = xyzw[o + 2] - merkez[2];
    if (dx * dx + dy * dy + dz * dz <= r2) bulunan.push(i);
  }
  return Int32Array.from(bulunan);
}

/** Bir silme işleminin geri alma kaydı: hangi indeksler, hangi opaklıktaydı. */
export interface SilmeKaydi {
  indeksler: Int32Array;
  eskiOpaklik: Float32Array;
}

/**
 * Seçili indekslerin opaklığını 0'a çeker ve geri alma kaydını döndürür.
 * ZATEN 0 olanlar kayda GİRMEZ: aynı yeri iki kez silmek, geri almayı iki
 * adıma bölmesin.
 */
export function silmeUygula(xyzw: Float32Array, indeksler: ArrayLike<number>): SilmeKaydi | null {
  const idx: number[] = [];
  const eski: number[] = [];
  for (let n = 0; n < indeksler.length; n++) {
    const i = indeksler[n];
    const o = i * 4 + 3;
    if (xyzw[o] <= 0) continue;
    idx.push(i);
    eski.push(xyzw[o]);
    xyzw[o] = 0;
  }
  if (idx.length === 0) return null;
  return { indeksler: Int32Array.from(idx), eskiOpaklik: Float32Array.from(eski) };
}

/** Kaydı geri alır: opaklıklar eski değerlerine döner. */
export function geriAl(xyzw: Float32Array, kayit: SilmeKaydi): number {
  for (let n = 0; n < kayit.indeksler.length; n++) {
    xyzw[kayit.indeksler[n] * 4 + 3] = kayit.eskiOpaklik[n];
  }
  return kayit.indeksler.length;
}

/** Geçmişin tamamını geri alır (en yeniden en eskiye). */
export function hepsiniGeriAl(xyzw: Float32Array, gecmis: SilmeKaydi[]): number {
  let n = 0;
  for (let i = gecmis.length - 1; i >= 0; i--) n += geriAl(xyzw, gecmis[i]);
  return n;
}

/** Görünür (silinmemiş) splat sayısı — şeritte "kalan" olarak gösterilir. */
export function gorunurSayisi(xyzw: Float32Array, count: number, esik = GORUNUR_ESIGI): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (xyzw[i * 4 + 3] > esik) n++;
  return n;
}
