// PAYLAŞILAN YARDIMCI: Vite dev sunucusu + playwright-core Chromium.
// `scripts/sentetik-klip.mjs` ve sonraki ölçüm betikleri bunu kullanır.
// `playwright-core` tarayıcı indirmez: `--chrome` verilirse kurulu Chrome
// (`channel: 'chrome'`), yoksa `PLAYWRIGHT_BROWSERS_PATH` altındaki
// (indirilmiş) Chromium yürütülebilir dosyası kullanılır.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_KOKU = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** SwiftShader (yazılım) render bayrakları — GPU'suz ortamda WebGPU için. */
const YAZILIM_GPU_BAYRAKLARI = [
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--disable-vulkan-surface',
];

function chromiumYuruturebiliriBul() {
  const kok = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!kok || !existsSync(kok)) {
    throw new Error(
      'PLAYWRIGHT_BROWSERS_PATH tanımlı değil ya da yok — --chrome kullanın ya da '
      + 'Playwright tarayıcılarını indirin (npx playwright install chromium).',
    );
  }
  const adaylar = [];
  for (const girdi of readdirSync(kok)) {
    if (!girdi.startsWith('chromium-')) continue; // chromium_headless_shell-* hariç
    const taban = join(kok, girdi);
    adaylar.push(
      join(taban, 'chrome-linux', 'chrome'),
      join(taban, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      join(taban, 'chrome-win', 'chrome.exe'),
    );
  }
  const bulunan = adaylar.find((p) => existsSync(p));
  if (!bulunan) {
    throw new Error(`PLAYWRIGHT_BROWSERS_PATH=${kok} altında chromium yürütülebilir dosyası bulunamadı`);
  }
  return bulunan;
}

/**
 * Vite dev sunucusunu açar, `playwright-core` chromium'u başlatır.
 * `fsAllow`: sunucunun repo dışında serveceği ek dizinler (ör. klip dosyası).
 * Döner: `url(yol)` (sunucu tabanına göre tam URL), `page`, `kapat()`.
 */
export async function tarayiciOturumu({ chrome = false, yazilimGpu = false, basli = false, fsAllow = [] } = {}) {
  const server = await createServer({
    root: REPO_KOKU,
    server: { port: 0, fs: { allow: [REPO_KOKU, ...fsAllow] } },
    logLevel: 'error',
  });
  await server.listen();
  const taban = server.resolvedUrls?.local?.[0] ?? (() => {
    const adres = server.httpServer?.address();
    const port = typeof adres === 'object' && adres ? adres.port : adres;
    return `http://localhost:${port}/`;
  })();

  const args = ['--enable-unsafe-webgpu'];
  if (yazilimGpu) args.push(...YAZILIM_GPU_BAYRAKLARI);
  const baseOpts = { headless: !basli, args };

  let browser;
  try {
    browser = chrome
      ? await chromium.launch({ ...baseOpts, channel: 'chrome' })
      : await chromium.launch({ ...baseOpts, executablePath: chromiumYuruturebiliriBul() });
  } catch (e) {
    await server.close();
    throw e;
  }
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[sayfa]', msg.text());
  });
  page.on('pageerror', (err) => console.error('[sayfa hata]', err));

  return {
    url: (yol) => new URL(yol, taban).toString(),
    page,
    async kapat() {
      await browser.close();
      await server.close();
    },
  };
}
