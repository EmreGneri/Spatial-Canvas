// Kamera tohumlu erişilebilir boş alan: `erisilebilirAlan` (bosAlan.ts) ve
// serbest gezinmede "erişilebilir bölgenin içinde" kısıtı.
import assert from 'node:assert/strict';
import { aciklik, bosAlanKur, erisilebilirAlan, serbestAdim, vokselIndeksi, vokselDurumuAt } from '../src/engine/reconstruction/bosAlan.ts';
import { kameraMerkezi } from '../src/engine/reconstruction/egitim3dgs.ts';
import { bosAlanSiniri, flySiniri, flyStepBirlesik } from '../src/ui/egitimControls.ts';
import { YUKARI, engelUzakligi, gtDerinlik, yolPozu } from '../src/bench/sentetikSahne.ts';

const makeGrid = (n) => {
  const t = n ** 3;
  const g = { min: [0, 0, 0], boyut: [n, n, n], voksel: 1,
    bos: new Uint16Array(t).fill(3), bosKare: new Uint16Array(t).fill(3), dolu: new Uint16Array(t), enAzKare: 2 };
  return g;
};
const at = (g, x, y, z) => x + g.boyut[0] * (y + g.boyut[1] * z);
const block = (g, x, y, z) => { const i = at(g, x, y, z); g.bos[i] = 0; g.bosKare[i] = 0; g.dolu[i] = 3; };
const say = (m) => m.reduce((s, v) => s + v, 0);

// 1. Duvar iki odayı ayırır: tohum yalnız kendi odasını doldurur.
{
  const g = makeGrid(20);
  for (let y = 0; y < 20; y++) for (let z = 0; z < 20; z++) block(g, 10, y, z);
  const m = erisilebilirAlan(g, [[5.5, 10.5, 10.5]], 0);
  assert.equal(m[at(g, 5, 10, 10)], 1, 'seed room reachable');
  assert.equal(m[at(g, 15, 10, 10)], 0, 'room behind the wall is not');
  assert.equal(m[at(g, 10, 10, 10)], 0, 'occupied voxel never reachable');
  assert.equal(say(m), 10 * 20 * 20, 'exactly the left room');
  // İki tohum iki odayı birleştirir.
  assert.equal(say(erisilebilirAlan(g, [[5.5, 10.5, 10.5], [15.5, 10.5, 10.5]], 0)), 19 * 20 * 20);
}

// 2. Duvardaki delik: güvenlik payından genişse geçilir, darsa geçilmez.
{
  const g = makeGrid(21);
  for (let y = 0; y < 21; y++) for (let z = 0; z < 21; z++) {
    if (Math.abs(y - 10) <= 2 && Math.abs(z - 10) <= 2) continue; // 5×5 delik
    block(g, 10, y, z);
  }
  const seed = [[5.5, 10.5, 10.5]];
  const genis = erisilebilirAlan(g, seed, 1.5);
  assert.equal(genis[at(g, 15, 10, 10)], 1, '5-voxel hole passes a 1.5-voxel margin');
  const dar = erisilebilirAlan(g, seed, 3);
  assert.equal(dar[at(g, 15, 10, 10)], 0, 'same hole blocks a 3-voxel margin');
  // Pay ≥ açıklık: sonuç her zaman açıklık eşiğini geçen 'bos' vokseller.
  const ac = aciklik(g);
  for (let i = 0; i < dar.length; i++) if (dar[i]) assert.ok(vokselDurumuAt(g, i) === 'bos' && ac[i] >= 3);
}

// 3. Tohum vokseli izinli değilse kendisi işaretlenmez ama komşulara açılır
//    (kamera tanımı gereği boşluktadır); ızgara dışı tohum yok sayılır.
{
  const g = makeGrid(10);
  block(g, 5, 5, 5);
  const m = erisilebilirAlan(g, [[5.5, 5.5, 5.5], [-3, 0, 0]], 0);
  assert.equal(m[at(g, 5, 5, 5)], 0, 'non-free seed voxel is not marked');
  assert.equal(say(m), 999, 'but the free space around it is');
  assert.equal(say(erisilebilirAlan(g, [[-3, 0, 0]], 0)), 0, 'outside seeds are ignored');
}

// 4. serbestAdim + maske: erişilebilir olmayan (bağlantısız) bir boş
//    kabarcıkta başlayan hareket durur; erişilebilir bölgede aynen ilerler.
{
  const g = makeGrid(20);
  for (let y = 0; y < 20; y++) for (let z = 0; z < 20; z++) block(g, 10, y, z);
  const ac = aciklik(g);
  const m = erisilebilirAlan(g, [[3.5, 10.5, 10.5]], 0.5);
  const kabarcik = [15.5, 10.5, 10.5], hedef = [17.5, 10.5, 10.5];
  assert.deepEqual(serbestAdim(g, ac, kabarcik, hedef, 0.5), hedef, 'without mask the bubble is walkable');
  assert.deepEqual(serbestAdim(g, ac, kabarcik, hedef, 0.5, m), kabarcik, 'with mask an unreachable start stays');
  assert.deepEqual(serbestAdim(g, ac, [3.5, 10.5, 10.5], [6.5, 10.5, 10.5], 0.5, m), [6.5, 10.5, 10.5], 'reachable motion unchanged');

  // flyStep katmanı: bosAlanSiniri tohumlarla maskeyi kurar ve uygular.
  const sinir = bosAlanSiniri(g, 10, 0.05, [[3.5, 10.5, 10.5]]);
  assert.ok(sinir.erisilebilir && sinir.erisilebilir[at(g, 3, 10, 10)] === 1, 'bound carries the reachable mask');
  assert.equal(bosAlanSiniri(g, 10, 0.05).erisilebilir, undefined, 'no seeds → no mask (old behaviour)');
  const cam = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: kabarcik.map((v) => -v), f: 100, cx: 50, cy: 50, w: 100, h: 100 };
  const hacim = flySiniri([[3.5, 10.5, 10.5], [17.5, 10.5, 10.5]], [10, 10, 10], 'yol');
  const moved = flyStepBirlesik(cam, { forward: 0, right: 1, vertical: 0 }, 2, hacim, [0, 1, 0], sinir);
  assert.deepEqual(kameraMerkezi(moved), kabarcik, 'fly step refuses to wander an unreachable bubble');
}

// 5. Sentetik orman yolu (GT): erişilebilir bölge açıklık kümesinin alt
//    kümesi, kameraları içerir ve GT engel ihlali artmaz.
{
  const pozlar = Array.from({ length: 24 }, (_, i) => yolPozu(i / 23));
  const alan = bosAlanKur(pozlar.map((kamera) => ({ derinlik: gtDerinlik(kamera, 240, 135), kamera })),
    { voksel: 0.1, yukari: YUKARI });
  const ac = aciklik(alan);
  const yaricap = 0.15;
  const cams = pozlar.map(kameraMerkezi);
  const m = erisilebilirAlan(alan, cams, yaricap, ac);
  const [nx, ny] = alan.boyut;
  let acikSay = 0, acikIhlal = 0, erSay = 0, erIhlal = 0;
  for (let i = 0; i < m.length; i++) {
    const izinli = vokselDurumuAt(alan, i) === 'bos' && ac[i] >= yaricap;
    if (m[i]) assert.ok(izinli, 'reachable ⊆ clearance set');
    if (!izinli) continue;
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
    const p = [0, 1, 2].map((a) => alan.min[a] + ([x, y, z][a] + 0.5) * alan.voksel);
    const ihlal = engelUzakligi(p) < -alan.voksel;
    acikSay++; if (ihlal) acikIhlal++;
    if (m[i]) { erSay++; if (ihlal) erIhlal++; }
  }
  const kamerali = cams.filter((c) => m[vokselIndeksi(alan, c)]).length;
  assert.ok(kamerali >= cams.length / 2, `most camera voxels reachable (${kamerali}/${cams.length})`);
  assert.ok(erSay > 0 && erSay <= acikSay, 'reachable is a non-empty subset');
  assert.ok(erIhlal <= acikIhlal, 'no new GT violations');
  console.log(`  sentetik: açıklık kümesi ${acikSay} (ihlal ${acikIhlal}), erişilebilir ${erSay} (ihlal ${erIhlal}), kamera ${kamerali}/${cams.length}`);
}

console.log('verify-erisilebilir-alan: OK');
