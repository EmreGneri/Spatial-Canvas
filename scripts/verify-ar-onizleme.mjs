import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arDurum, guvensizBaglam } from '../src/ui/arDurum.ts';

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
};

const temel = { xrVar: true, arDestekli: null, vrDestekli: null, sahneVar: true, ua: UA.android };

// ── SAHNE YOKSA: "cihaz desteklemiyor" DEĞİL, "sahne yok" denmeli. İkisini
//    karıştırmak kullanıcıyı ARCore güncellemeye gönderir, oysa sorun sahnede.
{
  const d = arDurum({ ...temel, arDestekli: true, sahneVar: false });
  assert.equal(d.acilabilir, false);
  assert.match(d.baslik, /sahne yok/i);
  assert.ok(d.adimlar.some((a) => /fotoğraf|eğitim/i.test(a)), 'sahne yoksa ne yapılacağı yazılmamış');
}

// ── AR VARSA: immersive-ar açılır.
{
  const d = arDurum({ ...temel, arDestekli: true });
  assert.equal(d.acilabilir, true);
  assert.equal(d.kip, 'immersive-ar');
  assert.match(d.etiket, /AR/);
}

// ── AR YOK, VR VARSA: "AR yok" demek masaüstü başlığı kullanıcısına YANLIŞ
//    bilgi olurdu; oturum VR olarak açılır ve etiket bunu söyler.
{
  const d = arDurum({ ...temel, arDestekli: false, vrDestekli: true, ua: UA.mac });
  assert.equal(d.acilabilir, true);
  assert.equal(d.kip, 'immersive-vr');
  assert.match(d.etiket, /başlık/i, 'VR oturumu "AR’da gör" diye etiketlenmiş');
}

// ── İKİSİ DE YOKSA kapalı ve sebepli.
{
  const d = arDurum({ ...temel, arDestekli: false, vrDestekli: false, ua: UA.mac });
  assert.equal(d.acilabilir, false);
  assert.equal(d.kip, null);
  assert.ok(d.adimlar.length >= 1);
}

// ── SORGU HATA VERDİYSE (null/null) "desteklemiyor" diye kesin konuşulmaz.
{
  const d = arDurum({ ...temel, arDestekli: null, vrDestekli: null });
  assert.equal(d.acilabilir, false);
  assert.match(d.baslik, /sorulamadı/i, 'sorgu hatası "desteklemiyor" gibi sunuluyor');
}

// ── TARAYICIYA ÖZEL YOL. iOS'ta "başka tarayıcı dene" demek YANLIŞ: hepsi
//    aynı motoru kullanıyor, WebXR hiçbirinde yok.
{
  const d = arDurum({ ...temel, xrVar: false, ua: UA.ios });
  const metin = d.adimlar.join(' ');
  assert.match(metin, /aynı motoru/i, 'iOS’ta yanlış yönlendirme yapılıyor');
  assert.match(metin, /\.ply/i, 'iOS’ta gerçek alternatif (PLY) verilmemiş');
  assert.ok(!/Chrome.{0,20}(dene|yükle)/i.test(metin), 'iOS kullanıcısı Chrome indirmeye gönderiliyor');
}
{
  const metin = arDurum({ ...temel, xrVar: false, ua: UA.android }).adimlar.join(' ');
  assert.match(metin, /ARCore|Play AR/i, 'Android’de ARCore koşulu söylenmiyor');
  assert.match(metin, /https/i, 'Android’de güvenli bağlam koşulu söylenmiyor');
}
{
  const metin = arDurum({ ...temel, xrVar: false, ua: UA.firefox }).adimlar.join(' ');
  assert.match(metin, /Firefox/i, 'Firefox’a özel yol yok');
}
// Her durumda en az bir adım olmalı: boş liste kullanıcıyı çıkmaz sokakta bırakır.
for (const ua of Object.values(UA)) {
  for (const [ar, vr] of [[null, null], [false, false], [true, null], [false, true]]) {
    const d = arDurum({ xrVar: true, arDestekli: ar, vrDestekli: vr, sahneVar: true, ua });
    assert.ok(d.adimlar.length >= 1, `${ua} ${ar}/${vr}: adım yok`);
    assert.ok(d.etiket.length > 0 && d.baslik.length > 0);
  }
}

// ── GÜVENLİ BAĞLAM: WebXR yalnız https ve localhost.
assert.equal(guvensizBaglam('https:', 'ornek.com'), false);
assert.equal(guvensizBaglam('http:', 'localhost:5173'), false);
assert.equal(guvensizBaglam('http:', '127.0.0.1:5173'), false);
assert.equal(guvensizBaglam('http:', 'ornek.com'), true);
assert.equal(guvensizBaglam('http:', 'localhost.saldirgan.com'), true, 'localhost öneki kandırıyor');

// ── SÖZLEŞME: XR'DA POST-FX BYPASS EDİLMELİ. EffectComposer tek kameralı tam
//    ekran quad'larla çalışır; XR'da iki göz var, quad zinciri sahneyi XR
//    poziyla çizmez. Bypass düşerse AR görüntüsü donuk/yanlış gelir.
const engine = readFileSync(new URL('../src/engine/Engine.ts', import.meta.url), 'utf8');
assert.match(engine, /if \(this\.xrSunuyor\) \{/, 'XR’da post-FX bypass’ı yok');
const dal = engine.slice(engine.indexOf('if (this.xrSunuyor) {'), engine.indexOf('this.composer.render();', engine.indexOf('if (this.xrSunuyor) {')));
assert.match(dal, /this\.renderer\.render\(this\.scene, this\.camera\)/, 'XR dalı sahneyi doğrudan çizmiyor');

// Oturum bitince renderer ESKİ HÂLİNE dönmeli, yoksa ekran kalıcı bozulur.
const acGovde = engine.slice(engine.indexOf('async xrOturumuAc('), engine.indexOf('get xrSunumda('));
assert.match(acGovde, /xr\.enabled = false/, 'oturum bitince xr.enabled kapatılmıyor');
assert.match(acGovde, /controls\.enabled = true/, 'oturum bitince OrbitControls geri açılmıyor');
assert.match(acGovde, /this\.resize\(\)/, 'oturum bitince ekran tamponu tazelenmiyor');
assert.match(acGovde, /controls\.enabled = false/, 'oturum sırasında OrbitControls kapatılmıyor — çıkışta kamera kayar');
assert.match(acGovde, /\{ once: true \}/, 'end dinleyicisi kaçak bırakıyor');

// ── ARAYÜZ: "efektler kapalı" kullanıcıya YAZILMALI (sessiz sapma yok).
const ui = readFileSync(new URL('../src/ui/ArDugmesi.tsx', import.meta.url), 'utf8');
const durum = readFileSync(new URL('../src/ui/arDurum.ts', import.meta.url), 'utf8');
assert.ok(/KAPALI/.test(durum), 'AR’da efektlerin kapalı olduğu kullanıcıya söylenmiyor');
// requestSession bir KULLANICI JESTİ ister: tanıtımdaki "başlat" tıklamasından
// çağrılmalı, effect/otomatik akıştan değil.
assert.match(ui, /onClick=\{ac\}/, 'oturum kullanıcı jestinden açılmıyor');
assert.ok(!/useEffect\([^)]*requestSession/s.test(ui), 'oturum effect içinden açılıyor — tarayıcı reddeder');
// Desteklenmeyen cihazda düğme GİZLENMEZ: gizli düğme "uygulamada AR yok" gibi
// okunur, oysa sorun cihazda.
assert.ok(!/durum\.acilabilir\s*&&\s*\(?\s*<button/.test(ui), 'desteklenmeyen cihazda düğme gizleniyor');
assert.match(ui, /requiredFeatures: \['local'\]/, 'zorunlu XR özelliği en aza indirilmemiş (local-floor telefonda yok)');

console.log('verify-ar-onizleme: OK · 4 cihaz yolu, AR/VR seçimi, güvenli bağlam, post-FX bypass sözleşmesi');
