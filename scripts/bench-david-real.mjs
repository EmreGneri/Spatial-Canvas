// DAViD insan derinliği niteliksel kıyası: varsayılan zincir vs ?derinlik=david, yan görünümler.
// Çalıştır: node scripts/bench-david-real.mjs --chrome [--sidecar] [--hash] foto1.jpg foto2.jpg ...
//   --hash: yalnız varsayılan yolun derinlik SHA-256'sı (bayraksız yol değişmedi kanıtı).
// Fotoğraflar olcum-out/david/inputs altına kopyalanır (gitignored). Yer gerçeği yok: göz kararı.
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const photos = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!photos.length) throw new Error('usage: node scripts/bench-david-real.mjs --chrome [--sidecar] [--hash] <photos...>');
const inference = process.argv.includes('--sidecar') ? 'sidecar' : 'browser';
const out = resolve('olcum-out/david', inference);
await mkdir(resolve('olcum-out/david/inputs'), { recursive: true });
await mkdir(out, { recursive: true });
const names = [];
for (const [i, p] of photos.entries()) {
  const name = `${i}-${basename(p)}`;
  await copyFile(p, resolve('olcum-out/david/inputs', name));
  names.push(name);
}
const session = await tarayiciOturumu({ chrome: process.argv.includes('--chrome') });
session.page.on('console', m => { if (['log', 'warning', 'error'].includes(m.type())) console.log(`[${m.type()}] ${m.text()}`); });
try {
  await session.page.goto(session.url(`/bench/david.html?inference=${inference}`), { waitUntil: 'load' });
  await session.page.waitForFunction(() => typeof window.varsayilanHash === 'function');
  const urls = names.map(n => `/olcum-out/david/inputs/${n}`);
  if (process.argv.includes('--hash')) {
    const r = await session.page.evaluate(u => window.varsayilanHash(u), urls);
    console.log(JSON.stringify(r, null, 2));
  } else {
    const results = await session.page.evaluate(u => window.runDavidRealPhotos(u), urls);
    for (const r of results) {
      await writeFile(resolve(out, `${basename(r.url)}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
      delete r.png;
    }
    await writeFile(resolve(out, 'results.json'), JSON.stringify({ createdAt: new Date().toISOString(), inference, results }, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
} finally { await session.kapat(); }
