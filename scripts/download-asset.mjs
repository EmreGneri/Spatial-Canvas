import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, rename, rm, readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function assetMatches(path, { size, sha256 }) {
  if ((await stat(path).catch(() => null))?.size !== size) return false;
  if (!sha256) return true;
  const hash = createHash('sha256');
  // Windows'ta rename öncesi okuma tanıtıcısının da kapanmasını bekle.
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex') === sha256;
}

// Son hedef yalnız doğrulama tamamlandığında değişir; kesilen yanıt eski dosyayı korur.
export async function downloadAsset({ url, dest, size, sha256 }, fetchImpl = fetch) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Missing expected size: ${dest}`);
  if (await assetMatches(dest, { size, sha256 })) return 'skip';
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!res.ok || !res.body) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    let bytes = 0;
    const limit = new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      done(bytes > size ? new Error(`Asset exceeds expected ${size} bytes: ${dest}`) : null, chunk);
    } });
    await pipeline(Readable.fromWeb(res.body), limit, createWriteStream(part));
    if (!await assetMatches(part, { size, sha256 })) throw new Error(`Asset integrity mismatch: ${dest}`);
    await rename(part, dest);
    return 'download';
  } finally {
    await rm(part, { force: true });
  }
}

// Yerel deneysel modelleri silme; build çıktısına da kopyalanacaklarını açıkça bildir.
export async function warnUnknownAssets(dir, keep, warn = console.warn) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const path = join(entry.parentPath, entry.name);
    const rel = relative(dir, path).split(sep).join('/');
    if (!keep.has(rel)) warn(`  WARNING  ${path} is not in the fetch list; preserved locally and may ship in the build.`);
  }
}
