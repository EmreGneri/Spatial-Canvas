// DAViD insan derinliği füzyonu (saf CPU): sağlam ölçek/kayma, maske içi değiştirme,
// yumuşak kenar, reddetme kapıları ve bayrak/varsayılan seçenek sözleşmesi.
import assert from 'node:assert/strict';
const { davidFuzyon, davidCiktisiniCoz, DAVID_SINIR } = await import('../src/engine/vision/davidFuzyon.ts');

const W = 40, H = 30, N = W * H;
// Sahne: arka plan 0.2, özne bölgesi düz 0.7 (yakın) + hafif eğim; DAViD: özne içinde zengin şekil.
const sahne = new Float32Array(N), david = new Float32Array(N), maske = new Float32Array(N);
const icerde = (x, y) => (x - 20) ** 2 / 100 + (y - 15) ** 2 / 64 < 1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const r2 = (x - 20) ** 2 / 100 + (y - 15) ** 2 / 64;
  maske[i] = icerde(x, y) ? 1 : 0;
  sahne[i] = icerde(x, y) ? 0.6 + 0.2 * (1 - r2) : 0.2; // düz-ish kubbe, aralık 0.6..0.8
  david[i] = icerde(x, y) ? 5 * (1 - r2) + Math.sin(x) * 0.5 : -3; // farklı birim/kayma, ek detay
}
const r = davidFuzyon(sahne, david, maske, W, H);
assert.ok(r, 'geçerli girdi kabul edilir');
assert.ok(r.olcek > 0, 'pozitif ölçek');
// Maske dışı birebir sahne.
for (let i = 0; i < N; i++) if (maske[i] === 0) assert.equal(r.data[i], sahne[i], 'maske dışı dokunulmaz');
// Maske içi: konum (medyan) sahneyle aynı, şekil DAViD'den (sin detayı görünür).
const ic = [...Array(N).keys()].filter(i => maske[i] === 1);
const med = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
assert.ok(Math.abs(med(ic.map(i => r.data[i])) - med(ic.map(i => sahne[i]))) < 0.01, 'medyan sahneye oturur');
const kor = (a, b) => {
  const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  let n = 0, da = 0, db = 0;
  a.forEach((v, k) => { n += (v - ma) * (b[k] - mb); da += (v - ma) ** 2; db += (b[k] - mb) ** 2; });
  return n / Math.sqrt(da * db);
};
assert.ok(kor(ic.map(i => r.data[i]), ic.map(i => david[i])) > 0.999, 'maske içi şekil DAViD');
// Genlik: LSQ gibi küçülmez — sağlam yayılım (p10..p90) sahneninkine eşit.
const yay = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(.9 * (s.length - 1))] - s[Math.floor(.1 * (s.length - 1))]; };
assert.ok(Math.abs(yay(ic.map(i => r.data[i])) - yay(ic.map(i => sahne[i]))) < 0.01, 'yayılım sahneyle eşleşir');
assert.ok(r.data.every(v => v >= 0 && v <= 1 && Number.isFinite(v)), '0..1 aralığı');
assert.ok(r.korelasyon > 0.5, 'tanı: korelasyon raporlanır');

// Yumuşak kenar: maske 0.5 → yarı yarıya karışım.
const m2 = Float32Array.from(maske); const kenar = ic[0]; m2[kenar] = 0.5;
const r2 = davidFuzyon(sahne, david, m2, W, H);
const tam = r.data[kenar];
assert.ok(Math.abs(r2.data[kenar] - (0.5 * tam + 0.5 * sahne[kenar])) < 0.02, 'yumuşak maske tüyler');

// Reddetme: ters işaret (DAViD sahneyle negatif ilişkili) → null.
assert.equal(davidFuzyon(sahne, david.map((v, i) => maske[i] ? -v : v), maske, W, H), null, 'ters kutup reddedilir');
// Reddetme: neredeyse boş maske.
const az = new Float32Array(N); az[ic[0]] = 1;
assert.equal(davidFuzyon(sahne, david, az, W, H), null, 'küçük maske reddedilir');
// Reddetme: NaN / sabit DAViD.
assert.equal(davidFuzyon(sahne, david.map(() => NaN), maske, W, H), null, 'NaN reddedilir');
assert.equal(davidFuzyon(sahne, new Float32Array(N).fill(1), maske, W, H), null, 'sabit DAViD reddedilir');
// Boyut uyuşmazlığı.
assert.throws(() => davidFuzyon(sahne, david.subarray(1), maske, W, H));
assert.ok(DAVID_SINIR.minMaskeOrani > 0);

// Ham çıktı çözümü: kutup KORUNUR (ölçüldü: ham zaten yakın = büyük), letterbox iç kırpımı alınır.
const S = 8, ham = new Float32Array(S * S);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) ham[y * S + x] = 10 * y + x;
const c = davidCiktisiniCoz(ham, S, { x: 2, y: 1, w: 4, h: 6 }, 4, 6);
assert.equal(c.length, 24);
assert.equal(c[0], 12, 'iç dikdörtgenin sol üstü');
assert.equal(c[23], 65, 'iç dikdörtgenin sağ altı, işaret değişmez');

// Bayrak: yalnız ?derinlik=david; bayraksız FOTO_KALITE birebir eski.
const { davidIstendi, mogeIstendi, FOTO_KALITE } = await import('../src/depth.ts');
assert.equal(davidIstendi('?derinlik=david'), true);
for (const q of ['', '?derinlik=David', '?derinlik=moge', '?david=1', '?yuz=0']) assert.equal(davidIstendi(q), false, q);
assert.equal(mogeIstendi('?derinlik=david'), false);
// insanMaskesi 'otomatik' yalnız yardımcı DAViD maskesini listeliyorsa koşar (verify-david-sidecar); derinlik füzyonu yok.
assert.deepEqual(FOTO_KALITE, { tileDetay: true, kenarHizalama: 0.5, model: 'da3-mono', insanMaskesi: 'otomatik' }, 'varsayılan seçenekler');
console.log('OK DAViD füzyonu: sağlam ölçek/kayma, maske içi şekil, tüy, kapılar, bayrak');
