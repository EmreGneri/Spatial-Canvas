import { copyFile, cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { assetManifest, MANAGED_ASSET_DIRS } from './asset-manifest.mjs';
import { warnUnknownAssets } from './download-asset.mjs';

/** Build only: publicDir still serves every local experiment during development. */
export function allowlistedPublicAssetsPlugin() {
  let config;
  return {
    name: 'allowlisted-public-assets',
    apply: 'build',
    config: () => ({ build: { copyPublicDir: false } }),
    configResolved(value) {
      config = value;
      if (!config.publicDir) return;
      const output = resolve(config.root, config.build.outDir);
      const contains = (parent, child) => {
        const path = relative(parent, child);
        return !path || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
      };
      if (contains(output, config.publicDir) || contains(config.publicDir, output))
        throw new Error('Build output and public assets must be separate directories');
    },
    // Vite's prepare-out-dir uses renderStart/order:pre. Copy after it, before generated output wins.
    renderStart: {
      order: 'post',
      sequential: true,
      async handler() {
        if (!config.publicDir || !config.build.write) return;
        const output = resolve(config.root, config.build.outDir);
        const destination = path => {
          const target = resolve(output, path);
          const rel = relative(output, target);
          if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
            throw new Error(`Public asset escapes build output: ${path}`);
          return target;
        };
        const assets = assetManifest(config.env);
        for (const directory of MANAGED_ASSET_DIRS) {
          const prefix = `${directory}/`;
          await warnUnknownAssets(resolve(config.publicDir, directory), new Set(assets.filter(asset => asset.path.startsWith(prefix)).map(asset => asset.path.slice(prefix.length))), message => config.logger.info(message));
        }
        for (const asset of assets) {
          const target = destination(asset.path);
          await mkdir(dirname(target), { recursive: true });
          await copyFile(resolve(config.publicDir, asset.path), target);
        }
        for (const entry of await readdir(config.publicDir, { withFileTypes: true })) {
          if (MANAGED_ASSET_DIRS.includes(entry.name)) continue;
          await cp(resolve(config.publicDir, entry.name), destination(entry.name), { recursive: true });
        }
      },
    },
  };
}
