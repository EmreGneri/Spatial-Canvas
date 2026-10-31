// Takılmış bir GPU işi sırayı tutarken arkasına gelen iş süresiz beklemez (denetim bulgusu 3).
//   node scripts/verify-gpu-kuyrugu-takili.mjs
import assert from 'node:assert/strict';
const { gpuSirasinaGir } = await import('../src/depth.ts');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const sonuc = async (p) => { try { return { ok: await p }; } catch (e) { return { hata: e.message }; } };

// 1. Normal akış: sıra bozulmadan çalışır.
{
  const sira = [];
  await Promise.all([1, 2, 3].map((n) => gpuSirasinaGir(async () => { sira.push(`b${n}`); await bekle(5); sira.push(`s${n}`); })));
  assert.deepEqual(sira, ['b1', 's1', 'b2', 's2', 'b3', 's3'], 'işler sırayla ve üst üste binmeden çalışmalı');
}

// 2. Bitmeyen iş: ilk çağıran zaman aşımını alır, SIRADA BEKLEYEN iş hızla reddedilir ve hiç başlamaz.
{
  let acik; const kapi = new Promise((r) => { acik = r; });
  let ikinciBasladi = false;
  const ilk = gpuSirasinaGir(async () => { await kapi; return 'ilk'; }, 20);
  const ikinci = gpuSirasinaGir(async () => { ikinciBasladi = true; return 'ikinci'; }, 20);
  const t0 = performance.now();
  const [a, b] = await Promise.all([sonuc(ilk), sonuc(ikinci)]);
  assert.match(a.hata, /20 sn|bitmedi/, 'ilk iş zaman aşımına uğramalı');
  assert.match(b.hata, /GPU sırası takılı/, 'bekleyen iş açıklayıcı hatayla reddedilmeli');
  assert.ok(performance.now() - t0 < 500, 'bekleyen iş süresiz beklememeli');
  // 3. Takılma sürerken sıraya YENİ giren iş de hemen reddedilir.
  const t1 = performance.now();
  const yeni = await sonuc(gpuSirasinaGir(async () => 'yeni', 20));
  assert.match(yeni.hata, /GPU sırası takılı/);
  assert.ok(performance.now() - t1 < 100, 'yeni iş de hemen reddedilmeli');
  // Gerçek iş bitmeden kilit bırakılmadı: iş serbest kalınca sıra normale döner, reddedilen iş hiç çalışmadı.
  acik();
  await bekle(30);
  assert.equal(ikinciBasladi, false, 'reddedilen bayat iş başlatılmamalı');
  const sonra = await sonuc(gpuSirasinaGir(async () => 'tamam', 20));
  assert.equal(sonra.ok, 'tamam', 'takılan iş bitince sıra yeniden çalışmalı');
}

// 4. Yavaş ama biten iş takılma sayılmaz (süre içinde biter).
{
  const a = await sonuc(gpuSirasinaGir(async () => { await bekle(10); return 'yavas'; }, 200));
  assert.equal(a.ok, 'yavas');
}
console.log('OK takılmış GPU işi arkasındakileri süresiz bekletmiyor (bekleyen ve yeni iş reddedilir, bayat iş başlamaz, iş bitince sıra normale döner)');
