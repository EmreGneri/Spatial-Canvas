import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

// Headed rendering is mandatory: headless timings cannot represent visible performance.
const out = resolve('olcum-out/points');
await mkdir(out, { recursive: true });
const reports = [];
for (const preference of ['low-power', 'high-performance']) {
  const session = await tarayiciOturumu({ chrome: true, basli: true });
  try {
    await session.page.setViewportSize({ width: 1280, height: 960 });
    await session.page.goto(session.url('/bench/points.html'), { waitUntil: 'load' });
    await session.page.bringToFront();
    await session.page.waitForFunction(() => typeof window.runPointCountBenchmark === 'function');
    const report = await session.page.evaluate(preference => window.runPointCountBenchmark(preference), preference);
    reports.push(report);
    await session.page.screenshot({ path: resolve(out, `${preference}.png`), fullPage: true });
    await writeFile(resolve(out, `${preference}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await session.kapat(); }
}
await writeFile(resolve(out, 'results.json'), JSON.stringify({ reports,
  unavailable: ['intel', 'rtx'].filter(adapter => !reports.some(report => report.adapter === adapter)),
  note: 'GPU preferences are browser hints; compare only independently identified hardware adapters.' }, null, 2));
