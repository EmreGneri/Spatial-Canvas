// Yüz rölyefi (saf): yön, ağırlık (oval içi tam, dışta geçiş), sabit çapa, modelin eğimine
// uymama (eğim ağdan), kafa elipsoidi sınırı, güç çarpanı.
//   node scripts/verify-yuz-rolyef.mjs
import assert from 'node:assert/strict';
const { yuzRolyefHaritasi, yuzRolyefiUygula, YUZ_OVAL } = await import('../src/engine/reconstruction/yuzRolyef.ts');

// Sentetik yüz: merkez (0.5, 0.5), yarıçap 0.2; kubbe: merkez kameraya yakın (z küçük).
const noktalar = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
const ovalSet = new Set(YUZ_OVAL);
YUZ_OVAL.forEach((idx, k) => {
  const a = (k / YUZ_OVAL.length) * Math.PI * 2;
  noktalar[idx] = { x: 0.5 + 0.2 * Math.sin(a), y: 0.5 - 0.2 * Math.cos(a), z: 0 };
});
let s = 1;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 478; i++) {
  if (ovalSet.has(i)) continue;
  const r = 0.19 * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
  const x = 0.5 + r * Math.cos(a), y = 0.5 + r * Math.sin(a);
  const rr = ((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.04;
  noktalar[i] = { x, y, z: -0.1 * (1 - rr) };
}
const w = 100, h = 100;
const r = yuzRolyefHaritasi(noktalar, w, h);
assert.ok(r, 'harita üretildi');
const at = (a, x, y) => a[y * w + x];

// Yön + ağırlık: oval içi tam (1), dışta geçiş, uzakta 0.
assert.ok(at(r.rel, 50, 50) > at(r.rel, 50, 35), 'merkez (burun) kenardan daha yakın');
assert.equal(at(r.agirlik, 5, 5), 0, 'uzak dış ağırlık 0');
assert.ok(at(r.agirlik, 50, 50) > 0.999 && at(r.agirlik, 50, 32) > 0.999, 'oval içi (kenara yakın dahil) ağırlık 1');
const disari = at(r.agirlik, 50, 28); // oval sınırı y≈30, biraz dışı
assert.ok(disari > 0 && disari < 1, `oval dışında yumuşak geçiş (${disari.toFixed(3)})`);

// Düz model derinliği: çapa = oval içi medyan(d − rel/birim); iç = çapa + rel/birim.
const birim = 200;
const depth = new Float32Array(w * h).fill(0.4);
const out = yuzRolyefiUygula(depth, w, h, r, birim);
assert.equal(at(out, 5, 5), depth[5 * w + 5], 'yüz dışı aynen');
assert.ok(at(out, 50, 50) > at(out, 50, 35), 'burun öne geldi');
const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
const icOut = [], icGir = [];
for (let i = 0; i < w * h; i++) if (r.agirlik[i] >= 0.999) { icOut.push(out[i] - r.rel[i] / birim); icGir.push(depth[i] - r.rel[i] / birim); }
assert.ok(Math.abs(med(icOut) - med(icGir)) < 1e-3, 'çapa: yüzün genel uzaklığı modelden (oval içi medyan)');

// Geçişin dış ucunda model devralır (basamak yok).
let enKotu = 0;
for (let i = 0; i < w * h; i++) {
  if (r.agirlik[i] > 0 && r.agirlik[i] < 0.1 && !(r.ustAgirlik?.[i] > 0)) enKotu = Math.max(enKotu, Math.abs(out[i] - depth[i]));
}
assert.ok(enKotu < 0.02, `geçiş dış ucunda basamak yok (${enKotu.toFixed(4)})`);

// Eğimli model derinliği (model alını yakın, çeneyi uzak sanıyor): yüzün İÇİNDEKİ eğim
// modele DEĞİL ağa uyar — merkez–üst farkı ağınkiyle aynı kalır.
const egik = Float32Array.from({ length: w * h }, (_, i) => 0.7 - 0.5 * (Math.floor(i / w) / h));
const outE = yuzRolyefiUygula(egik, w, h, r, birim);
const agFarki = (at(r.rel, 50, 50) - at(r.rel, 50, 38)) / birim;
const ciktiFarki = at(outE, 50, 50) - at(outE, 50, 38);
assert.ok(Math.abs(ciktiFarki - agFarki) < 0.01, `iç eğim ağdan (${ciktiFarki.toFixed(3)} ≈ ${agFarki.toFixed(3)})`);

// KAFA ELİPSOİDİ: oval üstündeki (alın/saç) bölge modelde yüzün çok ÖNÜNDE (0.95) olsun;
// geri itilmeli. Aynı bölge yüzün çok ARKASINDA (0.05) ise dokunulmamalı.
assert.ok(r.ust && r.ustAgirlik, 'kafa elipsoidi üretildi');
let sacPx = -1;
for (let y = 0; y < 30 && sacPx < 0; y++) { const i = y * w + 50; if (r.agirlik[i] === 0 && r.ustAgirlik[i] > 0.5) sacPx = i; }
assert.ok(sacPx >= 0, 'oval dışı, elipsoid içi saç pikseli var');
const onde = Float32Array.from(depth); onde[sacPx] = 0.95;
const outOnde = yuzRolyefiUygula(onde, w, h, r, birim);
assert.ok(outOnde[sacPx] < 0.8, `öne fırlamış saç geri itildi (${outOnde[sacPx].toFixed(3)})`);
const arkada = Float32Array.from(depth); arkada[sacPx] = 0.05;
assert.equal(yuzRolyefiUygula(arkada, w, h, r, birim)[sacPx], arkada[sacPx], 'arkadaki saç aynen');

// Güç çarpanı: ×2'de rölyef iki kat (ağ ve elipsoid birlikte ölçeklenir).
const r2 = yuzRolyefHaritasi(noktalar, w, h, 2);
assert.ok(Math.abs(at(r2.rel, 50, 50) - 2 * at(r.rel, 50, 50)) < 1e-3, 'güç rölyefi ölçekler');
const scalp = yuzRolyefHaritasi(noktalar, w, h, 1.5);
const baseZ = noktalar.slice(0, 468).map(p => p.z).sort((a, b) => a - b)[234];
const foreheadIds = [10, 109, 67, 338, 297, 151, 108, 337];
const foreheadMax = Math.max(...foreheadIds.map(k => -(noktalar[k].z - baseZ) * w * 1.5));
for (let i = 0; i < w * h; i++) {
  if (scalp.ustAgirlik[i] > 0) assert.ok(scalp.ust[i] <= foreheadMax + 0.06 * 40 + 1e-5, 'saç tavanı alın + fiziksel saç payını aşmaz');
}

// Eksik nokta → null; geçersiz birim → kopya.
assert.equal(yuzRolyefHaritasi(noktalar.slice(0, 100), w, h), null);
const flatAxis = noktalar.map(p => ({ ...p }));
flatAxis[152] = { ...flatAxis[10] };
assert.equal(yuzRolyefHaritasi(flatAxis, w, h), null, 'dejenere yüz ekseni reddedilir');
assert.deepEqual(yuzRolyefiUygula(depth, w, h, r, 0), depth);

// Çene ucunda ve boyunda rölyef sıfır; döndürülmüş yüzde de eksen yüzü izler.
for (const angle of [0, Math.PI / 6, -Math.PI / 6]) {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const pts = noktalar.map(p => ({ ...p, x: 0.5 + (p.x - 0.5) * cs - (p.y - 0.5) * sn, y: 0.5 + (p.x - 0.5) * sn + (p.y - 0.5) * cs }));
  const relief = yuzRolyefHaritasi(pts, w, h, 1.5);
  const forehead = pts[10], chin = pts[152];
  const atAxis = t => {
    const x = Math.floor((forehead.x + t * (chin.x - forehead.x)) * w);
    const y = Math.floor((forehead.y + t * (chin.y - forehead.y)) * h);
    return y * w + x;
  };
  assert.ok(relief.agirlik[atAxis(0.97)] < 0.1, 'çene ucunda rölyef söner');
  assert.equal(relief.agirlik[atAxis(1.08)], 0, 'boyun rölyef almaz');
  const changed = yuzRolyefiUygula(depth, w, h, relief, birim);
  assert.equal(changed[atAxis(1.08)], depth[atAxis(1.08)], 'boyun üst sınırdan da etkilenmez');
  assert.ok(relief.agirlik[atAxis(0.5)] > 0.999, 'orta yüz detayı korunur');
}
console.log('verify-yuz-rolyef OK');

// Zayıf model rölyefinde fazladan güç, yüz yanlarını geriye çekip kama üretmemeli.
const amplified = yuzRolyefHaritasi(noktalar, w, h, 1.5);
const canonical = yuzRolyefHaritasi(noktalar, w, h, 1);
const weak = Float32Array.from({length:w*h},(_,i)=>.5+.01*Math.sin(i%w));
const safe = yuzRolyefiUygula(weak,w,h,amplified,birim);
const physical = yuzRolyefiUygula(weak,w,h,canonical,birim);
assert.ok(safe.every((v,i)=>Math.abs(v-physical[i])<1e-6),'zayıf derinlikte ek ×1.5 yerine fiziksel ×1 şekli korunmalı');
const manual = yuzRolyefHaritasi(noktalar,w,h,1.5,false);
assert.notDeepEqual(yuzRolyefiUygula(weak,w,h,manual,birim),physical,'açık güç isteği korunmalı');
// Eşleşen güçlü modelde istenen güç gereksiz yere azaltılmamalı.
const matched = Float32Array.from(amplified.rel,v=>.5+v/birim);
assert.deepEqual(yuzRolyefiUygula(matched,w,h,amplified,birim),yuzRolyefiUygula(matched,w,h,manual,birim));
const transformed = Float32Array.from(weak,v=>.25+.5*v);
const scaledResult = yuzRolyefiUygula(transformed,w,h,amplified,birim*2);
assert.ok(scaledResult.every((v,i)=>Math.abs(v-(.25+.5*safe[i]))<1e-6),'uyarlama derinlik biriminin afin ölçeğinden bağımsız olmalı');
const sparse = {...amplified,agirlik:new Float32Array(w*h)};
sparse.agirlik.fill(1,0,7);
assert.deepEqual(yuzRolyefiUygula(weak,w,h,sparse,birim),weak,'yetersiz destek değiştirilmez');
const flatRelief = {...amplified,rel:new Float32Array(w*h)};
assert.ok(yuzRolyefiUygula(weak,w,h,flatRelief,birim).every(Number.isFinite),'sıfır ağ yayılımı sonlu kalır');
console.log('adaptive face relief: extra amplification limited; physical detail and explicit override retained');
