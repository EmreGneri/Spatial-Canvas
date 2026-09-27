import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  elemandanKameraya, gaussianlariXyzw, gsGorunumIzdusumu, icerikDonusumu, kameradanElemana,
} from '../src/ui/gsKamera.ts';
import { ekranaProjekte, fircaSecimi, kureSecimi } from '../src/ui/splatSecim.ts';
import { egitimKaynagi, EGITIM_GORUNUR_ESIGI, motorKaynagi } from '../src/ui/temizlemeKaynagi.ts';

const yakin = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} (${a} ≠ ${b})`);

/**
 * Bilinen bir COLMAP kamerası: dünya merkezinde, -z'ye BAKMIYOR — COLMAP'te
 * kamera +z'ye bakar. R = birim, t = (0, 0, 4) → dünya merkezi kameradan
 * 4 birim ÖNDE.
 */
const KAM = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 4], f: 500, cx: 320, cy: 240, w: 640, h: 480 };

/* ── KAMERA ÇEVRİMİ ───────────────────────────────────────────────────────── */

// Dünya merkezi tam ana noktaya (cx, cy) düşmeli.
{
  const a = Float32Array.from([0, 0, 0, 1]);
  const e = ekranaProjekte(a, 1, gsGorunumIzdusumu(KAM), KAM.w, KAM.h);
  yakin(e[0], KAM.cx, 1e-3, 'merkez x ana noktada değil');
  yakin(e[1], KAM.cy, 1e-3, 'merkez y ana noktada değil');
  yakin(e[2], 4, 1e-3, 'wClip COLMAP derinliği (z_cam) değil');
}

// Pinhole eşitliği: u = f·x/z + cx, v = fy·y/z + cy — birkaç noktada.
for (const [x, y, z] of [[1, 0, 4], [0, 1, 4], [-0.5, 0.25, 2], [2, -1, 8]]) {
  const a = Float32Array.from([x, y, z, 1]);
  const e = ekranaProjekte(a, 1, gsGorunumIzdusumu(KAM), KAM.w, KAM.h);
  const zc = z + KAM.t[2];
  yakin(e[0], (KAM.f * x) / zc + KAM.cx, 1e-3, `u(${x},${y},${z})`);
  yakin(e[1], (KAM.f * y) / zc + KAM.cy, 1e-3, `v(${x},${y},${z})`);
}

// COLMAP'te y AŞAĞI: dünya +y EKRANDA AŞAĞI gitmeli. (three.js'te tersiydi —
// işaret burada bir kez çevriliyor, iki kez çevrilirse seçim dikey aynalanır
// ve kullanıcı tıkladığının tam simetriğini siler.)
{
  const a = Float32Array.from([0, 0.5, 0, 1, 0, -0.5, 0, 1]);
  const e = ekranaProjekte(a, 2, gsGorunumIzdusumu(KAM), KAM.w, KAM.h);
  assert.ok(e[1] > e[4], 'COLMAP +y ekranda yukarı çıkıyor — dikey ayna hatası');
}

// fy ayrı verilirse kullanılmalı (kare olmayan piksel).
{
  const k = { ...KAM, fy: 250 };
  const a = Float32Array.from([0, 1, 0, 1]);
  const e = ekranaProjekte(a, 1, gsGorunumIzdusumu(k), k.w, k.h);
  yakin(e[1], (250 * 1) / 4 + k.cy, 1e-3, 'fy yok sayılıyor');
}

// KAMERANIN ARKASI seçilemez: COLMAP'te z_cam ≤ 0.
{
  const a = Float32Array.from([0, 0, -6, 1]); // z_cam = -2
  const e = ekranaProjekte(a, 1, gsGorunumIzdusumu(KAM), KAM.w, KAM.h);
  assert.ok(!(e[2] > 0), 'arkadaki nokta önde sayılıyor');
  assert.equal(fircaSecimi(e, a, 1, KAM.w, KAM.h, KAM.cx, KAM.cy, 400, 0.02).length, 0);
}

// DÖNMÜŞ kamera: R ortonormal kaldığı sürece pinhole eşitliği korunmalı.
{
  const c = Math.cos(0.7), s = Math.sin(0.7);
  // y ekseni etrafında dönme (satır sıralı)
  const k = { ...KAM, R: [c, 0, s, 0, 1, 0, -s, 0, c], t: [0.2, -0.1, 5] };
  const p = [0.8, -0.3, 1.1];
  const e = ekranaProjekte(Float32Array.from([...p, 1]), 1, gsGorunumIzdusumu(k), k.w, k.h);
  const xc = k.R[0] * p[0] + k.R[1] * p[1] + k.R[2] * p[2] + k.t[0];
  const yc = k.R[3] * p[0] + k.R[4] * p[1] + k.R[5] * p[2] + k.t[1];
  const zc = k.R[6] * p[0] + k.R[7] * p[1] + k.R[8] * p[2] + k.t[2];
  yakin(e[0], (k.f * xc) / zc + k.cx, 1e-3, 'dönmüş kamerada u');
  yakin(e[1], (k.f * yc) / zc + k.cy, 1e-3, 'dönmüş kamerada v');
  yakin(e[2], zc, 1e-3, 'dönmüş kamerada derinlik');
}

// Küre aracı 3DGS'te de derinliği ayırmalı (aracın VARLIK SEBEBİ).
{
  const a = Float32Array.from([0, 0, -2, 1, 0, 0, 20, 1]); // z_cam 2 ve 24
  const vp = gsGorunumIzdusumu(KAM);
  const e = ekranaProjekte(a, 2, vp, KAM.w, KAM.h);
  yakin(e[0], KAM.cx, 1e-3); yakin(e[3], KAM.cx, 1e-3); // ikisi de merkezde
  assert.equal(fircaSecimi(e, a, 2, KAM.w, KAM.h, KAM.cx, KAM.cy, 30, 0.02).length, 2,
    'fırça iki derinliği de alıyor olmalı (küre bu yüzden var)');
  assert.deepEqual([...kureSecimi(a, 2, [0, 0, -2], 1, 0.02)], [0], 'küre uzaktakini de alıyor');
}

/* ── KADRAJ DÖNÜŞÜMÜ (object-fit: contain) ────────────────────────────────── */

// Daha GENİŞ eleman: yanlarda boşluk, dikeyde tam oturur.
{
  const d = icerikDonusumu(1000, 480, 640, 480);
  yakin(d.olcek, 1, 1e-9, 'ölçek');
  yakin(d.dx, 180, 1e-9, 'yatay boşluk');
  yakin(d.dy, 0, 1e-9, 'dikey boşluk');
}
// Daha DAR eleman: üstte/altta boşluk.
{
  const d = icerikDonusumu(320, 480, 640, 480);
  yakin(d.olcek, 0.5, 1e-9);
  yakin(d.dx, 0, 1e-9);
  yakin(d.dy, 120, 1e-9);
}
// Gidiş-dönüş kayıpsız olmalı: imleç → kamera → imleç.
{
  const d = icerikDonusumu(853, 400, 640, 480);
  for (const [x, y] of [[0, 0], [100, 50], [852, 399]]) {
    const k = elemandanKameraya(d, x, y);
    const g = kameradanElemana(d, k.x, k.y);
    yakin(g.x, x, 1e-6, 'gidiş-dönüş x');
    yakin(g.y, y, 1e-6, 'gidiş-dönüş y');
  }
}
// TEK ölçek: x ve y ayrı ölçeklenseydi fırça dairesi elips olurdu.
{
  const d = icerikDonusumu(1000, 300, 640, 480);
  const a = elemandanKameraya(d, 10, 0);
  const b = elemandanKameraya(d, 0, 10);
  yakin(a.x - elemandanKameraya(d, 0, 0).x, b.y - elemandanKameraya(d, 0, 0).y, 1e-9,
    'yatay ve dikey ölçek farklı — fırça elips olur');
}
// Bozuk ölçü çökertmesin.
for (const arg of [[0, 100, 640, 480], [100, 100, 0, 480], [100, 100, 640, 0]]) {
  const d = icerikDonusumu(...arg);
  assert.ok(Number.isFinite(d.olcek) && d.olcek > 0, `bozuk ölçüde ölçek: ${d.olcek}`);
}

/* ── GAUSSIAN → SEÇİM GİRDİSİ ─────────────────────────────────────────────── */
{
  const n = 3;
  const data = new Float32Array(n * 16);
  const logit = [4, 0, -20]; // canlı, yarı, ÖLÜ (temizle bunu yazıyor)
  for (let i = 0; i < n; i++) {
    data[i * 16] = i; data[i * 16 + 1] = i * 2; data[i * 16 + 2] = i * 3;
    data[i * 16 + 13] = logit[i];
  }
  const xyzw = gaussianlariXyzw(data, n);
  assert.equal(xyzw.length, n * 4, 'stride-4 dizi değil');
  // İNDEKS SIRASI KORUNUR — seçimden çıkan indeks doğrudan temizle()'ye gider.
  for (let i = 0; i < n; i++) {
    assert.deepEqual([xyzw[i * 4], xyzw[i * 4 + 1], xyzw[i * 4 + 2]], [i, i * 2, i * 3], `konum ${i}`);
  }
  yakin(xyzw[3], 1 / (1 + Math.exp(-4)), 1e-6, 'sigmoid uygulanmamış');
  yakin(xyzw[7], 0.5, 1e-6, 'logit 0 → 0.5 değil');
  // ÖLÜ splat arayüzün kapısının ALTINDA olmalı, yoksa silinen geri seçilir.
  assert.ok(xyzw[11] < EGITIM_GORUNUR_ESIGI, `ölü splat (logit -20) kapının üstünde: ${xyzw[11]}`);
  // Kapı, PLY dışa aktarımının ölü eşiğiyle TUTARLI: dışa aktarımın attığı her
  // şey araçta da ölü sayılmalı, canlı hiçbir splat elenmemeli.
  const plyOluAlfa = 1 / 254;
  assert.ok(EGITIM_GORUNUR_ESIGI >= plyOluAlfa * 0.9 && EGITIM_GORUNUR_ESIGI <= plyOluAlfa * 1.5,
    `arayüz kapısı ${EGITIM_GORUNUR_ESIGI} ile PLY ölü eşiği ${plyOluAlfa} ayrışmış`);
  // Seçim, ölü splat'ı ALMAMALI.
  const e = ekranaProjekte(xyzw, n, gsGorunumIzdusumu(KAM), KAM.w, KAM.h);
  const secilen = [...fircaSecimi(e, xyzw, n, KAM.w, KAM.h, KAM.cx, KAM.cy, 9999, EGITIM_GORUNUR_ESIGI)];
  assert.ok(!secilen.includes(2), 'ölü splat yeniden seçiliyor');
}

/* ── EĞİTİM KAYNAĞI DAVRANIŞI ─────────────────────────────────────────────── */

function sahteEgitim(n = 4) {
  const data = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) { data[i * 16] = i; data[i * 16 + 13] = 4; }
  const cagri = { gaussianlar: 0, temizle: 0, geriAl: 0 };
  return {
    cagri,
    data,
    kamera: KAM,
    async gaussianlar() { cagri.gaussianlar++; return { data: data.slice(), n, stride: 16 }; },
    async temizle(idx) {
      cagri.temizle++;
      const eski = idx.map((i) => data[i * 16 + 13]);
      for (const i of idx) data[i * 16 + 13] = -20;
      return { geriAl: async () => { cagri.geriAl++; idx.forEach((i, k) => { data[i * 16 + 13] = eski[k]; }); } };
    },
  };
}

// ÖNBELLEK: fırça her darbede okur; her darbede GPU geri okuması YAPILMAMALI.
{
  const e = sahteEgitim();
  const k = egitimKaynagi(e);
  await k.oku(); await k.oku(); await k.oku();
  assert.equal(e.cagri.gaussianlar, 1, `önbellek yok — ${e.cagri.gaussianlar} kez GPU geri okuması`);
  k.birak();
  await k.oku();
  assert.equal(e.cagri.gaussianlar, 2, 'birak() önbelleği bırakmıyor');
}

// SİLME: oturuma gider, önbellek YERİNDE güncellenir (yeni geri okuma yok).
{
  const e = sahteEgitim();
  const k = egitimKaynagi(e);
  const once = await k.oku();
  assert.ok(once.xyzw[3] > EGITIM_GORUNUR_ESIGI);
  const geri = await k.sil(Int32Array.from([0, 2]));
  assert.equal(e.cagri.temizle, 1);
  assert.equal(geri.adet, 2);
  const sonra = await k.oku();
  assert.equal(e.cagri.gaussianlar, 1, 'silmeden sonra gereksiz GPU geri okuması');
  assert.equal(sonra.xyzw[3], 0, 'önbellekte silinen hâlâ canlı — sayaç yalan söyler');
  assert.equal(sonra.xyzw[11], 0);
  assert.ok(sonra.xyzw[7] > EGITIM_GORUNUR_ESIGI, 'seçilmeyen splat da silinmiş');
  // GERİ ALMA önbelleği DÜŞÜRMELİ: gerçek opaklıklar oturumda, kopyada değil.
  await geri.geriAl();
  assert.equal(e.cagri.geriAl, 1);
  const geriSonrasi = await k.oku();
  assert.equal(e.cagri.gaussianlar, 2, 'geri almadan sonra önbellek tazelenmiyor');
  assert.ok(geriSonrasi.xyzw[3] > EGITIM_GORUNUR_ESIGI, 'geri alma sonrası splat ölü kalmış');
}

// Boş seçim oturuma hiç gitmemeli.
{
  const e = sahteEgitim();
  assert.equal(await egitimKaynagi(e).sil(new Int32Array(0)), null);
  assert.equal(e.cagri.temizle, 0, 'boş seçim için oturum çağrılıyor');
}

// Kadraj kameranın KENDİ ölçüsünden gelmeli (intrinsics o ölçekte).
{
  const k = egitimKaynagi(sahteEgitim());
  const kare = k.kare();
  assert.equal(kare.en, KAM.w);
  assert.equal(kare.boy, KAM.h);
  assert.equal(kare.vp.length, 16);
}

/* ── MOTOR KAYNAĞI: eski davranış korunuyor ───────────────────────────────── */
{
  const a = Float32Array.from([0, 0, -2, 1, 1, 1, -3, 0.6]);
  let islendi = 0;
  const motor = {
    gaussianSnapshot: () => ({ a, count: 2 }),
    splatViewProjection: () => new Float32Array(16),
    commitSplatOpacity: () => { islendi++; },
    splatOpacityThreshold: 0.02,
  };
  const k = motorKaynagi(motor, () => ({ en: 800, boy: 500 }));
  assert.equal(k.esik(), 0.02, 'eşik motordan gelmiyor');
  assert.deepEqual(k.kare().en, 800);
  const geri = await k.sil(Int32Array.from([0]));
  assert.equal(a[3], 0, 'motor yolunda silme yerinde yazmıyor');
  assert.equal(islendi, 1, 'commitSplatOpacity çağrılmadı — silinen çizilmeye devam eder');
  await geri.geriAl();
  assert.equal(a[3], 1, 'geri alma eski opaklığı döndürmüyor');
  assert.equal(islendi, 2);
  // Zaten ölü seçim null döner (geçmişe boş adım eklenmesin).
  a[3] = 0;
  assert.equal(await k.sil(Int32Array.from([0])), null);
}

/* ── SÖZLEŞME DENETİMİ ────────────────────────────────────────────────────── */
const ui = readFileSync(new URL('../src/ui/SplatTemizleme.tsx', import.meta.url), 'utf8');
const uiKod = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// Araç kaynağı SOYUT görmeli: motora doğrudan bağlanırsa 3DGS yolu kopar.
assert.ok(!/gaussianSnapshot|splatViewProjection|commitSplatOpacity/.test(uiKod),
  'araç hâlâ motora doğrudan bağlı — 3DGS yolu çalışmaz');
assert.match(uiKod, /kaynak\.ad/, 'hangi sahnede olunduğu şeritte yazmıyor');
// Toplu geri alma TERS SIRADA olmalı: oturum başka sırayı reddediyor.
const toplu = uiKod.slice(uiKod.indexOf('function tumunuGeriAl'), uiKod.indexOf('const secimVar'));
assert.match(toplu, /gecmisRef\.current\[gecmisRef\.current\.length - 1\]/, 'toplu geri alma ters sırada değil');
// Jeton reddederse hata YUTULMAMALI ve jeton yığından düşmeli.
assert.match(uiKod, /setHata\(/, 'kaynak hatası kullanıcıya gösterilmiyor');
// Oturum eşzamanlı çağrıyı reddediyor: düğmeler kilitlenmeli.
assert.match(uiKod, /disabled=\{!secimVar \|\| mesgul\}/, 'silme düğmesi işlem sırasında kilitlenmiyor');

const egitim = readFileSync(new URL('../src/ui/Egitim3D.tsx', import.meta.url), 'utf8');
// Jetonlar devamEt ve kapat sonrası geçersiz: araç ikisinde de kapanmalı.
const devam = egitim.slice(egitim.indexOf('function devamEt'), egitim.indexOf('const yuzde'));
assert.match(devam, /setTemizleAcik\(false\)/, 'devamEt sonrası araç açık kalıyor — jetonlar geçersiz');
assert.ok((egitim.match(/temizleKaynakRef\.current = null/g) ?? []).length >= 2,
  'kaynak hem devamEt hem oturum kapanışında bırakılmıyor');
// Temizleme .ply'den ÖNCE gelmeli (floater çıktı alınmadan ayıklanır).
// (PLY düğmesinin KENDİSİ aranır; `.ply indirildi` log satırı daha yukarıda
// geçtiği için düz `indexOf('.ply indir')` yanlış yeri buluyordu.)
const plyDugmesi = egitim.indexOf("'PLY hazırlanıyor…' : '.ply indir'");
assert.ok(plyDugmesi > 0, 'PLY düğmesi bulunamadı');
assert.ok(egitim.indexOf('⌫ temizle') < plyDugmesi,
  'temizleme düğmesi .ply’den sonra — kullanıcı kirli çıktıyı önce alır');
// DAR PENCERE: serit sarmalı, yoksa düğmeler kadraj dışına taşar.
const seritStili = egitim.slice(egitim.indexOf('const serit: CSSProperties'), egitim.indexOf('const seritDurum'));
assert.match(seritStili, /flexWrap: 'wrap'/, 'eğitim şeridi sarmıyor — dar pencerede düğmeler taşar');

console.log('verify-gs-temizleme: OK · COLMAP izdüşümü, contain kadrajı, sigmoid/indeks, önbellek+geri alma, 2 kaynak');
