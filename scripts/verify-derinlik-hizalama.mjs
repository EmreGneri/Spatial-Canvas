// GÖREV 2 (docs/plans/2026-09-27-gezinme-3-geometri.md) — tek-göz derinliğini
// SfM noktalarıyla hizalama (`kareyiHizala`) ve kareler arası tutarlılık
// süzgeci (`tutarlilikSuz`), sentetik bozucu (`tekGozBenzetimi`) üzerinden.
//
// Model YÜKLEMEZ, GPU gerekmez: saf CPU, deterministik.
//   node scripts/verify-derinlik-hizalama.mjs
import assert from 'node:assert/strict';
import { kareyiHizala, tutarlilikSuz } from '../src/engine/reconstruction/derinlikHizalama.ts';
import { kameraOlcekle } from '../src/engine/reconstruction/egitim3dgs.ts';
import { tekGozBenzetimi } from '../src/bench/tekGozBenzetimi.ts';
import { gtDerinlik, mulberry32, yolPozu } from '../src/bench/sentetikSahne.ts';

// ── yardımcılar ───────────────────────────────────────────────────────────

/** `gtDerinlik`'in kullandığı ölçekleme ile aynı (bkz. sentetikSahne.ts). */
function olcekliIcsel(k, w, h) {
  const olcekX = w / k.w;
  const olcekY = h / k.h;
  return { f: k.f * olcekX, fy: (k.fy ?? k.f) * olcekY, cx: k.cx * olcekX, cy: k.cy * olcekY };
}

/** `gtDerinlik`'in piksel/derinlik sözleşmesinin TERSİ: bilinen (px, py, z)
 * (kamera uzayı z, ışın uzunluğu DEĞİL) üçlüsünden dünya noktası üretir.
 * `kareyiHizala`'nın kendi izdüşüm formülüyle (u = f·x/z + cx) tutarlıdır. */
function dunyaNoktasi(k, w, h, px, py, z) {
  const { f, fy, cx, cy } = olcekliIcsel(k, w, h);
  const xc = ((px + 0.5 - cx) / f) * z;
  const yc = ((py + 0.5 - cy) / fy) * z;
  const { R, t } = k;
  const dx = xc - t[0], dy = yc - t[1], dz = z - t[2];
  return [
    R[0] * dx + R[3] * dy + R[6] * dz,
    R[1] * dx + R[4] * dy + R[7] * dz,
    R[2] * dx + R[5] * dy + R[8] * dz,
  ];
}

/** Birkaç GT pozunun derinlik haritasından rastgele piksel örnekleyip dünya
 * noktasına çevirir — "SfM benzeri seyrek nokta bulutu" (tohumlu, deterministik). */
function noktaBulutuUret(poses, w, h, herPozdan, tohum) {
  const rng = mulberry32(tohum);
  const noktalar = [];
  for (const k of poses) {
    const gtZ = gtDerinlik(k, w, h);
    let denenen = 0;
    let eklenen = 0;
    while (eklenen < herPozdan && denenen < herPozdan * 30) {
      denenen++;
      const px = Math.floor(rng() * w);
      const py = Math.floor(rng() * h);
      const z = gtZ[py * w + px];
      if (!Number.isFinite(z) || z <= 0) continue;
      noktalar.push(dunyaNoktasi(k, w, h, px, py, z));
      eklenen++;
    }
  }
  return noktalar;
}

/** Kaba (yanlış üçgenlenmiş) bir SfM noktası: HEDEF kameranın kendi
 * görüntüsünde rastgele bir piksele karşılık gelir (o pikselde disparite
 * haritasının GERÇEK bir okuması vardır), ama derinliği gerçek sahnenin çok
 * altında bir değere (birkaç santim) atanır — `dMetric = 1/z` bu yüzden
 * gerçek kümenin ÇOK ötesine (onlarca kat) fırlar, MAD'in ilk aşamada
 * yakalaması gereken türden bariz bir "üçgenleme patlaması" üretir (bkz.
 * scale.ts'in kendi testindeki "500 + 200*i" tarzı zehirli noktalar — aynı
 * ilke: aykırı dPred'de değil dMetric'te patlar). */
function aykiriNoktaUret(kamera, w, h, tohum) {
  const rng = mulberry32(tohum);
  const px = Math.floor(rng() * w);
  const py = Math.floor(rng() * h);
  const z = 0.01 + rng() * 0.09; // 1-10 cm — gerçek sahne ölçeğinin çok altı
  return dunyaNoktasi(kamera, w, h, px, py, z);
}

function medyan(dizi) {
  const s = dizi.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const W = 240, H = 135;

// ---------------------------------------------------------------------------
// 0. FORMÜL DOĞRULUĞU — sentetik sahneden bağımsız, kontrollü afin: bilinen
//    a,b + gürültüsüz noktalarla `kareyiHizala` a,b'yi TAM olarak geri
//    bulmalı ve `z = 1/(a·d+b)` elemanlı olarak doğru olmalı; `a·d+b ≤ 1e-6`
//    NaN vermeli.
// ---------------------------------------------------------------------------
{
  const w = 100, h = 100;
  const kamera = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], f: 100, cx: 50, cy: 50, w, h };
  const aGercek = 2.0, bGercek = 0.1;
  const noktaSayisi = 25;
  const disparite = new Float32Array(w * h).fill(NaN);
  const noktalar = [];
  for (let i = 0; i < noktaSayisi; i++) {
    const z = 1 + i * (4 / (noktaSayisi - 1)); // 1..5
    const px = 10 + i * 3, py = 50;
    const dPred = (1 / z - bGercek) / aGercek;
    disparite[py * w + px] = dPred;
    noktalar.push(dunyaNoktasi(kamera, w, h, px, py, z));
  }
  // invZ = a·d+b ≤ 1e-6 olacak ayrı bir piksel (d = -b/a → invZ tam 0).
  const naNPx = 5, naNPy = 5;
  disparite[naNPy * w + naNPx] = -bGercek / aGercek;

  const sonuc = kareyiHizala(disparite, w, h, kamera, noktalar);
  assert.ok(sonuc.uydurma, '[0] gürültüsüz uydurma null döndü');
  console.log(`[0] gürültüsüz uydurma: a=${sonuc.uydurma.scaleA.toFixed(6)} (gerçek ${aGercek}) · b=${sonuc.uydurma.scaleB.toFixed(6)} (gerçek ${bGercek})`);
  assert.ok(Math.abs(sonuc.uydurma.scaleA - aGercek) < 1e-6, `[0] scaleA sapması: ${sonuc.uydurma.scaleA}`);
  assert.ok(Math.abs(sonuc.uydurma.scaleB - bGercek) < 1e-6, `[0] scaleB sapması: ${sonuc.uydurma.scaleB}`);
  for (let i = 0; i < noktaSayisi; i++) {
    const z = 1 + i * (4 / (noktaSayisi - 1));
    const px = 10 + i * 3, py = 50;
    const zh = sonuc.derinlik[py * w + px];
    assert.ok(Math.abs(zh - z) / z < 1e-4, `[0] piksel (${px},${py}) derinliği sapmalı: ${zh} != ${z}`);
  }
  assert.ok(Number.isNaN(sonuc.derinlik[naNPy * w + naNPx]), '[0] a·d+b ≤ 1e-6 NaN vermeli');
  console.log('[0] formül doğruluğu (a,b geri kurma + elemanlı z + eşik NaN) ✓');
}

// ---------------------------------------------------------------------------
// 1. DOĞRULUK — sentetik sahne + tekGozBenzetimi bozulmuş disparite:
//    medyan göreli derinlik hatası < %6.
// ---------------------------------------------------------------------------
const kHedef = yolPozu(0.5);
const gtZHedef = gtDerinlik(kHedef, W, H);
const disparite = tekGozBenzetimi(gtZHedef, W, H, 0xabcdef);
const poses = [0.4, 0.45, 0.5, 0.55, 0.6].map(yolPozu);
const noktalar = noktaBulutuUret(poses, W, H, 80, 0x1234);

{
  const sonuc = kareyiHizala(disparite, W, H, kHedef, noktalar);
  assert.ok(sonuc.uydurma, '[1] uydurma null döndü');
  assert.ok(sonuc.kullanilan >= 20, `[1] yetersiz inlier: ${sonuc.kullanilan}`);

  const hatalar = [];
  for (let i = 0; i < W * H; i++) {
    const z = gtZHedef[i], zh = sonuc.derinlik[i];
    if (!Number.isFinite(z) || !Number.isFinite(zh)) continue;
    hatalar.push(Math.abs(zh - z) / z);
  }
  const medyanHata = medyan(hatalar);
  console.log(`[1] medyan göreli derinlik hatası: %${(medyanHata * 100).toFixed(2)} (${hatalar.length}/${W * H} piksel, kullanılan=${sonuc.kullanilan})`);
  assert.ok(hatalar.length > W * H * 0.3, `[1] karşılaştırılabilir piksel çok az: ${hatalar.length}`);
  assert.ok(medyanHata < 0.06, `[1] medyan hata %6'yı aşıyor: ${medyanHata}`);
}

// ---------------------------------------------------------------------------
// 2. DAYANIKLILIK — SfM noktalarının ~%10'u kaba aykırı: sonucu bozmamalı.
// ---------------------------------------------------------------------------
{
  const aykiriSayisi = Math.round(noktalar.length * (0.1 / 0.9));
  const bozukNoktalar = noktalar.slice();
  for (let i = 0; i < aykiriSayisi; i++) bozukNoktalar.push(aykiriNoktaUret(kHedef, W, H, 0x9999 + i));
  const oran = aykiriSayisi / bozukNoktalar.length;

  const sonuc = kareyiHizala(disparite, W, H, kHedef, bozukNoktalar);
  assert.ok(sonuc.uydurma, '[2] aykırılı uydurma null döndü');
  console.log(`[2] %${(oran * 100).toFixed(1)} aykırı (${aykiriSayisi}/${bozukNoktalar.length}): a=${sonuc.uydurma.scaleA.toFixed(4)} · rejected=${sonuc.uydurma.rejected} · inliers=${sonuc.uydurma.inliers}`);

  const hatalar = [];
  for (let i = 0; i < W * H; i++) {
    const z = gtZHedef[i], zh = sonuc.derinlik[i];
    if (!Number.isFinite(z) || !Number.isFinite(zh)) continue;
    hatalar.push(Math.abs(zh - z) / z);
  }
  const medyanHata = medyan(hatalar);
  console.log(`[2] aykırılı medyan göreli hata: %${(medyanHata * 100).toFixed(2)}`);
  assert.ok(medyanHata < 0.06, `[2] %10 aykırı sonucu bozdu: ${medyanHata}`);
}

// ---------------------------------------------------------------------------
// 3. AZ NOKTA — tüm kare NaN olmalı (fit yok ya da inlier < 20).
// ---------------------------------------------------------------------------
{
  const bos = kareyiHizala(disparite, W, H, kHedef, []);
  assert.equal(bos.uydurma, null, '[3a] boş nokta listesi → null uydurma');
  assert.equal(bos.kullanilan, 0, '[3a] boş nokta listesi → kullanilan 0');
  assert.ok([...bos.derinlik].every((v) => Number.isNaN(v)), '[3a] boş nokta listesi → tüm kare NaN');
  console.log('[3a] boş nokta listesi → null uydurma + tüm kare NaN ✓');

  const az = kareyiHizala(disparite, W, H, kHedef, noktalar.slice(0, 10));
  console.log(`[3b] az nokta: uydurma ${az.uydurma ? 'var' : 'yok'} · kullanılan=${az.kullanilan}`);
  assert.ok(az.kullanilan < 20, `[3b] fikstür MIN_INLIERS altında kalmalı: ${az.kullanilan}`);
  assert.ok([...az.derinlik].every((v) => Number.isNaN(v)), '[3b] inlier < 20 → tüm kare NaN');
  console.log('[3b] inlier < 20 → tüm kare NaN ✓');
}

// ---------------------------------------------------------------------------
// 4. NaN — disparite haritasına serpiştirilmiş NaN kırmamalı, o pikseller
//    hem uydurmadan (kaynak olarak) hem de sonuçtan (hedef olarak) elenmeli.
// ---------------------------------------------------------------------------
{
  const disparNaN = disparite.slice();
  for (let i = 0; i < disparNaN.length; i += 7) disparNaN[i] = NaN;
  const sonuc = kareyiHizala(disparNaN, W, H, kHedef, noktalar);
  assert.ok(sonuc.uydurma, '[4] serpiştirilmiş NaN uydurmayı kırdı');
  assert.ok(sonuc.kullanilan >= 20, `[4] serpiştirilmiş NaN sonrası yetersiz inlier: ${sonuc.kullanilan}`);
  let hepsiNaN = true;
  for (let i = 0; i < disparNaN.length; i += 7) if (!Number.isNaN(sonuc.derinlik[i])) hepsiNaN = false;
  assert.ok(hepsiNaN, '[4] NaN disparite pikselleri NaN derinlik vermeli');
  console.log(`[4] NaN serpiştirilmiş disparite: kırılmadan geçti (kullanılan=${sonuc.kullanilan}) ✓`);
}

// ---------------------------------------------------------------------------
// 5. TUTARLILIK SÜZGECI — bilerek bozulan bir yama (%30 derinlik ofseti)
//    reddedilmeli, temiz pikseller %90+ korunmalı.
// ---------------------------------------------------------------------------
{
  const w2 = 160, h2 = 90;
  const olcek2 = w2 / kHedef.w;
  const ts = [0.47, 0.485, 0.5, 0.515, 0.53];
  const kareler = ts.map((t) => {
    const kOrijinal = yolPozu(t);
    return { derinlik: gtDerinlik(kOrijinal, w2, h2), kamera: kameraOlcekle(kOrijinal, olcek2) };
  });
  for (const k of kareler) assert.equal(k.derinlik.length, k.kamera.w * k.kamera.h, '[5] fikstür boyutu tutarsız');

  const corruptIdx = 2;
  const kareCopy = kareler.map((k) => ({ derinlik: k.derinlik.slice(), kamera: k.kamera }));
  const bozukDizi = kareCopy[corruptIdx].derinlik;
  const y0 = Math.floor(h2 * 0.55), y1 = Math.floor(h2 * 0.85);
  const x0 = Math.floor(w2 * 0.35), x1 = Math.floor(w2 * 0.65);
  const yamaSeti = new Set();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * w2 + x;
      if (Number.isFinite(bozukDizi[idx])) {
        bozukDizi[idx] *= 1.3; // bilerek %30 derinlik ofseti
        yamaSeti.add(idx);
      }
    }
  }
  assert.ok(yamaSeti.size > 50, `[5] yama fikstürü çok küçük: ${yamaSeti.size}`);

  const sonuclar = tutarlilikSuz(kareCopy);
  const ciktiBozuk = sonuclar[corruptIdx];

  let reddedilen = 0;
  for (const idx of yamaSeti) if (Number.isNaN(ciktiBozuk[idx])) reddedilen++;
  const reddOrani = reddedilen / yamaSeti.size;
  console.log(`[5] bozuk yama (${yamaSeti.size} px): reddedilen %${(reddOrani * 100).toFixed(1)}`);
  assert.ok(reddOrani > 0.6, `[5] bozuk yama yeterince reddedilmedi: ${reddOrani}`);

  let temizToplam = 0, temizKorunan = 0;
  for (let i = 0; i < bozukDizi.length; i++) {
    if (yamaSeti.has(i)) continue;
    if (!Number.isFinite(bozukDizi[i])) continue;
    temizToplam++;
    if (!Number.isNaN(ciktiBozuk[i])) temizKorunan++;
  }
  const korumaOrani = temizKorunan / temizToplam;
  console.log(`[5] temiz pikseller korunan: %${(korumaOrani * 100).toFixed(1)} (${temizKorunan}/${temizToplam})`);
  assert.ok(korumaOrani >= 0.9, `[5] temiz pikseller %90 altında kaldı: ${korumaOrani}`);

  // ── 6. NaN girişleri asla "diriltilmemeli". ──────────────────────────────
  const kareNaNTest = kareler.map((k) => ({ derinlik: k.derinlik.slice(), kamera: k.kamera }));
  const hedefArr = kareNaNTest[0].derinlik;
  const naNIndeksleri = new Set();
  for (let i = 0; i < 50; i++) {
    const idx = (i * 13) % hedefArr.length;
    hedefArr[idx] = NaN;
    naNIndeksleri.add(idx);
  }
  const ciktiNaN = tutarlilikSuz(kareNaNTest);
  let naNKaldi = true;
  for (const idx of naNIndeksleri) if (!Number.isNaN(ciktiNaN[0][idx])) naNKaldi = false;
  assert.ok(naNKaldi, '[6] önceden NaN olan pikseller NaN kalmalı');
  console.log('[6] önceden-NaN pikseller korunuyor (asla diriltilmiyor) ✓');

  // boyut uyuşmazlığı reddedilmeli (sessiz kayma yok).
  assert.throws(
    () => tutarlilikSuz([{ derinlik: new Float32Array(10), kamera: kareler[0].kamera }]),
    /derinlik\.length/,
    '[6] derinlik/kamera boyut uyuşmazlığı fırlatmalı',
  );
  console.log('[6] boyut uyuşmazlığı fırlatıyor ✓');
}

// ---------------------------------------------------------------------------
// 7. tekGozBenzetimi — determinizm, [0,1] aralığı, sky→0, kenar taşması.
// ---------------------------------------------------------------------------
{
  const d1 = tekGozBenzetimi(gtZHedef, W, H, 777);
  const d2 = tekGozBenzetimi(gtZHedef, W, H, 777);
  assert.deepEqual(d1, d2, '[7] aynı tohum aynı sonucu vermeli');
  const d3 = tekGozBenzetimi(gtZHedef, W, H, 778);
  assert.notDeepEqual(d1, d3, '[7] farklı tohum farklı sonuç vermeli');
  let araliktaMi = true;
  for (const v of d1) if (!(v >= 0 && v <= 1) || !Number.isFinite(v)) araliktaMi = false;
  assert.ok(araliktaMi, '[7] disparite [0,1] aralığında olmalı');
  console.log('[7] tekGozBenzetimi determinizm + [0,1] aralığı ✓');
}
{
  const w3 = 20, h3 = 10;
  const gtZManual = new Float32Array(w3 * h3).fill(Infinity);
  for (let y = 3; y < 7; y++) for (let x = 8; x < 12; x++) gtZManual[y * w3 + x] = 2;
  const dManual = tekGozBenzetimi(gtZManual, w3, h3, 42);

  assert.equal(dManual[0 * w3 + 0], 0, '[7b] nesneden uzak gökyüzü tam 0 olmalı');
  assert.ok(dManual[5 * w3 + 9] > 0, '[7b] nesne içi pozitif disparite vermeli');

  let bulanmisVar = false;
  for (let y = 2; y < 8 && !bulanmisVar; y++) {
    for (let x = 6; x < 14 && !bulanmisVar; x++) {
      const idx = y * w3 + x;
      if (gtZManual[idx] === Infinity && dManual[idx] > 0) bulanmisVar = true;
    }
  }
  assert.ok(bulanmisVar, '[7b] süreksizlik civarında taşma (bleeding) görünmeli');
  console.log('[7b] gökyüzü=0 (normalize öncesi) + kenar taşması ✓');
}

console.log('OK tek-göz derinlik hizalama + tutarlılık süzgeci (Görev 2)');
