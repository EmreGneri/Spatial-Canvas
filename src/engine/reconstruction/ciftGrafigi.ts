// ÇİFT GRAFİĞİ — SfM eşleştirmesinde hangi kare çiftlerinin eşleşeceği.
// Bağımlılıksız, saf; Node'da test edilir (scripts/verify-cift-grafigi.mjs).
//
// `siraliCiftler` yürüyüş klipleri için sıralı + seçilmiş uzak bağlantılı bir
// grafik üretir; `sfm.pairs = (n) => siraliCiftler(n)` olarak vendored
// sfm.js'in `opts.pairs` kancasına verilir. Kanca kayıt düşerse (oran < %90
// ya da çekim sırasında >= 3 ardışık kayıtsız kare) aynı özniteliklerle
// varsayılan (yoğun) grafiğe döner — bkz. VENDORED.md 2026-09-27.
// `ciftSayisi` varsayılan grafiğin çift sayısını verir (karşılaştırma/ölçüm).

export type CiftGrafigiProfili = 'walk' | 'orbit' | 'dense';

export interface SiraliCiftSecenekleri {
  /** Her kare kendinden sonraki kaç kareyle eşleşir (i+1 … i+pencere). */
  pencere?: number;
  /** Uzak bağlantılar her kaçıncı kareden atılır (i % uzakAdim === 0). */
  uzakAdim?: number;
  /** Uzak bağlantı adımı = pencere · uzakCarpan (i + adım, i + 2·adım, … < n). */
  uzakCarpan?: number;
}

/**
 * Sıralı eşleştirme grafiği: her i için i+1 … i+pencere; ek olarak her
 * `uzakAdim`'ıncı i için i + pencere·uzakCarpan, i + 2·pencere·uzakCarpan, …
 * (n'e kadar). Çiftler [i, j], i < j, yinelenmesiz, sözlüksel sırada.
 */
export function siraliCiftler(
  n: number,
  { pencere = 6, uzakAdim = 3, uzakCarpan = 2 }: SiraliCiftSecenekleri = {},
): Array<[number, number]> {
  const N = Math.max(0, Math.floor(n));
  const win = Math.max(1, Math.floor(pencere));
  const her = Math.max(1, Math.floor(uzakAdim));
  const adim = Math.round(win * uzakCarpan); // <= 0 → uzak bağlantı yok
  const ciftler: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    // i satırı içinde j artan sırada: önce pencere, sonra pencereyi aşan uzak j'ler
    const js = new Set<number>();
    for (let d = 1; d <= win && i + d < N; d++) js.add(i + d);
    if (adim > 0 && i % her === 0) for (let j = i + adim; j < N; j += adim) js.add(j);
    for (const j of [...js].sort((a, b) => a - b)) ciftler.push([i, j]);
  }
  return ciftler;
}

/**
 * Vendored sfm.js `buildPairs(n, profil)` grafiğinin çift sayısı (kural oradan
 * birebir kopya; TS'ten vendor JS içe aktarılmaz). n <= 30: tüm çiftler; üstünde
 * pencere (dense 20 / orbit 16 / walk 10) + uzak ızgara. SIFT ile varsayılan 'dense'.
 * Kural değişirse scripts/verify-cift-grafigi.mjs vendor kaynağına karşı düşer.
 */
export function ciftSayisi(n: number, profil: CiftGrafigiProfili): number {
  const N = Math.max(0, Math.floor(n));
  if (N <= 30) return N < 2 ? 0 : (N * (N - 1)) / 2;
  const dense = profil === 'dense';
  const orbit = profil === 'orbit' || dense;
  const win = dense ? 20 : orbit ? 16 : 10;
  // buildPairs'in anahtarı (i·10000 + j) — n > 10000'de o da çakışır; birebir aynı kalsın
  const seen = new Set<number>();
  const add = (i: number, j: number): void => {
    if (i === j || i < 0 || j >= N) return;
    seen.add(i < j ? i * 10000 + j : j * 10000 + i);
  };
  for (let i = 0; i < N; i++) for (let d = 1; d <= win; d++) add(i, i + d);
  for (let i = 0; i < N; i += dense ? 1 : orbit ? 2 : 4)
    for (let j = i + win + 2; j < N; j += dense ? 2 : orbit ? 3 : 4) add(i, j);
  return seen.size;
}
