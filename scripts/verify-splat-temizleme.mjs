import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ekranaProjekte, ekranYaricapiniDunyaya, enYakinSplat, fircaSecimi, geriAl, GORUNUR_ESIGI,
  gorunurSayisi, hepsiniGeriAl, kureSecimi, lassoSecimi, poligonIcinde, silmeUygula,
} from '../src/ui/splatSecim.ts';

const EN = 400;
const BOY = 200;

/** Float32 yuvarlaması: dizi float32, karşılaştırmalar toleranslı olmalı. */
const yakin = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} (${a} ≠ ${b})`);

/**
 * Bilinen bir kamera: merkezde, -z'ye bakıyor, 90° fov, aspect 2.
 * P = perspective(fov=90, aspect=2, near=0.1, far=100), V = birim.
 * Kolon-major elements (three.js Matrix4.elements sırası).
 */
function viewProj() {
  const f = 1 / Math.tan((90 * Math.PI) / 360); // 1
  const aspect = EN / BOY; // 2
  const near = 0.1;
  const far = 100;
  // three.js makePerspective çıktısıyla aynı yerleşim.
  return Float32Array.from([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, -(far + near) / (far - near), -1,
    0, 0, (-2 * far * near) / (far - near), 0,
  ]);
}

// ── PROJEKSİYON ────────────────────────────────────────────────────────────
// Kameranın 2 birim önündeki merkez nokta kadrajın TAM ORTASINA düşmeli.
{
  const a = Float32Array.from([0, 0, -2, 1]);
  const e = ekranaProjekte(a, 1, viewProj(), EN, BOY);
  assert.ok(Math.abs(e[0] - EN / 2) < 1e-3, `merkez x ${e[0]} ≠ ${EN / 2}`);
  assert.ok(Math.abs(e[1] - BOY / 2) < 1e-3, `merkez y ${e[1]} ≠ ${BOY / 2}`);
  assert.ok(e[2] > 0, 'kameranın önündeki nokta wClip ≤ 0 veriyor');
}

// YUKARI dünya yönü EKRANDA YUKARI olmalı (y işareti ters çevrilmiş mi).
{
  const a = Float32Array.from([0, 0.5, -2, 1, 0, -0.5, -2, 1]);
  const e = ekranaProjekte(a, 2, viewProj(), EN, BOY);
  assert.ok(e[1] < e[4], 'dünya +y ekranda aşağı düşüyor — y işareti ters');
}

// Kameranın ARKASINDAKİ splat seçime GİRMEMELİ.
{
  const a = Float32Array.from([0, 0, 2, 1]); // arkada
  const e = ekranaProjekte(a, 1, viewProj(), EN, BOY);
  assert.ok(!(e[2] > 0), 'arkadaki splat wClip > 0');
  assert.equal(fircaSecimi(e, a, 1, EN, BOY, EN / 2, BOY / 2, 200).length, 0,
    'kameranın arkasındaki splat fırçayla seçiliyor');
}

// ── FIRÇA ──────────────────────────────────────────────────────────────────
{
  // Ortada bir splat, kenarda bir splat.
  const a = Float32Array.from([
    0, 0, -2, 1, // ekranda (200,100)
    0.9, 0, -2, 1, // sağda
  ]);
  const e = ekranaProjekte(a, 2, viewProj(), EN, BOY);
  const yakin = fircaSecimi(e, a, 2, EN, BOY, EN / 2, BOY / 2, 20);
  assert.deepEqual([...yakin], [0], 'fırça yalnız daire içindekini almıyor');
  const genis = fircaSecimi(e, a, 2, EN, BOY, EN / 2, BOY / 2, 400);
  assert.equal(genis.length, 2, 'büyük fırça ikisini de almıyor');
}

// ZATEN SİLİNMİŞ splat yeniden seçilmez (aynı yeri iki kez silmek geçmişi bölmesin).
{
  const a = Float32Array.from([0, 0, -2, 0]); // opaklık 0
  const e = ekranaProjekte(a, 1, viewProj(), EN, BOY);
  assert.equal(fircaSecimi(e, a, 1, EN, BOY, EN / 2, BOY / 2, 100).length, 0);
  assert.ok(GORUNUR_ESIGI > 0);
}

// ── LASSO ──────────────────────────────────────────────────────────────────
// Kare poligon: içindeki nokta girer, dışındaki girmez.
assert.equal(poligonIcinde([0, 0, 10, 0, 10, 10, 0, 10], 5, 5), true);
assert.equal(poligonIcinde([0, 0, 10, 0, 10, 10, 0, 10], 15, 5), false);
// İÇBÜKEY poligon (U şekli): ışın atma bunu doğru çözmeli, sınırlayıcı kutu çözmez.
const U = [0, 0, 10, 0, 10, 10, 7, 10, 7, 3, 3, 3, 3, 10, 0, 10];
assert.equal(poligonIcinde(U, 5, 6), false, 'U’nun oyuğu içeride sayılıyor');
assert.equal(poligonIcinde(U, 5, 1), true, 'U’nun tabanı dışarıda sayılıyor');
// Üçten az köşe = alan yok.
assert.equal(poligonIcinde([0, 0, 1, 1], 0.5, 0.5), false);

{
  const a = Float32Array.from([0, 0, -2, 1, 0.9, 0, -2, 1]);
  const e = ekranaProjekte(a, 2, viewProj(), EN, BOY);
  const kare = [EN / 2 - 30, BOY / 2 - 30, EN / 2 + 30, BOY / 2 - 30, EN / 2 + 30, BOY / 2 + 30, EN / 2 - 30, BOY / 2 + 30];
  assert.deepEqual([...lassoSecimi(e, a, 2, EN, BOY, kare)], [0]);
  assert.equal(lassoSecimi(e, a, 2, EN, BOY, [1, 1, 2, 2]).length, 0, 'açık yol seçim yapıyor');
}

// ── KÜRE: DERİNLİK AYRIMI ──────────────────────────────────────────────────
// Bu aracın VARLIK SEBEBİ: aynı ekran noktasında bir floater (ön) ve bir yüzey
// (arka) varken fırça İKİSİNİ de siler, küre yalnız tıklanana yakın olanı.
{
  const a = Float32Array.from([
    0, 0, -1.0, 1, // ön: floater
    0, 0, -6.0, 1, // arka: yüzey
  ]);
  const vp = viewProj();
  const e = ekranaProjekte(a, 2, vp, EN, BOY);
  // İkisi de kadrajın ortasına düşer.
  assert.ok(Math.abs(e[0] - EN / 2) < 1e-3 && Math.abs(e[3] - EN / 2) < 1e-3);
  // Fırça: ikisini birden alır (ölçülen kusur — bu yüzden küre var).
  assert.equal(fircaSecimi(e, a, 2, EN, BOY, EN / 2, BOY / 2, 20).length, 2);
  // En yakın = ön splat (wClip küçük olan).
  const idx = enYakinSplat(e, a, 2, EN, BOY, EN / 2, BOY / 2, 20);
  assert.equal(idx, 0, 'imleç altındaki EN YAKIN splat yanlış');
  const r = ekranYaricapiniDunyaya(vp, e[2], 20, EN);
  assert.ok(r > 0 && r < 1, `dünya yarıçapı makul değil: ${r}`);
  const kure = kureSecimi(a, 2, [a[0], a[1], a[2]], r);
  assert.deepEqual([...kure], [0], 'küre arkadaki yüzeyi de alıyor');
}

// Aynı piksel yarıçapı UZAKTA daha büyük dünya yarıçapı demek (perspektif).
{
  const vp = viewProj();
  const yakinR = ekranYaricapiniDunyaya(vp, 1, 20, EN);
  const uzakR = ekranYaricapiniDunyaya(vp, 10, 20, EN);
  assert.ok(uzakR > yakinR * 9, `perspektif ölçeklemesi yok: ${yakinR} → ${uzakR}`);
}
// Bozuk matris/genişlik çökertmesin.
assert.equal(ekranYaricapiniDunyaya(new Float32Array(16), 1, 20, EN), 0);
assert.equal(ekranYaricapiniDunyaya(viewProj(), 1, 20, 0), 0);

// ── OPAKLIK KAPISI ÇİZİMLE AYNI OLMALI ─────────────────────────────────────
// ÖLÇÜLDÜ (sentetik sahne, 147.456 splat): köprü doldurucusu opaklığı İKİ
// SEVİYELİ yazıyor — 140.523 splat 0.40, 6.933 splat 1.00. Nesne ayırma
// AÇIKKEN motorun kapısı 0.50, yani o 140 bin splat zaten çizilmiyor. Araç
// sabit 0.02 ile çalışsaydı onları seçer, "sil (140.523)" yazar ve silme
// ekranda hiçbir şey değiştirmezdi.
{
  const N = 100;
  const a = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    a[i * 4 + 2] = -2;                 // hepsi kadrajın ortasında
    a[i * 4 + 3] = i < 80 ? 0.4 : 1;   // 80 arka plan, 20 ön plan
  }
  const e = ekranaProjekte(a, N, viewProj(), EN, BOY);
  // Ayırma KAPALI (kapı 0.02): hepsi seçilebilir.
  assert.equal(fircaSecimi(e, a, N, EN, BOY, EN / 2, BOY / 2, 50, 0.02).length, 100);
  // Ayırma AÇIK (kapı 0.50): yalnız gerçekten çizilen 20 splat.
  assert.equal(fircaSecimi(e, a, N, EN, BOY, EN / 2, BOY / 2, 50, 0.5).length, 20,
    'görünmeyen arka plan splatları seçime giriyor — sayaç yalan söyler');
  assert.equal(lassoSecimi(e, a, N, EN, BOY, [0, 0, EN, 0, EN, BOY, 0, BOY], 0.5).length, 20);
  assert.equal(kureSecimi(a, N, [0, 0, -2], 1, 0.5).length, 20);
  assert.equal(gorunurSayisi(a, N, 0.5), 20, '"kalan" sayacı çizilenle uyuşmuyor');
  assert.equal(gorunurSayisi(a, N, 0.02), 100);
  // Küre aracının merkezi de çizilen splat olmalı.
  assert.ok(enYakinSplat(e, a, N, EN, BOY, EN / 2, BOY / 2, 50, 0.5) >= 80,
    'küre merkezi görünmeyen bir splat seçiyor');
}

// ── SİLME + GERİ ALMA ──────────────────────────────────────────────────────
{
  const a = Float32Array.from([0, 0, -2, 1, 1, 1, -3, 0.6, 2, 2, -4, 0.3]);
  assert.equal(gorunurSayisi(a, 3), 3);
  const k1 = silmeUygula(a, [0, 2]);
  assert.ok(k1);
  assert.equal(a[3], 0);
  assert.equal(a[11], 0);
  yakin(a[7], 0.6, 'seçilmeyen splat da silinmiş');
  // KONUM DEĞİŞMEMELİ: silme yalnız opaklık kanalında olur.
  assert.deepEqual([a[0], a[1], a[2]], [0, 0, -2]);
  assert.equal(gorunurSayisi(a, 3), 1);

  // Geri alma ESKİ DEĞERİ döndürür, 1'e sabitlemez.
  assert.equal(geriAl(a, k1), 2);
  assert.equal(a[3], 1);
  yakin(a[11], 0.3, 'geri alma opaklığı 1’e sabitliyor — kısmi saydamlık kayboldu');
  assert.equal(gorunurSayisi(a, 3), 3);
}

// Zaten silinmiş splat kayda girmez → boş kayıt null döner (geçmişe boş adım eklenmez).
{
  const a = Float32Array.from([0, 0, -2, 0]);
  assert.equal(silmeUygula(a, [0]), null);
}

// ÇOK ADIMLI geçmiş: hepsini geri alma her adımı doğru sırada çözmeli.
{
  const a = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0.5, 0, 0, 0, 0.9]);
  const gecmis = [silmeUygula(a, [0]), silmeUygula(a, [1, 2])].filter(Boolean);
  assert.equal(gorunurSayisi(a, 3), 0);
  assert.equal(hepsiniGeriAl(a, gecmis), 3);
  yakin(a[3], 1); yakin(a[7], 0.5); yakin(a[11], 0.9);
}

// ── SÖZLEŞME DENETİMİ ──────────────────────────────────────────────────────
// 1. Temizleme, D.4 timeline kimliğini DÜŞÜRMEMELİ: `syncFromTextures`
//    keyframeIndex verilmezse null'a çeker ve filtre sessizce kapanır.
const splats = readFileSync(new URL('../src/engine/splats.ts', import.meta.url), 'utf8');
const refresh = splats.slice(splats.indexOf('refreshOpacity()'), splats.indexOf('setKeyframeFilter'));
assert.ok(refresh.includes('forceResort'), 'refreshOpacity sırayı zorlamıyor — silinen splat çizilmeye devam eder');
assert.ok(refresh.includes('needsUpdate'), 'refreshOpacity texture’ı GPU’ya göndermiyor');
assert.ok(!refresh.includes('syncFromTextures'), 'refreshOpacity syncFromTextures çağırıyor — D.4 keyframe filtresi düşer');

// 2. Engine kamerayı DIŞARI VERMEZ; yalnız matris kopyası çıkar.
const engine = readFileSync(new URL('../src/engine/Engine.ts', import.meta.url), 'utf8');
assert.match(engine, /splatViewProjection\(\): Float32Array \| null/, 'matris kancası yok');
assert.match(engine, /commitSplatOpacity\(\)/, 'opaklık işleme kancası yok');
assert.ok(!/get camera\(\)/.test(engine), 'kamera nesnesi dışarı açılmış — UI kamerayı oynatabilir');
const vpGovde = engine.slice(engine.indexOf('splatViewProjection()'), engine.indexOf('commitSplatOpacity()'));
assert.ok(vpGovde.includes('Float32Array.from'), 'matris KOPYALANMIYOR — UI canlı matrisi yazabilir');

// 3. Vurgu, GaussianBuffer'ın RENK kanalına yazmamalı (geri alma tek kanalı izler).
const ui = readFileSync(new URL('../src/ui/SplatTemizleme.tsx', import.meta.url), 'utf8');
// Yorumlar ayıklanır: kural METİNDE anlatılıyor, KODDA ihlal edilmemeli.
const uiKod = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.ok(!/gSplatC|snapshot\(\)\.c\b|\.c\[/.test(uiKod), 'vurgu renk kanalına yazıyor — orijinal veri bozulur');
// 4. GEZ modu ŞART: katman olayları yakalarken kamera kilitlenir, floater bulunamaz.
assert.match(ui, /pointerEvents: arac === 'gez' \? 'none' : 'auto'/, 'gez modunda katman olayları bırakmıyor');
// 5. Seçim eşiği ÇİZİMİN KAPISINDAN okunmalı (yukarıdaki ölçüm). Araç 3DGS'e
//    de bağlanınca eşik `kaynak.esik()` arkasına taşındı; kural DEĞİŞMEDİ,
//    yalnız yeri değişti — motor bağlantısı artık temizlemeKaynagi.ts'te.
assert.match(uiKod, /esik: kaynakRef\.current\.esik\(\)|kaynakRef\.current\.esik\(\)/,
  'seçim eşiği kaynaktan okunmuyor — sabit eşik sayaç yalanı üretir');
const kaynakKodu = readFileSync(new URL('../src/ui/temizlemeKaynagi.ts', import.meta.url), 'utf8');
assert.match(kaynakKodu, /esik: \(\) => engine\.splatOpacityThreshold/,
  'motor kaynağı eşiği motordan almıyor');
assert.match(engine, /get splatOpacityThreshold\(\): number/, 'motor etkin opaklık kapısını açmıyor');
assert.match(engine, /splatOpacityGate\(this\.splatMinOpacity, this\.objectSeparation, this\.gaussianSource\)/,
  'kapı çizimdekiyle aynı fonksiyondan gelmiyor — ikisi ayrı ayrı bayatlar');
// 6. Fitts: araç düğmeleri ≥ 32 px. Yalnız DÜĞME stilleri denetlenir —
//    ayraç çizgisinin yüksekliği bir tıklama hedefi değil.
const dugmeStilleri = [...uiKod.matchAll(/\.\.\.dugme\([^)]*\),([^}]*)/g)].map((m) => m[1]);
assert.ok(dugmeStilleri.length >= 5, `düğme stili bulunamadı (${dugmeStilleri.length})`);
for (const st of dugmeStilleri) {
  const m = /minHeight: (\d+)/.exec(st);
  // minHeight yazılmamışsa tema.dugme'nin kendi 32 px'i geçerli.
  assert.ok(!m || Number(m[1]) >= 32, `temizleme düğmesinde ${m?.[1]} px hedef var`);
}

console.log('verify-splat-temizleme: OK · projeksiyon, fırça/lasso/küre, derinlik ayrımı, geri alma, 5 sözleşme');
