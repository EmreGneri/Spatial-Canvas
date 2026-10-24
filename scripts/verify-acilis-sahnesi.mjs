// Açılış sahnesi: analitik derinlik sözleşmesi + çizimle TEK tanımdan türeme.
// Bu sahne modelsiz koşar; derinliği yanlışsa ziyaretçi ilk gördüğü şeyde
// bozuk bir hacim görür ve bunu modelin hatası sanar.
//   node scripts/verify-acilis-sahnesi.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACILIS_BOY, ACILIS_EN, ACILIS_NOTU, acilisDerinligi, BINALAR, GOK, KURE, UFUK_Y, ZEMIN,
} from '../src/ui/acilisSahnesi.ts';

const d = acilisDerinligi();
const at = (x, y) => d[y * ACILIS_EN + x];
// Float32Array: 0.04 diskte 0.03999999910593033 olur. Tam eşitlik aramak
// sahneyle ilgisi olmayan bir hassasiyet hatası verir.
const yakin = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);

// ── SÖZLEŞME ───────────────────────────────────────────────────────────────
// depth.ts: "Normalized 0..1, 0 = far, 1 = near. Row 0 is the TOP."
assert.equal(d.length, ACILIS_EN * ACILIS_BOY, 'harita boyutu sahneyle uyuşmuyor');
for (let i = 0; i < d.length; i++) {
  assert.ok(d[i] >= 0 && d[i] <= 1, `değer aralık dışı: ${d[i]} @${i}`);
  assert.ok(Number.isFinite(d[i]), `sonlu olmayan değer @${i}`);
}

// ── GÖK EN UZAK ────────────────────────────────────────────────────────────
// Bina olmayan bir gökyüzü sütunu seçilir (x=260: binaların hiçbiri orada değil).
const gokSutunu = 260;
for (const b of BINALAR) {
  assert.ok(gokSutunu < b.x || gokSutunu >= b.x + b.en, `x=${gokSutunu} binaya denk geliyor, test sütunu seçilemez`);
}
yakin(at(gokSutunu, 10), GOK.derinlik, 'gök analitik değerinde değil');
let enUzak = 1;
for (let i = 0; i < d.length; i++) enUzak = Math.min(enUzak, d[i]);
yakin(enUzak, GOK.derinlik, 'sahnede gökten daha uzak bir şey var');

// ── ZEMİN ÖNE DOĞRU YAKLAŞIR ───────────────────────────────────────────────
// Alt kenar kameraya en yakın yerdir; ufka doğru uzaklaşır.
const zeminUst = at(5, UFUK_Y + 2);
const zeminAlt = at(5, ACILIS_BOY - 2);
assert.ok(zeminAlt > zeminUst, `zemin ters yönde: ufukta ${zeminUst}, önde ${zeminAlt}`);
assert.ok(zeminUst >= ZEMIN.ufukta - 1e-5 && zeminAlt <= ZEMIN.onde + 1e-5, 'zemin aralık dışına taştı');
assert.ok(zeminUst > GOK.derinlik, 'zemin gökten uzak çıkıyor');

// ── BİNALAR: UZUN OLAN DAHA YAKIN ──────────────────────────────────────────
// Perspektif: aynı gerçek yükseklikteki binalardan kadrajda uzun görünen
// daha yakındır. Sıralama boyla aynı yönde değilse sahne içten dışa döner.
const boyaGore = [...BINALAR].sort((a, b) => a.boy - b.boy);
for (let i = 1; i < boyaGore.length; i++) {
  assert.ok(
    boyaGore[i].derinlik > boyaGore[i - 1].derinlik,
    `bina derinliği boyla tutarsız: boy ${boyaGore[i - 1].boy}→${boyaGore[i].boy} ama derinlik ${boyaGore[i - 1].derinlik}→${boyaGore[i].derinlik}`,
  );
}
// Haritada da öyle okunmalı (gövde ortasından örneklenir).
for (const b of BINALAR) {
  const x = Math.round(b.x + b.en / 2);
  const y = Math.round(UFUK_Y - b.boy / 2);
  yakin(at(x, y), b.derinlik, `bina (x=${b.x}) haritada kendi derinliğinde değil`);
  // Bina gökten de zeminin ufkundan da yakın olmalı.
  assert.ok(b.derinlik > GOK.derinlik, 'bina gökten uzak');
}

// ── KÜRE: EN YAKIN VE KUBBE ────────────────────────────────────────────────
const merkez = at(Math.round(KURE.x), Math.round(KURE.y));
yakin(merkez, KURE.tepe, 'küre merkezi beklenen değerde değil');
// DÜZ DİSK DEĞİL: kenara doğru alçalmalı, yoksa tek kavisli yüzey kaybolur.
const kenar = at(Math.round(KURE.x + KURE.r * 0.92), Math.round(KURE.y));
assert.ok(merkez > kenar + 0.05, `küre düz: merkez ${merkez}, kenar ${kenar}`);
assert.ok(kenar >= KURE.etek - 1e-5, 'küre eteği tanımın altına düştü');
// Sahnenin en yakın noktası kürenin tepesi olmalı.
let enYakin = 0;
for (let i = 0; i < d.length; i++) enYakin = Math.max(enYakin, d[i]);
yakin(enYakin, KURE.tepe, 'en yakın nokta küre değil');

// ── ÖRTME SIRASI ───────────────────────────────────────────────────────────
// Küre zeminin üstüne çizilir; altındaki zemin değerini EZMELİ.
const kureIciZemin = at(Math.round(KURE.x), Math.round(KURE.y + KURE.r * 0.5));
assert.ok(kureIciZemin > ZEMIN.onde, 'küre zemini örtmemiş — çizim ve derinlik sırası ayrışmış');

// ── ÖLÇEKTEN BAĞIMSIZ ──────────────────────────────────────────────────────
// Motor kaynağı farklı boyutta verebilir; harita oranı korumalı.
const kucuk = acilisDerinligi(256, 256);
assert.equal(kucuk.length, 256 * 256);
const kMerkez = kucuk[Math.round(KURE.y / 2) * 256 + Math.round(KURE.x / 2)];
assert.ok(kMerkez > 0.8, `yarı ölçekte küre kaybolmuş: ${kMerkez}`);
const kGok = kucuk[5 * 256 + 130];
yakin(kGok, GOK.derinlik, 'yarı ölçekte gök bozuldu');

// ── TEK TANIM ──────────────────────────────────────────────────────────────
// Çizim geometriyi KOPYALAMAMALI: ikisi ayrı yerde dururken biri değişirse
// derinlik sahneyle uyuşmaz ve "bina burada, hacim şurada" görünür.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(app, /for \(const b of BINALAR\)/, 'çizim BINALAR tanımını kullanmıyor');
assert.match(app, /ctx\.arc\(KURE\.x, KURE\.y, KURE\.r/, 'çizim KURE tanımını kullanmıyor');
assert.ok(!/\[40, 70, 160\]|\[150, 90, 240\]/.test(app), 'bina koordinatları App.tsx içinde hâlâ elle yazılı');

// ── MODELSİZ YOL ───────────────────────────────────────────────────────────
// Asıl kazanç bu: açılışta hiçbir model indirilmemeli (ölçüldü: 131,4 MB → 0).
// Örnek sahne TEK KOD YOLUNDAN geçer: run() analitik derinliği alır,
// çıkarımı atlar ama diğer tüm yan etkileri aynen işler.
assert.match(app, /return run\(g, acilisDerinligi\(/, 'soğuk açılış modelsiz yolu kullanmıyor');
assert.ok(!/void run\(syntheticImage\(\)\)/.test(app), 'örnek sahne hâlâ model indiren run() ile koşuyor');
assert.match(app, /if \(sunum && !canliKaynak\) return/, 'canlı model ön ısıtması sunumda hâlâ spekülatif');
// Isıtma GERÇEKTEN canlı yolu kullanacak kaynağa bağlı olmalı. "Bir dosya
// seçildi mi" yetmez: fotoğraf yüklenince de tetikleniyordu ve aynı 47 MB
// iki kez paralel iniyordu (ölçüldü: 131 MB beklenirken 178,8 MB).
assert.match(app, /const canliKaynak = cameraOn \|\| !!videoDosya;/, 'ısıtma koşulu canlı kaynağa bağlı değil');
// Kullanıcının kendi görüntüsü GERÇEK boru hattından geçmeli — analitik
// derinlik yalnız bizim çizdiğimiz sahne için geçerlidir.
assert.match(app, /handleFile\(file: File\) \{\s*\n\s*indirmeSifirla\(\);/, 'yeni işte artakalan indirme satırı temizlenmiyor');

// ── DÜRÜSTLÜK BEYANI ───────────────────────────────────────────────────────
// Analitik sahneyi model çıktısıymış gibi sunmak, projenin eleştirdiği şey.
assert.ok(/ölçülmedi|yazıldı/.test(ACILIS_NOTU), 'açılış notu derinliğin ölçülmediğini söylemiyor');
assert.match(app, /say\(ACILIS_NOTU\)/, 'açılış notu kullanıcıya hiç söylenmiyor');

console.log('verify-acilis-sahnesi: OK · sözleşme, örtme sırası, ölçek, tek tanım, modelsiz yol, dürüstlük notu');
