import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { egim, grafikDuzeni, SERI_SINIRI, seriEkle } from '../src/ui/egitimIlerleme.ts';

// ── SERİ BİRİKTİRME ────────────────────────────────────────────────────────
// PSNR henüz yoksa nokta EKLENMEZ: 0 dB uydurmak eğriyi yalan bir dipten
// başlatır (ilk iterasyonlarda trainer PSNR basmıyor).
assert.equal(seriEkle([], { iter: 1, splats: 1000 }).length, 0);
assert.equal(seriEkle([], { iter: 1, splats: 1000, psnrTrain: NaN }).length, 0);

// psnrTrain yoksa psnrHold'a düşülür (holdout modunda yalnız o gelir).
{
  const s = seriEkle([], { iter: 10, splats: 5, psnrHold: 18.2 });
  assert.equal(s.length, 1);
  assert.equal(s[0].psnr, 18.2);
}
// İkisi de varsa EĞİTİM PSNR'ı çizilir — her iterasyonda gelen odur, eğri
// holdout'un seyrek noktalarıyla basamaklanmaz.
assert.equal(seriEkle([], { iter: 10, splats: 5, psnrTrain: 20, psnrHold: 18 })[0].psnr, 20);

// Girdi dizisi YERİNDE değişmemeli (React state).
{
  const once = [{ iter: 1, psnr: 10, splats: 1 }];
  const sonra = seriEkle(once, { iter: 2, splats: 2, psnrTrain: 11 });
  assert.equal(once.length, 1, 'seriEkle girdi dizisini değiştiriyor');
  assert.equal(sonra.length, 2);
}

// Aynı iterasyon iki kez gelirse ÜZERİNE yazılır, seri şişmez.
{
  let s = seriEkle([], { iter: 100, splats: 1, psnrTrain: 15 });
  s = seriEkle(s, { iter: 100, splats: 2, psnrTrain: 16 });
  assert.equal(s.length, 1);
  assert.equal(s[0].psnr, 16);
  assert.equal(s[0].splats, 2);
}

// SINIR: seyreltme eğrinin BAŞINI kesmemeli (en dik iyileşme orada) ve CANLI
// UCU düşürmemeli (grafik geride kalır).
{
  let s = [];
  for (let i = 1; i <= 600; i++) s = seriEkle(s, { iter: i * 10, splats: i, psnrTrain: 10 + i * 0.01 });
  assert.ok(s.length <= SERI_SINIRI + 1, `seri sınırı aşılmış: ${s.length}`);
  assert.equal(s[0].iter, 10, 'seyreltme serinin başını kesmiş');
  assert.equal(s[s.length - 1].iter, 6000, 'seyreltme canlı ucu düşürmüş');
  // Sıra bozulmamalı.
  for (let i = 1; i < s.length; i++) assert.ok(s[i].iter > s[i - 1].iter, 'seri sırası bozuldu');
}

// ── KADRAJA OTURTMA ────────────────────────────────────────────────────────
// Boş seri çökmemeli, boş kadraj dönmeli.
{
  const d = grafikDuzeni([], 260, 44, 3000);
  assert.equal(d.yol, '');
  assert.equal(d.son, null);
  assert.equal(d.ilerleme, 0);
}

// X ekseni BÜTÇEye göre ölçeklenir: yarı yolda çizgi kadrajın yarısında biter
// (hedef-gradyanı etkisi — bitişe ne kadar kaldığı görünmeli).
{
  const seri = [{ iter: 0, psnr: 10, splats: 1 }, { iter: 1500, psnr: 20, splats: 2 }];
  const d = grafikDuzeni(seri, 200, 40, 3000, 0);
  const noktalar = d.yol.split(' ').map((p) => p.split(',').map(Number));
  assert.ok(Math.abs(noktalar[0][0] - 0) < 0.2, `başlangıç x ${noktalar[0][0]}`);
  assert.ok(Math.abs(noktalar[1][0] - 100) < 0.2, `yarı yol x ${noktalar[1][0]} ≠ 100`);
  assert.ok(Math.abs(d.ilerleme - 0.5) < 1e-6);
  // YÜKSEK PSNR YUKARI: SVG y aşağı artar, işaret çevrilmiş olmalı.
  assert.ok(noktalar[1][1] < noktalar[0][1], 'PSNR artışı grafikte aşağı iniyor');
}

// Y ekseni SERİNİN aralığı — sabit 0..50'de 1 dB'lik iyileşme düz görünür.
{
  const d = grafikDuzeni([{ iter: 0, psnr: 18, splats: 1 }, { iter: 10, psnr: 22, splats: 1 }], 100, 40, 10);
  assert.ok(d.yMin <= 18 && d.yMax >= 22);
  assert.ok(d.yMax - d.yMin < 10, `eksen gereksiz geniş: ${d.yMin}–${d.yMax}`);
}

// DÜZ seri: eksen çökmemeli (sıfıra bölme), aralık açılmalı.
{
  const d = grafikDuzeni([{ iter: 0, psnr: 20, splats: 1 }, { iter: 10, psnr: 20, splats: 1 }], 100, 40, 10);
  assert.ok(d.yMax > d.yMin, 'düz seride eksen çöküyor');
  assert.ok(d.yol.split(' ').every((p) => p.split(',').every((v) => Number.isFinite(Number(v)))),
    'düz seride NaN koordinat üretiliyor');
}

// Bütçe bilinmiyorsa (0) son iterasyon eksenin sonu olur — çizgi taşmaz.
{
  const d = grafikDuzeni([{ iter: 0, psnr: 10, splats: 1 }, { iter: 700, psnr: 12, splats: 1 }], 200, 40, 0, 0);
  const son = d.yol.split(' ').pop().split(',').map(Number);
  assert.ok(Math.abs(son[0] - 200) < 0.2, `bütçesiz kadrajda son x ${son[0]}`);
}

// Bütçe AŞILIRSA (devamEt hedefi yükseltmeden metrik gelirse) çizgi kadrajın
// dışına taşmamalı.
{
  const d = grafikDuzeni([{ iter: 0, psnr: 10, splats: 1 }, { iter: 9000, psnr: 12, splats: 1 }], 200, 40, 3000, 0);
  for (const p of d.yol.split(' ')) {
    const [x, y] = p.split(',').map(Number);
    assert.ok(x >= 0 && x <= 200, `x kadraj dışı: ${x}`);
    assert.ok(y >= 0 && y <= 40, `y kadraj dışı: ${y}`);
  }
  assert.ok(d.ilerleme <= 1);
}

// ── EĞİM ("sürdür +4.000" kararı) ──────────────────────────────────────────
assert.equal(egim([]), null);
assert.equal(egim([{ iter: 1, psnr: 10, splats: 1 }]), null, 'tek noktadan eğim uydurulmuş');
// Aynı iterasyonda iki nokta → bölme yok, null.
assert.equal(egim([
  { iter: 5, psnr: 10, splats: 1 }, { iter: 5, psnr: 11, splats: 1 }, { iter: 5, psnr: 12, splats: 1 },
]), null);
{
  // 1000 iterasyonda 2 dB → 2 dB / 1k.
  const s = [{ iter: 0, psnr: 10, splats: 1 }, { iter: 500, psnr: 11, splats: 1 }, { iter: 1000, psnr: 12, splats: 1 }];
  assert.ok(Math.abs(egim(s) - 2) < 1e-6, `eğim ${egim(s)}`);
}
{
  // Doymuş eğri: eğim ~0, "eğri düzleşmişti" yazılmalı.
  const s = Array.from({ length: 30 }, (_, i) => ({ iter: i * 100, psnr: 24 + i * 0.0001, splats: 1 }));
  assert.ok(Math.abs(egim(s)) < 0.01, `doymuş eğride eğim ${egim(s)}`);
}

// ── KABLO DENETİMİ ─────────────────────────────────────────────────────────
// Trainer ZATEN iterasyon başına PSNR + Gaussian basıyor (olay.metrik); eksik
// olan tek şey onu UI'a taşımaktı. Kablo kopmasın.
const egitim = readFileSync(new URL('../src/ui/Egitim3D.tsx', import.meta.url), 'utf8');
assert.match(egitim, /ilerlemeRef\.current\?\.\(m, hedefIterRef\.current\)/, 'metrik üst katmana verilmiyor');
assert.match(egitim, /ilerlemeRef\.current\?\.\(null, 0\)/, 'oturum kapanırken seri sıfırlanmıyor — yeni deneme eskinin üstüne çizer');
// `say` ile aynı tuzak: geri çağrı effect bağımlılığı olursa eğitim her
// render'da baştan başlar. Ref üzerinden okunmalı.
assert.ok(!/\[dosya, started, subjectOnly, onIlerleme\]/.test(egitim),
  'onIlerleme effect bağımlılığında — her render eğitimi baştan başlatır');
// devamEt bütçeyi yükseltir; X ekseni takip etmezse çizgi kadrajı taşar.
assert.match(egitim, /hedefIterRef\.current = target/, 'sürdür sonrası X ekseni bütçeyi takip etmiyor');

// Grafik kütüphanesiz olmalı (bu ölçekte 40+ KB bağımlılık aynı çizgiyi çizer).
const bilesen = readFileSync(new URL('../src/ui/EgitimGrafik.tsx', import.meta.url), 'utf8');
assert.match(bilesen, /<polyline/, 'grafik SVG polyline ile çizilmiyor');
assert.ok(!/from '(?!\.\/|react)/.test(bilesen.replace(/from 'react'/g, '')), 'grafiğe dış bağımlılık girmiş');
// Erişilebilirlik: eğri tek başına ekran okuyucuya bir şey söylemez.
assert.match(bilesen, /aria-label=/, 'grafikte aria-label yok');

// Grafik transport şeridinin ALTINDA, şeridin İÇİNDE değil.
const serit = readFileSync(new URL('../src/ui/TransportSerit.tsx', import.meta.url), 'utf8');
assert.match(serit, /altSatir && <div style=\{\{ flexBasis: '100%'/, 'alt satır tam genişlikte değil');

console.log('verify-egitim-ilerleme: OK · seyreltme, bütçe eksenli kadraj, eğim, kablo denetimi');
