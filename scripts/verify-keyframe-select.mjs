// E5.3 — PARALLAKS GÜDÜMLÜ KEYFRAME SEÇİMİ.
//
// NEDEN (ölçüldü, 2026-08-16, 260 sn NYC yürüyüş klibi):
// sabit aralık iki kısıtı AYNI ANDA sağlayamıyor —
//   • ardışık çift İZLENEBİLİR olmalı (aralık küçük),
//   • zincir 3B yapı üretmeli (toplam taban uzun).
// 8 kare × 0.125 sn = 0.875 sn ≈ 1.2 m yürüyüş; sokak derinliği onlarca
// metre. Sonuç: 8 kamera neredeyse aynı yerden bakıyor, sahne tek düz
// PANOYA çöküyor (poz 0 hata olmasına rağmen).
//
// Üstelik kamera hızı klip İÇİNDE 10 kat değişiyor: aynı 0.5 sn aralık
// t=13.0'da 6.12 px, t=14.0'da LK küresini aşan parallaks üretiyor.
//
// ÇÖZÜM: aralığı SAAT yerine PARALLAKSA göre seç. Politika saf tutuldu,
// ölçüm enjekte ediliyor (gerçek yolda seek + flow; testte sentetik hız
// profili) — DOM/model olmadan sınanabilsin.
//
// GPU gerekmez: node scripts/verify-keyframe-select.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);

const { selectKeyframeTimes, PARALLAX_TARGET_PX, PARALLAX_BAND_PX, TRACK_RATIO_MIN } = await import(
  '../src/engine/vision/seekCapture.ts'
);

/**
 * LK'nın izleyebildiği yer değiştirme tavanı (px) — bu fikstürün EN ÖNEMLİ
 * parçası. Gerçek ölçüm parallaksla birlikte MONOTON ARTMAZ: yer değiştirme
 * izleme küresini aşınca eşleşme çöker ve medyan 0'a düşer.
 *
 * İlk sürüm bunu modellemiyordu (parallaks = ∫hız dt, hep artan) ve gerçek
 * klipte KAÇAK GERİ BESLEMEYE yol açtı: büyük aralık → 0 eşleşme → seçici
 * "parallaks yok" okuyup aralığı DAHA DA büyüttü → istenen 8 kare yerine 4,
 * 3532 yerine 11 eşleşme. Fikstür artık çöküşü taklit ediyor; test [6] bunu
 * doğrudan sınıyor.
 */
const LK_KURESI_PX = 35;

/**
 * Sentetik ölçüm: parallaks = ∫hız dt, ama küre aşılınca izleme çöker.
 * Ölçüm sayısı sayılır (bütçe testi için).
 */
const olcumYap = (hiz) => {
  const durum = { cagri: 0 };
  const measure = async (tA, tB) => {
    durum.cagri++;
    // Basit dikdörtgen integrasyon (0.01 sn adım) — hız profili değişse de doğru.
    let p = 0;
    for (let t = tA; t < tB; t += 0.01) p += hiz(t) * 0.01;
    if (p > LK_KURESI_PX) {
      // Küre aşıldı: izler kopar, medyan anlamsızlaşır (gerçek davranış).
      return { parallaksPx: 0, izlemeOrani: 0.02 };
    }
    return { parallaksPx: p, izlemeOrani: 0.85 };
  };
  return { measure, durum };
};

/** Ölçüm sonucundan yalnız parallaks (assert'lerde okunur). */
const px = async (measure, a, b) => (await measure(a, b)).parallaksPx;

const gaps = (t) => t.slice(1).map((v, i) => v - t[i]);

// ---------------------------------------------------------------------------
// 1. SABİT YAVAŞ HIZ — aralık BÜYÜMELİ (sabit 0.125 sn'den çok daha uzun
//    taban), her çift hedef bandın içinde kalmalı.
// ---------------------------------------------------------------------------
{
  const { measure } = olcumYap(() => 12); // 12 px/sn — gerçek klipte t=13 civarı
  const t = await selectKeyframeTimes(260, measure, { maxFrames: 8 });
  assert.equal(t.length, 8, 'istenen kare sayısı');
  const span = t[t.length - 1] - t[0];
  console.log(`[1] yavaş kamera (12 px/sn): toplam taban ${span.toFixed(2)} sn (sabit yol: 0.875 sn)`);
  assert.ok(span > 5, `toplam taban ${span.toFixed(2)} sn — sabit yoldan belirgin uzun olmalı`);
  for (const g of gaps(t)) {
    const p = await px(measure, 0, g); // aynı hızda parallaks = 12·g
    assert.ok(
      p >= PARALLAX_BAND_PX[0] && p <= PARALLAX_BAND_PX[1],
      `çift parallaksı bant dışı: ${p.toFixed(1)} px`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. HIZ 10 KAT DEĞİŞİYOR — gerçek klibin davranışı. Aralıklar UYUM
//    SAĞLAMALI: hızlı bölgede kısalmalı, yavaşta uzamalı.
// ---------------------------------------------------------------------------
{
  const hiz = (t) => (t < 20 ? 12 : 120); // t=20'de 10× hızlanma
  const { measure } = olcumYap(hiz);
  const t = await selectKeyframeTimes(260, measure, { maxFrames: 10, startSec: 13 });
  const g = gaps(t);
  const yavasAralik = g.filter((_, i) => t[i] < 20);
  const hizliAralik = g.filter((_, i) => t[i] >= 20);
  assert.ok(yavasAralik.length > 0 && hizliAralik.length > 0, 'her iki bölgeden de örnek gerekli');
  const yavasOrt = yavasAralik.reduce((a, b) => a + b, 0) / yavasAralik.length;
  const hizliOrt = hizliAralik.reduce((a, b) => a + b, 0) / hizliAralik.length;
  console.log(
    `[2] hız değişimi: yavaş bölge ortalama aralık ${yavasOrt.toFixed(3)} sn, hızlı bölge ${hizliOrt.toFixed(3)} sn (${(yavasOrt / hizliOrt).toFixed(1)}× uyarlama)`,
  );
  assert.ok(yavasOrt > hizliOrt * 3, 'hızlı bölgede aralık belirgin kısalmalı');
  // Hiçbir çift LK küresini aşmamalı (aşan çift = kopuk izleme = düşen poz).
  for (let i = 1; i < t.length; i++) {
    const r = await measure(t[i - 1], t[i]);
    assert.ok(
      r.izlemeOrani >= TRACK_RATIO_MIN,
      `çift ${i} izleme çökmüş (oran ${r.izlemeOrani}) — aralık LK küresini aşıyor`,
    );
    assert.ok(r.parallaksPx <= PARALLAX_BAND_PX[1], `çift ${i} bant üstü: ${r.parallaksPx.toFixed(1)} px`);
  }
}

// ---------------------------------------------------------------------------
// 3. ÖLÇÜM BÜTÇESİ — her keyframe için sınırsız arama YAPILMAZ (her ölçüm
//    bir seek + flow demek). Kare başına ortalama ölçüm makul kalmalı.
// ---------------------------------------------------------------------------
{
  const { measure, durum } = olcumYap((t) => (t < 20 ? 12 : 120));
  const t = await selectKeyframeTimes(260, measure, { maxFrames: 12, startSec: 13 });
  const kareBasina = durum.cagri / t.length;
  console.log(`[3] ölçüm bütçesi: ${durum.cagri} ölçüm / ${t.length} kare = kare başına ${kareBasina.toFixed(1)}`);
  assert.ok(kareBasina <= 4, `kare başına ${kareBasina.toFixed(1)} ölçüm — bütçe aşıldı`);
}

// ---------------------------------------------------------------------------
// 4. HAREKETSİZ KAMERA (tripod) — parallaks hiç birikmiyor ama İZLEME
//    SAĞLAM. Aralık büyümeli (doğru tepki), sonsuz aramaya girmemeli.
// ---------------------------------------------------------------------------
{
  const { measure, durum } = olcumYap(() => 0);
  const t = await selectKeyframeTimes(30, measure, { maxFrames: 8, startSec: 1 });
  console.log(`[4] hareketsiz kamera: ${t.length} kare, ${durum.cagri} ölçüm (askıda kalmadı)`);
  assert.ok(t.length >= 2, 'en az iki kare dönmeli (poz zinciri minimumu)');
  assert.ok(t.every((v) => v >= 0 && v <= 30), 'zamanlar klip içinde');
  assert.ok(durum.cagri < 200, 'ölçüm sayısı patlamamalı');
}

// ---------------------------------------------------------------------------
// 5. SÖZLEŞME — artan, klip içi, deterministik.
// ---------------------------------------------------------------------------
{
  const hiz = (t) => 10 + 40 * Math.abs(Math.sin(t));
  const a = await selectKeyframeTimes(120, olcumYap(hiz).measure, { maxFrames: 9, startSec: 5 });
  const b = await selectKeyframeTimes(120, olcumYap(hiz).measure, { maxFrames: 9, startSec: 5 });
  assert.deepEqual(a, b, 'deterministik değil');
  for (let i = 1; i < a.length; i++) assert.ok(a[i] > a[i - 1], `zaman artmıyor @${i}`);
  assert.ok(
    a.every((v) => Number.isFinite(v) && v >= 0 && v <= 120),
    'zaman klip dışında',
  );
  console.log(`[5] sözleşme: artan + klip içi + deterministik (hedef ${PARALLAX_TARGET_PX} px) ✓`);
}

// ---------------------------------------------------------------------------
// 6. KAÇAK GERİ BESLEME (gerçek klipte görülen hata) — çok hızlı kamera.
//    İlk tahmin bile LK küresini aşıyor: ölçüm "0 parallaks" döner ama
//    İZLEME ORANI çökük gelir. Seçici bunu "hareket yok" sanıp aralığı
//    BÜYÜTMEMELİ; KÜÇÜLTMELİ. Regresyonda 8 kare istenmişken 4 kare ve
//    11 eşleşme dönmüştü.
// ---------------------------------------------------------------------------
{
  const { measure } = olcumYap(() => 600); // 600 px/sn — 0.125 sn'de bile 75 px
  const t = await selectKeyframeTimes(260, measure, { maxFrames: 8, startSec: 13 });
  const g = gaps(t);
  console.log(
    `[6] çok hızlı kamera (600 px/sn): ${t.length} kare, en büyük aralık ${Math.max(...g).toFixed(4)} sn`,
  );
  assert.equal(t.length, 8, 'kaçak geri besleme kare sayısını düşürmemeli');
  for (let i = 1; i < t.length; i++) {
    const r = await measure(t[i - 1], t[i]);
    assert.ok(
      r.izlemeOrani >= TRACK_RATIO_MIN,
      `çift ${i} izleme çökük — seçici aralığı küçültmek yerine büyütmüş`,
    );
  }
}

console.log('OK parallaks güdümlü keyframe seçimi (E5.3)');
