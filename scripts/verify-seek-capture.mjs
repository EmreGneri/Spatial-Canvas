// SEEK YAKALAMA ZAMAN SEÇİMİ — keyframe'ler arası aralık, klip süresinden
// BAĞIMSIZ olarak izlenebilir bantta kalmalı.
//
// NEDEN (ölçüldü, 2026-08-16 · 260.04 sn NYC yürüyüş klibi, 384×288):
// keyframe'ler klip ORANINA yayıldığında (eski davranış) 8 kare için aralık
// 33.4 sn oluyordu. Aynı klipten ffmpeg ile çıkarılan kare çiftlerinde
// computeOpticalFlow ölçümü:
//
//   aralık(sn) | eşleşme | medyan parallaks(px)
//        0.25  |    378  |  3.61
//        0.50  |    211  |  6.12
//        1.00  |     64  | 12.41
//        2.00  |      1  |  6.84
//        4.00  |      0  |  —
//       33.40  |      0  |  —     <- eski davranış
//
// LK izleme küresi ~1 sn'de tükeniyor; 33.4 sn'de ardışık kareler farklı
// sahne. Uygulamada sonuç: 0 eşleşme, 7/7 poz hatası, ölçek çözülemedi.
// Taban (parallaks) klip GENİŞLİĞİNDEN değil, poz ZİNCİRİNİN birikiminden
// gelir — kareler ardışık örtüşmeli olmak zorunda.
//
// Varsayılan aralık aynı klipte TAM ZİNCİRLE ölçülerek seçildi
// (flow → PointMatch → chainPoseTrack, 8 keyframe, t=13.0'dan):
//   0.125 sn → 489 medyan eşleşme → poz 7/7   (varsayılan)
//   0.25  sn → 240 medyan eşleşme → poz 6/7
//   0.5   sn →  12 medyan eşleşme → poz 3/7
//
// GPU gerekmez: node scripts/verify-seek-capture.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);

const { keyframeTimes, DEFAULT_GAP_SEC } = await import('../src/engine/vision/seekCapture.ts');

const gaps = (t) => t.slice(1).map((v, i) => v - t[i]);
const maxGap = (t) => Math.max(...gaps(t));

// ---------------------------------------------------------------------------
// 1. UZUN KLİP — asıl hata. 260 sn, 8 kare: eski yol 33.4 sn aralık verirdi.
//    Aralık, ölçülen izlenebilir bandın (≈1 sn) içinde kalmalı.
// ---------------------------------------------------------------------------
{
  const t = keyframeTimes(260.04, { maxFrames: 8 });
  assert.equal(t.length, 8, 'istenen kare sayısı dönmeli');
  const g = maxGap(t);
  console.log(`[1] 260 sn klip · 8 kare: maksimum aralık ${g.toFixed(3)} sn (eski yol 33.4 sn)`);
  assert.ok(g <= 1.0, `aralık ${g.toFixed(2)} sn — LK izleme küresi ~1 sn, eşleşme kalmaz`);
  assert.ok(g > 0, 'aralık pozitif olmalı');
}

// ---------------------------------------------------------------------------
// 2. KISA KLİP — eski davranışın hedefi. 12 sn klipte de aynı kural geçerli
//    (tek yol, iki dal değil) ve kareler klip içinde kalır.
// ---------------------------------------------------------------------------
{
  const d = 12;
  const t = keyframeTimes(d, { maxFrames: 8 });
  console.log(`[2] 12 sn klip · 8 kare: maksimum aralık ${maxGap(t).toFixed(3)} sn`);
  assert.ok(maxGap(t) <= 1.0, 'kısa klipte de aralık bandın içinde');
  assert.ok(t[0] >= 0 && t[t.length - 1] <= d, 'kareler klip sınırları içinde');
}

// ---------------------------------------------------------------------------
// 3. ÇOK KISA KLİP — hedef aralık sığmıyorsa aralık KÜÇÜLÜR, kareler taşmaz.
//    (Sığmayan hedefi zorlamak klip dışına seek demekti.)
// ---------------------------------------------------------------------------
{
  const d = 2;
  const t = keyframeTimes(d, { maxFrames: 8 });
  console.log(`[3] 2 sn klip · 8 kare: maksimum aralık ${maxGap(t).toFixed(3)} sn`);
  assert.ok(t[0] >= 0 && t[t.length - 1] <= d, 'kareler klip sınırları içinde kalmalı');
  assert.ok(maxGap(t) > 0, 'çok kısa klipte bile ayrık zaman noktaları');
}

// ---------------------------------------------------------------------------
// 4. SÖZLEŞME — zaman noktaları artan ve klip içinde; her süre/kare sayısı için.
// ---------------------------------------------------------------------------
{
  for (const d of [2, 12, 60, 260.04, 3600]) {
    for (const n of [2, 3, 8, 12, 20]) {
      const t = keyframeTimes(d, { maxFrames: n });
      assert.equal(t.length, n, `kare sayısı (${d} sn, ${n})`);
      assert.ok(
        t.every((v) => Number.isFinite(v) && v >= 0 && v <= d),
        `zaman noktası klip dışında (${d} sn, ${n})`,
      );
      for (let i = 1; i < t.length; i++) {
        assert.ok(t[i] > t[i - 1], `zaman artmıyor (${d} sn, ${n}) @${i}`);
      }
    }
  }
  console.log('[4] sözleşme: artan + klip içi (5 süre × 5 kare sayısı) ✓');
}

// ---------------------------------------------------------------------------
// 5. AYAR KOLU — hedef aralık dışarıdan sürülebilir. Yavaş kamerada (tripod
//    pan) parallaks birikmesi için büyütmek gerekir; sabitlemek kalibrasyonu
//    kilitlerdi. Uzun klipte hedef AYNEN uygulanır.
// ---------------------------------------------------------------------------
{
  const t = keyframeTimes(260.04, { maxFrames: 8, gapSec: 0.25 });
  const g = maxGap(t);
  console.log(`[5] gapSec=0.25 · maksimum aralık ${g.toFixed(3)} sn (varsayılan ${DEFAULT_GAP_SEC})`);
  assert.ok(Math.abs(g - 0.25) < 1e-9, `hedef aralık uygulanmadı: ${g}`);
}

console.log('OK seek yakalama zaman seçimi — aralık klip süresinden bağımsız');
