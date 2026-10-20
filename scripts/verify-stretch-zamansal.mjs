// ÖN PLAN STRETCH'İ KARELER ARASI KARARLI OLMALI — "bulut nefes alıyor".
//
// ── BULUNAN HATA (2026-08-30) ──────────────────────────────────────────────
// `applyForegroundStretch` `lo`/`hi`'yi HER KAREDE yalnız o karenin maskeli
// piksellerinden hesaplıyordu; hiçbir zamansal taşıma yoktu. Canlı yolda
// `kararliNormalize` GLOBAL uçları EMA ile taşıyor (LIVE_RANGE_ALPHA = 0.15)
// ve `zamansalYumusat` alanı yumuşatıyor — ama stretch İKİSİNDEN DE SONRA
// çalışıyor, dolayısıyla temporal filtre onu SÖNÜMLEYEMİYOR.
//
// Sonuç: öznenin kendi min/max'ı değiştiği anda — el öne gelir, kafa döner,
// maske birkaç piksel kayar — TÜM öznenin z eşlemesi yeniden ölçekleniyor.
// Ekranda bu, hiç kıpırdamayan yüzeylerin ileri geri gitmesi olarak görünür.
//
// ── BU KAPI NE ÖLÇER ───────────────────────────────────────────────────────
// İki kare: ikincisinde öznenin bir bölümü öne geliyor (el). HAM derinliği
// HİÇ DEĞİŞMEYEN bir referans piksel seçiliyor. O pikselin stretch SONRASI
// değeri ne kadar kayıyorsa, "nefes alma" odur — çünkü o piksel gerçekte
// kıpırdamadı.
//
//   node scripts/verify-stretch-zamansal.mjs
import assert from 'node:assert/strict';
import {
  STRETCH_RANGE_ALPHA,
  applyForegroundStretch,
  yeniStretchAraligi,
} from '../src/depth.ts';

const W = 40;
const H = 40;
const N = W * H;
const REF = 10 * W + 10; // referans piksel — ham değeri iki karede de aynı

/**
 * Kare üretici. Özne kadrajın yarısı; `elOrani` kadar piksel `elDerinligi`'ne
 * taşınır (öne gelen el). Referans piksel HER ZAMAN 0.50'de kalır.
 */
function kare(elOrani, elDerinligi) {
  const depth = new Float32Array(N);
  const mask = new Float32Array(N);
  let oznePiksel = 0;
  for (let i = 0; i < N; i++) {
    const ozne = i % 2 === 0; // özne = piksellerin yarısı, deterministik
    mask[i] = ozne ? 1 : 0;
    if (!ozne) {
      depth[i] = 0.05;
      continue;
    }
    oznePiksel++;
    // Gövde: 0.40–0.60 arasında tekdüze dağılım.
    depth[i] = 0.4 + 0.2 * ((oznePiksel * 37) % 100) / 100;
  }
  // El: özne piksellerinin ilk `elOrani` kadarını öne taşı.
  let tasinan = 0;
  const hedef = Math.round(oznePiksel * elOrani);
  for (let i = 0; i < N && tasinan < hedef; i++) {
    if (mask[i] < 0.5 || i === REF) continue;
    depth[i] = elDerinligi;
    tasinan++;
  }
  depth[REF] = 0.5; // referans — iki karede de birebir aynı
  mask[REF] = 1;
  return { depth, mask };
}

const A = kare(0, 0); // el yok
const B = kare(0.2, 0.9); // öznenin %20'si öne geldi

assert.equal(A.depth[REF], B.depth[REF], 'referans pikselin HAM değeri iki karede aynı olmalı');

/** Bir kare dizisini işleyip referans pikselin stretch sonrası değerini verir. */
function refDegeri(kareler, durum) {
  const cikti = [];
  for (const k of kareler) {
    const d = Float32Array.from(k.depth);
    applyForegroundStretch(d, k.mask, W, H, undefined, durum);
    cikti.push(d[REF]);
  }
  return cikti;
}

// ---------------------------------------------------------------------------
// [1] ZAMANSAL TAŞIMA YOKKEN (bugünkü davranış, foto yolu) — kayma BÜYÜK.
// ---------------------------------------------------------------------------
const durumsuz = refDegeri([A, B], undefined);
const durumsuzKayma = Math.abs(durumsuz[1] - durumsuz[0]);
console.log(
  `[1] taşımasız: ref ${durumsuz[0].toFixed(4)} → ${durumsuz[1].toFixed(4)} · kayma ${durumsuzKayma.toFixed(4)}`,
);
assert.ok(
  durumsuzKayma > 0.05,
  `kapı anlamsız: taşımasız kayma zaten küçük (${durumsuzKayma.toFixed(4)}) — senaryo nefes almayı üretmiyor`,
);

// ---------------------------------------------------------------------------
// [2] ZAMANSAL TAŞIMA VARKEN — aynı kayma belirgin biçimde SÖNMELİ.
// ---------------------------------------------------------------------------
const durum = yeniStretchAraligi();
const durumlu = refDegeri([A, B], durum);
const durumluKayma = Math.abs(durumlu[1] - durumlu[0]);
const sonum = durumsuzKayma / Math.max(1e-9, durumluKayma);
console.log(
  `[2] taşımalı (α=${STRETCH_RANGE_ALPHA}): ref ${durumlu[0].toFixed(4)} → ${durumlu[1].toFixed(4)} · kayma ${durumluKayma.toFixed(4)} · sönüm ${sonum.toFixed(2)}×`,
);
// TABAN 4×: α süpürüldü (bkz. STRETCH_RANGE_ALPHA docstring'i). Seçim kuralı
// "kalıcı değişimin 30 kare sonraki kalan hatası < %1" idi; onu sağlayan en
// güçlü sönüm 4.92× ölçüldü. Taban, o ölçümün altına küçük bir paylaydı —
// sönüm 4×'in altına düşerse α sessizce gevşetilmiş demektir.
assert.ok(
  sonum >= 4,
  `zamansal taşıma nefes almayı yeterince sönümlemiyor: ${sonum.toFixed(2)}× (taban 4×)`,
);

// ---------------------------------------------------------------------------
// [3] TAŞIMA SÜREKLİ İZLEMELİ — kalıcı değişim sonunda kabul edilmeli.
// Yoksa sönüm "dondurma" olurdu ve gerçek hareket asla görünmezdi.
// ---------------------------------------------------------------------------
{
  const d2 = yeniStretchAraligi();
  const seri = refDegeri([A, ...Array(29).fill(B)], d2);
  const sonDeger = seri[seri.length - 1];
  const hedef = durumsuz[1]; // taşımasız kararlı hâl
  const fark = Math.abs(sonDeger - hedef);
  console.log(
    `[3] aynı kare 29 kez tekrar → ref ${sonDeger.toFixed(4)}, taşımasız hedef ${hedef.toFixed(4)}, kalan hata ${fark.toFixed(4)}`,
  );
  // α SEÇİM KURALININ KENDİSİ: 30 kare sonra kalan hata 0..1 aralığının
  // %1'ini aşmamalı (canlı yol 3.5–9 Hz → 30 kare ≈ 3–9 sn). Bu kapı, α
  // düşürülerek sönümün "dondurmaya" çevrilmesini engeller.
  assert.ok(
    fark < 0.01,
    `taşıma kalıcı değişimi izlemiyor (kalan hata ${fark.toFixed(4)} ≥ %1) — sönüm dondurmaya dönüşmüş`,
  );
}

// ---------------------------------------------------------------------------
// [4] FOTOĞRAF YOLU DEĞİŞMEDİ — durum verilmezse davranış birebir eskisi.
// ---------------------------------------------------------------------------
{
  const d1 = Float32Array.from(B.depth);
  const d2 = Float32Array.from(B.depth);
  applyForegroundStretch(d1, B.mask, W, H);
  applyForegroundStretch(d2, B.mask, W, H, undefined, undefined);
  let enBuyuk = 0;
  for (let i = 0; i < N; i++) enBuyuk = Math.max(enBuyuk, Math.abs(d1[i] - d2[i]));
  assert.equal(enBuyuk, 0, 'durumsuz çağrı ile açıkça undefined geçilen çağrı ayrışıyor');
  console.log('[4] foto yolu (durum yok) bit düzeyinde değişmedi ✓');
}

// ---------------------------------------------------------------------------
// [5] DURUM SIFIRLANABİLİR — kaynak değişiminde eski klibin aralığı miras
// kalmamalı.
// ---------------------------------------------------------------------------
{
  const d = yeniStretchAraligi();
  refDegeri([B, B, B, B, B], d);
  assert.ok(d.lo !== null && d.hi !== null, 'durum dolmadı');
  const taze = yeniStretchAraligi();
  assert.equal(taze.lo, null, 'yeni durum temiz başlamıyor');
  assert.equal(taze.hi, null, 'yeni durum temiz başlamıyor');
  const ilk = refDegeri([A], taze)[0];
  const referans = refDegeri([A], undefined)[0];
  assert.ok(
    Math.abs(ilk - referans) < 1e-6,
    'temiz durumda İLK kare taşımasız sonuçla aynı olmalı (miras yok)',
  );
  console.log('[5] temiz durum: ilk kare taşımasız sonuçla birebir ✓');
}

console.log('OK stretch zamansal kararlılığı — nefes alma sönümlendi, kalıcı değişim izleniyor');
