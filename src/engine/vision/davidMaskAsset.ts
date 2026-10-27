import asset from './david-mask-asset.json' with { type: 'json' };
import { ilerlemeliGetir, MODEL_ONBELLEGI } from '../../indirmeIlerleme.ts';

export const DAVID_MASK_PATH = `/models/${asset.dest}`;
export const DAVID_MASK_REMOTE = `https://huggingface.co/${asset.repo}/resolve/${asset.rev}/${asset.file}`;

/** Same pinned weights, served by the deployment CDN with HTTP compression. */
export async function loadDavidMaskBytes(
  get: (url: string, label: string) => Promise<ArrayBuffer> = ilerlemeliGetir,
  origin = typeof location === 'undefined' ? 'http://localhost' : location.origin ?? `https://${location.hostname}`,
): Promise<ArrayBuffer> {
  try {
    // Existing visitors already have these exact weights under the HF key.
    if (typeof caches !== 'undefined' && await (await caches.open(MODEL_ONBELLEGI)).match(DAVID_MASK_REMOTE))
      return await get(DAVID_MASK_REMOTE, 'DAViD maske');
  } catch { /* Cache access/read failure falls through to the deployment asset. */ }
  try { return await get(new URL(DAVID_MASK_PATH, origin).href, 'DAViD maske'); }
  catch {
    // Older deployments or missing static assets retain the existing HF route.
    return get(DAVID_MASK_REMOTE, 'DAViD maske');
  }
}
