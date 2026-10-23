// Run: node scripts/bench-moge-photo.mjs --chrome
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const output = resolve('olcum-out/moge-photo');
await mkdir(output, { recursive: true });
const session = await tarayiciOturumu({ chrome: process.argv.includes('--chrome'), basli: process.argv.includes('--basli') });
session.page.on('console', m => { if (m.type() === 'log' || m.type() === 'warning') console.log(m.text()); });
try {
  await session.page.goto(session.url('/bench/moge.html?inference=browser'), { waitUntil: 'load' });
  await session.page.waitForFunction(() => typeof window.runMogePhotoBench === 'function');
  const result = await session.page.evaluate(() => window.runMogePhotoBench());
  for (const scene of result.scenes) {
    await writeFile(resolve(output, `${scene.name}.png`), Buffer.from(scene.imagePng.split(',')[1], 'base64'));
    delete scene.imagePng;
  }
  await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, adapters: result.adapters, scenes: result.scenes, mean: result.mean }, null, 2));
} finally { await session.kapat(); }
