// Validate recorded independent runs without downloading models or rerunning inference.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
const dir = 'docs/benchmarks/photo-raw', fixtureHashes = new Map(), profiles = new Set(), cells = {};
let count = 0;
for (const phase of ['before', 'after', 'live']) {
  const files = readdirSync(dir).filter(n => new RegExp(`^${phase}-(thumbnail|12mp)-(10|100)-[123]\\.json$`).test(n));
  assert.equal(files.length, phase === 'live' ? 3 : 12, `${phase}: every cold/warm pair must exist`);
  for (const file of files) {
    const rows = JSON.parse(readFileSync(`${dir}/${file}`));
    assert.deepEqual(rows.map(r => r.pass), ['cold', 'warm'], `${file}: two visits required`);
    assert.equal(rows[0].profile, rows[1].profile, 'warm uses the same profile');
    assert.ok(!profiles.has(rows[0].profile), 'every cold uses an independent profile');
    profiles.add(rows[0].profile);
    for (const r of rows) {
      assert.equal(r.failure, null); assert.equal(r.report.status, 'ready');
      assert.equal(r.pngDisabled, false, 'final gate is open');
      assert.equal(typeof r.timing.previewOpportunity, 'number');
      assert.ok(r.timing.previewOpportunity >= r.timing.t0);
      assert.ok(r.timing.finalGate >= r.timing.previewOpportunity);
      assert.equal(r.latency, 20); assert.equal(r.throughputBytesPerSecond, r.mbps * 125000);
      assert.equal(r.environment.adapter.vendor, 'nvidia');
      assert.equal(r.environment.visibility, 'visible');
      assert.equal(r.errors.filter(e => e.type === 'pageerror').length, 0);
      const m = r.report.metadata;
      assert.deepEqual([m.depthModel,m.depthBackend,m.segmentationModel,m.davidMask?.arkaUc,m.davidMask?.reddedildi ?? false],
        ['v2-small','webgpu','birefnet','webgpu',false], 'comparable final path required');
      if (phase === 'after') {
        const mask = r.report.downloads.find(d => /birefnet/i.test(d.url) && d.status === 'ok');
        assert.ok(mask, 'photo mask download/cache read is measured');
        assert.ok(mask.startedAt >= r.report.startedAt + m.previewReadyMs, 'mask bytes start after depth preview');
      }
      const photo = r.label.includes('-12mp-') ? '12mp' : 'thumbnail';
      const previous = fixtureHashes.get(photo);
      if (previous) assert.equal(r.fixture.sha256, previous); else fixtureHashes.set(photo, r.fixture.sha256);
      if (photo === '12mp') assert.deepEqual([r.report.meta.width,r.report.meta.height], [4000,3000]);
      const stem = file.slice(0,-5);
      for (const milestone of ['preview','final']) assert.ok(existsSync(`${dir}/${stem}-${r.pass}-${milestone}.png`));
      const cell = `${phase}/${photo}/${r.mbps}/${r.pass}`;
      cells[cell] = (cells[cell] ?? 0) + 1; count++;
    }
  }
}
assert.equal(count, 54); assert.equal(profiles.size, 27);
for (const [cell, n] of Object.entries(cells)) assert.equal(n, 3, `${cell}: three independent samples`);
const before = JSON.parse(readFileSync('docs/benchmarks/photo-model-identities-20261108.json'));
const after = JSON.parse(readFileSync('docs/benchmarks/photo-model-identities-after-20261108.json'));
assert.deepEqual(after, before, 'all ten active model/runtime identities remain unchanged');
const result = { status: 'passed', operations: count, profiles: profiles.size, cells, fixtureHashes: Object.fromEntries(fixtureHashes), modelIdentities: before.length };
writeFileSync('docs/benchmarks/photo-matrix-validation-20261108.json', JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
