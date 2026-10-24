// SAM 2.1 video bellek bankası (saf JS) + yeniden çapa kuralı.  node scripts/verify-sam-bellek.mjs
// Referans: facebookresearch/sam2 `SAM2Base._prepare_memory_conditioned_features`
// (num_maskmem=7, max_obj_ptrs_in_encoder=16, proj_tpos_enc_in_obj_ptrs, ileri izleme).
import assert from 'node:assert/strict';
const { SamBellek, sinusPe, ekleriAyristir, EKLER_BAYT, yenidenCapaMi } = await import('../src/engine/reconstruction/samBellek.ts');

const yakin = (a, b, e = 1e-5) => assert.ok(Math.abs(a - b) <= e, `${a} ≉ ${b}`);

// --- get_1d_sine_pe: pe_dim = dim/2, dim_t = 10000^(2*floor(i/2)/pe_dim), [sin | cos]
{
  const p0 = sinusPe(0, 256);
  assert.equal(p0.length, 256);
  for (let i = 0; i < 128; i++) { yakin(p0[i], 0); yakin(p0[128 + i], 1); }
  const p = sinusPe(0.5, 256);
  yakin(p[0], Math.sin(0.5)); yakin(p[1], Math.sin(0.5)); // i=0,1 → aynı frekans
  yakin(p[2], Math.sin(0.5 / 10000 ** (2 / 128)));
  yakin(p[128 + 3], Math.cos(0.5 / 10000 ** (2 / 128)));
  console.log('[1] sinüs konum kodlaması ✓');
}

// --- ek ağırlık düzeni: tpos 7×64 | noMem 256 | projW 64×256 | projB 64 (float32)
const TOK = 4096, MEM = 64;
const f = new Float32Array(EKLER_BAYT / 4);
assert.equal(EKLER_BAYT, 68608);
for (let i = 0; i < 7 * 64; i++) f[i] = Math.floor(i / 64) + 1; // tpos[k][*] = k+1
const projW0 = 7 * 64 + 256, projB0 = projW0 + 64 * 256;
for (let o = 0; o < 64; o++) f[projW0 + o * 256 + 128] = o; // yalnız cos(0)=1 sütunu: x[128]
for (let o = 0; o < 64; o++) f[projB0 + o] = 1000;
const ek = ekleriAyristir(f.buffer);
assert.equal(ek.tpos.length, 448); assert.equal(ek.noMem.length, 256);
assert.equal(ek.projW.length, 16384); assert.equal(ek.projB.length, 64);
console.log('[2] ek ağırlık ayrıştırma ✓');

// --- banka: kare k'nin belleği tüm tokenlarda (k+1)*10, işaretçisi j-indeksli
const kayit = (kare, kosul) => {
  const ozellik = new Float32Array(TOK * MEM).fill((kare + 1) * 10);
  const konum = new Float32Array(TOK * MEM); // 0 → tpos eklenince tpos değeri görünür
  const isaretci = new Float32Array(256);
  for (let j = 0; j < 256; j++) isaretci[j] = kare * 1000 + j;
  return { kare, kosul, ozellik, konum, isaretci };
};
const b = new SamBellek(ek);
assert.equal(b.bos(), true);
b.ekle(kayit(0, true));
assert.equal(b.bos(), false);
for (let k = 1; k <= 9; k++) b.ekle(kayit(k, false));
const g = b.girdi(10);
// uzamsal: koşul karesi 0 (t_pos 0 → tpos[6]) + önceki 6 kare 4..9 (t_pos 1..6 → tpos[5..0])
assert.equal(g.uzamsalUzunluk, 7 * TOK);
const bloklar = [];
for (let i = 0; i < 7; i++) bloklar.push([g.uzamsal[i * TOK * MEM], g.uzamsalKonum[i * TOK * MEM]]);
assert.deepEqual(bloklar, [[10, 7], [50, 6], [60, 5], [70, 4], [80, 3], [90, 2], [100, 1]],
  'sıra: koşul, sonra eskiden yeniye; en yeni kare tpos[0]');
// işaretçi: koşul (pos 10) + t_diff 1..9 (kare 9..1) → 10 işaretçi × 4 token
assert.equal(g.isaretciUzunluk, 10 * 4);
assert.equal(g.isaretci[0], 0); // kare 0, ilk 64'lük parça
assert.equal(g.isaretci[1 * MEM], 64, 'token (p,k) = işaretçi[k*64..]: p*4+k');
assert.equal(g.isaretci[4 * MEM], 9000, 'ikinci işaretçi kare 9 (t_diff 1)');
assert.equal(g.isaretci[39 * MEM + 63], 1000 + 255);
// işaretçi konumu: proj(sinusPe(pos/15)) — x[128]=cos(0)=1 sütunu için pos=0 yok; bias 1000 + o*cos(pos/15)
yakin(g.isaretciKonum[0 * MEM + 5], 1000 + 5 * Math.cos(10 / 15), 1e-3);
yakin(g.isaretciKonum[3 * MEM + 5], 1000 + 5 * Math.cos(10 / 15), 1e-3); // aynı işaretçinin 4 tokenı aynı konum
yakin(g.isaretciKonum[4 * MEM + 5], 1000 + 5 * Math.cos(1 / 15), 1e-3);
console.log('[3] bellek birleştirme (koşul + 6 önceki, 16 işaretçi sınırı) ✓');

// --- boşluklu kareler: yalnız mevcut önceki kareler; budama 16 kareden eskiyi atar
{
  const c = new SamBellek(ek);
  c.ekle(kayit(0, true));
  for (let k = 1; k <= 40; k++) c.ekle(kayit(k, false));
  const h = c.girdi(41);
  assert.equal(h.uzamsalUzunluk, 7 * TOK);
  assert.equal(h.isaretciUzunluk, (1 + 15) * 4, 'koşul + en çok 15 önceki işaretçi');
  assert.ok(c.kayitSayisi() <= 1 + 16, `budama: ${c.kayitSayisi()}`);
  // yeni çapa: en çok `maxKosul` koşul karesi tutulur
  const d = new SamBellek(ek, { maxKosul: 2 });
  for (let k = 0; k < 5; k++) d.ekle(kayit(k * 20, true));
  const e = d.girdi(100);
  assert.equal(e.uzamsalUzunluk, 2 * TOK, 'yalnız son 2 koşul karesi');
  assert.equal(e.uzamsal[0], 610); assert.equal(e.uzamsal[TOK * MEM], 810);
  d.sifirla();
  assert.equal(d.bos(), true);
  console.log('[4] budama ve koşul sınırı ✓');
}

// --- yeniden çapa kuralı (saf): nesne kaybı, alan/ağırlık merkezi sıçraması, IS-Net IoU düşüşü
{
  const temel = { nesneSkoru: 5, alan: 0.2, merkezX: 0.5, merkezY: 0.5 };
  assert.equal(yenidenCapaMi(temel, temel), null);
  assert.equal(yenidenCapaMi({ ...temel, nesneSkoru: -1 }, temel), 'nesne-kayboldu');
  assert.equal(yenidenCapaMi({ ...temel, alan: 0.45 }, temel), 'alan-sicradi');
  assert.equal(yenidenCapaMi({ ...temel, alan: 0.08 }, temel), 'alan-sicradi');
  assert.equal(yenidenCapaMi({ ...temel, alan: 0.26 }, temel), null, '%30 değişim normal hareket');
  assert.equal(yenidenCapaMi({ ...temel, merkezX: 0.75 }, temel), 'merkez-sicradi');
  assert.equal(yenidenCapaMi({ ...temel, merkezX: 0.6 }, temel), null);
  assert.equal(yenidenCapaMi(temel, temel, 0.3), 'isnet-uyusmuyor');
  assert.equal(yenidenCapaMi(temel, temel, 0.8), null);
  assert.equal(yenidenCapaMi(temel, temel, 0.3, 0.25), null, 'eşik ayarlanabilir');
  assert.equal(yenidenCapaMi(temel, null), null, 'önceki kare yoksa sıçrama ölçülmez');
  console.log('[5] yeniden çapa kuralı ✓');
}
console.log('verify-sam-bellek: tamam');
