// Splat geometrisi (konum, normal, ölçek) nokta bulutundan — saf, three.js'siz.
// splats.ts:fillGaussiansFromPointCloud bunu çağırır; Node testleri (verify-splat-yan)
// doğrudan ölçer.

/**
 * Türetilen normalin en küçük |n_z|'si. Eksen başına eğim kırpmak YETMEZ
 * (iki eksen birden büyükse n_z yine çöker); sınır doğrudan normalin
 * kendisine uygulanır: yanal bileşen, n_z bu tabanı tutacak şekilde
 * ölçeklenir. 0.38 → splat kameraya göre en fazla ~68° eğilebilir.
 *
 * Bu bir GÖRÜNTÜ kararı değil, TÜRETME hatasının tavanıdır: gerçek füzyon
 * normalleri geldiğinde (Gün 7) bu tabana ihtiyaç kalmaz.
 */
const NORMAL_MIN_NZ = 0.38;

/**
 * Bu eğimin (|∇z|, dünya birimi/dünya birimi) altı SÜREKLİ yüzey sayılır: splat eğime
 * yaslanır ve yarıçap √(1+g²) büyür. Üstü süreksizlik (eski tavanlı davranış).
 * Değer verify-splat-yan ile seçildi (kapsama ↔ perde, aşağıdaki ölçüm notu).
 */
export const SUREKLI_EGIM_MAKS = 6;
/**
 * Yarıçap büyümesinin tavanı: disk yuvarlak olduğu için büyüme önden bakınca dik bölgede
 * yana doğru bulanıklık da getirir; tavan bu bedeli sınırlar.
 *
 * Ölçüm (verify-splat-yan, 2026-10-11; yan = 70°, ön izdüşüm alanı = bulanıklık):
 *   eski                 ön %99,19 · yan %90,11 · perde %0    · alan 15,9 px²
 *   eşik 4, tavansız     ön %99,79 · yan %95,25 · perde %0    · alan 20,5
 *   eşik 6, tavan 3  ←   ön %99,79 · yan %97,22 · perde %0    · alan 20,6
 *   eşik 6, tavansız     ön %99,79 · yan %97,70 · perde %0,03 · alan 22,0
 */
export const YARICAP_BUYUME_MAKS = 3;

/**
 * (nx, ny, 1) ham normalini normalize eder ve |n_z| ≥ NORMAL_MIN_NZ olacak
 * şekilde yanal bileşeni kısar. Çıktı BİRİM uzunluktadır.
 */
function stabilizedNormal(nx: number, ny: number, out: Float32Array, o: number) {
  const lat = Math.hypot(nx, ny);
  // n_z = 1/√(1+lat²) ≥ min  ⇔  lat ≤ √(1/min² − 1)
  const maxLat = Math.sqrt(1 / (NORMAL_MIN_NZ * NORMAL_MIN_NZ) - 1);
  const k = lat > maxLat ? maxLat / lat : 1;
  const cx = nx * k;
  const cy = ny * k;
  const len = Math.hypot(cx, cy, 1);
  out[o] = cx / len;
  out[o + 1] = cy / len;
  out[o + 2] = 1 / len;
}

/**
 * home (grid²×4: xyz + opaklık) → A (xyz + opaklık), B (normal.xyz + ölçek).
 */
export function splatGeometrisiTuret(home: Float32Array, grid: number, A: Float32Array, B: Float32Array) {
  // Dünya adımı: home grid'i [-halfW, +halfW] × [-1, +1] aralığını kaplar.
  // NORMAL türevleri için sabit adım yeterlidir (grid düzenli).
  const stepX = Math.abs(home[4] - home[0]) || 2 / grid;
  const stepY = Math.abs(home[grid * 4 + 1] - home[1]) || 2 / grid;
  // Yarıçap: komşu aralığının yarısı → komşu splat'lar 2σ'da buluşur,
  // Gauss kuyrukları örtüşür. Aralık grid boyunca SABİTTİR (yukarıdaki
  // "yarıçap küreseldir" kaydına bak).
  const baseScale = 0.5 * Math.max(stepX, stepY);

  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const k = j * grid + i;
      const o = k * 4;
      const x = home[o];
      const y = home[o + 1];
      const z = home[o + 2];
      A[o] = x;
      A[o + 1] = y;
      A[o + 2] = z;
      A[o + 3] = home[o + 3];

      // Merkezi fark (kenarda tek yanlı) → yüzey normali.
      const zl = home[(k - (i > 0 ? 1 : 0)) * 4 + 2];
      const zr = home[(k + (i < grid - 1 ? 1 : 0)) * 4 + 2];
      const zd = home[(k - (j > 0 ? grid : 0)) * 4 + 2];
      const zu = home[(k + (j < grid - 1 ? grid : 0)) * 4 + 2];
      // grid satırı j ARTARKEN dünya y AZALIR → dz/dy işareti ters.
      // EĞİM TAVANI (ölçüldü — aşağı bak): derinlik SÜREKSİZLİĞİNDE (siluet
      // kenarı, kol/gövde sınırı) merkezi fark patlar; normal kameraya
      // neredeyse DİK döner, splat kılcal bir şerite çöker ve yüzeyde delik
      // bırakır. Ölçüm (2026-08-14, sentetik görsel, 640×420): tavansız
      // %15.87 splat |n_z| < 0.35 taşıyordu ve yüzeyin %9.68'i delikti;
      // yarıçapı 3× büyütmek deliği yalnızca %4.48'e indiriyordu — yani
      // sorun YARIÇAP değil YÖNELİMDİ.
      const dzdx = (zr - zl) / (2 * stepX);
      const dzdy = -(zu - zd) / (2 * stepY);
      // DİK ama SÜREKLİ yüzey (yüz yanı, burun kenarı, saç): splat gerçek eğime yaslanır ve
      // yarıçap yüzey üzerindeki gerçek komşu aralığına (adım·√(1+g²)) büyür. Önden izdüşüm
      // aynı kalır (r·√(1+g²)·cosθ = r), yandan komşular birleşir. Ölçüldü (verify-splat-yan,
      // 2026-10-11): yan görünüm (70°) kapsaması %90,1 → %97,2. Eğim SUREKLI_EGIM_MAKS'ı
      // aşarsa bu bir SÜREKSİZLİKTİR (siluet/kol kenarı): eski tavanlı normal + küresel yarıçap,
      // yoksa ön plan ile arka arasına perde gerilir.
      const g = Math.hypot(dzdx, dzdy);
      const surekli = g <= SUREKLI_EGIM_MAKS;
      if (surekli) {
        const len = Math.hypot(dzdx, dzdy, 1);
        B[o] = -dzdx / len;
        B[o + 1] = -dzdy / len;
        B[o + 2] = 1 / len;
      } else {
        stabilizedNormal(-dzdx, -dzdy, B, o);
      }
      // YARIÇAP KÜRESELDİR — ve öyle KALMALI. Denendi ve ÖLÇÜLDÜ (2026-08-14):
      // splat başına "komşu dünya mesafesi"nden yarıçap türetmek hiçbir şeyi
      // değiştirmiyor, çünkü önem remap'i (buildImportanceRemap) yalnızca
      // hangi DEPTH pikselinin okunduğunu büker; parçacığın DÜNYA konumu
      // kendi grid yerindedir (ARCHITECTURE.md · Point Cloud Sözleşmesi:
      // "grid ve aUv sözleşmesi aynı kalır"). Ölçüm: türetilen yarıçapın
      // min/maks/ortalaması 0.0026 / 0.0026 / 0.0026 — yani tam olarak
      // küresel değerin kendisi. Fazladan komşu okuması ve dallanma bedava
      // değildi; geri alındı.
      B[o + 3] = surekli ? baseScale * Math.min(YARICAP_BUYUME_MAKS, Math.sqrt(1 + g * g)) : baseScale;

    }
  }
}
