// Preserve local experiments; download/copy only the shared active deployment manifest.
//   npm run fetch:assets
import { mkdir, copyFile, stat, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { downloadAsset, warnUnknownAssets } from './download-asset.mjs';
import { assetEnvironment, assetManifest, MANAGED_ASSET_DIRS } from './asset-manifest.mjs';

const PUBLIC_DIR = process.env.FETCH_ASSETS_PUBLIC_DIR || 'public';
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const strayMedia = (await readdir(PUBLIC_DIR, { recursive: true }).catch(() => []))
  .filter(file => MEDIA_EXTENSIONS.has(extname(file).toLowerCase()));
if (strayMedia.length) {
  console.error('public/ contains video files that would be deployed with the site:');
  for (const file of strayMedia) console.error(`  ${PUBLIC_DIR}/${file}`);
  console.error('Move them to assets/test-clips/ (gitignored; the dev server serves it at /assets/test-clips/).');
  process.exit(1);
}

const assets = assetManifest(assetEnvironment());
for (const asset of assets) {
  const dest = join(PUBLIC_DIR, asset.path);
  let result;
  if (asset.source) {
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(asset.source, dest);
  } else result = await downloadAsset({ ...asset, dest });
  console.log(`${result === 'skip' ? 'skip' : (await stat(dest)).size + ' bytes'}  ${asset.path}`);
}
for (const directory of MANAGED_ASSET_DIRS) {
  const prefix = `${directory}/`;
  await warnUnknownAssets(join(PUBLIC_DIR, directory), new Set(assets.filter(asset => asset.path.startsWith(prefix)).map(asset => asset.path.slice(prefix.length))));
}
