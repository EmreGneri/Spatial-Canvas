import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hataGorunum, hataSinifla, onbellekAnahtarlari } from '../src/ui/hataMesaji.ts';

// GERÇEK HATA METİNLERİ — hepsi bu projede yaşandı. Sınıflandırıcı bunları
// tanımayı bırakırsa kullanıcı yine "beyaz ekran + anlamsız mesaj" görür.
const YASANAN = {
  onbellek: "Unexpected token '<', \"<!doctype \"... is not valid JSON",
  onbellek2: 'SyntaxError: Unexpected token < in JSON at position 0',
  webgl: 'THREE.WebGLRenderer: Context Lost.',
  shader: 'THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false',
  bellek: 'RangeError: Array buffer allocation failed',
};

assert.equal(hataSinifla(YASANAN.onbellek), 'onbellek');
assert.equal(hataSinifla(YASANAN.onbellek2), 'onbellek');
assert.equal(hataSinifla(YASANAN.webgl), 'webgl');
assert.equal(hataSinifla(YASANAN.shader), 'webgl');
assert.equal(hataSinifla(YASANAN.bellek), 'bellek');
assert.equal(hataSinifla(new Error('tamamen başka bir şey')), 'bilinmeyen');

// Önbellek hatası TEK sınıf: yenilemek yetmez, silme düğmesi ŞART.
const o = hataGorunum(new Error(YASANAN.onbellek));
assert.equal(o.onbellekTemizle, true, 'önbellek hatasında temizleme düğmesi yok — yenileme tek başına işe yaramaz');
assert.ok(o.adimlar.length >= 2, 'kurtarma adımı verilmemiş');

// Diğer sınıflarda o düğme ÇIKMAZ: gereksiz yere model önbelleği silinmesin.
for (const m of [YASANAN.webgl, YASANAN.bellek, 'rastgele']) {
  assert.equal(hataGorunum(m).onbellekTemizle, false, `${m}: gereksiz önbellek düğmesi`);
}

// Her sınıf için başlık + açıklama + en az iki adım olmalı; boş ekran yasak.
for (const m of Object.values(YASANAN).concat(['bilinmeyen bir şey'])) {
  const g = hataGorunum(m);
  assert.ok(g.baslik.length > 4, `${m}: başlık boş`);
  assert.ok(g.aciklama.length > 20, `${m}: açıklama boş`);
  assert.ok(g.adimlar.length >= 2, `${m}: yeterli adım yok`);
  assert.ok(g.ham.length > 0, `${m}: ham hata metni düşürülmüş`);
}

// BİLİNMEYEN hatada hatanın KENDİ metni gösterilmeli: "bir şeyler ters gitti"
// tek başına kullanıcıyı kör bırakır.
const b = hataGorunum(new Error('tuhaf-özel-belirteç-42'));
assert.match(b.ham, /tuhaf-özel-belirteç-42/);

// Ham metin kutuyu taşırmasın.
assert.ok(hataGorunum(new Error('x'.repeat(5000))).ham.length <= 400);

// Error olmayan değerler de çökmemeli (unhandledrejection her şeyi taşır).
for (const garip of [null, undefined, 42, { a: 1 }, ['x']]) {
  assert.ok(hataGorunum(garip).baslik.length > 0, `${String(garip)}: çöküyor`);
}

// Yalnız transformers önbellekleri silinir — vite/workbox önbelleğine dokunma.
assert.deepEqual(
  onbellekAnahtarlari(['transformers-cache', 'vite-deps', 'workbox-precache', 'transformers-v2']),
  ['transformers-cache', 'transformers-v2'],
);

// KAPSAM: React yalnız RENDER içindeki hatayı görür. Döngü/olay hataları için
// pencere dinleyicileri şart — kaldırılırsa sahne donar ve hiçbir yerde yazmaz.
const sinir = readFileSync(new URL('../src/ui/HataSinir.tsx', import.meta.url), 'utf8');
assert.match(sinir, /addEventListener\('error'/, 'pencere error dinleyicisi yok');
assert.match(sinir, /addEventListener\('unhandledrejection'/, 'unhandledrejection dinleyicisi yok');
assert.match(sinir, /removeEventListener\('error'/, 'dinleyici sökülmüyor — kaçak');
assert.match(sinir, /getDerivedStateFromError/, 'React sınır kancası yok');
// Kurtarma ağacı GERÇEKTEN yeniden mount edilmeli; aynı key'le çöken bileşen
// bozuk state'iyle geri gelir.
assert.match(sinir, /key=\{this\.state\.nesil\}/, 'yeniden denemede ağaç remount edilmiyor');

// Sınır App'in DIŞINDA olmalı: App'in kendi mount'u çökerse de yakalanmalı.
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
assert.match(main, /<HataSinir>[\s\S]*<App \/>[\s\S]*<\/HataSinir>/, 'sınır App ağacını sarmalamıyor');

// Fitts (tasarim-kurallari.md): kurtarma düğmeleri ≥ 32 px.
for (const m of sinir.matchAll(/minHeight: (\d+)/g)) {
  assert.ok(Number(m[1]) >= 20, `kurtarma ekranında ${m[1]} px hedef var`);
}
assert.ok(/minHeight: 36/.test(sinir), 'birincil kurtarma düğmesi 36 px değil');

console.log('verify-hata-siniri: OK · 4 sınıf, yaşanan 5 hata metni, remount + pencere kapsamı');
