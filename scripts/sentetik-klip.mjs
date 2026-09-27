// `bench/klip.html`'i Playwright ile sürer, sentetik orman yolu klibini
// `assets/test-clips/sentetik-orman-yolu.webm` + `.gt.json` olarak yazar,
// baş/orta/son kare PNG'lerini `olcum-out/sentetik-onizleme/`e koyar.
//
// Kullanım: node scripts/sentetik-klip.mjs [--chrome] [--yazilim-gpu] [--basli]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const REPO_KOKU = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZAMAN_ASIMI_MS = 30 * 60 * 1000;

const argv = process.argv.slice(2);
const secenekler = {
  chrome: argv.includes('--chrome'),
  yazilimGpu: argv.includes('--yazilim-gpu'),
  basli: argv.includes('--basli'),
};

function bicimBayt(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

async function klipBekle(page) {
  // NOT: `waitForFunction(fn, opts)` iki argümanla çağrılırsa ikinci argümanı
  // `arg` sanır (options değil) — üçüncü konumda geçmek gerekir, yoksa
  // varsayılan 30 sn zaman aşımı sessizce devreye girer.
  await page.waitForFunction(
    () => Boolean(window.__klip) || Boolean(window.__klipHata),
    undefined,
    { timeout: ZAMAN_ASIMI_MS, polling: 250 },
  );
  const hata = await page.evaluate(() => window.__klipHata ?? null);
  if (hata) throw new Error(`sayfa içinde klip üretimi başarısız oldu:\n${hata}`);
}

async function main() {
  const t0 = Date.now();
  console.log(`sentetik klip: tarayıcı açılıyor (${secenekler.chrome ? 'chrome' : 'playwright chromium'}${secenekler.yazilimGpu ? ', SwiftShader' : ''})…`);
  const oturum = await tarayiciOturumu(secenekler);
  try {
    const url = oturum.url('/bench/klip.html');
    console.log(`sentetik klip: ${url}`);
    await oturum.page.goto(url, { waitUntil: 'load' });
    await klipBekle(oturum.page);
    const tUret = Date.now();
    console.log(`sentetik klip: üretim ${((tUret - t0) / 1000).toFixed(1)} sn`);

    const { webmB64, gt, onizleme } = await oturum.page.evaluate(() => ({
      webmB64: window.__klip.webm,
      gt: window.__klip.gt,
      onizleme: window.__onizleme,
    }));

    const webmBuf = Buffer.from(webmB64, 'base64');
    const cikisDizini = resolve(REPO_KOKU, 'assets/test-clips');
    await mkdir(cikisDizini, { recursive: true });
    const webmYolu = resolve(cikisDizini, 'sentetik-orman-yolu.webm');
    const gtYolu = resolve(cikisDizini, 'sentetik-orman-yolu.gt.json');
    await writeFile(webmYolu, webmBuf);
    await writeFile(gtYolu, JSON.stringify(gt, null, 2));

    const onizlemeDizini = resolve(REPO_KOKU, 'olcum-out/sentetik-onizleme');
    await mkdir(onizlemeDizini, { recursive: true });
    for (const [ad, dataUrl] of [['bas.png', onizleme.bas], ['orta.png', onizleme.orta], ['son.png', onizleme.son]]) {
      const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
      await writeFile(resolve(onizlemeDizini, ad), Buffer.from(b64, 'base64'));
    }

    console.log(`sentetik klip: ${webmYolu} (${bicimBayt(webmBuf.length)})`);
    console.log(`sentetik klip: ${gtYolu} (${gt.kareler.length} kare, ${gt.fps} fps, ${gt.w}x${gt.h})`);
    console.log(`sentetik klip: önizlemeler ${onizlemeDizini}`);
    console.log(`sentetik klip: toplam ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
  } finally {
    await oturum.kapat();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
