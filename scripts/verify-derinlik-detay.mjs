// Parça birleştirme + kılavuzlu süzgeç (saf matematik, modelsiz).
//   node scripts/verify-derinlik-detay.mjs
import assert from 'node:assert/strict';
const { tileGrid, boxBlur, fitAffine, mergeTileDetail, kenarHizala } =
  await import('../src/engine/reconstruction/derinlikDetay.ts');

// tileGrid: tüm ızgarayı örter, komşular bindirir.
{
  const t = tileGrid(100, 60, 2, 2, 0.25);
  assert.equal(t.length, 4);
  const cover = new Uint8Array(100 * 60);
  for (const r of t) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cover[y * 100 + x] = 1;
  assert.ok(cover.every((v) => v === 1), 'tam örtme');
  assert.ok(t[0].x + t[0].w > t[1].x, 'bindirme var');
}

// boxBlur: sabit girdi değişmez; toplam korunur gibi davranır.
{
  const c = new Float32Array(12 * 9).fill(0.4);
  assert.ok(boxBlur(c, 12, 9, 3).every((v) => Math.abs(v - 0.4) < 1e-6));
}

// fitAffine: bilinen a,b geri bulunur; ters eğilim reddedilir.
{
  const t = Float32Array.from({ length: 100 }, (_, i) => i / 100);
  const g = t.map((v) => 0.5 * v + 0.1);
  const f = fitAffine(t, g);
  assert.ok(Math.abs(f.scale - 0.5) < 1e-4 && Math.abs(f.offset - 0.1) < 1e-4);
  assert.equal(fitAffine(t, t.map((v) => -v)), null);
}

// mergeTileDetail: global = pürüzsüz rampa; parça = aynı rampa + ince desen.
// Sonuç ince deseni kazanır, düşük frekans (rampa) bozulmaz.
{
  const w = 64, h = 64;
  const ramp = (x) => 0.2 + 0.6 * (x / (w - 1));
  const depth = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) depth[y * w + x] = ramp(x);
  const base = Float32Array.from(depth);
  const fine = (x, y) => 0.03 * Math.sin(x * 1.3) * Math.cos(y * 1.1);
  const tiles = tileGrid(w, h, 2, 2).map((rect) => {
    const d = new Float32Array(rect.w * rect.h);
    for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) {
      const x = rect.x + i, y = rect.y + j;
      d[j * rect.w + i] = 0.9 * ramp(x) + 0.05 + fine(x, y); // farklı genlik/ofset
    }
    return { rect, depth: d };
  });
  assert.equal(mergeTileDetail(depth, w, h, tiles), 4);
  let errBefore = 0, errAfter = 0, lowShift = 0;
  const lowB = boxBlur(base, w, h, 6), lowA = boxBlur(depth, w, h, 6);
  for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) {
    const i = y * w + x;
    errBefore += Math.abs(base[i] - (ramp(x) + fine(x, y)));
    errAfter += Math.abs(depth[i] - (ramp(x) + fine(x, y)));
    lowShift = Math.max(lowShift, Math.abs(lowA[i] - lowB[i]));
  }
  assert.ok(errAfter < errBefore * 0.6, `ince yapı geri geldi (${errBefore.toFixed(1)} -> ${errAfter.toFixed(1)})`);
  assert.ok(lowShift < 0.02, `düşük frekans korundu (${lowShift.toFixed(4)})`);
}

// Ters/bozuk parça uygulanmaz.
{
  const w = 32, h = 32;
  const depth = Float32Array.from({ length: w * h }, (_, i) => (i % w) / w);
  const before = Float32Array.from(depth);
  const rect = { x: 0, y: 0, w, h };
  const used = mergeTileDetail(depth, w, h, [{ rect, depth: depth.map((v) => 1 - v) }]);
  assert.equal(used, 0);
  assert.deepEqual(depth, before);
}

// kenarHizala: bulanık basamak, keskin luminance basamağıyla hizalanır.
{
  const w = 48, h = 16, edge = 24;
  const guide = new Float32Array(w * h), blurry = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    guide[y * w + x] = x < edge ? 0.2 : 0.8;
    blurry[y * w + x] = Math.min(1, Math.max(0, (x - (edge - 5)) / 10)); // 10 px rampa
  }
  const out = kenarHizala(blurry, guide, w, h, 1, 4, 0.005);
  const sharp = (d) => Math.abs(d[8 * w + edge] - d[8 * w + edge - 1]);
  assert.ok(sharp(out) > sharp(blurry) * 2, `kenar keskinleşti (${sharp(blurry).toFixed(3)} -> ${sharp(out).toFixed(3)})`);
  // strength 0 = kimlik
  assert.deepEqual(kenarHizala(blurry, guide, w, h, 0), Float32Array.from(blurry));
  // düz kılavuz: yalnız yumuşatır, hiçbir yerde yeni kenar/doku üretmez
  const flat = kenarHizala(blurry, new Float32Array(w * h).fill(0.5), w, h, 1);
  const maxGrad = (d) => Math.max(...Array.from({ length: w - 1 }, (_, x) => Math.abs(d[8 * w + x + 1] - d[8 * w + x])));
  assert.ok(maxGrad(flat) <= maxGrad(blurry) + 1e-6);
}

console.log('verify-derinlik-detay OK');
