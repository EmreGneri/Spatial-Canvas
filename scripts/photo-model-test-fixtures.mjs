// Model-boundary unit tests use eight zero bytes, while exercising the real integrity checker.
// Only test-process JSON loading is replaced; production code contains no test bypass.
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
export function installPhotoModelFixtures() {
  return registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url.endsWith('/src/engine/vision/david-mask-asset.json')
        || url.endsWith('/src/engine/reconstruction/birefnet-asset.json')) {
        const descriptor = JSON.parse(Buffer.from(loaded.source).toString());
        return { ...loaded, source: JSON.stringify({ ...descriptor, size: 8,
          sha256: createHash('sha256').update(Buffer.alloc(8)).digest('hex') }) };
      }
      return loaded;
    },
  });
}
