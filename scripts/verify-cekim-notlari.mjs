import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cekimKaliteNotlari, cekimNotlari, COK_BULANIK_ORAN, EN_AZ_FPS, EN_AZ_SURE_SN, EN_AZ_TABAN_ORANI, EN_AZ_UZUN_KENAR,
  ONERILEN_SURE_SN, uzunKenar, YERINDE_DONME_DERECE,
} from '../src/ui/cekimNotlari.ts';
import { cekimGeometrisi } from '../src/engine/reconstruction/egitim3dgs.ts';

const iyi = { genislik: 3840, yukseklik: 2160, sureSn: 20.9, fps: 30 };

// ── SESSİZLİK KURALI ───────────────────────────────────────────────────────
// Sorun yoksa HİÇBİR ŞEY çizilmez. `yetenekGorunum` ile aynı gerekçe: çalışan
// kurulumda "her şey yolunda" rozeti, sonraki GERÇEK uyarının okunmamasına
// yol açar.
assert.deepEqual(cekimNotlari(iyi), [], 'sorunsuz klipte not üretiliyor');

// ── ÖLÇÜLEN GERÇEK KLİPLER (assets/test-clips) ─────────────────────────────
// Bu satırlar bir ölçümün kaydı: eşikler değişirse hangi gerçek klibin
// davranışının değiştiği görünür olsun.
const OLCULEN = {
  uhd:           { genislik: 3840, yukseklik: 2160, sureSn: 20.9, fps: 30 },
  nyuYuruyus:    { genislik: 854,  yukseklik: 480,  sureSn: 382.6, fps: 30 },
  stgeorge:      { genislik: 4096, yukseklik: 1974, sureSn: 12.2, fps: 29.97 },
  mariatheresa:  { genislik: 3840, yukseklik: 2160, sureSn: 71.5, fps: 30 },
};
// Dosya adında "[4K]" yazan klip GERÇEKTE 854×480 — aracın yakalaması gereken
// tam durum bu. Diğer üçü sessiz kalmalı.
assert.equal(cekimNotlari(OLCULEN.nyuYuruyus).length, 1, 'NYU klibi (854×480) not almıyor');
assert.match(cekimNotlari(OLCULEN.nyuYuruyus)[0].sebep, /854×480/, 'not gerçek çözünürlüğü söylemiyor');
for (const ad of ['uhd', 'mariatheresa']) {
  assert.deepEqual(cekimNotlari(OLCULEN[ad]), [], `${ad}: meşru klip haksız not alıyor`);
}
// stgeorge 12,2 sn: yumuşak "kısa klip" notu (yaygın öneri ≥ 20 sn). Bilinçli
// değişiklik (2026-10-24): kalite tahmini değil, kapsama hatırlatması.
assert.deepEqual(cekimNotlari(OLCULEN.stgeorge).map((n) => n.baslik), ['Klip kısa']);

// ── UZUN KENAR, KISA KENAR DEĞİL ───────────────────────────────────────────
// Dikey telefon videosu kısa kenara bakan bir kuralda HAKSIZ düşer; eğitim
// uzun kenarı kullanıyor.
assert.equal(uzunKenar({ genislik: 1080, yukseklik: 1920 }), 1920);
assert.deepEqual(cekimNotlari({ genislik: 1080, yukseklik: 1920, sureSn: 30, fps: 30 }), [],
  'dikey telefon videosu (1080×1920) haksız not alıyor — kural kısa kenara bakıyor');
// Yatay 1920×1080 de sessiz.
assert.deepEqual(cekimNotlari({ genislik: 1920, yukseklik: 1080, sureSn: 30, fps: 30 }), []);
// Eşiğin tam üstü/altı.
assert.equal(cekimNotlari({ ...iyi, genislik: EN_AZ_UZUN_KENAR, yukseklik: 720 }).length, 0);
assert.equal(cekimNotlari({ ...iyi, genislik: EN_AZ_UZUN_KENAR - 1, yukseklik: 720 }).length, 1);

// ── SÜRE ───────────────────────────────────────────────────────────────────
{
  const n = cekimNotlari({ genislik: 1920, yukseklik: 1080, sureSn: 2.1, fps: 30 });
  assert.equal(n.length, 1);
  assert.match(n[0].sebep, /2\.1 sn/, 'süre notu gerçek süreyi söylemiyor');
  // Eylem somut olmalı: "yerinde dönmek paralaks üretmez" bu projenin
  // ölçülmüş bulgusu (sfm.js "need more parallax/overlap").
  assert.match(n[0].eylem, /etrafında|ETRAFINDA/i, 'eylem somut değil');
}
// 3–20 sn: yumuşak not; tam 20 sn ve üstü sessiz.
assert.deepEqual(cekimNotlari({ ...iyi, sureSn: EN_AZ_SURE_SN }).map((n) => n.baslik), ['Klip kısa']);
assert.match(cekimNotlari({ ...iyi, sureSn: 8.4 })[0].sebep, /8\.4 sn/);
assert.equal(cekimNotlari({ ...iyi, sureSn: ONERILEN_SURE_SN }).length, 0);
assert.equal(cekimNotlari({ ...iyi, sureSn: 2.9 }).filter((n) => n.baslik === 'Klip kısa').length, 0,
  '3 sn altı yalnız "çok kısa" almalı, iki süre notu birden değil');

// ── FPS ────────────────────────────────────────────────────────────────────
assert.equal(cekimNotlari({ ...iyi, fps: 15 }).length, 1);
assert.equal(cekimNotlari({ ...iyi, fps: EN_AZ_FPS }).length, 0);
// BİLİNMEYEN ≠ KÖTÜ. fps konteyner başlığında yok; null not üretmemeli.
assert.deepEqual(cekimNotlari({ ...iyi, fps: null }), [], 'fps bilinmiyorken not üretiliyor');

// ── GEÇERSİZ/EKSİK ÖLÇÜ SESSİZ KALIR ───────────────────────────────────────
// `videoWidth` metadata gelmeden 0 olabilir, `duration` canlı akışta Infinity.
// Bunları "kötü" saymak ilk gerçek notun güvenilirliğini de bitirirdi.
for (const [ad, o] of Object.entries({
  sifirBoyut: { genislik: 0, yukseklik: 0, sureSn: 20, fps: 30 },
  sonsuzSure: { genislik: 1920, yukseklik: 1080, sureSn: Infinity, fps: 30 },
  nanSure:    { genislik: 1920, yukseklik: 1080, sureSn: NaN, fps: 30 },
  nanFps:     { ...iyi, fps: NaN },
  sifirFps:   { ...iyi, fps: 0 },
})) {
  assert.deepEqual(cekimNotlari(o), [], `${ad}: bilinmeyen ölçü not üretiyor`);
}

// ── ÇOKLU NOT VE SIRA ──────────────────────────────────────────────────────
// Çözünürlük bir TAVAN'dır (sonradan düzeltilemez), süre/fps yeniden çekimle
// düzelir — en çok kısıtlayan önce.
{
  const n = cekimNotlari({ genislik: 640, yukseklik: 480, sureSn: 1.5, fps: 12 });  // 3 sn altı: tek süre notu
  assert.equal(n.length, 3);
  assert.deepEqual(n.map((x) => x.baslik), ['Çözünürlük düşük', 'Klip çok kısa', 'Kare hızı düşük']);
}

// Her notun üç alanı da dolu ve eylem içeriyor olmalı.
for (const o of [OLCULEN.nyuYuruyus, { ...iyi, sureSn: 1 }, { ...iyi, fps: 10 }]) {
  for (const n of cekimNotlari(o)) {
    assert.ok(n.baslik.length > 3, 'başlık boş');
    assert.ok(n.sebep.length > 25, 'sebep boş');
    assert.ok(n.eylem.length > 15, 'eylem boş — not ne yapılacağını söylemiyor');
    assert.ok(/\d/.test(n.sebep), 'sebep gerçek bir sayı içermiyor');
  }
}

// ── EĞİTİM SIRASINDA: KAMERA GEOMETRİSİ VE BULANIKLIK ─────────────────────
// SfM çözüldükten SONRA bilinen ölçüler. Kural aynı: sessizlik, bilinmeyen≠kötü,
// sebep gerçek sayı içerir, eğitimi durdurmaz.
{
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const yaw = (d) => { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
  const t = (R, C) => [0, 1, 2].map((i) => -(R[i * 3] * C[0] + R[i * 3 + 1] * C[1] + R[i * 3 + 2] * C[2]));
  const noktalar = Array.from({ length: 50 }, (_, i) => [(i % 10) - 5, (i % 5) - 2, 10]);
  // Yürüyüş: x ekseninde 2 birim taban, sahne 10 birim önde → oran ≈ 0,2; dönme 0.
  const yuru = [0, 1, 2].map((x) => ({ R: I, t: t(I, [x, 0, 0]) }));
  const g1 = cekimGeometrisi(yuru, noktalar);
  assert.ok(Math.abs(g1.tabanOrani - 0.2) < 1e-6, `taban oranı ${g1.tabanOrani}`);
  assert.ok(g1.donmeDerece < 1e-6);
  // Yerinde dönme: merkez sabit, 0..60° sapma.
  const don = [0, 20, 40, 60].map((d) => ({ R: yaw(d), t: [0, 0, 0] }));
  const g2 = cekimGeometrisi(don, noktalar);
  assert.ok(g2.tabanOrani < 1e-9 && Math.abs(g2.donmeDerece - 60) < 1e-6, JSON.stringify(g2));
  // Nokta yok → bilinmiyor (NaN), not üretmez.
  assert.ok(Number.isNaN(cekimGeometrisi(yuru, []).tabanOrani));

  const temiz = { bulanikOran: 0.05, tabanOrani: 0.2, donmeDerece: 40 };
  assert.deepEqual(cekimKaliteNotlari(temiz), [], 'sorunsuz çekimde not üretiliyor');
  const donNot = cekimKaliteNotlari({ ...temiz, tabanOrani: 0.01 });
  assert.deepEqual(donNot.map((n) => n.baslik), ['Kamera çoğunlukla yerinde dönüyor']);
  assert.match(donNot[0].sebep, /0[.,]01/, 'sebep ölçülen oranı söylemiyor');
  assert.match(donNot[0].sebep, /40°/, 'sebep ölçülen dönmeyi söylemiyor');
  // Düşük taban ama dönme de az (ör. sabit tripod, kısa kaydırma): yerinde
  // DÖNME değil; bu not haksız olur.
  assert.deepEqual(cekimKaliteNotlari({ ...temiz, tabanOrani: 0.01, donmeDerece: YERINDE_DONME_DERECE - 1 }), []);
  assert.deepEqual(cekimKaliteNotlari({ ...temiz, tabanOrani: EN_AZ_TABAN_ORANI }), []);
  const bul = cekimKaliteNotlari({ ...temiz, bulanikOran: 0.4 });
  assert.deepEqual(bul.map((n) => n.baslik), ['Bulanık kare oranı yüksek']);
  assert.match(bul[0].sebep, /%40/);
  assert.deepEqual(cekimKaliteNotlari({ ...temiz, bulanikOran: COK_BULANIK_ORAN }), []);
  for (const o of [{ bulanikOran: NaN, tabanOrani: NaN, donmeDerece: NaN }, { ...temiz, tabanOrani: Infinity }]) {
    assert.deepEqual(cekimKaliteNotlari(o), [], 'bilinmeyen ölçü not üretiyor');
  }
  for (const n of [...donNot, ...bul]) assert.ok(n.eylem.length > 15 && /\d/.test(n.sebep));
}

// ── SÖZLEŞME DENETİMİ ──────────────────────────────────────────────────────
const mod = readFileSync(new URL('../src/ui/cekimNotlari.ts', import.meta.url), 'utf8');
const kod = mod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// ÖLÇÜMLE ÇÜRÜTÜLEN SİNYALLER KULLANILMAMALI. focus keskinliği değil sahne
// dokusunu ölçüyor (gerçek 4K klip 322, 480p klip 600); clip %8,4'te meşru
// güneşli cephe; lum bandında bu repoda hiç ölçüm yok.
assert.ok(!/\bfocus\b|\bkeskinlik\b|\blum\b|\bparlaklik\b|\bclip\b/i.test(kod),
  'çürütülen bir sinyal (focus/lum/clip) eşik olarak kullanılıyor');
// ENGELLEMEZ: bu modül bir "calisir/engel" bayrağı üretmemeli.
assert.ok(!/engel|calisir|disabled/i.test(kod), 'çekim notu engelleme kararı veriyor — o egitimOnKontrol’ün işi');

// Arayüz tarafı: not yoksa hiçbir şey çizilmemeli, başlat düğmesi yalnız
// CİHAZ yetmiyorsa kapanmalı.
const ui = readFileSync(new URL('../src/ui/Egitim3D.tsx', import.meta.url), 'utf8');
assert.match(ui, /cekimNot\.map\(/, 'notlar ön ayar ekranında çizilmiyor');
assert.match(ui, /cekimKaliteNotlari\(/, 'eğitim sırasındaki çekim notları arayüze bağlı değil');
assert.match(ui, /disabled=\{onKontrol\?\.calisir === false\}/,
  'başlat düğmesinin kapanma koşulu değişmiş — çekim notu eğitimi engellememeli');
assert.ok(!/cekimNot\.length[^)]*disabled|disabled[^)]*cekimNot/.test(ui),
  'çekim notu başlat düğmesini kilitliyor');
// TEK KARE BİLE DECODE ETMEDEN: preload 'metadata' şart, yoksa tarayıcı
// görüntü verisini indirir ve "ön kontrol" bedava olmaktan çıkar.
assert.match(ui, /preload = 'metadata'/, 'metadata okuması tüm videoyu indiriyor olabilir');
assert.match(ui, /URL\.revokeObjectURL/, 'object URL bırakılmıyor — kaçak');

console.log('verify-cekim-notlari: OK · sessizlik kuralı, 4 ölçülen klip, uzun kenar, bilinmeyen≠kötü, engellemez');
