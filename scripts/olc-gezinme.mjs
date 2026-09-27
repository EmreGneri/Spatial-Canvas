// GEZİNME ÖLÇÜMÜ — `bench/gezinme.html`'i Vite + Playwright ile sürer, raporu ve
// sonda PNG'lerini `olcum-out/<etiket>/<klip-adı>/` altına yazar; ya da iki
// raporu karşılaştırır. Plan: docs/plans/2026-09-27-gezinme-1-olcum.md, Görev 5.
//
// Ölçüm:
//   node scripts/olc-gezinme.mjs <klip-yolu> [--gt yol] [--etiket ad]
//     [--katman quick|standard] [--kare N] [--iter N] [--ayrilan N] [--genislik N]
//     [--chrome] [--yazilim-gpu] [--basli] [--yalniz-sfm]
//     [--secim yenilik] [--eslestirme sirali] [--odak-alt N]
//     [--geometri model|sentetik] [--derinlik-kisiti WEIGHT] [--bolgesel]
//     [--refine-every N] [--cap-mult N] [--max-splats N] [--trainer-seed N]
// Karşılaştırma:
//   node scripts/olc-gezinme.mjs --karsilastir <raporA.json> <raporB.json> [--cikti dizin]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';
import { karsilastirmaHtml, karsilastirmaMd, ozetMd } from './olcum-rapor.mjs';

const REPO_KOKU = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZAMAN_ASIMI_MS = 3 * 60 * 60 * 1000;
const ILERLEME_ARALIGI_MS = 20_000;

const BAYRAKLAR = new Set(['--chrome', '--yazilim-gpu', '--basli', '--yalniz-sfm', '--bolgesel']);
const DEGERLI = new Set(['--gt', '--etiket', '--katman', '--kare', '--iter', '--ayrilan', '--genislik', '--cikti',
  '--secim', '--eslestirme', '--odak-alt', '--geometri', '--derinlik-kisiti',
  '--refine-every', '--cap-mult', '--max-splats', '--trainer-seed']);

function kullanim(mesaj) {
  if (mesaj) console.error(`olc-gezinme: ${mesaj}`);
  console.error(
    'kullanım: node scripts/olc-gezinme.mjs <klip-yolu> [--gt yol] [--etiket ad] [--katman quick|standard]\n'
    + '          [--kare N] [--iter N] [--ayrilan N] [--genislik N] [--chrome] [--yazilim-gpu] [--basli]\n'
    + '          [--yalniz-sfm] [--secim yenilik] [--eslestirme sirali] [--odak-alt N]\n'
    + '          [--geometri model|sentetik] [--derinlik-kisiti WEIGHT] [--bolgesel]\n'
    + '          [--refine-every N] [--cap-mult N] [--max-splats N] [--trainer-seed N]\n'
    + '          node scripts/olc-gezinme.mjs --karsilastir <raporA.json> <raporB.json> [--cikti dizin]',
  );
  process.exit(2);
}

function argumanlariAyristir(argv) {
  const secenek = { konumsal: [], bayrak: new Set(), deger: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--karsilastir') secenek.karsilastir = true;
    else if (BAYRAKLAR.has(a)) secenek.bayrak.add(a);
    else if (DEGERLI.has(a)) {
      if (i + 1 >= argv.length) kullanim(`${a} bir değer ister`);
      secenek.deger[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) kullanim(`bilinmeyen seçenek ${a}`);
    else secenek.konumsal.push(a);
  }
  return secenek;
}

const posix = (p) => p.split(sep).join('/');
/** Vite serves any allowed absolute path at `/@fs/<path>`. */
const fsUrl = (mutlak) => encodeURI(`/@fs${mutlak.startsWith('/') ? '' : '/'}${posix(mutlak)}`);
const klipKoku = (ad) => basename(ad, extname(ad));
const saniye = (ms) => `${(ms / 1000).toFixed(1)} sn`;

function dataUrlBuffer(dataUrl) {
  return Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64');
}

// ── measurement ──────────────────────────────────────────────────────────

async function olc(secenek) {
  if (secenek.konumsal.length !== 1) kullanim('tek bir klip yolu gerekli');
  const klip = resolve(secenek.konumsal[0]);
  if (!existsSync(klip)) kullanim(`klip yok: ${klip}`);
  const gt = secenek.deger.gt ? resolve(secenek.deger.gt) : null;
  if (gt && !existsSync(gt)) kullanim(`GT yok: ${gt}`);
  const katman = secenek.deger.katman;
  if (katman && katman !== 'quick' && katman !== 'standard') kullanim(`--katman quick|standard olmalı: ${katman}`);
  for (const k of ['kare', 'iter', 'ayrilan', 'genislik']) {
    const v = secenek.deger[k];
    if (v != null && !/^\d+$/.test(v)) kullanim(`--${k} bir tamsayı olmalı: ${v}`);
  }
  for (const k of ['refine-every', 'max-splats']) {
    const raw = secenek.deger[k];
    if (raw != null && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) === 0))
      kullanim(`--${k} must be a positive integer`);
  }
  const capMult = secenek.deger['cap-mult'];
  if (capMult != null && (!Number.isFinite(Number(capMult)) || Number(capMult) < 1))
    kullanim('--cap-mult must be a finite number >= 1');
  const trainerSeed = secenek.deger['trainer-seed'];
  if (trainerSeed != null && (!/^\d+$/.test(trainerSeed) || !Number.isSafeInteger(Number(trainerSeed))))
    kullanim('--trainer-seed must be a non-negative integer');
  if (secenek.deger.secim && secenek.deger.secim !== 'yenilik') kullanim('--secim yenilik olmalı');
  if (secenek.deger.eslestirme && secenek.deger.eslestirme !== 'sirali') kullanim('--eslestirme sirali olmalı');
  if (secenek.deger.geometri && !['model', 'sentetik'].includes(secenek.deger.geometri)) kullanim('--geometri model|sentetik olmalı');
  if (secenek.deger.geometri === 'sentetik' && !gt) kullanim('--geometri sentetik için --gt gerekli');
  if (secenek.deger['derinlik-kisiti'] && !(Number(secenek.deger['derinlik-kisiti']) > 0))
    kullanim('--derinlik-kisiti pozitif sayı olmalı');
  if (secenek.bayrak.has('--bolgesel') && !secenek.deger['derinlik-kisiti'])
    kullanim('--bolgesel için --derinlik-kisiti gerekli');
  if (secenek.deger['odak-alt'] && !/^\d+$/.test(secenek.deger['odak-alt'])) kullanim('--odak-alt tamsayı olmalı');
  if (secenek.bayrak.has('--yalniz-sfm') && (secenek.deger.geometri || secenek.deger['derinlik-kisiti']))
    kullanim('--yalniz-sfm ile derinlik seçenekleri kullanılamaz');
  if (secenek.bayrak.has('--yalniz-sfm') && ['refine-every', 'cap-mult', 'max-splats', 'trainer-seed'].some((k) => secenek.deger[k] != null))
    kullanim('Training benchmark flags require a training run');
  const etiket = secenek.deger.etiket ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (/[\\/]/.test(etiket) || etiket.startsWith('.')) kullanim(`geçersiz etiket: ${etiket}`);
  const cikis = resolve(REPO_KOKU, 'olcum-out', etiket, klipKoku(klip));

  const q = new URLSearchParams({ klip: fsUrl(klip), etiket });
  if (gt) q.set('gt', fsUrl(gt));
  for (const k of ['katman', 'kare', 'iter', 'ayrilan', 'genislik', 'secim', 'eslestirme', 'odak-alt', 'geometri', 'derinlik-kisiti',
    'refine-every', 'cap-mult', 'max-splats', 'trainer-seed'])
    if (secenek.deger[k] != null) q.set(k, secenek.deger[k]);
  for (const k of ['yalniz-sfm', 'bolgesel']) if (secenek.bayrak.has(`--${k}`)) q.set(k, '1');

  const oturumSecenekleri = {
    chrome: secenek.bayrak.has('--chrome'),
    yazilimGpu: secenek.bayrak.has('--yazilim-gpu'),
    basli: secenek.bayrak.has('--basli'),
    fsAllow: [...new Set([dirname(klip), ...(gt ? [dirname(gt)] : [])])],
  };
  const t0 = Date.now();
  const damga = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  console.log(`olc-gezinme: ${klip}${gt ? ` (GT ${gt})` : ''} → ${cikis}`);
  console.log(`olc-gezinme: tarayıcı (${oturumSecenekleri.chrome ? 'chrome' : 'playwright chromium'}` +
    `${oturumSecenekleri.yazilimGpu ? ', SwiftShader' : ''})…`);

  const oturum = await tarayiciOturumu(oturumSecenekleri);
  try {
    // Progress lines from the page, throttled: a new stage prints at once,
    // repeats of the same stage at most every ILERLEME_ARALIGI_MS.
    let sonAsama = '';
    let sonYazim = 0;
    oturum.page.on('console', (msg) => {
      if (msg.type() !== 'log') return;
      const metin = msg.text();
      if (!metin.startsWith('[gezinme] ')) return;
      const govde = metin.slice('[gezinme] '.length);
      const asama = govde.split(/[\s:]/)[0];
      const simdi = Date.now();
      if (asama === sonAsama && simdi - sonYazim < ILERLEME_ARALIGI_MS) return;
      sonAsama = asama;
      sonYazim = simdi;
      console.log(`[${damga()}] ${govde}`);
    });

    const url = oturum.url(`/bench/gezinme.html?${q}`);
    console.log(`olc-gezinme: ${url}`);
    await oturum.page.goto(url, { waitUntil: 'load' });
    await oturum.page.waitForFunction(
      () => Boolean(window.__gezinme) || Boolean(window.__gezinmeHata),
      undefined,
      { timeout: ZAMAN_ASIMI_MS, polling: 1000 },
    );
    const hata = await oturum.page.evaluate(() => window.__gezinmeHata ?? null);
    if (hata) throw new Error(`sayfa içinde ölçüm başarısız oldu:\n${hata}`);

    const rapor = await oturum.page.evaluate(() => window.__gezinme.rapor);
    const pngAdlari = await oturum.page.evaluate(() => Object.keys(window.__gezinme.pngler));
    await mkdir(join(cikis, 'sondalar'), { recursive: true });
    for (const ad of pngAdlari) {
      const dataUrl = await oturum.page.evaluate((k) => window.__gezinme.pngler[k], ad);
      await writeFile(join(cikis, 'sondalar', `${ad}.png`), dataUrlBuffer(dataUrl));
    }
    await writeFile(join(cikis, 'rapor.json'), `${JSON.stringify(rapor, null, 2)}\n`);
    await writeFile(join(cikis, 'ozet.md'), `${ozetMd(rapor)}\n`);

    console.log(`olc-gezinme: ${join(cikis, 'rapor.json')}`);
    console.log(`olc-gezinme: ${join(cikis, 'ozet.md')}`);
    console.log(`olc-gezinme: ${pngAdlari.length} PNG → ${join(cikis, 'sondalar')}`);
    console.log(`olc-gezinme: aşamalar ${Object.entries(rapor.sureler).map(([k, v]) => `${k} ${saniye(v)}`).join(', ')}`);
    if (rapor.hizalama) {
      console.log(`olc-gezinme: GT hizalama rms ${rapor.hizalama.rms.toFixed(4)} ` +
        `(yolun ${(rapor.hizalama.rmsOrani * 100).toFixed(2)}%), açı ${rapor.hizalama.aciHatasi.toFixed(2)}°`);
    }
    console.log(`olc-gezinme: toplam ${saniye(Date.now() - t0)}`);
  } finally {
    await oturum.kapat();
  }
}

// ── comparison ───────────────────────────────────────────────────────────

async function karsilastir(secenek) {
  if (secenek.konumsal.length !== 2) kullanim('--karsilastir iki rapor yolu ister');
  const [yolA, yolB] = secenek.konumsal.map((p) => resolve(p));
  const a = JSON.parse(await readFile(yolA, 'utf8'));
  const b = JSON.parse(await readFile(yolB, 'utf8'));
  const cikis = secenek.deger.cikti
    ? resolve(secenek.deger.cikti)
    : resolve(REPO_KOKU, 'olcum-out', 'karsilastirma', `${a.etiket}--${b.etiket}`, klipKoku(a.klip ?? 'klip'));
  await mkdir(cikis, { recursive: true });
  const pngA = posix(relative(cikis, join(dirname(yolA), 'sondalar')));
  const pngB = posix(relative(cikis, join(dirname(yolB), 'sondalar')));
  await writeFile(join(cikis, 'karsilastirma.md'), `${karsilastirmaMd(a, b)}\n`);
  await writeFile(join(cikis, 'karsilastirma.html'), karsilastirmaHtml(a, b, { pngA, pngB }));
  console.log(`olc-gezinme: ${join(cikis, 'karsilastirma.md')}`);
  console.log(`olc-gezinme: ${join(cikis, 'karsilastirma.html')}`);
}

const secenek = argumanlariAyristir(process.argv.slice(2));
(secenek.karsilastir ? karsilastir(secenek) : olc(secenek)).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
