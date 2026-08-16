// Splat alfa/kenar doğruluğu testi (GPU gerekmez, saf CPU) — Gün 4, Zeynep.
//
// Video füzyonu on binlerce splat üretiyor; algılanan kalite doğrudan
// kenarların ve alfanın doğruluğundan geliyor. İki somut hata denetlenir:
//   1. KES-KOPAR KENAR: ham Gauss kesim yarıçapında (2σ) hâlâ exp(-2) = 0.135
//      taşır. Orada kesilince alfa %13.5'ten bir anda 0'a düşer ve her
//      splat'ın çevresinde görünür sert bir halka oluşur.
//   2. KAYBOLAN UZAK SPLAT: piksel altına inen splat örnekleme ızgarasını
//      ıskalar ve yok olur — uzak yüzey delik delik görünür.
//
// GLSL'deki düşüş bu dosyadaki `splatFalloff` ile AYNI sabitlerden üretilir
// (shader şablonu SPLAT_EDGE'i gömüyor), yani ikisi ayrışamaz.
//   node scripts/verify-splat-alpha.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SPLAT_CUTOFF_SIGMA,
  SPLAT_EDGE,
  SPLAT_MIN_SCREEN_RADIUS,
  splatFalloff,
} from '../src/shaders/splatMaterial.ts';

// --- 1. Düşüş sözleşmesi: f(0) = 1, f(1) = 0, monoton azalan ---
{
  assert.equal(splatFalloff(0), 1, 'merkez tam opak (f(0) = 1)');
  assert.equal(splatFalloff(1), 0, 'kesim yarıçapında TAM 0 (sert halka yok)');
  assert.ok(splatFalloff(1) < 0.02, 'f(1) < 0.02 (kabul ölçütü)');
  let prev = Infinity;
  for (let i = 0; i <= 100; i++) {
    const v = splatFalloff(i / 100);
    assert.ok(v <= prev + 1e-12, `monoton azalan @rNorm=${(i / 100).toFixed(2)}`);
    assert.ok(v >= 0 && v <= 1, `0..1 aralığında @${i}`);
    prev = v;
  }
  // Aralık dışı girdiler kelepçeli (NaN/negatif alfa üretmez).
  assert.equal(splatFalloff(1.5), 0, 'kesim ötesi → 0');
  assert.equal(splatFalloff(-0.2), 1, 'negatif yarıçap → 1 (kelepçe)');
}

// --- 2. REGRESYON: ham Gauss neden yetmiyordu ---
// Bu, 1. hatanın kanıtı: normalize edilmemiş düşüş kesim noktasında hâlâ
// gözle görülür bir alfa taşıyor.
{
  const hamKesimde = Math.exp(-0.5 * SPLAT_CUTOFF_SIGMA * SPLAT_CUTOFF_SIGMA);
  assert.ok(
    hamKesimde > 0.1,
    `ham Gauss kesimde ${hamKesimde.toFixed(4)} taşıyor (>0.1) — sert halka kaynağı`,
  );
  assert.ok(Math.abs(hamKesimde - SPLAT_EDGE) < 1e-12, 'SPLAT_EDGE ham kesim değeriyle aynı');
  // Normalize edilmiş sürüm aynı noktada sıfır.
  assert.equal(splatFalloff(1), 0, 'normalize sürüm kesimde 0');
}

// --- 3. ALFA ÖLÇEĞİ: küçük splat sönümlenir, BÜYÜMEZ (enerji korunur) ---
// Vertex'teki formülün CPU aynası: shrink = (min(r,rmin)/rmin)², alan oranı.
{
  const rmin = SPLAT_MIN_SCREEN_RADIUS;
  const shrink = (r1, r2) => (Math.min(r1, rmin) / rmin) * (Math.min(r2, rmin) / rmin);
  assert.equal(shrink(rmin, rmin), 1, 'taban yarıçapta sönüm yok');
  assert.equal(shrink(10, 10), 1, 'büyük splat sönümlenmez');
  const yari = shrink(rmin / 2, rmin / 2);
  assert.ok(Math.abs(yari - 0.25) < 1e-12, 'yarıçap yarıya inince alfa 1/4 (alan oranı)');
  assert.ok(shrink(0, 0) === 0, 'sıfır yarıçap → alfa 0');
  // Monotonluk: küçüldükçe alfa azalır.
  let prev = 1;
  for (let k = 10; k >= 0; k--) {
    const v = shrink((rmin * k) / 10, (rmin * k) / 10);
    assert.ok(v <= prev + 1e-12, 'küçüldükçe alfa azalır');
    prev = v;
  }
}

// --- 4. Shader ile CPU AYRIŞAMAZ: GLSL sabitleri TS'ten gömülüyor ---
{
  const src = readFileSync(
    fileURLToPath(new URL('../src/shaders/splatMaterial.ts', import.meta.url)),
    'utf8',
  );
  assert.ok(
    src.includes('${SPLAT_EDGE.toFixed(6)}'),
    'GLSL düşüşü SPLAT_EDGE sabitinden gömülüyor (elle yazılmış sayı değil)',
  );
  assert.ok(
    src.includes('${SPLAT_MIN_SCREEN_RADIUS.toFixed(2)}'),
    'GLSL min yarıçapı SPLAT_MIN_SCREEN_RADIUS sabitinden gömülüyor',
  );
  assert.ok(src.includes('vAlphaScale'), 'alfa ölçeği vertex→fragment taşınıyor');
  assert.ok(
    /alpha\s*=\s*g \* vOpacity \* uSplatOpacity \* vAlphaScale/.test(src),
    'alfa hesabı ölçeği içeriyor',
  );
}

// --- 5. ÖLÇÜM: erken discard'ın kazandırdığı fragment oranı ---
// Kesim dairesi quad'ın içine yazılı: quad alanı (2c)², daire π c².
// Yani köşelerdeki 1 − π/4 ≈ %21.5 fragment ZATEN atılıyor; üstüne alfa
// eşiğinin (0.003) altındaki halka da atılıyor. İddia değil, ölçüm.
{
  const N = 400;
  let inQuad = 0;
  let drawn = 0;
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const x = ((ix + 0.5) / N) * 2 - 1;
      const y = ((iy + 0.5) / N) * 2 - 1;
      inQuad++;
      const rNorm = Math.hypot(x, y);
      if (rNorm >= 1) continue; // kesim dışı → discard
      if (splatFalloff(rNorm) < 0.003) continue; // alfa eşiği → discard
      drawn++;
    }
  }
  const atilan = 100 * (1 - drawn / inQuad);
  console.log(
    `erken discard: quad fragment'lerinin %${atilan.toFixed(1)}'i atılıyor (kesim dairesi + alfa eşiği)`,
  );
  assert.ok(atilan > 20, `fill-rate kazancı anlamlı (%${atilan.toFixed(1)} > %20)`);
}

console.log(
  'OK · splat alfa (normalize düşüş f(0)=1 f(1)=0 monoton, ham Gauss regresyonu, min ekran yarıçapı alan-oranlı sönüm, GLSL/CPU sabit bağı)',
);
