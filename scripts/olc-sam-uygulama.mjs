// UYGULAMA İÇİ ÖLÇÜM: `?videoMaske=sam` gerçek video yolunda (canlı derinlik + SAM maske
// aynı GPU sırasında). Klibi yükler, "nesne ayırma"yı açar, uygulamanın kendi 3 sn'lik
// log satırlarını toplar: derinlik Hz, SAM maske Hz, maske yaşı, çapa olayları, adapter.
// Aynı klip bayraksız da koşulur (derinlik Hz karşılaştırması, IS-Net yolu).
//   node scripts/olc-sam-uygulama.mjs --klip <video> [--sure 40] [--chrome] [--basli]
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const arg = (ad, vars) => { const i = process.argv.indexOf(ad); return i > 0 ? process.argv[i + 1] : vars; };
const klip = arg('--klip');
if (!klip || !existsSync(klip)) { console.error('kullanım: --klip <video dosyası>'); process.exit(2); }
const SURE_MS = Number(arg('--sure', '40')) * 1000;

async function kos(sorgu) {
  const oturum = await tarayiciOturumu({ chrome: process.argv.includes('--chrome'), basli: process.argv.includes('--basli') });
  try {
    const { page } = oturum;
    await page.addInitScript(() => {
      const gpu = navigator.gpu;
      if (!gpu) return;
      const ra = gpu.requestAdapter.bind(gpu);
      gpu.requestAdapter = async (...a) => {
        const ad = await ra(...a);
        if (ad) {
          const rd = ad.requestDevice.bind(ad);
          ad.requestDevice = async (...b) => { const d = await rd(...b); (window.__cihazlar ??= []).push(`${ad.info.vendor} / ${ad.info.architecture}`); return d; };
        }
        return ad;
      };
    });
    const uyarilar = [];
    page.on('console', (m) => { if (m.text().includes('[videoMaske]')) uyarilar.push(m.text()); });
    await page.goto(oturum.url(`/${sorgu}`), { waitUntil: 'load' });
    await page.setInputFiles('input[accept="image/*,video/*"]', resolve(klip));
    const log = () => page.evaluate(() => [...document.querySelectorAll('pre')].map((p) => p.textContent ?? '').join('\n'));
    await page.waitForFunction(() => [...document.querySelectorAll('pre')].some((p) => p.textContent?.includes('model devraldı')), undefined, { timeout: 120_000 });
    await page.getByRole('button', { name: /nesne ayırma/ }).click();
    const t0 = Date.now();
    const satirlar = new Set();
    while (Date.now() - t0 < SURE_MS) {
      for (const s of (await log()).split('\n')) satirlar.add(s);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const hepsi = [...satirlar];
    const cihaz = await page.evaluate(() => window.__cihazlar ?? []);
    return { hepsi, uyarilar, cihaz };
  } finally {
    await oturum.kapat();
  }
}

const sayilar = (satirlar, re) => satirlar.map((s) => re.exec(s)).filter(Boolean).map((m) => Number(m[1]));
const medyan = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

for (const [ad, sorgu] of [['SAM', '?videoMaske=sam&inference=browser'], ['IS-Net (varsayılan)', '?inference=browser']]) {
  const r = await kos(sorgu);
  const canli = r.hepsi.filter((s) => s.startsWith('canlı derinlik ·'));
  // İlk 2 satır ısınma (model indirme/derleme): medyana katılmaz.
  const sabit = canli.slice(2);
  console.log(`\n== ${ad} · adapter: ${[...new Set(r.cihaz)].join('; ') || '-'}`);
  console.log(`derinlik Hz medyan ${medyan(sayilar(sabit, /· ([\d.]+) Hz ·/))} (${sabit.length} satır)`);
  if (ad === 'SAM') {
    console.log(`SAM maske Hz medyan ${medyan(sayilar(sabit, /SAM maske ([\d.]+) Hz/))}`);
    console.log(`maske yaşı p50 medyan ${medyan(sayilar(sabit, /maske yaşı p50\/p95 (-?\d+)\//))} ms`);
    console.log(`çapa olayları: ${r.hepsi.filter((s) => s.startsWith('SAM video maskesi')).join(' | ')}`);
  }
  for (const s of r.hepsi.filter((x) => /video (özne )?maskesi|SAM/.test(x)).slice(0, 12)) console.log(`  ${s}`);
  if (r.uyarilar.length) console.log(`uyarılar: ${r.uyarilar.join(' | ')}`);
  console.log(canli.slice(-4).map((s) => `  ${s}`).join('\n'));
}
