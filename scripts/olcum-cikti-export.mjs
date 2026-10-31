// Gerçek Chrome denetimi: PNG boyut seçimi (#16) ve WebM kayıt pompası (#15).
//   node scripts/olcum-cikti-export.mjs <cikti-dizini>
// Dizin repo DIŞINDA olmalı (görüntüler repoya girmez). Taze profil, Chrome
// kanalı, `?inference=browser`; sidecar'a ve kullanıcının Chrome'una dokunmaz.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const out = resolve(process.argv[2] ?? 'cikti-export');
await mkdir(out, { recursive: true });
const s = await tarayiciOturumu({ chrome: true, basli: true });
const { page } = s;
const rapor = { png: [], kayit: null };

async function ac(w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(s.url('/?inference=browser'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__engine, null, { timeout: 60000 });
  await page.waitForTimeout(6000); // açılış sahnesi otursun
}

async function pngAl(ad, mod) {
  await page.selectOption('select[aria-label="PNG boyutu"]', mod);
  const once = await page.evaluate(() => {
    const e = window.__engine;
    const c = e.renderer.domElement;
    return { w: c.width, h: c.height, dpr: e.renderer.getPixelRatio(), css: [c.style.width, c.style.height] };
  });
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'PNG', exact: true }).click(),
  ]);
  const yol = resolve(out, `${ad}-${mod}.png`);
  await dl.saveAs(yol);
  const sonra = await page.evaluate(() => {
    const e = window.__engine;
    const c = e.renderer.domElement;
    return { w: c.width, h: c.height, dpr: e.renderer.getPixelRatio(), css: [c.style.width, c.style.height] };
  });
  await page.waitForTimeout(500);
  const olcu = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  }, (await import('node:fs')).readFileSync(yol).toString('base64'));
  rapor.png.push({ ad, mod, tampon: once, tamponSonra: sonra, dosya: olcu, yol });
  return yol;
}

// Küçük kopyaya indirip iki PNG'nin ortalama mutlak farkını verir.
async function fark(a, b) {
  const fs = await import('node:fs');
  return page.evaluate(async ([x, y]) => {
    const yukle = async (b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); return i; };
    const [ia, ib] = [await yukle(x), await yukle(y)];
    const W = 96, H = Math.round(96 * ia.naturalHeight / ia.naturalWidth);
    const oku = (i) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(i, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
    const da = oku(ia), db = oku(ib);
    let t = 0; for (let k = 0; k < da.length; k++) t += Math.abs(da[k] - db[k]);
    return { ortFarkRGBA: t / da.length, kucukBoyut: [W, H] };
  }, [fs.readFileSync(a).toString('base64'), fs.readFileSync(b).toString('base64')]);
}

try {
  // PNG: aynı oranlı iki pencere (800x600, 1200x900) + farklı oranlı bir üçüncü.
  const dosya = {};
  if (!process.env.SADECE_KAYIT) for (const [ad, w, h] of [['kucuk', 800, 600], ['buyuk', 1200, 900], ['genis', 1400, 700]]) {
    await ac(w, h);
    if (ad === 'kucuk') await pngAl(ad, 'mevcut');
    dosya[ad] = await pngAl(ad, '1080p');
    if (ad === 'buyuk') await pngAl(ad, '2k');
    if (ad === 'buyuk') await page.screenshot({ path: resolve(out, 'ekran-buyuk.png') });
  }
  if (!process.env.SADECE_KAYIT) rapor.fark_kucuk_buyuk_1080p = await fark(dosya.kucuk, dosya.buyuk);

  // WebM: composer.render sayacı + tracker kancası canlı kalıyor mu.
  await ac(1000, 700);
  await page.evaluate(() => {
    const e = window.__engine;
    window.__sayac = { render: 0, tap: 0 };
    const orj = e.composer.render.bind(e.composer);
    e.composer.render = (...a) => { window.__sayac.render++; return orj(...a); };
    e.setFrameTap(() => { window.__sayac.tap++; });
  });
  const olc = async (ms) => {
    const a = await page.evaluate(() => ({ ...window.__sayac }));
    await page.waitForTimeout(ms);
    const b = await page.evaluate(() => ({ ...window.__sayac }));
    return { render: b.render - a.render, tap: b.tap - a.tap, sn: ms / 1000 };
  };
  const bos = await olc(3000);
  const indi = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: 'WebM', exact: true }).click();
  await page.waitForTimeout(500);
  const kayit = await olc(3500); // 5 sn'lik kaydın içinde
  const dl = await indi;
  await dl.saveAs(resolve(out, 'kayit.webm'));
  await page.waitForTimeout(500);
  const sonra = await olc(2000);
  rapor.kayit = {
    kayitDisi_renderPerSn: bos.render / bos.sn,
    kayitSirasi_renderPerSn: kayit.render / kayit.sn,
    kayitSonrasi_renderPerSn: sonra.render / sonra.sn,
    kayitSonrasi_trackerTapPerSn: sonra.tap / sonra.sn,
    ham: { bos, kayit, sonra },
  };
} finally {
  await writeFile(resolve(out, 'rapor.json'), JSON.stringify(rapor, null, 2));
  console.log(JSON.stringify(rapor, null, 2));
  await s.kapat();
}
