/**
 * RELEASE HYGIENE (review-fixes task 3): ORT pin, cache headers, notices.
 *
 * Finding: onnxruntime-web was on a dev-nightly `^` range; after an ORT
 * upgrade the new hashed JS glue would load a year-old .wasm cached at the
 * same /ort/* URL and every model would break. /ort and /models carried an
 * "immutable" cache header even though their content can change without the
 * URL changing (a model/ORT upgrade); Vite's hashed /assets/* files got no
 * cache header at all. The build also stripped bundled license notices
 * (mediabunny MPL, splat.js MIT).
 *
 * This script verifies four things: (1) vercel.json cache rules, (2)
 * onnxruntime-web is pinned to a single exact version, (3)
 * public/THIRD_PARTY_NOTICES.txt covers every production dependency,
 * vendored code and model weight -- and that its generator didn't leak
 * license-body boilerplate as a fake copyright line or silently drop a
 * package with no license field, (4) the notices generator is chained into
 * the build so it can't go stale.
 *
 *   node scripts/verify-release-hygiene.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// [1] vercel.json cache rules: /ort and /models content can change without
// the URL changing -> must-revalidate. /assets is content-hashed by Vite ->
// safe to cache forever.
{
  const vercel = readJson('vercel.json');
  const bySource = Object.fromEntries(
    vercel.headers.map((h) => [h.source, h.headers.find((x) => x.key === 'Cache-Control')?.value]),
  );
  assert.equal(bySource['/ort/(.*)'], 'public, max-age=0, must-revalidate',
    '/ort/* content can change while its URL stays the same; an immutable cache would serve a stale .wasm');
  assert.equal(bySource['/models/(.*)'], 'public, max-age=0, must-revalidate',
    '/models/* content can change while its URL stays the same; an immutable cache would serve a stale weight');
  assert.equal(bySource['/assets/(.*)'], 'public, max-age=31536000, immutable',
    'Vite /assets/* files are content-hashed, so caching them forever is safe');
}

// [2] onnxruntime-web is pinned to an exact version, matches
// @huggingface/transformers's own dependency spec, and only one version
// exists in node_modules.
{
  const pkg = readJson('package.json');
  const spec = pkg.dependencies['onnxruntime-web'];
  assert.ok(!/^[\^~]/.test(spec), `onnxruntime-web must be pinned to an exact version, found: ${spec}`);

  const transformersPkg = readJson('node_modules/@huggingface/transformers/package.json');
  assert.equal(spec, transformersPkg.dependencies['onnxruntime-web'],
    'onnxruntime-web spec must match @huggingface/transformers\'s own dependency spec');

  const lock = readJson('package-lock.json');
  const versions = new Set(
    Object.entries(lock.packages)
      .filter(([p]) => p.split('node_modules/').pop() === 'onnxruntime-web')
      .map(([, info]) => info.version),
  );
  assert.equal(versions.size, 1, `node_modules must contain a single onnxruntime-web version, found: ${[...versions]}`);
  assert.ok(versions.has(spec), 'the installed version must match the package.json spec');
}

// [3] THIRD_PARTY_NOTICES.txt covers every production dependency, vendored
// code and model weight -- and its generator didn't leak license-body
// boilerplate as a fake copyright line or silently drop an unlisted license.
{
  const notices = readFileSync('public/THIRD_PARTY_NOTICES.txt', 'utf8');

  const lock = readJson('package-lock.json');
  const missing = [];
  for (const [p, info] of Object.entries(lock.packages)) {
    if (!p) continue; // the root package itself
    if (info.dev) continue; // dev-only dependency
    const name = p.split('node_modules/').pop();
    if (name.startsWith('@types/')) continue; // type declarations only, ship no runtime code
    if (!notices.includes(name)) missing.push(`${name}@${info.version}`);
  }
  assert.equal(missing.length, 0, `notices file is missing production dependencies: ${missing.join(', ')}`);

  for (const needle of [
    'splat.js',
    'MIT',
    'mediabunny',
    'MPL-2.0',
    'onnx-community/depth-anything-v2-small',
    'Apache-2.0',
    'Xenova/yolos-tiny',
    'imgly/isnet-general-onnx',
    'huggingface.co',
  ]) {
    assert.ok(notices.includes(needle), `notices file is missing "${needle}"`);
  }

  // Scope the next two checks to the npm-packages section only: section 2
  // deliberately reproduces splat.js's full MIT LICENSE text verbatim
  // (required by the brief), which legitimately contains this same
  // liability-disclaimer wording as normal license boilerplate -- that's
  // correct there and must not trip a check meant for the per-package
  // extracted copyright lines in section 1.
  const npmSection = notices.slice(notices.indexOf('1. NPM PACKAGES'), notices.indexOf('2. VENDORED CODE'));

  // The generator's fallback for a package-lock entry with no license field
  // is a literal "(unlisted)" marker -- if that ever shows up, a shipped
  // dependency has an unverified license and the generator swallowed it
  // instead of failing loudly.
  assert.ok(!npmSection.includes('(unlisted)'),
    'a package has no license field in package-lock.json; verify its license by hand and update the generator');

  // A word-wrapped LICENSE file puts "copyright" as the first word of a
  // physical line even mid-sentence (Apache's "...as indicated by a /
  // copyright notice that is included...", MIT's "...THE AUTHORS OR /
  // COPYRIGHT HOLDERS BE LIABLE..."). The generator's copyright-line
  // extractor must reject these, not print them as if they named a holder.
  for (const boilerplate of [
    'copyright notice that is included in or attached to the work',
    'COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM',
  ]) {
    assert.ok(!npmSection.includes(boilerplate),
      `notices file leaked license-body boilerplate as a copyright line: "${boilerplate}"`);
  }
}

// [4] The notices generator runs between fetch:assets and vite build (before
// public/ is copied into dist/) so it can't go stale as dependencies change.
{
  const pkg = readJson('package.json');
  assert.match(pkg.scripts.build, /npm run fetch:assets && node scripts\/gen-third-party-notices\.mjs && vite build/,
    'build script must chain the notices generator after fetch:assets and before vite build');
}

console.log('OK release hygiene: cache headers, ORT pin, third-party notices coverage');
