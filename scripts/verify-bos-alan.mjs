// Boş alan ızgarası (gezinme parça 3, görev 3): ışın taşıma (3B DDA),
// voksel durumu, işaretli açıklık alanı (Felzenszwalb–Huttenlocher EDT),
// zemin RANSAC'ı ve serbest adım. Saf Node testi — GPU/DOM yok.
// Sentetik orman yolu + analitik GT derinliği (`gtDerinlik`) ile doğrulanır.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  aciklik, aciklikAt, bosAlanKur, durum, edt3B, serbestAdim, vokselDurumu, zeminBul,
} from '../src/engine/reconstruction/bosAlan.ts';
import { kameraMerkezi } from '../src/engine/reconstruction/egitim3dgs.ts';
import {
  PATIKA_YARI_GENISLIK, VARSAYILAN_TOHUM, YUKARI, ZEMIN_Y,
  engelUzakligi, gtDerinlik, isinKes, mulberry32, sahneTanimi, yolPozu,
} from '../src/bench/sentetikSahne.ts';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} != ${b} (eps ${eps})`);
const topla = (a) => a.reduce((s, x) => s + x, 0);
const idx = (alan, ix, iy, iz) => ix + alan.boyut[0] * (iy + alan.boyut[1] * iz);

// ── 1. voksel sınıflandırma kuralı ──────────────────────────────────────
assert.equal(vokselDurumu(2, 0, 2), 'bos');
assert.equal(vokselDurumu(10, 1, 2), 'bos', 'dolu ≤ 0.1·bos');
assert.equal(vokselDurumu(19, 2, 5), 'dolu', 'dolu > 0.1·bos and dolu ≥ 2');
assert.equal(vokselDurumu(20, 2, 2), 'bos');
assert.equal(vokselDurumu(1, 0, 1), 'bilinmiyor', 'a single ray is not enough');
assert.equal(vokselDurumu(0, 1, 0), 'bilinmiyor');
assert.equal(vokselDurumu(0, 2, 0), 'dolu');
assert.equal(vokselDurumu(0, 0, 0), 'bilinmiyor');
// Farklı kare kanıtı: tek karenin çok geçişi 'bos' yapmaz.
assert.equal(vokselDurumu(40, 0, 1), 'bilinmiyor', 'many crossings from one frame are not enough');
assert.equal(vokselDurumu(40, 5, 1), 'dolu', 'one-frame crossings do not mask a surface');
assert.equal(vokselDurumu(40, 0, 1, 1), 'bos', 'enAzKare = 1 restores the crossing-only rule');
assert.equal(vokselDurumu(40, 0, 2, 3), 'bilinmiyor', 'enAzKare = 3');

// ── 2. EDT: küçük ızgarada kaba kuvvetle birebir ─────────────────────────
{
  const rng = mulberry32(7);
  for (const [nx, ny, nz, oran] of [[7, 5, 6, 0.15], [1, 9, 4, 0.2], [12, 1, 1, 0.1], [4, 4, 4, 0.02]]) {
    const n = nx * ny * nz;
    const engel = new Uint8Array(n);
    for (let i = 0; i < n; i++) engel[i] = rng() < oran ? 1 : 0;
    const d2 = edt3B(engel, [nx, ny, nz]);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let en = Infinity;
      for (let c = 0; c < nz; c++) for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
        if (!engel[a + nx * (b + ny * c)]) continue;
        const q = (a - x) ** 2 + (b - y) ** 2 + (c - z) ** 2;
        if (q < en) en = q;
      }
      assert.equal(d2[x + nx * (y + ny * z)], en, `edt3B ${nx}x${ny}x${nz} at (${x},${y},${z})`);
    }
  }
  const bos = edt3B(new Uint8Array(24), [2, 3, 4]);
  assert.ok(bos.every((v) => v === Infinity), 'no seed anywhere -> Infinity');
}

// ── 3. işaretli açıklık: elle kurulmuş ızgarada kaba kuvvet ─────────────
{
  const [nx, ny, nz] = [6, 5, 4];
  const voksel = 0.5;
  const n = nx * ny * nz;
  const rng = mulberry32(11);
  const alan = {
    min: [1, -2, 3], boyut: [nx, ny, nz], voksel, enAzKare: 2,
    bos: new Uint16Array(n), bosKare: new Uint16Array(n), dolu: new Uint16Array(n),
  };
  for (let i = 0; i < n; i++) {
    const r = rng();
    if (r < 0.65) { alan.bos[i] = 5; alan.bosKare[i] = 2; } // bos
    else if (r < 0.75) { alan.bos[i] = 5; alan.bosKare[i] = 1; } // tek kare: bilinmiyor
    else if (r < 0.85) alan.dolu[i] = 3; // dolu
    // aksi bilinmiyor
  }
  const durumI = (i) => vokselDurumu(alan.bos[i], alan.dolu[i], alan.bosKare[i], alan.enAzKare);
  const serbest = (i) => durumI(i) === 'bos';
  const izgara = aciklik(alan);
  const kosegen = Math.hypot(nx, ny, nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = x + nx * (y + ny * z);
    let en = Infinity;
    for (let c = 0; c < nz; c++) for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
      const j = a + nx * (b + ny * c);
      if (serbest(j) === serbest(i)) continue;
      en = Math.min(en, Math.hypot(a - x, b - y, c - z));
    }
    let beklenen;
    if (serbest(i)) {
      const kenar = Math.min(x + 1, nx - x, y + 1, ny - y, z + 1, nz - z); // ızgara dışı = bilinmiyor
      beklenen = (Math.min(en, kenar) - 0.5) * voksel;
    } else {
      beklenen = -(Math.min(en, kosegen) - 0.5) * voksel;
    }
    near(izgara[i], beklenen, 1e-5, `aciklik at (${x},${y},${z})`);
    // voksel merkezinde trilineer = ızgara değeri
    const p = [alan.min[0] + (x + 0.5) * voksel, alan.min[1] + (y + 0.5) * voksel, alan.min[2] + (z + 0.5) * voksel];
    near(aciklikAt(alan, p, izgara), izgara[i], 1e-5, `aciklikAt at centre (${x},${y},${z})`);
    assert.equal(durum(alan, p), durumI(i), 'durum at voxel centre');
  }
  // İki merkezin tam ortası: trilineer = ortalama.
  const pOrta = [alan.min[0] + 2 * voksel, alan.min[1] + 1.5 * voksel, alan.min[2] + 1.5 * voksel];
  const a0 = izgara[1 + nx * (1 + ny * 1)], a1 = izgara[2 + nx * (1 + ny * 1)];
  near(aciklikAt(alan, pOrta, izgara), (a0 + a1) / 2, 1e-5, 'trilinear midpoint');
  // Varsayılan (önbellekli) ızgara ile aynı.
  near(aciklikAt(alan, pOrta), aciklikAt(alan, pOrta, izgara), 1e-9, 'cached aciklik grid');
  // Izgara dışı: bilinmiyor, ≤ 0 ve uzaklaştıkça azalır.
  const dis1 = aciklikAt(alan, [alan.min[0] - 1, 0, 4], izgara);
  const dis2 = aciklikAt(alan, [alan.min[0] - 2, 0, 4], izgara);
  assert.ok(dis1 <= 0 && dis2 < dis1, `outside the grid clearance must be ≤ 0 and decrease: ${dis1}, ${dis2}`);
  assert.equal(durum(alan, [alan.min[0] - 1, 0, 4]), 'bilinmiyor');
}

// ── 4. DDA: tek ışın, bilinen voksel dizisi ─────────────────────────────
{
  const C = [0.05, 0.05, 0.05];
  const kamera = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [-C[0], -C[1], -C[2]], f: 1, cx: 0.5, cy: 0.5, w: 1, h: 1 };
  const sinir = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 2.0] };
  const secenek = { voksel: 0.1, sinir, adimPx: 1, yukari: [0, -1, 0] };
  const kontrol = (alan, bosZ, doluZ, msg) => {
    assert.deepEqual(alan.boyut, [10, 10, 25], `${msg}: grid size`);
    near(alan.min[2], -0.5, 1e-12, `${msg}: grid min`);
    for (let iz = 0; iz < 25; iz++) for (let iy = 0; iy < 10; iy++) for (let ix = 0; ix < 10; ix++) {
      const i = idx(alan, ix, iy, iz);
      const hat = ix === 5 && iy === 5;
      assert.equal(alan.bos[i], hat && bosZ.includes(iz) ? 1 : 0, `${msg}: bos at (${ix},${iy},${iz})`);
      assert.equal(alan.bosKare[i], alan.bos[i], `${msg}: one frame -> bosKare = bos (${ix},${iy},${iz})`);
      assert.equal(alan.dolu[i], hat && iz === doluZ ? 1 : 0, `${msg}: dolu at (${ix},${iy},${iz})`);
    }
  };
  const aralik = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  // derinlik 1.0: yüzey z = 1.05 (voksel 15), serbest z ≤ 0.95 (vokseller 5..14).
  kontrol(bosAlanKur([{ derinlik: new Float32Array([1.0]), kamera }], secenek), aralik(5, 14), 15, 'finite depth');
  // Kanvas ölçeğinde kamera (2×2) + 1×1 harita: içsel parametreler orantılı ölçeklenir.
  const kanvas = { ...kamera, f: 2, cx: 1, cy: 1, w: 2, h: 2 };
  kontrol(bosAlanKur([{ derinlik: new Float32Array([1.0]), kamera: kanvas }], secenek), aralik(5, 14), 15, 'inferred map size');
  kontrol(bosAlanKur([{ derinlik: new Float32Array([1.0]), kamera: kanvas, w: 1, h: 1 }], secenek), aralik(5, 14), 15, 'explicit map size');
  // Yüzey ızgara dışında: ışın sınıra kadar serbest, dolu yok.
  kontrol(bosAlanKur([{ derinlik: new Float32Array([5.0]), kamera }], secenek), aralik(5, 24), -1, 'surface beyond bounds');
  // Sonsuz: varsayılan hiçbir şey kanıtlamaz; `sonsuzBos` ile sınıra kadar serbest.
  kontrol(bosAlanKur([{ derinlik: new Float32Array([Infinity]), kamera }], secenek), [], -1, 'Infinity, default');
  kontrol(bosAlanKur([{ derinlik: new Float32Array([Infinity]), kamera }], { ...secenek, sonsuzBos: true }), aralik(5, 24), -1, 'Infinity, sonsuzBos');
  // `enUzak`: bundan uzak derinlik "hiçbir şey görmedi" sayılır.
  kontrol(bosAlanKur([{ derinlik: new Float32Array([5.0]), kamera }], { ...secenek, enUzak: 3 }), [], -1, 'beyond enUzak, default');
  // NaN = geçersiz: her durumda atlanır.
  kontrol(bosAlanKur([{ derinlik: new Float32Array([NaN]), kamera }], { ...secenek, sonsuzBos: true }), [], -1, 'NaN');
  kontrol(bosAlanKur([{ derinlik: new Float32Array([-1]), kamera }], secenek), [], -1, 'negative depth');
  // Yüzey kameraya bir vokselden yakın: serbest yok, yalnız dolu.
  kontrol(bosAlanKur([{ derinlik: new Float32Array([0.08]), kamera }], secenek), [], 6, 'surface within one voxel');
  // Sayaçlar doymalı (Uint16): taşma sıfıra dönmez.
  const d = new Float32Array([1.0]);
  const cok = bosAlanKur(Array.from({ length: 70000 }, () => ({ derinlik: d, kamera })), secenek);
  assert.equal(cok.bos[idx(cok, 5, 5, 10)], 65535, 'bos counter saturates');
  assert.equal(cok.dolu[idx(cok, 5, 5, 15)], 65535, 'dolu counter saturates');
  assert.equal(cok.bosKare[idx(cok, 5, 5, 10)], 65535, 'bosKare counter saturates (frame tags wrap safely)');
  // Farklı kare sayımı: 3×3 piksel, hepsi kameranın vokselinden başlar →
  // tek karede o voksel 9 kez geçilir ama tek kare sayılır.
  const k3 = { ...kamera, f: 3, cx: 1.5, cy: 1.5, w: 3, h: 3 };
  const d3 = new Float32Array(9).fill(1.0);
  const cV = idx(cok, 5, 5, 5);
  const tek = bosAlanKur([{ derinlik: d3, kamera: k3 }], secenek);
  assert.equal(tek.bos[cV], 9, 'one frame crosses the camera voxel 9 times');
  assert.equal(tek.bosKare[cV], 1, 'but it is one distinct frame');
  assert.equal(tek.enAzKare, 2, 'default enAzKare');
  assert.equal(durum(tek, C), 'bilinmiyor', 'one frame alone never proves free space');
  const iki = bosAlanKur([{ derinlik: d3, kamera: k3 }, { derinlik: d3, kamera: k3 }], secenek);
  assert.equal(iki.bos[cV], 18);
  assert.equal(iki.bosKare[cV], 2, 'two frames -> bosKare 2');
  assert.equal(durum(iki, C), 'bos', 'two distinct frames prove free space');
  const tekGevsek = bosAlanKur([{ derinlik: d3, kamera: k3 }], { ...secenek, enAzKare: 1 });
  assert.equal(tekGevsek.enAzKare, 1);
  assert.equal(durum(tekGevsek, C), 'bos', 'enAzKare = 1 accepts a single frame');
  // Uyumsuz harita boyutu reddedilir.
  assert.throws(() => bosAlanKur([{ derinlik: new Float32Array(3), kamera: kanvas }], secenek), /boyut|size/i);
}

// ── 5. zeminBul: elle kurulmuş eğik düzlem ──────────────────────────────
{
  const kur = (egimDerece) => {
    const [nx, ny, nz] = [40, 30, 40];
    const alan = {
      min: [0, 0, 0], boyut: [nx, ny, nz], voksel: 0.1, enAzKare: 2,
      bos: new Uint16Array(nx * ny * nz), bosKare: new Uint16Array(nx * ny * nz), dolu: new Uint16Array(nx * ny * nz),
    };
    const e = (egimDerece * Math.PI) / 180;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      // y aşağı; düzlem x yönünde eğik: y = 2 + tan(e)·(x − 2)
      const x = (ix + 0.5) * 0.1;
      const y = 2 + Math.tan(e) * (x - 2);
      const iy = Math.floor(y / 0.1);
      if (iy >= 0 && iy < ny) alan.dolu[ix + nx * (iy + ny * iz)] = 3;
    }
    // Birkaç dikey "gövde" (ayrık destek, düzlem değil).
    for (let iy = 0; iy < 18; iy++) alan.dolu[5 + nx * (iy + ny * 7)] = 3;
    return alan;
  };
  const z10 = zeminBul(kur(10), [0, -1, 0]);
  assert.ok(z10, '10° plane found');
  const aci = (Math.acos(Math.min(1, -z10.n[1])) * 180) / Math.PI;
  near(aci, 10, 1.0, 'tilted plane angle');
  assert.ok(z10.n[1] < 0, 'normal points along yukari');
  near(z10.n[0] * 2 + z10.n[1] * 2 + z10.n[2] * 2 + z10.d, 0, 0.06, 'plane passes through (2,2,2)');
  assert.deepEqual(zeminBul(kur(10), [0, -1, 0]), z10, 'deterministic');
  assert.equal(zeminBul(kur(30), [0, -1, 0]), null, '30° plane is outside the 15° cone');
  const bosAlan0 = kur(0);
  bosAlan0.dolu.fill(0);
  assert.equal(zeminBul(bosAlan0, [0, -1, 0]), null, 'no occupied voxels -> null');
}

// ── 6. sentetik orman yolu: 24 GT pozu, GT derinlik ─────────────────────
const W = 240, H = 135, VOKSEL = 0.1;
const pozlar = Array.from({ length: 24 }, (_, i) => yolPozu(i / 23));
let t0 = performance.now();
const kareler = pozlar.map((kamera) => ({ derinlik: gtDerinlik(kamera, W, H), kamera }));
const gtMs = performance.now() - t0;

t0 = performance.now();
const alan = bosAlanKur(kareler, { voksel: VOKSEL, yukari: YUKARI });
const kurMs = performance.now() - t0;
t0 = performance.now();
const izgara = aciklik(alan);
const aciklikMs = performance.now() - t0;
const [nx, ny, nz] = alan.boyut;
const N = nx * ny * nz;

// Varsayılan sınır kuralı: kameralar ± 0.5·L yatay, 0.3·L yukarı, zemin + 0.2·L aşağı.
{
  const merkezler = pozlar.map(kameraMerkezi);
  let L = 0;
  for (let i = 1; i < merkezler.length; i++) {
    L += Math.hypot(...[0, 1, 2].map((a) => merkezler[i][a] - merkezler[i - 1][a]));
  }
  const ekst = (a, f) => f(...merkezler.map((c) => c[a]));
  const tol = VOKSEL + 1e-9;
  near(alan.min[0], ekst(0, Math.min) - 0.5 * L, tol, 'default bound x min');
  near(alan.min[0] + nx * VOKSEL, ekst(0, Math.max) + 0.5 * L, tol, 'default bound x max');
  near(alan.min[2], ekst(2, Math.min) - 0.5 * L, tol, 'default bound z min');
  near(alan.min[2] + nz * VOKSEL, ekst(2, Math.max) + 0.5 * L, tol, 'default bound z max');
  near(alan.min[1], ekst(1, Math.min) - 0.3 * L, tol, 'default bound top (y down: min y)');
  near(alan.min[1] + ny * VOKSEL, ZEMIN_Y + 0.2 * L, tol, 'default bound bottom = ground + 0.2 L');
}

// Tek kare tek başına hiçbir 'bos' voksel üretmez (yakın vokseller onlarca
// kez geçilse bile); ikinci bir kare eklenince üretir.
{
  // Aynı sınır (varsayılan sınır yol uzunluğuyla ölçeklenir; 1–2 karede küçülürdü).
  const sinir = { min: alan.min, max: [0, 1, 2].map((a) => alan.min[a] + alan.boyut[a] * VOKSEL) };
  const tek = bosAlanKur([kareler[12]], { voksel: VOKSEL, yukari: YUKARI, sinir });
  assert.deepEqual(tek.boyut, alan.boyut);
  let bosSayisi = 0, cokGecis = 0;
  for (let i = 0; i < tek.bos.length; i++) {
    if (vokselDurumu(tek.bos[i], tek.dolu[i], tek.bosKare[i], tek.enAzKare) === 'bos') bosSayisi++;
    if (tek.bos[i] >= 2) cokGecis++;
    assert.ok(tek.bosKare[i] <= 1, 'one frame -> bosKare ≤ 1');
  }
  assert.equal(bosSayisi, 0, 'a single frame alone yields no bos voxels');
  assert.equal(durum(tek, kameraMerkezi(pozlar[12])), 'bilinmiyor', 'not even the camera voxel');
  assert.ok(cokGecis > 10000, `(the frame does cross many voxels ≥ 2 times: ${cokGecis})`);
  const iki = bosAlanKur([kareler[11], kareler[12]], { voksel: VOKSEL, yukari: YUKARI, sinir });
  let ikiBos = 0;
  for (let i = 0; i < iki.bos.length; i++) {
    if (vokselDurumu(iki.bos[i], iki.dolu[i], iki.bosKare[i], iki.enAzKare) === 'bos') ikiBos++;
  }
  assert.ok(ikiBos > 10000, `two frames yield bos voxels (${ikiBos})`);
}

const merkez = (i) => {
  const iz = Math.floor(i / (nx * ny)), r = i - iz * nx * ny, iy = Math.floor(r / nx), ix = r - iy * nx;
  return [alan.min[0] + (ix + 0.5) * VOKSEL, alan.min[1] + (iy + 0.5) * VOKSEL, alan.min[2] + (iz + 0.5) * VOKSEL];
};

// Hızlı GT engel uzaklığı (engelUzakligi ile aynı formül, düz dizi üzerinde).
const sahne = sahneTanimi(VARSAYILAN_TOHUM);
const govdeler = sahne.nesneler.filter((n) => n.tur === 'govde');
const caliler = sahne.nesneler.filter((n) => n.tur === 'cali');
const hizliEngel = (p) => {
  let en = ZEMIN_Y - p[1];
  for (const g of govdeler) {
    const dx = p[0] - g.x, dz = p[2] - g.z;
    const d = Math.sqrt(dx * dx + dz * dz) - g.r;
    if (d < en) en = d;
  }
  for (const c of caliler) {
    const dx = p[0] - c.x, dy = p[1] - c.y, dz = p[2] - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - c.r;
    if (d < en) en = d;
  }
  return en;
};
{
  const rng = mulberry32(3);
  for (let k = 0; k < 500; k++) {
    const p = [rng() * 16 - 8, rng() * 6 - 4, rng() * 30 - 5];
    near(hizliEngel(p), engelUzakligi(p), 1e-9, 'fast GT distance matches engelUzakligi');
  }
}

// Sayımlar (`nBosTekKare`: farklı-kare şartı olmadan, yalnız karşılaştırma için).
let nBos = 0, nDolu = 0, nIyi = 0, enKotu = Infinity, nBosTekKare = 0;
for (let i = 0; i < N; i++) {
  if (vokselDurumu(alan.bos[i], alan.dolu[i], alan.bosKare[i], 1) === 'bos') nBosTekKare++;
  const s = vokselDurumu(alan.bos[i], alan.dolu[i], alan.bosKare[i], alan.enAzKare);
  if (s === 'dolu') nDolu++;
  if (s !== 'bos') continue;
  nBos++;
  const e = hizliEngel(merkez(i));
  if (e > -VOKSEL) nIyi++;
  if (e < enKotu) enKotu = e;
}
const iyiOran = nIyi / nBos;
assert.ok(nBos > 50000, `enough free voxels (${nBos})`);
assert.ok(iyiOran >= 0.99, `≥ 99% of 'bos' voxels outside GT obstacles by > −voxel: ${(iyiOran * 100).toFixed(3)}%`);

// Patika şeridinin ortası 'bos'.
{
  let n = 0;
  for (let z = 4; z <= 13.5 + 1e-9; z += 0.25) {
    for (const y of [-0.3, 0, 0.5, 1.0]) {
      for (const x of [-0.3, 0, 0.3]) {
        assert.equal(durum(alan, [x, y, z]), 'bos', `path strip (${x}, ${y}, ${z.toFixed(2)}) must be 'bos'`);
        n++;
      }
    }
  }
  assert.ok(n > 400);
  assert.ok(Math.abs(0.3) < PATIKA_YARI_GENISLIK);
}

// Gövde içleri (yüzeyden ≥ 1 voksel içeride): hiçbiri 'bos' değil.
let govdeIci = 0, govdeIciDolu = 0;
for (const g of govdeler) {
  const ar = (a, c) => [
    Math.max(0, Math.floor((c - g.r - alan.min[a]) / VOKSEL)),
    Math.min(alan.boyut[a] - 1, Math.floor((c + g.r - alan.min[a]) / VOKSEL)),
  ];
  const [x0, x1] = ar(0, g.x), [z0, z1] = ar(2, g.z);
  for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
    const px = alan.min[0] + (ix + 0.5) * VOKSEL, pz = alan.min[2] + (iz + 0.5) * VOKSEL;
    if (Math.hypot(px - g.x, pz - g.z) >= g.r - VOKSEL) continue;
    for (let iy = 0; iy < ny; iy++) {
      const py = alan.min[1] + (iy + 0.5) * VOKSEL;
      if (py >= ZEMIN_Y) break;
      const i = idx(alan, ix, iy, iz);
      govdeIci++;
      const s = vokselDurumu(alan.bos[i], alan.dolu[i], alan.bosKare[i], alan.enAzKare);
      assert.notEqual(s, 'bos', `trunk interior voxel at (${[px, py, pz].map((v) => v.toFixed(2))}) is 'bos'`);
      if (s === 'dolu') govdeIciDolu++;
    }
  }
}
assert.ok(govdeIci > 1000, `trunk interior sample is not vacuous (${govdeIci})`);

// Zemin düzlemi.
t0 = performance.now();
const zemin = zeminBul(alan, YUKARI);
const zeminMs = performance.now() - t0;
assert.ok(zemin, 'ground plane found');
const zeminAci = (Math.acos(Math.min(1, zemin.n[0] * YUKARI[0] + zemin.n[1] * YUKARI[1] + zemin.n[2] * YUKARI[2])) * 180) / Math.PI;
assert.ok(zeminAci <= 2, `ground normal within 2° of YUKARI: ${zeminAci.toFixed(3)}°`);
const zeminY = -(zemin.d + zemin.n[0] * 0 + zemin.n[2] * 7) / zemin.n[1]; // düzlemin (x=0, z=7)'deki y'si
near(zeminY, ZEMIN_Y, VOKSEL, 'ground height');
assert.ok(zemin.destek > 1000, `ground support (${zemin.destek})`);

// ── 7. serbestAdim ──────────────────────────────────────────────────────
const YARICAP = 0.3;
const esit = (a, b, msg) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-12, `${msg}: ${a} != ${b}`);

// Patika boyunca ileri yürüyüş serbest (10 cm adımlar, GT kamera yolu).
{
  let adim = 0;
  for (let s = 0.2; s < 0.9; s += 0.1 / 14) {
    const C = kameraMerkezi(yolPozu(s));
    const hedef = kameraMerkezi(yolPozu(s + 0.1 / 14));
    esit(serbestAdim(alan, izgara, C, hedef, YARICAP), hedef, `forward step at s=${s.toFixed(3)}`);
    adim++;
  }
  assert.ok(adim > 90);
  // Tek büyük ileri adım da serbest (yol boyu 2 m).
  const C = [0, 0, 4], hedef = [0, 0, 6];
  esit(serbestAdim(alan, izgara, C, hedef, YARICAP), hedef, 'long forward step');
}

// Bir gövdeye doğru yürüyüş: gövde yüzeyinin `yaricap` önünde durur.
// (a) Görüş hattı: bir GT kamerasından, ilk kesişimi bu gövde olan ve
//     yolunda başka engel 0.6 m'den yakın olmayan her (gövde, kamera) çifti;
//     durma noktası yüzeye `yaricap`tan yakın değil ama gereksiz erken de değil.
// (b) Yandan: patika ortasından (x = 0) gövde merkezine yatay yürüyüş; arada
//     başka engel ya da bilinmeyen olabilir, yalnız GT ihlali yok denetlenir.
const govdeUzak = (p, g) => Math.hypot(p[0] - g.x, p[2] - g.z) - g.r;
const yakinGovdeler = govdeler
  .filter((g) => g.r >= 0.15 && g.z >= 4 && g.z <= 14 && Math.abs(g.x) <= 4)
  .sort((a, b) => a.z - b.z || a.x - b.x);
let hatSayisi = 0, hatAcik = 0, hatEnYakin = Infinity, hatEnUzak = 0, yanSayisi = 0, yanEnYakin = Infinity;
for (const g of yakinGovdeler) {
  for (let i = 1; i < pozlar.length; i++) {
    const C = kameraMerkezi(pozlar[i]);
    if (C[2] > g.z - 1.5 || C[2] < g.z - 8) continue;
    const hedef = [g.x, C[1], g.z];
    const yon = [hedef[0] - C[0], hedef[1] - C[1], hedef[2] - C[2]];
    // Gövde merkezi bu kameranın görüntüsünde mi?
    const k = pozlar[i];
    const zc = k.R[6] * yon[0] + k.R[7] * yon[1] + k.R[8] * yon[2];
    const xc = k.R[0] * yon[0] + k.R[1] * yon[1] + k.R[2] * yon[2];
    if (zc <= 0 || Math.abs((k.f * xc) / zc) > k.cx * 0.9) continue;
    // İlk kesişim bu gövde mi?
    const tHit = isinKes(C, yon);
    const L = Math.hypot(...yon);
    const P = [0, 1, 2].map((a) => C[a] + (yon[a] / L) * tHit);
    if (Math.abs(govdeUzak(P, g)) > 1e-6) continue;
    // Görüş hattı boyunca başka engele en yakın GT uzaklığı.
    let baskaEn = Infinity;
    for (let s = 0; s <= 1; s += 0.01) {
      const q = [0, 1, 2].map((a) => C[a] + s * (P[a] - C[a]));
      const e = hizliEngel(q);
      if (e < govdeUzak(q, g) - 1e-9) baskaEn = Math.min(baskaEn, e);
    }
    const S = serbestAdim(alan, izgara, C, hedef, YARICAP);
    const bosluk = govdeUzak(S, g);
    const ad = `trunk (${g.x.toFixed(2)}, ${g.z.toFixed(2)}, r ${g.r.toFixed(2)}) from camera ${i}`;
    assert.ok(bosluk >= YARICAP, `${ad}: stop must be ≥ yaricap from the trunk surface: ${bosluk.toFixed(3)}`);
    assert.ok(hizliEngel(S) >= YARICAP, `${ad}: stop must be ≥ yaricap from every GT obstacle`);
    hatSayisi++;
    // Koridor ≥ 0.8 m açıksa (komşu nesnelerin görüş gölgesi `yaricap`
    // topuna girmez) gereksiz erken de durmaz.
    if (baskaEn >= 0.8) {
      assert.ok(bosluk <= YARICAP + 0.35, `${ad}: stop should get reasonably close: ${bosluk.toFixed(3)}`);
      hatAcik++;
      hatEnYakin = Math.min(hatEnYakin, bosluk);
      hatEnUzak = Math.max(hatEnUzak, bosluk);
    }
  }
  const C = [0, 0, g.z];
  const S = serbestAdim(alan, izgara, C, [g.x, 0, g.z], YARICAP);
  assert.ok(hizliEngel(S) >= YARICAP, `lateral walk to trunk (${g.x.toFixed(2)}, ${g.z.toFixed(2)}) keeps yaricap: ${hizliEngel(S).toFixed(3)}`);
  assert.ok(govdeUzak(S, g) >= YARICAP);
  yanSayisi++;
  yanEnYakin = Math.min(yanEnYakin, hizliEngel(S));
}
assert.ok(hatSayisi >= 10, `enough line-of-sight trunk approaches (${hatSayisi})`);
assert.ok(hatAcik >= 5, `enough clear-corridor trunk approaches (${hatAcik})`);
assert.ok(yanSayisi >= 5, `enough lateral trunk approaches (${yanSayisi})`);

// Patikadan yana, gözlenmemiş alana yürüyüş durdurulur.
{
  const C = [0, 0, 3];
  for (const hedef of [[5, 0, 3], [-5, 0, 3]]) {
    assert.notEqual(durum(alan, hedef), 'bos', `lateral target ${hedef} is unobserved`);
    const S = serbestAdim(alan, izgara, C, hedef, YARICAP);
    assert.ok(Math.abs(S[0]) < 3, `lateral move to ${hedef} must stop early: ${S}`);
    assert.equal(durum(alan, S), 'bos', 'stop point is free');
    assert.ok(aciklikAt(alan, S, izgara) >= YARICAP - 1e-9, 'stop point keeps the clearance');
    assert.ok(hizliEngel(S) > 0, 'stop point is outside GT obstacles');
  }
}

// C zaten izinli kümenin dışındaysa: yalnız açıklığı azaltmayan hareket.
{
  const C = [5, 0, 3];
  const c0 = aciklikAt(alan, C, izgara);
  assert.ok(c0 < 0, `unobserved start has negative clearance (${c0})`);
  const derin = serbestAdim(alan, izgara, C, [6, 0, 3], YARICAP);
  assert.ok(Math.hypot(derin[0] - C[0], derin[1] - C[1], derin[2] - C[2]) < 0.05, `moving deeper into unknown is refused: ${derin}`);
  const geri = serbestAdim(alan, izgara, C, [0, 0, 3], YARICAP);
  assert.ok(geri[0] < 4, `moving back toward the path is allowed: ${geri}`);
  assert.ok(aciklikAt(alan, geri, izgara) >= c0, 'recovery never lowers clearance');
}

console.log(
  `grid ${nx}x${ny}x${nz} (${(N / 1e6).toFixed(2)}M voxels) · bos ${nBos} (${nBosTekKare} without the 2-frame rule) · dolu ${nDolu}\n`
  + `bos with GT distance > −voxel: ${(iyiOran * 100).toFixed(3)}% (worst ${enKotu.toFixed(3)} m)\n`
  + `trunk-interior voxels: ${govdeIci} (none bos; dolu ${govdeIciDolu})\n`
  + `ground: normal ${zeminAci.toFixed(3)}° from YUKARI, y ${zeminY.toFixed(3)} (GT ${ZEMIN_Y}), support ${zemin.destek}\n`
  + `trunk approaches (yaricap ${YARICAP}): ${hatSayisi} line-of-sight (${hatAcik} clear-corridor stop ${hatEnYakin.toFixed(3)}…${hatEnUzak.toFixed(3)} m from surface); ${yanSayisi} lateral, min GT clearance ${yanEnYakin.toFixed(3)} m\n`
  + `timing: gtDerinlik 24×${W}x${H} ${gtMs.toFixed(0)}ms · bosAlanKur ${kurMs.toFixed(0)}ms · aciklik ${aciklikMs.toFixed(0)}ms · zeminBul ${zeminMs.toFixed(0)}ms`,
);
console.log('bos alan: OK');
