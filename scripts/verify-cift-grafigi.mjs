// Sıralı eşleştirme grafiği (Gezinme Parça 2 / Görev 1): siraliCiftler + ciftSayisi,
// ve bunların aynaladığı vendor yardımcıları (buildPairs kuralı, opts.pairs süzgeci).
// Vendor'dan yeni bir şey export EDİLMEZ: iki fonksiyon sfm.js kaynak metninden
// okunur ve yalıtık çalıştırılır (ikisi de dış sembol kullanmaz).
//   node scripts/verify-cift-grafigi.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siraliCiftler, ciftSayisi } from '../src/engine/reconstruction/ciftGrafigi.ts';

const sfmKaynak = readFileSync(new URL('../src/vendor/splat.js/sfm/sfm.js', import.meta.url), 'utf8');

/** `function ad(...) { ... }` gövdesini süslü parantez sayarak kesip çalıştırır. */
function vendorFonksiyonu(ad) {
  const bas = sfmKaynak.indexOf(`\nfunction ${ad}(`);
  assert.ok(bas >= 0, `sfm.js içinde function ${ad} yok`);
  let i = sfmKaynak.indexOf('{', sfmKaynak.indexOf(')', bas));
  let derinlik = 0;
  for (; i < sfmKaynak.length; i++) {
    if (sfmKaynak[i] === '{') derinlik++;
    else if (sfmKaynak[i] === '}' && --derinlik === 0) break;
  }
  return new Function(`${sfmKaynak.slice(bas, i + 1)}\nreturn ${ad};`)();
}

/** Yapısal denetim: [i, j] tamsayı, 0 <= i < j < n, yinelenme yok. Anahtar kümesini döndürür. */
function yapisal(ciftler, n, ne) {
  const gorulen = new Set();
  for (const p of ciftler) {
    assert.ok(Array.isArray(p) && p.length === 2, `${ne}: [i, j] değil: ${JSON.stringify(p)}`);
    const [i, j] = p;
    assert.ok(Number.isInteger(i) && Number.isInteger(j), `${ne}: tamsayı değil ${p}`);
    assert.ok(i >= 0 && i < j && j < n, `${ne}: 0 <= i < j < n bozuk ${p} (n ${n})`);
    const k = `${i},${j}`;
    assert.ok(!gorulen.has(k), `${ne}: yinelenen çift ${k}`);
    gorulen.add(k);
  }
  return gorulen;
}
const sozluksel = (a, b) => a[0] - b[0] || a[1] - b[1];

// [1] n = 24, varsayılanlar (pencere 6, uzakAdim 3, uzakCarpan 2 → uzak adım 12).
{
  const n = 24;
  const c = siraliCiftler(n);
  const k = yapisal(c, n, 'n=24');
  // komşular: i = 0..17 için 6'şar (108) + i = 18..23 için 5+4+3+2+1+0 (15) = 123;
  // uzak: i ∈ {0, 3, 6, 9} için i + 12 (i + 24 >= n) = 4 → 127
  assert.equal(c.length, 127, 'n=24 çift sayısı');
  for (let i = 0; i + 1 < n; i++) assert.ok(k.has(`${i},${i + 1}`), `komşu (${i}, ${i + 1}) eksik`);
  for (let i = 0; i < n; i++)
    for (let d = 1; d <= 6 && i + d < n; d++) assert.ok(k.has(`${i},${i + d}`), `pencere (${i}, ${i + d}) eksik`);
  const uzak = c.filter(([i, j]) => j - i > 6);
  assert.deepEqual(uzak, [[0, 12], [3, 15], [6, 18], [9, 21]], 'n=24 uzak bağlantılar');
  const enUzun = Math.max(...c.map(([i, j]) => j - i));
  assert.ok(enUzun >= n / 2, `en uzak bağlantı ${enUzun} < n/2`);
  assert.deepEqual(c, c.slice().sort(sozluksel), 'sözlüksel sırada');
  // yapısal kazanç: varsayılan grafik n <= 30'da tüm çiftler (276) — sıralı grafik yarısının altında
  assert.equal(ciftSayisi(n, 'dense'), 276);
  assert.ok(c.length < 276 / 2, `siraliCiftler(24) = ${c.length}, 276'nın yarısının altında olmalı`);
}

// [2] kenar durumları
{
  assert.deepEqual(siraliCiftler(0), []);
  assert.deepEqual(siraliCiftler(1), []);
  assert.deepEqual(siraliCiftler(2), [[0, 1]]);
  // n = 7: pencere 6 zaten her çifti kapsar (7·6/2 = 21), uzak bağlantı yok
  const c7 = siraliCiftler(7);
  yapisal(c7, 7, 'n=7');
  const hepsi7 = [];
  for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) hepsi7.push([i, j]);
  assert.deepEqual(c7, hepsi7, 'n=7 = tüm çiftler');
  assert.equal(c7.length, ciftSayisi(7, 'dense'));
}

// [3] seçenekler
{
  // pencere 2, her 2. i, uzak adım 2·2 = 4
  const c = siraliCiftler(10, { pencere: 2, uzakAdim: 2, uzakCarpan: 2 });
  yapisal(c, 10, 'seçenekli');
  const beklenen = [];
  for (let i = 0; i < 10; i++) for (let d = 1; d <= 2 && i + d < 10; d++) beklenen.push([i, i + d]);
  beklenen.push([0, 4], [0, 8], [2, 6], [4, 8]);
  assert.deepEqual(c, beklenen.sort(sozluksel), 'seçenekli çift listesi');
  // uzakCarpan 1: uzak adım pencerenin içine düşer → yinelenme süzülür
  const ic = siraliCiftler(10, { pencere: 3, uzakAdim: 1, uzakCarpan: 1 });
  const kic = yapisal(ic, 10, 'uzakCarpan 1');
  for (const [a, b] of [[0, 6], [0, 9], [1, 7], [3, 9]]) assert.ok(kic.has(`${a},${b}`), `uzak (${a}, ${b}) eksik`);
  // uzakCarpan 0: sonsuz döngü yok, yalnız pencere
  const sifir = siraliCiftler(12, { pencere: 2, uzakCarpan: 0 });
  yapisal(sifir, 12, 'uzakCarpan 0');
  assert.ok(sifir.every(([i, j]) => j - i <= 2));
  assert.equal(sifir.length, 11 + 10);
}

// [4] ölçeklenme: sıralı grafik ~doğrusal, varsayılan (dense) karesel
for (const n of [24, 40, 60, 100, 200]) {
  const c = siraliCiftler(n);
  const k = yapisal(c, n, `n=${n}`);
  for (let i = 0; i + 1 < n; i++) assert.ok(k.has(`${i},${i + 1}`), `n=${n}: komşu (${i}, ${i + 1}) eksik`);
  assert.ok(Math.max(...c.map(([i, j]) => j - i)) >= n / 2, `n=${n}: en uzak bağlantı < n/2`);
  assert.ok(c.length < ciftSayisi(n, 'dense'), `n=${n}: ${c.length} >= dense ${ciftSayisi(n, 'dense')}`);
  assert.ok(c.length <= 6 * n + n * n / 36 + 1, `n=${n}: ${c.length} çift, beklenenden çok`);
}

// [5] ciftSayisi = vendor buildPairs(n, profil).length
{
  // buildPairs (sfm.js ~117) kuralının elle aynası: n <= 30 tüm çiftler; üstünde pencere
  // (dense 20 / orbit 16 / walk 10) + uzak ızgara (i adımı 1/2/4, j = i+pencere+2'den adım 2/3/4).
  const ayna = (n, profil) => {
    const dense = profil === 'dense', orbit = profil === 'orbit' || dense;
    const win = dense ? 20 : orbit ? 16 : 10;
    if (n <= 30) return n < 2 ? 0 : n * (n - 1) / 2;
    const s = new Set();
    for (let i = 0; i < n; i++) for (let d = 1; d <= win; d++) if (i + d < n) s.add(`${i},${i + d}`);
    for (let i = 0; i < n; i += dense ? 1 : orbit ? 2 : 4)
      for (let j = i + win + 2; j < n; j += dense ? 2 : orbit ? 3 : 4) s.add(`${i},${j}`);
    return s.size;
  };
  assert.equal(ciftSayisi(24, 'dense'), 276);
  // n = 40 dense: pencere 20·20 + (19+…+0) = 590; uzak 2·(9+8+…+1) = 90 → 680
  assert.equal(ciftSayisi(40, 'dense'), 680);
  assert.equal(ciftSayisi(40, 'dense'), ayna(40, 'dense'));
  for (const p of ['walk', 'orbit', 'dense']) {
    assert.equal(ciftSayisi(0, p), 0);
    assert.equal(ciftSayisi(1, p), 0);
    assert.equal(ciftSayisi(30, p), 435, `${p}: n=30 tüm çiftler`);
  }
  // gerçek vendor kuralı, kaynak metinden: kural sfm.js'te değişirse burada düşer
  const buildPairs = vendorFonksiyonu('buildPairs');
  for (const p of ['walk', 'orbit', 'dense'])
    for (let n = 0; n <= 130; n++) {
      const beklenen = n < 2 ? 0 : buildPairs(n, p).length;
      assert.equal(ciftSayisi(n, p), beklenen, `ciftSayisi(${n}, '${p}') != buildPairs`);
      assert.equal(ayna(n, p), beklenen, `ayna(${n}, '${p}') != buildPairs`);
    }
}

// [6] sfm.js opts.pairs süzgeci (sanitizePairs) ve varsayılan yolun korunması
{
  const sanitizePairs = vendorFonksiyonu('sanitizePairs');
  const girdi = [[0, 1], [1, 0], [2, 2], [0, 1], [-1, 3], [3, 5], [1.5, 3], ['1', '2'], [4, 6], null, [2, 4], [0, 1]];
  assert.deepEqual(sanitizePairs(girdi, 6), [[0, 1], [3, 5], [2, 4]], 'süzgeç: tamsayı, 0 <= i < j < n, ilk görülen kalır, sıra korunur');
  assert.deepEqual(sanitizePairs(siraliCiftler(24), 24), siraliCiftler(24), 'geçerli liste aynen geçer');
  assert.throws(() => sanitizePairs(undefined, 6), /opts\.pairs/, 'dizi olmayan dönüş açık hata verir');
  // opts.pairs verilmezse eski satır bit bit aynı: buildPairs + aynı log metni
  assert.match(sfmKaynak, /: buildPairs\(n, opts\.graph \|\| \(useSift \? 'dense' : 'walk'\)\);/);
  assert.match(sfmKaynak, /log\(`matching \$\{pairs\.length\} image pairs\$\{opts\.pairs \? ' \(custom graph\)' : ''\} \.\.\.`\);/);
  // geri dönüş, gevşek-kapı yeniden denemesinden ÖNCE ve yalnız opts.pairs ile
  const runSfM = sfmKaynak.slice(sfmKaynak.indexOf('export async function runSfM('));
  assert.ok(runSfM.indexOf('runSfMCustomPairs(') >= 0 &&
    runSfM.indexOf('runSfMCustomPairs(') < runSfM.indexOf('pairMinInliers: 100'), 'geri dönüş yeniden denemeden önce');
  assert.match(runSfM, /if \(opts\.pairs\) \(\{ res: first, opts \} = await runSfMCustomPairs\(/);
  assert.match(runSfM, /else first = await runSfMOnce\(images, log, sampleColor, opts\);/);
}

console.log('sıralı çift grafiği (siraliCiftler, ciftSayisi, sfm.js opts.pairs): OK');
