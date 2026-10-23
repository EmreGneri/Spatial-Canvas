// Qualitative real-photo check: default photo depth vs ?derinlik=moge, side-view renders.
// Run: node scripts/bench-moge-real.mjs --chrome [--sidecar] photo1.jpg photo2.jpg ...
// Photos are copied into olcum-out/moge-real/inputs (gitignored). No ground truth: judge visually.
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const photos = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!photos.length) throw new Error('usage: node scripts/bench-moge-real.mjs --chrome [--sidecar] <photos...>');
const out = resolve('olcum-out/moge-real', process.argv.includes('--sidecar') ? 'sidecar' : 'browser');
await mkdir(resolve('olcum-out/moge-real/inputs'), { recursive: true });
await mkdir(out, { recursive: true });
const names = [];
for (const [i, p] of photos.entries()) {
  const name = `${i}-${basename(p)}`;
  await copyFile(p, resolve('olcum-out/moge-real/inputs', name));
  names.push(name);
}
const session = await tarayiciOturumu({ chrome: process.argv.includes('--chrome') });
session.page.on('console', m => { if (['log', 'warning'].includes(m.type())) console.log(m.text()); });
try {
  const inference = process.argv.includes('--sidecar') ? 'sidecar' : 'browser';
  await session.page.goto(session.url(`/bench/moge.html?inference=${inference}`), { waitUntil: 'load' });
  await session.page.waitForFunction(() => typeof window.runMogeRealPhotos === 'function');
  const results = await session.page.evaluate(urls => window.runMogeRealPhotos(urls), names.map(n => `/olcum-out/moge-real/inputs/${n}`));
  for (const r of results) {
    await writeFile(resolve(out, `${basename(r.url)}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
    delete r.png;
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ createdAt: new Date().toISOString(), inference, results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await session.kapat(); }
