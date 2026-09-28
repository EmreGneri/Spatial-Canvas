import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cekimNotlari, EN_AZ_FPS, EN_AZ_SURE_SN, EN_AZ_UZUN_KENAR, uzunKenar,
} from '../src/ui/cekimNotlari.ts';

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
for (const ad of ['uhd', 'stgeorge', 'mariatheresa']) {
  assert.deepEqual(cekimNotlari(OLCULEN[ad]), [], `${ad}: meşru klip haksız not alıyor`);
}

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
assert.equal(cekimNotlari({ ...iyi, sureSn: EN_AZ_SURE_SN }).length, 0);

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
  const n = cekimNotlari({ genislik: 640, yukseklik: 480, sureSn: 1.5, fps: 12 });
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
assert.match(ui, /disabled=\{onKontrol\?\.calisir === false\}/,
  'başlat düğmesinin kapanma koşulu değişmiş — çekim notu eğitimi engellememeli');
assert.ok(!/cekimNot\.length[^)]*disabled|disabled[^)]*cekimNot/.test(ui),
  'çekim notu başlat düğmesini kilitliyor');
// TEK KARE BİLE DECODE ETMEDEN: preload 'metadata' şart, yoksa tarayıcı
// görüntü verisini indirir ve "ön kontrol" bedava olmaktan çıkar.
assert.match(ui, /preload = 'metadata'/, 'metadata okuması tüm videoyu indiriyor olabilir');
assert.match(ui, /URL\.revokeObjectURL/, 'object URL bırakılmıyor — kaçak');

console.log('verify-cekim-notlari: OK · sessizlik kuralı, 4 ölçülen klip, uzun kenar, bilinmeyen≠kötü, engellemez');
