// Navigability report summary / comparison (scripts/olcum-rapor.mjs) — pure, no browser.
import assert from 'node:assert/strict';
import { ozetMd, karsilastirmaMd, karsilastirmaHtml } from './olcum-rapor.mjs';

const BOLGELER = ['bas', 'orta', 'son'];
const YONLER = ['sag', 'sol', 'ileri', 'yukari'];

function sonda(bolge, yon, d, m) {
  const id = d === 0 ? `${bolge}_merkez_0.00` : `${bolge}_${yon}_${d.toFixed(2)}`;
  return { id, bolge, yon, d, iyi: true, ...m };
}

function tablo(deger) {
  return Object.fromEntries(BOLGELER.map((b) => [b, Object.fromEntries(YONLER.map((y) => [y, deger(b, y)]))]));
}

/** Small fake report; `gt` toggles GT metrics (psnr/ssim) and `hizalama`. */
function sahteRapor(etiket, { gt = true, kaydir = 0, fazlaSonda = [], eksikSonda = [], sureler } = {}) {
  let sondalar = [];
  for (const bolge of BOLGELER) {
    sondalar.push(sonda(bolge, 'sag', 0, { kaplama: 0.99, keskinlik: 120, ...(gt ? { psnr: 24 + kaydir, ssim: 0.8 } : {}) }));
    for (const yon of YONLER) {
      sondalar.push(sonda(bolge, yon, 0.1, {
        kaplama: 0.95, keskinlik: 80, ...(gt ? { psnr: 20 + kaydir, ssim: 0.7 } : {}), iyi: false,
      }));
    }
  }
  sondalar.push(...fazlaSonda);
  sondalar = sondalar.filter((s) => !eksikSonda.includes(s.id));
  return {
    surum: 1,
    etiket,
    klip: 'sentetik-orman-yolu.webm',
    tarayici: 'HeadlessChrome/140',
    gpu: 'google / swiftshader',
    ayar: { tier: 'quick', maxFrames: 12, maxIters: 200, gpu: 'google / swiftshader', zayifGpu: true, entegreGpu: false, ayrilan: 2, genislik: 640 },
    tur: 'yol',
    birim: 3.5,
    sureler: sureler ?? { kareler: 1200, decode: 300, features: 5000, matching: 4000, seed: 800, egitim: 60000 },
    sfm: { kayitli: 18, toplamKare: 18 },
    gauss: 12000,
    ayrilan: [
      { ad: 'olcum_t1.000.jpg', psnr: 22.5 + kaydir, ssim: 0.71 },
      { ad: 'olcum_t3.000.jpg', psnr: 20.5 + kaydir, ssim: 0.65 },
    ],
    sondalar,
    // orta/sag: bugünkü 0.06, kullanılabilir 0.10 (A) — B shifts kullanılabilir by +0.05 there.
    kullanilabilir: tablo((b, y) => (b === 'orta' && y === 'sag' ? 0.1 + (kaydir ? 0.05 : 0) : b === 'son' && y === 'sol' ? 0.04 - (kaydir ? 0.02 : 0) : 0.02)),
    bugunku: tablo((b, y) => (y === 'sag' || y === 'sol' ? 0.06 : y === 'ileri' ? 0.25 : 0.03)),
    esikler: gt
      ? { olcut: 'gt', ssimDusus: 0.08, psnrDusus: 2 }
      : { olcut: 'gtsiz', keskinlikOrani: 0.6, kaplamaMin: 0.97 },
    ...(gt ? { hizalama: { rms: 0.021, rmsOrani: 0.0015 } } : {}),
    zamanCizelgesi: [{ ms: 0, asama: 'kareler seçiliyor' }],
  };
}

/** Markdown table row whose leading cells are exactly `hucreler`. */
const satir = (...hucreler) => new RegExp(`^\\|\\s*${hucreler.map((h) => h.replace(/[.+*?()[\]\\|]/g, '\\$&')).join('\\s*\\|\\s*')}\\s*\\|`, 'm');

// ── ozetMd ────────────────────────────────────────────────────────────────
const A = sahteRapor('taban');
const ozet = ozetMd(A);
assert.equal(typeof ozet, 'string');
assert.match(ozet, /taban/, 'summary names the label');
assert.match(ozet, /sentetik-orman-yolu\.webm/, 'summary names the clip');
assert.match(ozet, /bugünkü sınır/i, 'region x direction table has a bugünkü sınır column');
assert.match(ozet, /kullanılabilir/i, 'region x direction table has a kullanılabilir column');
for (const b of BOLGELER) {
  for (const y of YONLER) assert.match(ozet, satir(b, y), `row for ${b} x ${y}`);
}
// orta x sag: bugünkü 0.06, kullanılabilir 0.10, then the 0.10 probe's psnr/ssim.
assert.match(ozet, satir('orta', 'sag', '0.06', '0.10', '20.00', '0.700'), 'orta/sag row values');
assert.match(ozet, satir('son', 'ileri', '0.25', '0.02'), 'son/ileri row values');
// Centre probe values per region.
assert.match(ozet, satir('orta', '24.00', '0.800', '0.990'), 'centre probe row for orta');
// Held-out means: psnr (22.5 + 20.5) / 2, ssim (0.71 + 0.65) / 2.
assert.match(ozet, /ortalama/i, 'held-out mean row');
assert.match(ozet, satir('**ortalama**', '21.50', '0.680'), 'held-out means');
// Stage durations in seconds.
assert.match(ozet, satir('features', '5.0'), 'stage duration row (features)');
assert.match(ozet, satir('egitim', '60.0'), 'stage duration row (egitim)');
assert.match(ozet, /0\.0015|0\.15 ?%/, 'alignment rms ratio is shown');

// Without GT: psnr/ssim cells are blank, no alignment line, no throw.
const gtsiz = ozetMd(sahteRapor('gtsiz', { gt: false }));
assert.match(gtsiz, satir('orta', 'sag', '0.06', '0.10', '—', '—', '0.950'), 'no-GT row shows blanks for psnr/ssim');
assert.doesNotMatch(gtsiz, /hizalama rms/i, 'no alignment line without GT');

// ── karsilastirmaMd ───────────────────────────────────────────────────────
const B = sahteRapor('yeni', {
  kaydir: 0.5,
  eksikSonda: ['son_yukari_0.10'],
  fazlaSonda: [sonda('bas', 'ileri', 0.3, { kaplama: 0.9, keskinlik: 50, psnr: 18, ssim: 0.6 })],
  sureler: { kareler: 1000, decode: 300, features: 5000, matching: 4500, seed: 800, egitim: 45000, olcum: 2000 },
});
const kars = karsilastirmaMd(A, B);
assert.match(kars, /taban/, 'comparison names A');
assert.match(kars, /yeni/, 'comparison names B');
// Region x direction: bugünkü A/B/Δ, kullanılabilir A/B/Δ with signed deltas.
assert.match(kars, satir('orta', 'sag', '0.06', '0.06', '+0.00', '0.10', '0.15', '+0.05'), 'kullanılabilir delta is signed +');
assert.match(kars, satir('son', 'sol', '0.06', '0.06', '+0.00', '0.04', '0.02', '-0.02'), 'kullanılabilir delta is signed -');
// Held-out means: psnr 21.50 -> 22.00 (+0.50), ssim unchanged.
assert.match(kars, satir('psnr', '21.50', '22.00', '+0.50'), 'held-out psnr mean delta');
assert.match(kars, satir('ssim', '0.680', '0.680', '+0.000'), 'held-out ssim mean delta');
// Stage durations: egitim 60.0 -> 45.0 s; a stage only in B still listed.
assert.match(kars, satir('egitim', '60.0', '45.0', '-15.0'), 'stage duration delta');
assert.match(kars, satir('olcum', '—', '2.0'), 'stage only in B is listed with a blank A');
// Probe rows: common probe with psnr delta, probes missing on one side marked.
assert.match(kars, satir('orta_sag_0.10', '20.00', '20.50', '+0.50'), 'per-probe psnr delta');
assert.match(kars, /son_yukari_0\.10[^\n]*yok/, 'probe missing in B is marked');
assert.match(kars, /bas_ileri_0\.30[^\n]*yok/, 'probe missing in A is marked');

// ── karsilastirmaHtml ─────────────────────────────────────────────────────
const html = karsilastirmaHtml(A, B, { pngA: '../taban/sentetik/sondalar', pngB: '../yeni/sentetik/sondalar' });
assert.match(html, /^<!doctype html>/i, 'a full HTML document');
const trDe = (id) => {
  const rows = html.split(/<tr[\s>]/).filter((r) => r.includes(`>${id}<`));
  assert.equal(rows.length, 1, `exactly one row for ${id}`);
  return rows[0];
};
const ortak = trDe('orta_sag_0.10');
assert.ok(ortak.includes('<img src="../taban/sentetik/sondalar/orta_sag_0.10.png"'), 'A image in the common row');
assert.ok(ortak.includes('<img src="../yeni/sentetik/sondalar/orta_sag_0.10.png"'), 'B image in the common row');
assert.ok(ortak.includes('<img src="../taban/sentetik/sondalar/orta_sag_0.10_gt.png"'), 'GT image beside them');
assert.ok(ortak.indexOf('../taban/') < ortak.indexOf('../yeni/'), 'A then B, side by side');
const yalnizA = trDe('son_yukari_0.10');
assert.match(yalnizA, /class="eksik"/, 'probe missing in B is marked');
assert.ok(yalnizA.includes('../taban/sentetik/sondalar/son_yukari_0.10.png'), 'A image still shown');
assert.ok(!yalnizA.includes('../yeni/sentetik/sondalar/son_yukari_0.10.png'), 'no B image for a missing probe');
const yalnizB = trDe('bas_ileri_0.30');
assert.match(yalnizB, /class="eksik"/, 'probe missing in A is marked');
assert.ok(!yalnizB.includes('../taban/sentetik/sondalar/bas_ileri_0.30.png'), 'no A image for a missing probe');
assert.ok(yalnizB.includes('../yeni/sentetik/sondalar/bas_ileri_0.30.png'), 'B image still shown');

// Pure: inputs untouched.
assert.deepEqual(A, sahteRapor('taban'), 'ozetMd / karsilastirma do not mutate their input');

console.log('verify-olcum-rapor: OK');
