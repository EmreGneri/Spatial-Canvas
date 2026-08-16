// E5.1 — VİDEO DERİNLİĞİ: keyframe'ler arası zamansal hizalama.
//
// SORUN: her keyframe'in derinliği KENDİ içinde normalize gelir (MiDaS
// çıktısı göreli; luminance da öyle). Aynı duvar iki karede farklı sayı
// alır → füzyonda katmanlar kayar (hayalet). Çözüm: her kareyi ortak
// izlerden uydurulan affine (a·d + b) ile keyframe-0 uzayına taşımak.
//
// Suite MODELE BAĞLANMAZ — sahte derinlik sağlayıcıyla deterministik kalır
// (MiDaS indirme/GPU testte yok). GPU gerekmez:
//   node scripts/verify-video-depth.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);

const { alignDepthChain } = await import('../src/engine/vision/temporal.ts');
const { disparityToDistance } = await import('../src/engine/vision/depthProvider.ts');

const W = 32;
const H = 24;

/** Sentetik derinlik alanı: ön plan (sol yarı) yakın, arka plan uzak. */
const makeDepth = (a, b) => {
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const base = x < W / 2 ? 0.8 : 0.2; // yakın / uzak
      d[y * W + x] = a * base + b;
    }
  }
  return d;
};

/** Kareler arası birebir eşleşme (aynı pikseller — saf ölçek farkı testi). */
const identityMatches = () => {
  const m = [];
  for (let y = 2; y < H - 2; y += 2) {
    for (let x = 2; x < W - 2; x += 2) m.push({ x1: x, y1: y, x2: x, y2: y });
  }
  return m;
};

const medianOf = (d) => {
  const s = [...d].sort((p, q) => p - q);
  return s[s.length >> 1];
};

// ---------------------------------------------------------------------------
// 1. BİLİNEN AFFINE — üç kare, her biri farklı ölçek/offset'te. Hizalama
//    sonrası hepsi keyframe-0 uzayında olmalı.
// ---------------------------------------------------------------------------
{
  const depths = [makeDepth(1, 0), makeDepth(2, 0.1), makeDepth(0.5, -0.05)];
  const matches = [identityMatches(), identityMatches()];
  const { depths: aligned, fits } = alignDepthChain(depths, matches, W, H);

  assert.equal(aligned.length, 3, 'kare sayısı korunmalı');
  assert.equal(fits.length, 2, 'çift başına bir uydurma');
  assert.ok(
    fits.every((f) => f !== null),
    'birebir eşleşmede uydurma başarısız olmamalı',
  );

  const m0 = medianOf(aligned[0]);
  for (let i = 1; i < aligned.length; i++) {
    const rel = Math.abs(medianOf(aligned[i]) - m0) / Math.abs(m0);
    console.log(`[1] kare ${i}: hizalama sonrası medyan sapması %${(rel * 100).toFixed(3)}`);
    assert.ok(rel < 0.05, `kare ${i} medyan sapması %${(rel * 100).toFixed(1)} ≥ %5`);
  }
  // Kare 0 DOKUNULMAZ (referans uzay).
  assert.deepEqual(Array.from(aligned[0]), Array.from(depths[0]), 'kare 0 değişmemeli');
}

// ---------------------------------------------------------------------------
// 2. AYRIM KAZANCI — hizalanmış zincirde ön/arka plan ayrımı, hizalanmamış
//    (ham) zincire göre net daha iyi olmalı. Ham zincirde kare 1'in "uzak"ı
//    kare 0'ın "yakın"ından büyük olabiliyor — sıralama bozuluyor.
// ---------------------------------------------------------------------------
{
  const depths = [makeDepth(1, 0), makeDepth(2, 0.1), makeDepth(0.5, -0.05)];
  const matches = [identityMatches(), identityMatches()];
  const { depths: aligned } = alignDepthChain(depths, matches, W, H);

  // Her karede ön plan (x<W/2) ile arka planın ortalaması.
  const layers = (arr) => {
    let near = 0;
    let far = 0;
    let n = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W / 2; x++) {
        near += arr[y * W + x];
        far += arr[y * W + x + W / 2];
        n++;
      }
    }
    return [near / n, far / n];
  };
  // Yayılım: aynı yüzeyin kareler arası değer aralığı. Küçük = tutarlı.
  const spread = (list, idx) => {
    const v = list.map((a) => layers(a)[idx]);
    return Math.max(...v) - Math.min(...v);
  };
  const hamYakin = spread(depths, 0);
  const hizaliYakin = spread(aligned, 0);
  const kazanc = hamYakin / Math.max(hizaliYakin, 1e-9);
  console.log(
    `[2] "yakın" yüzeyin kareler arası yayılımı: ham ${hamYakin.toFixed(4)} → hizalı ${hizaliYakin.toFixed(4)} (${kazanc.toFixed(1)}× iyileşme)`,
  );
  assert.ok(kazanc >= 2, `tutarlılık kazancı ${kazanc.toFixed(1)}× — en az 2× beklenir`);
}

// ---------------------------------------------------------------------------
// 3. EŞLEŞME YOKSA — uydurma null döner ve O ADIM KİMLİK olur; zincir
//    kopmaz, sonraki kareler sessizce bozulmaz (yanlış ölçek yaymaz).
// ---------------------------------------------------------------------------
{
  const depths = [makeDepth(1, 0), makeDepth(2, 0.1), makeDepth(2, 0.1)];
  const { depths: aligned, fits } = alignDepthChain(depths, [[], identityMatches()], W, H);
  assert.equal(fits[0], null, 'eşleşmesiz çiftte uydurma null olmalı');
  assert.deepEqual(Array.from(aligned[1]), Array.from(depths[1]), 'null uydurma = kimlik');
  console.log('[3] eşleşmesiz çift → kimlik adımı, zincir kopmuyor ✓');
}

// ---------------------------------------------------------------------------
// 4. DETERMİNİZM + sözleşme: aynı girdi birebir aynı çıktı, NaN yok.
// ---------------------------------------------------------------------------
{
  const mk = () => [makeDepth(1, 0), makeDepth(1.7, 0.05), makeDepth(0.6, -0.02)];
  const m = [identityMatches(), identityMatches()];
  const a = alignDepthChain(mk(), m, W, H).depths;
  const b = alignDepthChain(mk(), m, W, H).depths;
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(Array.from(a[i]), Array.from(b[i]), `kare ${i} deterministik değil`);
    assert.ok(a[i].every(Number.isFinite), `kare ${i} NaN içeriyor`);
  }
  console.log('[4] determinizm + NaN yok ✓');
}

// ---------------------------------------------------------------------------
// 5. DİSPARİTE → MESAFE. estimateDepth "0 = uzak, 1 = yakın" DİSPARİTE verir;
//    füzyon d_pred'i MESAFE gibi kullanır (scale.ts pozitif eğim bekler).
//    Dönüşüm monoton ARTAN olmalı — yoksa affine uydurma ters işaretle
//    "çözer" ve guven 0'a düşer (sessiz kalite kaybı).
// ---------------------------------------------------------------------------
{
  // Yakın (0.9) → uzak (0.05) giden disparite dizisi.
  const disp = new Float32Array([0.9, 0.7, 0.5, 0.3, 0.1, 0.05]);
  const dist = disparityToDistance(disp);
  assert.ok(dist.every(Number.isFinite), 'mesafe alanında NaN/Infinity olmamalı');
  for (let i = 1; i < dist.length; i++) {
    assert.ok(dist[i] > dist[i - 1], `mesafe monoton artmalı @${i}: ${dist[i - 1]} → ${dist[i]}`);
  }
  assert.ok(Math.max(...dist) <= 1 + 1e-6, 'çıktı [0,1] aralığına ölçeklenmeli');
  console.log(
    `[5] disparite→mesafe monoton artan, en yakın ${dist[0].toFixed(3)} → en uzak ${dist[dist.length - 1].toFixed(3)} ✓`,
  );

  // Sıfır disparite (gökyüzü) patlamamalı — alt yüzdelik kırpması devrede.
  const withSky = new Float32Array([0, 0, 0.5, 0.9]);
  const skyDist = disparityToDistance(withSky);
  assert.ok(skyDist.every(Number.isFinite), 'sıfır disparite sonsuza gitmemeli');
  console.log('[5] sıfır disparite (gökyüzü) sonlu kalıyor ✓');

  // Kenar durum: boş girdi ve tek eleman.
  assert.equal(disparityToDistance(new Float32Array(0)).length, 0, 'boş girdi');
  assert.ok(Number.isFinite(disparityToDistance(new Float32Array([0.4]))[0]), 'tek eleman');
}

console.log('OK video derinliği — zamansal affine hizalama + disparite dönüşümü (E5.1)');
