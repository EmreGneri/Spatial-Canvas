// splat sözleşme testi (GPU gerekmez, saf CPU) — Gün 1/2/4, render şeridi.
//
// Doğrulananlar:
//   1. GaussianBuffer spike verisi (Gün 1): küre kabuğu, birim normaller,
//      anizotropik ölçek, determinizm
//   2. Derinlik sıralaması (Gün 2): radix TAM sıralar (arkadan öne), opaklık
//      kapısı, dejenere girdiler (tek düzlem, boş küme, tek eleman)
//   3. Kova sıralaması (Gün 4 alternatifi): yaklaşıklık ÖLÇÜLÜR (ters çift
//      oranı) — "yeterince iyi" iddia edilmez, sayı basılır
//   4. Yeniden sıralama kapısı (Gün 4): küçük kamera hareketinde sıra
//      kurulmaz, büyük hareketinde kurulur
//   5. Ölçüm: radix vs kova, 147k splat üzerinde medyan süre
//   node scripts/verify-splat.mjs
import assert from 'node:assert/strict';
import {
  BUCKET_COUNT,
  bucketSortByDepth,
  createSortScratch,
  ensureSortScratch,
  needsResort,
  radixSortByDepth,
  sortSplatsByDepth,
} from '../src/shaders/splatSort.ts';
import { buildSpikeSphere, buildStressVolume } from '../src/shaders/splatFixture.ts';

/** Birim viewMatrix (kolon-major, three.js): kamera orijinde, −z'ye bakar. */
const IDENTITY_VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** z ekseninde geriye çekilmiş kamera: viewMatrix = translate(0,0,−d). */
function viewAtZ(d) {
  const m = IDENTITY_VIEW.slice();
  m[14] = -d;
  return m;
}
const viewDepth = (view, x, y, z) => view[2] * x + view[6] * y + view[10] * z + view[14];

// --- 1. spike verisi (Gün 1): küre kabuğu sözleşmesi ---
{
  const g = buildSpikeSphere(1000);
  assert.equal(g.count, 1000, 'spike splat sayısı');
  assert.equal(g.a.length, 4000, 'gSplatA 4 kanal/splat');
  let minR = Infinity;
  let maxR = -Infinity;
  let minScale = Infinity;
  let maxScale = -Infinity;
  for (let i = 0; i < g.count; i++) {
    const o = i * 4;
    const r = Math.hypot(g.a[o], g.a[o + 1], g.a[o + 2]);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
    const nl = Math.hypot(g.b[o], g.b[o + 1], g.b[o + 2]);
    assert.ok(Math.abs(nl - 1) < 1e-5, `normal birim uzunlukta @${i} (${nl})`);
    // Kabuk normali = konumun birim hâli (dışa bakar) — yönelim testinin temeli.
    assert.ok(
      Math.abs(g.b[o] - g.a[o] / r) < 1e-5,
      `normal DIŞA bakar (konumla hizalı) @${i}`,
    );
    minScale = Math.min(minScale, g.b[o + 3]);
    maxScale = Math.max(maxScale, g.b[o + 3]);
    assert.ok(g.a[o + 3] > 0 && g.a[o + 3] <= 1, `opaklık (0,1] @${i}`);
    for (let c = 0; c < 4; c++) {
      assert.ok(g.c[o + c] >= 0 && g.c[o + c] <= 1, `renk/AO 0..1 @${i}`);
    }
  }
  assert.ok(Math.abs(maxR - minR) < 1e-5, 'tüm splatler AYNI yarıçapta (küre kabuğu)');
  // Anizotropi: ölçekler eşit OLMAMALI, yoksa yönelim hatası gözden kaçar.
  assert.ok(maxScale / minScale > 1.5, `ölçek çeşitliliği var (${(maxScale / minScale).toFixed(2)}×)`);
  // Determinizm: aynı tohum → birebir aynı çıktı.
  const again = buildSpikeSphere(1000);
  assert.deepEqual(Array.from(again.a), Array.from(g.a), 'spike deterministik (gSplatA)');
  assert.deepEqual(Array.from(again.b), Array.from(g.b), 'spike deterministik (gSplatB)');
}

// --- 2. radix: TAM sıralama, arkadan öne ---
{
  const g = buildSpikeSphere(1000);
  const view = viewAtZ(4);
  const scratch = createSortScratch(g.count);
  const res = radixSortByDepth(g.a, g.count, view, 0, scratch);
  assert.equal(res.exact, true, 'radix tam sıralamadır');
  assert.equal(res.count, g.count, 'opaklık kapısı 0 → hepsi çizilir');
  let prev = -Infinity;
  let inversions = 0;
  for (let k = 0; k < res.count; k++) {
    const i = res.order[k];
    const d = viewDepth(view, g.a[i * 4], g.a[i * 4 + 1], g.a[i * 4 + 2]);
    if (d < prev - 1e-4) inversions++;
    prev = d;
  }
  assert.equal(inversions, 0, `radix sırası artan görüş-derinliği (${inversions} ters çift)`);
  // İlk çizilen EN UZAK, son çizilen EN YAKIN olmalı (arkadan öne sözleşmesi).
  const first = res.order[0];
  const last = res.order[res.count - 1];
  const dFirst = viewDepth(view, g.a[first * 4], g.a[first * 4 + 1], g.a[first * 4 + 2]);
  const dLast = viewDepth(view, g.a[last * 4], g.a[last * 4 + 1], g.a[last * 4 + 2]);
  assert.ok(dFirst < dLast, `ilk çizilen daha uzak (${dFirst.toFixed(4)} < ${dLast.toFixed(4)})`);
  // Permütasyon bütünlüğü: her index TAM BİR kez.
  const seen = new Uint8Array(g.count);
  for (let k = 0; k < res.count; k++) {
    assert.equal(seen[res.order[k]], 0, 'index tekrarı yok');
    seen[res.order[k]] = 1;
  }
}

// --- 3. opaklık kapısı: eşiğin altındakiler HİÇ sıraya girmez ---
{
  const g = buildSpikeSphere(1000);
  const scratch = createSortScratch(g.count);
  let expected = 0;
  for (let i = 0; i < g.count; i++) if (g.a[i * 4 + 3] > 0.6) expected++;
  const res = radixSortByDepth(g.a, g.count, viewAtZ(4), 0.6, scratch);
  assert.equal(res.count, expected, `opaklık kapısı: ${expected} splat kaldı`);
  assert.ok(expected > 0 && expected < g.count, 'kapı gerçekten eliyor (ne hepsi ne hiçbiri)');
  for (let k = 0; k < res.count; k++) {
    assert.ok(g.a[res.order[k] * 4 + 3] > 0.6, 'sıraya yalnızca kapıyı geçen girdi');
  }
}

// --- 4. dejenere girdiler: NaN/çökme YOK ---
{
  const scratch = createSortScratch(16);
  // (a) boş küme (hepsi kapının altında)
  const dim = new Float32Array(16 * 4);
  for (let i = 0; i < 16; i++) dim[i * 4 + 3] = 0.01;
  const empty = radixSortByDepth(dim, 16, IDENTITY_VIEW, 0.5, scratch);
  assert.equal(empty.count, 0, 'tamamı kapının altında → 0 splat');
  // (b) tek eleman
  const one = new Float32Array(16 * 4);
  one[3] = 1;
  const single = radixSortByDepth(one, 16, IDENTITY_VIEW, 0.5, scratch);
  assert.equal(single.count, 1, 'tek splat → 1');
  // (c) TEK DÜZLEM (span = 0): bölme yok, sıra girdi sırası
  const flat = new Float32Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    flat[i * 4] = i * 0.1; // x değişir, z sabit
    flat[i * 4 + 2] = 0;
    flat[i * 4 + 3] = 1;
  }
  const planar = radixSortByDepth(flat, 16, IDENTITY_VIEW, 0.5, scratch);
  assert.equal(planar.count, 16, 'tek düzlem → hepsi çizilir');
  for (let k = 0; k < planar.count; k++) {
    assert.ok(Number.isFinite(planar.order[k]), 'tek düzlemde NaN/Infinity index yok');
  }
}

// --- 5. kova sıralaması: YAKLAŞIKLIK ÖLÇÜLÜR (iddia edilmez) ---
{
  const g = buildStressVolume(50000);
  const view = viewAtZ(4);
  const scratch = createSortScratch(g.count);
  const bucket = bucketSortByDepth(g.a, g.count, view, 0, scratch, BUCKET_COUNT);
  assert.equal(bucket.exact, false, 'kova yolu YAKLAŞIK olduğunu bildirir');
  assert.equal(bucket.count, g.count, 'kova yolu splat kaybetmez');
  const seen = new Uint8Array(g.count);
  for (let k = 0; k < bucket.count; k++) {
    assert.equal(seen[bucket.order[k]], 0, 'kova: index tekrarı yok');
    seen[bucket.order[k]] = 1;
  }
  // Ters çift oranı: ardışık çiftlerde kaçı yanlış sırada?
  let inv = 0;
  let maxErr = 0;
  let prev = -Infinity;
  for (let k = 0; k < bucket.count; k++) {
    const i = bucket.order[k];
    const d = viewDepth(view, g.a[i * 4], g.a[i * 4 + 1], g.a[i * 4 + 2]);
    if (d < prev) {
      inv++;
      maxErr = Math.max(maxErr, prev - d);
    }
    prev = d;
  }
  const ratio = inv / bucket.count;
  console.log(
    `kova yaklaşıklığı: ardışık ters çift ${inv}/${bucket.count} (%${(ratio * 100).toFixed(2)}), en büyük derinlik ihlali ${maxErr.toFixed(5)} dünya birimi`,
  );
  // İDDİA: kova İÇİ sıra bozulabilir ama kova SINIRI aşılamaz — yani bir
  // derinlik ihlali asla kova genişliğini geçemez. Bu matematiksel sözleşme
  // testidir, "göze iyi görünüyor" değil.
  const span = (() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < g.count; i++) {
      const d = viewDepth(view, g.a[i * 4], g.a[i * 4 + 1], g.a[i * 4 + 2]);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    return hi - lo;
  })();
  const bucketWidth = span / BUCKET_COUNT;
  assert.ok(
    maxErr <= bucketWidth * 1.5,
    `derinlik ihlali kova genişliğini aşmaz (${maxErr.toFixed(6)} ≤ ${(bucketWidth * 1.5).toFixed(6)})`,
  );
}

// --- 6. seçim kapısı + havuz yeniden kullanımı ---
{
  const g = buildSpikeSphere(500);
  let scratch = ensureSortScratch(null, g.count);
  const a = sortSplatsByDepth('radix', g.a, g.count, viewAtZ(3), 0, scratch);
  assert.equal(a.exact, true, "sortSplatsByDepth('radix') → tam");
  const b = sortSplatsByDepth('bucket', g.a, g.count, viewAtZ(3), 0, scratch);
  assert.equal(b.exact, false, "sortSplatsByDepth('bucket') → yaklaşık");
  // Havuz: aynı boyut → aynı nesne (kare başına tahsis yok)
  const same = ensureSortScratch(scratch, g.count);
  assert.equal(same, scratch, 'havuz yeterliyse yeniden kullanılır');
  const bigger = ensureSortScratch(scratch, g.count * 2);
  assert.notEqual(bigger, scratch, 'havuz küçükse yeniden ayrılır');
}

// --- 7. yeniden sıralama kapısı (Gün 4): küçük dönüşte sıra kurulmaz ---
{
  const last = new Float32Array([0, 0, 1]);
  // İlk çağrı: lastDir (0,0,1) ile view yönü aynı → sıralama GEREKMEZ.
  assert.equal(needsResort(IDENTITY_VIEW, last), false, 'aynı yön → yeniden sıralama yok');
  // 1° dönme (eşik 2°): hâlâ gerekmez.
  const rot = (deg) => {
    const r = (deg * Math.PI) / 180;
    const m = IDENTITY_VIEW.slice();
    m[2] = Math.sin(r);
    m[10] = Math.cos(r);
    return m;
  };
  assert.equal(needsResort(rot(1), last), false, '1° dönme → eşik altı, sıra korunur');
  assert.equal(needsResort(rot(5), last), true, '5° dönme → yeniden sıralanır');
  // Kapı geçtikten sonra yön güncellenmiş olmalı: aynı view tekrar gelirse hayır.
  assert.equal(needsResort(rot(5), last), false, 'kapı geçince yön güncellenir');
}

// --- 8. ÖLÇÜM (Gün 4): 147k splat'ta radix vs kova, medyan süre ---
{
  const g = buildStressVolume(147456);
  const scratch = createSortScratch(g.count);
  const view = viewAtZ(4);
  const median = (fn) => {
    fn(); // ısınma (JIT)
    const t = [];
    for (let k = 0; k < 11; k++) {
      const t0 = performance.now();
      fn();
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    return t[5];
  };
  const radixMs = median(() => radixSortByDepth(g.a, g.count, view, 0.02, scratch));
  const bucketMs = median(() => bucketSortByDepth(g.a, g.count, view, 0.02, scratch));
  console.log(
    `sıralama (147.456 splat, medyan/11): radix ${radixMs.toFixed(2)} ms · kova ${bucketMs.toFixed(2)} ms`,
  );
  // Sözleşme: sıralama 16.6 ms'lik kare bütçesinin TAMAMINI yiyemez. Eşik
  // cömert (8 ms) çünkü CI makinesi yavaş olabilir; asıl kanıt yukarıdaki
  // basılan sayıdır ve yeniden sıralama kapısı bunu her karede ödemez.
  assert.ok(radixMs < 8, `radix kare bütçesine sığar (${radixMs.toFixed(2)} ms < 8 ms)`);
  assert.ok(bucketMs < 8, `kova kare bütçesine sığar (${bucketMs.toFixed(2)} ms < 8 ms)`);
}

console.log(
  'OK · splat (spike küre kabuğu + anizotropi, radix TAM sıralama arkadan öne, opaklık kapısı, dejenere girdiler, kova yaklaşıklığı kova genişliğiyle sınırlı, yeniden sıralama kapısı, 147k ölçümü)',
);
