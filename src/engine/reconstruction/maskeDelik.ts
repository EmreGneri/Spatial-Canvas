// Özne maskesindeki YANLIŞ delikleri derinlik tutarlılığıyla kapatır.
//
// Sorun: segmentasyon modeli bazı öznelerde (kesik giysi, yüz, açık ten) içeriden
// "arka plan" der; delik ön plana yazılmayınca yüz/karın 3B'de boş kalır.
// Olasılığa bakmak yetmez (yanlış delikler de güvenle ~0.05–0.17 çıkıyor).
// Ayırt edici olan DERİNLİK: gerçek boşluk (kol-gövde aralığı) arkadaki sahneyi
// gösterir, yani çevresindeki özneden belirgin UZAKTIR; yanlış delik ise özne
// yüzeyinin devamıdır, derinliği çevre halkasıyla süreklidir.
//
// UYARI (DAVIS 2017, 2026-10-10): genel videoda bu varsayım çoğunlukla TUTMUYOR.
// IS-Net maskelerindeki kapalı deliklerin piksel bazında yalnız %15–21'i özne;
// gerçek boşluklar (tekerlek, bacak arası) arka plana derinlikçe yakın olabiliyor.
// Doldurma isabeti %16–22. Bu yüzden estimateDepth'te varsayılan KAPALI.
// Ölçüm: scripts/olc-maske.mjs, docs/benchmarks/maske-olcumu.md.

export interface DelikOlcum {
  alan: number;
  /** delik içi ile çevre halkası medyan derinlik farkı (0..1 normalize derinlik). */
  fark: number;
  doldu: boolean;
}

export const DELIK_FARK_ESIGI = 0.12;
/** Tek bir delik özne alanının bu oranından büyükse (muhtemelen gerçek boşluk/ayrı bölge) dokunma. */
export const DELIK_MAX_ORAN = 0.25;
const HALKA = 3;

function median(a: number[]): number {
  a.sort((x, y) => x - y);
  return a[a.length >> 1];
}

/**
 * Sınıra değmeyen (kapalı) arka plan bileşenlerinden, derinliği çevre halkasıyla
 * tutarlı olanları ön plana (1) çevirir. Girdi maskeyi DEĞİŞTİRMEZ; yeni dizi döner.
 * `depth`: maskeyle aynı ızgarada, 0 = uzak 1 = yakın.
 */
export function delikleriDoldur(
  mask: Float32Array,
  depth: Float32Array,
  w: number,
  h: number,
  esik = DELIK_FARK_ESIGI,
): { mask: Float32Array; delikler: DelikOlcum[] } {
  const n = w * h;
  const out = Float32Array.from(mask);
  const id = new Int32Array(n).fill(-1);
  let fg = 0;
  for (let i = 0; i < n; i++) if (mask[i] >= 0.5) fg++;
  const delikler: DelikOlcum[] = [];
  const stack: number[] = [];
  let k = 0;
  for (let s = 0; s < n; s++) {
    if (mask[s] >= 0.5 || id[s] >= 0) continue;
    const px: number[] = [];
    let border = false;
    stack.push(s);
    id[s] = k;
    while (stack.length) {
      const p = stack.pop()!;
      px.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && mask[p - 1] < 0.5 && id[p - 1] < 0) { id[p - 1] = k; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] < 0.5 && id[p + 1] < 0) { id[p + 1] = k; stack.push(p + 1); }
      if (y > 0 && mask[p - w] < 0.5 && id[p - w] < 0) { id[p - w] = k; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] < 0.5 && id[p + w] < 0) { id[p + w] = k; stack.push(p + w); }
    }
    k++;
    if (border || px.length < 4) continue; // dış arka plan / tek-iki piksel gürültü
    // Çevre halkası: delik piksellerinin HALKA px içindeki özne (mask>=0.5) komşuları.
    const ring = new Set<number>();
    for (const p of px) {
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -HALKA; dy <= HALKA; dy++) {
        for (let dx = -HALKA; dx <= HALKA; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (mask[q] >= 0.5) ring.add(q);
        }
      }
    }
    if (ring.size < 8) continue;
    const inside = median(px.map((p) => depth[p]));
    const around = median([...ring].map((q) => depth[q]));
    const fark = Math.abs(inside - around);
    const doldu = fark <= esik && px.length <= DELIK_MAX_ORAN * fg;
    delikler.push({ alan: px.length, fark, doldu });
    if (doldu) for (const p of px) out[p] = 1;
  }
  return { mask: out, delikler };
}
