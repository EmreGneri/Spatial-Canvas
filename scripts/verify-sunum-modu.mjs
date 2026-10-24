import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  olcumSatiri, soganAcilisGerekliMi, sunumAcikMi, SUNUM_DISI, SUNUM_ICI, yerelHostMu,
} from '../src/ui/sunumModu.ts';

// ── ANAHTAR ────────────────────────────────────────────────────────────────
for (const q of ['?sunum', '?sunum=1', '?sunum=true', '?sunum=TRUE', '?a=1&sunum=1', '?sunum=1&a=2']) {
  assert.equal(sunumAcikMi(q), true, `${q}: açmıyor`);
}
// AÇIK BİR KAPATMA YOLU ŞART: sunum bitince bağlantı elden ele dolaşır,
// "?sunum=0" yazan biri normal arayüzü görebilmeli.
for (const q of ['?sunum=0', '?sunum=false', '?sunum=kapali']) {
  assert.equal(sunumAcikMi(q), false, `${q}: kapatmıyor`);
}
// AÇIK SEÇİM YOKSA ADRES KARAR VERİR — `sidecarAcikMi` deseninin aynısı.
// Ölçüldü: çıplak adreste 52 düğme + boş siyah tuval çıkıyordu, yani
// bağlantıyı tıklayan kişi geliştirici enstrümanını görüyordu.
for (const q of ['', '?', '?a=1', '?sunumlu=1', '?xsunum=1', '?a=sunum']) {
  assert.equal(sunumAcikMi(q, true), false, `${q}: localhost'ta yanlışlıkla açıyor`);
  assert.equal(sunumAcikMi(q, false), true, `${q}: YAYINDA kapalı — ziyaretçi geliştirici arayüzünü görür`);
}
// AÇIK İSTEK HER ZAMAN ADRESİ EZER (iki yönde de).
assert.equal(sunumAcikMi('?sunum=0', false), false, 'yayında ?sunum=0 kapatmıyor — geliştirici tam arayüze ulaşamaz');
assert.equal(sunumAcikMi('?sunum=1', true), true, 'localhost’ta ?sunum=1 açmıyor — prova yapılamaz');

// Yerel host ölçütü (arDurum.ts ile aynı aile).
// `vite --host` ile LAN'dan açan geliştirici de YEREL sayılır: aksi hâlde
// kendini sunum modunda bulup tanı düğmelerini kayıp sanıyor.
for (const h of [
  'localhost', '127.0.0.1', '::1', '[::1]', 'app.localhost', 'macbook.local',
  '192.168.1.5', '10.0.0.7', '172.16.3.2', '172.31.255.254',
]) {
  assert.equal(yerelHostMu(h), true, `${h}: yerel sayılmıyor`);
}
// Sınır dar: benzeyen ama YEREL OLMAYAN adresler geçmemeli.
for (const h of [
  'spatial-canvas.vercel.app', 'example.com', 'localhost.evil.com',
  '127.0.0.1.evil.com', '172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.1.1',
  '8.8.8.8', 'notlocal', 'local',
]) {
  assert.equal(yerelHostMu(h), false, `${h}: YANLIŞLIKLA yerel sayılıyor`);
}
// `?` olsun olmasın aynı sonuç (çağrıcı `location.search` de verebilir, düz dize de).
assert.equal(sunumAcikMi('sunum=1'), sunumAcikMi('?sunum=1'));
// Benzer adlı başka bir parametre karıştırmamalı.
assert.equal(sunumAcikMi('?sunumModu=1', true), false);

// ── SOĞUK AÇILIŞ ───────────────────────────────────────────────────────────
// motorHazir · zatenTetiklendi · kaynakVar
// Örnek sahne HER İKİ MODDA yüklenir: boş siyah tuval kimseye yaramıyordu
// ve sahne artık model indirmiyor (acilisSahnesi.ts — 131,4 MB → 0).
assert.equal(soganAcilisGerekliMi(true, false, false), true, 'soğuk açılış tetiklenmiyor — ziyaretçi boş ekran görür');
assert.equal(soganAcilisGerekliMi(false, false, false), false, 'motor hazır olmadan yükleniyor');
assert.equal(soganAcilisGerekliMi(true, true, false), false, 'ikinci kez tetikleniyor — döngü riski');
// KULLANICININ KAYNAĞI EZİLMEZ: kendi dosyasını açtıysa örnek sahne onun
// üstüne yazılmamalı.
assert.equal(soganAcilisGerekliMi(true, false, true), false, 'kullanıcının kaynağı eziliyor');

// ── ÖLÇÜM SATIRI ───────────────────────────────────────────────────────────
// Eval duvarının (AbsRel/RMSE/IoU tablosu) yerine geçen TEK cümle.
{
  const s = olcumSatiri({ kare: 24, splat: 58803, psnr: 27.3, bilinmeyenOran: 0.84 });
  assert.match(s, /24 kare/);
  assert.match(s, /58\.803 Gaussian/, 'binlik ayracı tr-TR değil');
  // Ondalıkta NOKTA: uygulamanın mevcut düzeni (EgitimGrafik, Egitim3D hep
  // `toFixed(1)`). Yalnız bu satırda virgüle geçmek tutarsızlık olurdu;
  // binlik ayracı ise tr-TR (58.803) — ikisi ayrı kural.
  assert.match(s, /27\.3 dB/);
  assert.match(s, /%84/);
  // SINIR BEYANI SON SÖZ olmalı: projenin tezi ölçümün sınırını söylemek.
  assert.ok(s.indexOf('%84') > s.indexOf('Gaussian'), 'sınır beyanı sonda değil');
}
// Eksik alan ATLANIR, uydurulmaz (künye kuralı · paylasim.ts).
assert.equal(olcumSatiri({ kare: 24, splat: null, psnr: null, bilinmeyenOran: null }), '24 kare');
assert.equal(olcumSatiri({ psnr: 30.98 }), 'test PSNR 31.0 dB');
// Hiç alan yoksa satır HİÇ ÇİZİLMEZ ("—" bile yazılmaz).
assert.equal(olcumSatiri({}), null);
assert.equal(olcumSatiri({ kare: 0, splat: 0, psnr: NaN, bilinmeyenOran: NaN }), null);
assert.equal(olcumSatiri({ kare: null, splat: undefined }), null);

// ── GEREKÇE BELGESİ ────────────────────────────────────────────────────────
// Gizlenen her panelin NEDEN gizlendiği yazılı olmalı; "sade dursun" bir
// gerekçe değil, sonraki tur onu sessizce geri açar.
for (const [ad, sebep] of Object.entries(SUNUM_DISI)) {
  assert.ok(sebep.length > 20, `${ad}: gerekçe yazılmamış`);
}
for (const [ad, sebep] of Object.entries(SUNUM_ICI)) {
  assert.ok(/vuruş|kapanış/.test(sebep), `${ad}: demo senaryosundaki karşılığı yazılmamış`);
}
assert.ok(Object.keys(SUNUM_DISI).length >= 8);
assert.ok(Object.keys(SUNUM_ICI).length >= 5);

// ── KABLO DENETİMİ ─────────────────────────────────────────────────────────
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

// ENSTRÜMAN KATMANI sunumda MOUNT EDİLMEMELİ. Her biri ayrı ayrı denetlenir:
// biri unutulursa sayfa yine 2,3 ekrana çıkar.
for (const bilesen of ['NodeGraphEditor', 'PresetControls', 'ForceControls']) {
  const re = new RegExp(`\\{!sunum && engine && <${bilesen}`);
  assert.match(app, re, `${bilesen} sunum modunda hâlâ mount ediliyor`);
}
assert.match(app, /\{!sunum && engine && \(\s*\n\s*<div[^\n]*\n\s*<div[^\n]*\n\s*<CapturePanel/,
  'CapturePanel/MetricsPanel bloğu sunumda mount ediliyor');
assert.match(app, /\{!sunum && \(\s*\n\s*<pre style/, 'ham log şeridi sunumda mount ediliyor');

// DURUM OKUMALARI ("nesne ayırma: kapalı" vb.) gizlenmeli.
assert.match(app, /\{!sunum && \(\s*\n\s*<>[\s\S]{0,400}nesne ayırma:/,
  'tanı toggle grubu sunumda mount ediliyor');

// DEMO SENARYOSUNUN GEREKTİRDİKLERİ KALMALI — fazla kesmek de hata.
// `{!sunum ...}` bloklarını SÜSLÜ PARANTEZ SAYARAK çıkar; etiketler bu
// blokların DIŞINDA olmalı. (Metin arayışı kırılgandı: araya giren yorum
// satırları yanlış eşleşme veriyordu.)
function sunumBloklari(kaynak) {
  const araliklar = [];
  let i = 0;
  while ((i = kaynak.indexOf('{!sunum', i)) !== -1) {
    let derinlik = 0;
    let j = i;
    for (; j < kaynak.length; j++) {
      if (kaynak[j] === '{') derinlik++;
      else if (kaynak[j] === '}') { derinlik--; if (derinlik === 0) break; }
    }
    araliklar.push([i, j]);
    i = j + 1;
  }
  return araliklar;
}
const gizliAraliklar = sunumBloklari(app);
assert.ok(gizliAraliklar.length >= 6, `beklenenden az {!sunum} bloğu: ${gizliAraliklar.length}`);
const gizlendiMi = (etiket) => {
  const i = app.indexOf(etiket);
  assert.ok(i > 0, `${etiket} bulunamadı`);
  return gizliAraliklar.some(([a, b]) => i > a && i < b);
};
assert.equal(gizlendiMi('sentetik görsel'), false, 'sentetik görsel (1. vuruş) sunumda gizlenmiş — demo senaryosu kırılır');

// İLK EKRAN BÜTÇESİ (hoca geri bildirimi 2026-10-23: "ne yapacağını
// bilemedi" + "kontrolün çokluğu boğdu"). Ölçüldü: 22 birincil kontrol,
// kuralın (tasarim-kurallari.md) iki katı. Üç kol çekildi; her biri
// burada ayrı ayrı kilitlenir, yoksa sonraki tur sessizce geri açar.

// 1. ÇIKTI BLOĞU KATLANIR: PNG·WebM·5/10/20sn·PLY·imza·AR = 8 kontrol,
//    hepsi kapanış vuruşuna ait. Katlanınca 8 → 1.
assert.match(app, /ciktiKatlanir=\{sunum\}/, 'çıktı bloğu sunumda katlanmıyor');
const serit = readFileSync(new URL('../src/ui/TransportSerit.tsx', import.meta.url), 'utf8');
assert.match(serit, /ciktiKatlanir && !ciktiAcik \?/, 'TransportSerit katlama dalını uygulamıyor');
assert.match(serit, /↓ çıktı/, 'katlanmış hâlde açma düğmesi yok — çıktı erişilemez olur');

// 2. İLK HAMLE TEK DOLGU: ekranda birden fazla birincil düğme olursa
//    hiçbiri birincil olmaz.
const birincilSayisi = (app.match(/birincilDugme\(\)/g) || []).length;
assert.equal(birincilSayisi, 1, `birincil dolgu düğme sayısı ${birincilSayisi} — tam 1 olmalı`);
assert.match(app, /sunum \? 'fotoğrafını yükle' : 'dosya…'/, 'ilk hamle sunumda açıkça adlandırılmıyor');

// 3. TIKLANAMAYAN DÜĞME ÇİZİLMEZ: `3D eğit` video olmadan zaten devre
//    dışıydı. Sunumda hiç mount edilmez; video gelince belirir, yani
//    3. vuruş KAYBOLMAZ — koşulun ikinci yarısı bunun garantisi.
assert.match(app, /\{\(!sunum \|\| !!videoDosya\) && <button/,
  '3D eğit koşullu mount edilmiyor (video gelince belirmeli)');
assert.ok(app.includes('3D eğit'), '3D eğit tamamen kaldırılmış — 3. vuruş yok olur');

// Salınım hızı kolu, ait olduğu özellik kapalıyken çizilmez.
const modSec = readFileSync(new URL('../src/ui/ModeSelector.tsx', import.meta.url), 'utf8');
assert.match(modSec, /\{on && \(\s*\n\s*<label title="salınım hızı"/,
  'hız kolu salınım kapalıyken de çiziliyor');
// Ve tersi: tanı kontrolleri GERÇEKTEN blokların içinde olmalı.
// DÜĞMENİN KENDİSİ aranır, log mesajı değil: `say('nesne ayırma: ...')`
// satırları dosyada daha yukarıda geçiyor ve düz metin araması onları buluyordu.
for (const etiket of [
  'nesne ayırma: {segment', 'maskeyi göster: {showMask', 'tracker: {trackerOn', '          video → 3B',
]) {
  assert.equal(gizlendiMi(etiket), true, `${etiket.trim()} sunumda hâlâ görünür`);
}

// SOĞUK AÇILIŞ kablosu: bir kez bayrağı, saf karar fonksiyonu, sentetik yükleme.
assert.match(app, /soganTetiklendi\.current = true/, 'soğuk açılış bir kez bayrağı yok — döngü riski');
assert.match(app, /soganAcilisGerekliMi\(!!engine/, 'soğuk açılış kararı saf fonksiyondan gelmiyor');
// Soğuk açılış sahneyi MODELSİZ yoldan yükler (bkz. verify-acilis-sahnesi):
// ölçüldü, açılışta inen model baytı 131,4 MB → 0.
assert.match(app, /void acilisSahne\(\)/, 'soğuk açılış sahneyi yüklemiyor');

// Mod bir KEZ okunmalı: her render'da okunursa effect bağımlılıkları oynar.
assert.match(app, /useState\(\(\) => sunumAcikMi\(window\.location\.search, yerelHostMu\(window\.location\.hostname\)\)\)/,
  'sunum modu render başına yeniden okunuyor ya da adres ölçütü geçilmiyor');

// Efekt rafı sunumda KAPALI başlamalı (açık kart 9 kaydırıcı + 2 renk gösteriyor).
assert.match(app, /baslangicKapali=\{sunum\}/, 'efekt rafı sunumda kapalı başlamıyor');
const cp = readFileSync(new URL('../src/ui/ControlPanel.tsx', import.meta.url), 'utf8');
assert.match(cp, /baslangicKapali \? null : 'render'/, 'ControlPanel kapalı başlangıcı uygulamıyor');

// KALICI AYAR OLMAMALI: sunumdan sonra "kapatmayı unutma" durumu kalmasın.
const mod = readFileSync(new URL('../src/ui/sunumModu.ts', import.meta.url), 'utf8');
// Yorumlar ayıklanır: kural METİNDE anlatılıyor ("kalıcı ayar (localStorage)
// değil"), KODDA ihlal edilmemeli.
const modKod = mod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.ok(!/localStorage|sessionStorage/.test(modKod), 'sunum modu kalıcı ayara yazıyor');

console.log('verify-sunum-modu: OK · anahtar, soğuk açılış, ölçüm satırı, enstrüman katmanı, demo senaryosu korundu');
