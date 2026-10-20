// MASKE ÖLÇÜMÜ — DAVIS 2017 GT ile video maskesi (IS-Net) ve derinlik tutarlı delik
// doldurmayı (`delikleriDoldur`) karşılaştırır; `bench/maske.html`'i Vite + Playwright
// ile sürer, çıktıyı `olcum-out/<etiket>/maske/` altına yazar.
//   node scripts/olc-maske.mjs --davis <kök> [--dizi a,b,c] [--adim N=5] [--en-fazla-dizi N]
//     [--etiket ad] [--chrome] [--yazilim-gpu] [--basli] [--yardimci]
// <kök>: JPEGImages/480p, Annotations/480p, ImageSets/2017/val.txt içeren DAVIS dizini.
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const REPO_KOKU = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZAMAN_ASIMI_MS = 2 * 60 * 60 * 1000;
const ILERLEME_ARALIGI_MS = 15_000;

const BAYRAKLAR = new Set(['--chrome', '--yazilim-gpu', '--basli', '--yardimci', '--delik-kaydi']);
const DEGERLI = new Set(['--davis', '--dizi', '--adim', '--en-fazla-dizi', '--etiket', '--bolum']);

function kullanim(mesaj) {
  if (mesaj) console.error(`olc-maske: ${mesaj}`);
  console.error('kullanım: node scripts/olc-maske.mjs --davis <kök> [--dizi a,b,c] [--adim N=5] [--en-fazla-dizi N]\n'
    + '          [--etiket ad] [--chrome] [--yazilim-gpu] [--basli] [--yardimci]');
  process.exit(2);
}

function ayristir(argv) {
  const s = { bayrak: new Set(), deger: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BAYRAKLAR.has(a)) s.bayrak.add(a);
    else if (DEGERLI.has(a)) {
      if (i + 1 >= argv.length) kullanim(`${a} bir değer ister`);
      s.deger[a.slice(2)] = argv[++i];
    } else kullanim(`bilinmeyen seçenek ${a}`);
  }
  return s;
}

const posix = (p) => p.split(sep).join('/');
/** Vite, izin verilen mutlak yolu `/@fs/<yol>` altında sunar. */
const fsUrl = (mutlak) => encodeURI(`/@fs${mutlak.startsWith('/') ? '' : '/'}${posix(mutlak)}`);
const dataUrlBuffer = (d) => Buffer.from(String(d).replace(/^data:image\/png;base64,/, ''), 'base64');
const f3 = (x) => (x == null || Number.isNaN(x) ? '-' : x.toFixed(3));
const f1 = (x) => (x == null || Number.isNaN(x) ? '-' : x.toFixed(1));
const yuzde = (x) => (x == null || Number.isNaN(x) ? '-' : `${(x * 100).toFixed(1)}%`);

async function manifestKur(kok, secenek) {
  let adlar;
  if (secenek.dizi) adlar = secenek.dizi.split(',').map((x) => x.trim()).filter(Boolean);
  else {
    const val = join(kok, 'ImageSets', '2017', `${secenek.bolum ?? 'val'}.txt`);
    if (!existsSync(val)) kullanim(`bölüm listesi yok: ${val}`);
    adlar = (await readFile(val, 'utf8')).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  }
  if (secenek['en-fazla-dizi']) adlar = adlar.slice(0, Number(secenek['en-fazla-dizi']));
  const adim = Number(secenek.adim ?? 5);
  const diziler = [];
  for (const ad of adlar) {
    const jpgDizin = join(kok, 'JPEGImages', '480p', ad);
    const gtDizin = join(kok, 'Annotations', '480p', ad);
    if (!existsSync(jpgDizin) || !existsSync(gtDizin)) kullanim(`dizi yok: ${ad}`);
    const dosyalar = (await readdir(jpgDizin)).filter((x) => x.endsWith('.jpg')).sort();
    const kareler = [];
    for (let i = 0; i < dosyalar.length; i += adim) {
      const gt = join(gtDizin, dosyalar[i].replace(/\.jpg$/, '.png'));
      if (existsSync(gt)) kareler.push({ jpgUrl: fsUrl(join(jpgDizin, dosyalar[i])), gtUrl: fsUrl(gt) });
    }
    if (kareler.length) diziler.push({ ad, kareler });
  }
  return diziler;
}

function ozetMd(r, etiket) {
  const g = r.global;
  const yontemler = [['A', 'A: IS-Net'], ['B', 'B: IS-Net + delik doldurma'], ...(r.yardimci ? [['C', `C: BiRefNet (${r.cModeli ?? '?'})`]] : [])];
  const satirlar = yontemler.filter(([k]) => g[k]).map(([k, ad]) => {
    const v = g[k];
    return `| ${ad} | ${v.kare} | ${f3(v.J)} | ${f3(v.F)} | ${f3(v.JF)} | ${f3(v.diziOrtalamasi.JF)} | ${yuzde(v.delik)} | ${f3(v.ardisik)} | ${(v.alanDalgalanma * 100).toFixed(2)}% |`;
  });
  const d = r.dolgu, fa = r.farkBA;
  return [
    `# Maske ölçümü: ${etiket}`,
    '',
    `${r.diziSayisi} dizi, ${r.kareSayisi} kare, hata: ${r.hataSayisi}${r.yardimci ? `, C kullanılamayan kare: ${r.cKullanilamayanKare}` : ''}`,
    '',
    '| Yöntem | Kare | J | F | J&F (kare ort.) | J&F (dizi ort.) | İç delik/ön plan | Ardışık IoU | Alan dalgalanması |',
    '|---|---|---|---|---|---|---|---|---|',
    ...satirlar,
    '',
    '## Delik doldurma (B)',
    '',
    `- Doldurulan piksel: ${d.doldurulanPiksel} (doğru, GT içi: ${d.dogru}; yanlış, GT dışı: ${d.yanlis})`,
    `- Doldurma kesinliği: ${yuzde(d.kesinlik)}`,
    `- Doldurma olan kare: ${d.dolguluKareSayisi} / ${d.toplamKare}`,
    fa ? `- Delta J&F (B-A): kare ort. ${fa.JF >= 0 ? '+' : ''}${f3(fa.JF)} (J ${fa.J >= 0 ? '+' : ''}${f3(fa.J)}, F ${fa.F >= 0 ? '+' : ''}${f3(fa.F)}), dizi ort. ${fa.diziOrtJF >= 0 ? '+' : ''}${f3(fa.diziOrtJF)}` : '',
    fa ? `- B < A olan dizi: ${fa.bKotuDiziSayisi} / ${r.diziSayisi}` : '',
    '',
    `Süre (ms/kare): segmentasyon ${f1(r.sureMs.seg)}, derinlik ${f1(r.sureMs.derinlik)}, doldurma ${f1(r.sureMs.doldur)}`,
    '',
    '## Dizi başına J&F (A -> B), doldurulan piksel (doğru/yanlış)',
    '',
    '| Dizi | A | B | Delta | Doldurma d/y |',
    '|---|---|---|---|---|',
    ...r.diziler.map((s) => {
      const a = s.A ? (s.A.J + s.A.F) / 2 : null, b = s.B ? (s.B.J + s.B.F) / 2 : null;
      return `| ${s.ad} | ${f3(a)} | ${f3(b)} | ${a != null && b != null ? f3(b - a) : '-'} | ${s.dolgu.dogru}/${s.dolgu.yanlis} |`;
    }),
    '',
    ...(r.hataSayisi ? ['## Hatalar', '', ...r.hatalar.slice(0, 20).map((h) => `- ${h.dizi} kare ${h.kare}: ${h.mesaj}`), ''] : []),
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '' )).join('\n');
}

async function main() {
  const secenek = ayristir(process.argv.slice(2));
  const d = secenek.deger;
  if (!d.davis) kullanim('--davis gerekli');
  const kok = resolve(d.davis);
  if (!existsSync(kok)) kullanim(`DAVIS kökü yok: ${kok}`);
  for (const k of ['adim', 'en-fazla-dizi']) {
    if (d[k] != null && !/^[1-9]\d*$/.test(d[k])) kullanim(`--${k} pozitif tamsayı olmalı: ${d[k]}`);
  }
  const etiket = d.etiket ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (/[\\/]/.test(etiket) || etiket.startsWith('.')) kullanim(`geçersiz etiket: ${etiket}`);
  const cikis = resolve(REPO_KOKU, 'olcum-out', etiket, 'maske');
  const yardimci = secenek.bayrak.has('--yardimci');
  const delikKaydi = secenek.bayrak.has('--delik-kaydi');
  if (d.bolum != null && !['train', 'val'].includes(d.bolum)) kullanim(`--bolum train|val olmalı: ${d.bolum}`);

  const diziler = await manifestKur(kok, d);
  if (!diziler.length) kullanim('ölçülecek dizi/kare bulunamadı');
  const toplamKare = diziler.reduce((s, x) => s + x.kareler.length, 0);
  console.log(`olc-maske: ${diziler.length} dizi, ${toplamKare} kare → ${cikis}`);

  const t0 = Date.now();
  const damga = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const oturum = await tarayiciOturumu({
    chrome: secenek.bayrak.has('--chrome'),
    yazilimGpu: secenek.bayrak.has('--yazilim-gpu'),
    basli: secenek.bayrak.has('--basli'),
    fsAllow: [kok],
  });
  try {
    // İlerleme: dizi değişince hemen, aynı dizide en çok ILERLEME_ARALIGI_MS'de bir.
    let sonDizi = '', sonYazim = 0;
    oturum.page.on('console', (msg) => {
      if (msg.type() !== 'log') return;
      const m = msg.text();
      if (!m.startsWith('[maske] ')) return;
      const govde = m.slice('[maske] '.length);
      const dizi = govde.split(' ')[0];
      const simdi = Date.now();
      if (dizi === sonDizi && !govde.startsWith('HATA') && simdi - sonYazim < ILERLEME_ARALIGI_MS) return;
      sonDizi = dizi; sonYazim = simdi;
      console.log(`[${damga()}] ${govde}`);
    });
    await oturum.page.goto(oturum.url(`/bench/maske.html${yardimci ? '?inference=sidecar' : ''}`), { waitUntil: 'load' });
    await oturum.page.waitForFunction(() => typeof window.__maskeBaslat === 'function', undefined, { timeout: 60_000 });
    await oturum.page.evaluate((m) => { window.__maskeBaslat(m); }, { diziler, yardimci, delikKaydi });
    // Delik kayıtları sayfa belleğini şişirmesin: bitene dek periyodik boşalt, jsonl'e ekle.
    const delikDosya = join(cikis, 'delikler.jsonl');
    let delikSayisi = 0;
    const bosalt = async () => {
      const kayit = await oturum.page.evaluate(() => window.__delikAl());
      if (!kayit.length) return;
      await appendFile(delikDosya, `${kayit.map((r) => JSON.stringify(r)).join('\n')}\n`);
      delikSayisi += kayit.length;
    };
    if (delikKaydi) { await mkdir(cikis, { recursive: true }); await writeFile(delikDosya, ''); }
    const t1 = Date.now();
    for (;;) {
      if (delikKaydi) await bosalt();
      if (await oturum.page.evaluate(() => Boolean(window.__maske) || Boolean(window.__maskeHata))) break;
      if (Date.now() - t1 > ZAMAN_ASIMI_MS) throw new Error('zaman aşımı');
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (delikKaydi) { await bosalt(); console.log(`olc-maske: ${delikSayisi} delik kaydı → ${delikDosya}`); }
    const hata = await oturum.page.evaluate(() => window.__maskeHata ?? null);
    if (hata) throw new Error(`sayfa içinde ölçüm başarısız oldu:\n${hata}`);

    const rapor = await oturum.page.evaluate(() => window.__maske.rapor);
    const adlar = await oturum.page.evaluate(() => Object.keys(window.__maske.pngler));
    await mkdir(join(cikis, 'kareler'), { recursive: true });
    for (const ad of adlar) {
      const url = await oturum.page.evaluate((k) => window.__maske.pngler[k], ad);
      await writeFile(join(cikis, 'kareler', `${ad}.png`), dataUrlBuffer(url));
    }
    await writeFile(join(cikis, 'rapor.json'), `${JSON.stringify(rapor, null, 2)}\n`);
    const md = ozetMd(rapor, etiket);
    await writeFile(join(cikis, 'ozet.md'), `${md}\n`);
    console.log(md);
    console.log(`olc-maske: ${adlar.length} PNG, ${rapor.hataSayisi} hata, toplam ${Math.round((Date.now() - t0) / 1000)} sn → ${cikis}`);
  } finally {
    await oturum.kapat();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
