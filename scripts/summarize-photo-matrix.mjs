// CDP transport bytes remain separate from decoded model buffer lengths and manifest sizes.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = 'docs/benchmarks/photo-raw';
const rows = readdirSync(dir).filter(n => /^(before|after|live)-(thumbnail|12mp)-(10|100)-\d+\.json$/.test(n))
  .flatMap(n => JSON.parse(readFileSync(`${dir}/${n}`)).map(r => ({ ...r, raw: `${dir}/${n}` })));
const model = r => /\/models\/|\/ort\/|\/mediapipe-wasm\//.test(r.url);
// A conditional 304 is bodyless. Chrome cancels the unused fetch response after Cache Storage reuse,
// so loadingFinished may be absent; responseReceived still supplies the exact received header bytes.
const transportBytes = r => r.encodedDataLength ?? ((r.wireStatus ?? r.status) === 304 ? r.headerEncodedBytes : undefined);
const elapsed = entries => {
  const spans = entries.filter(r => r.end).map(r => [r.start, r.end]).sort((a, b) => a[0] - b[0]);
  let sum = 0, end = -Infinity;
  for (const [a, b] of spans) { sum += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
  return sum;
};
const stats = ns => {
  const a = ns.filter(Number.isFinite).sort((a, b) => a - b);
  return a.length ? `${a[0].toFixed(3)} / ${((a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2).toFixed(3)} / ${a.at(-1).toFixed(3)}` : 'ÖLÇÜLMEDİ';
};
const metrics = rows.map(r => {
  const requests = r.network.filter(model), t = r.timing;
  const metadata = r.report?.metadata;
  const pathFingerprint = JSON.stringify({ depth: metadata?.depthModel, backend: metadata?.depthBackend,
    segmentation: metadata?.segmentationModel, davidBackend: metadata?.davidMask?.arkaUc,
    davidRejected: metadata?.davidMask?.reddedildi ?? false });
  return { label: r.label, pass: r.pass, raw: r.raw, status: r.report?.status, failure: r.failure, pathFingerprint,
    previewOpportunityS: typeof t.previewOpportunity === 'number' ? (t.previewOpportunity - t.t0) / 1000 : null,
    previewMetadataS: r.report && Number.isFinite(r.report.metadata.previewReadyMs) ? (r.report.startedAt + r.report.metadata.previewReadyMs - t.t0) / 1000 : null,
    decodeS: r.report ? (r.report.startedAt - t.t0) / 1000 : null,
    finalS: r.report ? (r.report.endedAt - t.t0) / 1000 : null,
    finalGateS: t.finalGate === null ? null : (t.finalGate - t.t0) / 1000,
    modelNetworkActiveS: elapsed(requests),
    modelNetworkWindowS: requests.some(r => r.end) ? Math.max(...requests.filter(r => r.end).map(r => r.end)) - Math.min(...requests.map(r => r.start)) : null,
    knownTransportBytes: requests.reduce((s, r) => s + (transportBytes(r) ?? 0), 0),
    unknownTransportRequests: requests.filter(r => transportBytes(r) === undefined).map(r => ({ url: r.url, status: r.wireStatus ?? r.status })),
    requests: requests.map(r => ({ url: r.url, status: r.status, wireStatus: r.wireStatus, bytes: transportBytes(r) ?? null,
      byteSource: r.encodedDataLength !== undefined ? 'CDP loadingFinished' : (r.wireStatus ?? r.status) === 304 ? 'CDP responseReceived headers; bodyless 304' : 'unknown', failure: r.failure,
      bodyEncodedBytes: r.bodyEncodedBytes ?? null, headerEncodedBytes: r.headerEncodedBytes,
      cache: r.servedFromCache ? 'memory/disk (CDP servedFromCache)' : r.fromDiskCache ? 'disk' : r.fromServiceWorker ? 'service-worker' : (r.wireStatus ?? r.status) === 304 ? '304 validation' : 'network/CDP',
      seconds: r.end ? r.end - r.start : null })),
    cacheStorage: r.report?.downloads.filter(d => d.source === 'cache-storage'), profile: r.profile, environment: r.environment };
});
writeFileSync('docs/benchmarks/photo-metrics-20261108.json', JSON.stringify(metrics, null, 2));
const lines = ['# Fotoğraf production ölçüm matrisi', '',
  'Sayılar min / medyan / maks. Sunum fırsatı iki rAF ve gerçek önizleme PNG ile gözlendi; fiziksel ekran gecikmesi ölçülmedi. Preview metadata CPU/komut tamamlanmasıdır. Model byte toplamı CDP loadingFinished encodedDataLength; gövdesiz304' + " için responseReceived encodedDataLength header baytlarını kullanır (Chrome kullanılmayan304 yanıtını ERR_ABORTED ile kapatabilir). HTTP yanıt header+body baytlarıdır; request/TCP/TLS overhead dahil değildir. Bilinmeyen baytlar sıfır sayılmaz. Cache Storage bodyBytes ağ baytı değildir.", '',
  '| Faz | Fotoğraf | Mbit/s | Ziyaret | Final yol | Başarılı n | Sunum fırsatı sn | Preview metadata sn | Final sn | UI final gate sn | Model aktif ağ sn | Model ağ penceresi sn | Bilinen transfer B | Transferi belirsiz istek |',
  '|---|---|---:|---|---|---:|---|---|---|---|---|---|---|---|'];
for (const phase of ['before', 'after', 'live']) for (const photo of ['thumbnail', '12mp']) for (const mbps of [100, 10]) for (const pass of ['cold', 'warm']) {
  const a = metrics.filter(r => r.label.startsWith(`${phase}-${photo}-${mbps}-`) && r.pass === pass && r.status === 'ready' && !r.failure);
  const paths = [...new Set(a.map(r => r.pathFingerprint))];
  for (const path of paths.length ? paths : ['ÖLÇÜLMEDİ']) {
    const group = a.filter(r => r.pathFingerprint === path);
    lines.push(`| ${phase} | ${photo} | ${mbps} | ${pass} | ${path} | ${group.length} | ${stats(group.map(r => r.previewOpportunityS))} | ${stats(group.map(r => r.previewMetadataS))} | ${stats(group.map(r => r.finalS))} | ${stats(group.map(r => r.finalGateS))} | ${stats(group.map(r => r.modelNetworkActiveS))} | ${stats(group.map(r => r.modelNetworkWindowS))} | ${stats(group.map(r => r.knownTransportBytes))} | ${stats(group.map(r => r.unknownTransportRequests.length))} |`);
  }
}
lines.push('', 'URL bazında transfer/cache kaynağı ve bütün ham dosya yolları: photo-metrics-20261108.json. Canlı AFTER deploy yapılmadığı için yok. Yerel HTTP warm cache sonucu HTTPS canlıya genellenmez. 12 MP fixture thumbnail büyütmesidir; gerçek telefon fotoğrafı/EXIF çeşitliliği doğrulanmadı. Mobil donanım ve termal eşdeğerlik ölçülmedi.', '');
writeFileSync('docs/benchmarks/photo-matrix-20261108.md', lines.join('\n'));
console.log(JSON.stringify({ successful: metrics.filter(r => r.status === 'ready' && !r.failure).length, total: metrics.length }));

// Descriptive comparisons never promote a difference inside the observed ranges to a speed claim.
const comparisons = [];
const numericRange = values => {
  const a = values.filter(Number.isFinite).sort((a,b)=>a-b);
  return a.length ? { min: a[0], median: (a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2, max: a.at(-1) } : null;
};
for (const photo of ['thumbnail','12mp']) for (const mbps of [100,10]) for (const pass of ['cold','warm']) {
  const group = phase => metrics.filter(r => r.label.startsWith(`${phase}-${photo}-${mbps}-`) && r.pass === pass && r.status === 'ready' && !r.failure);
  const b = group('before'), a = group('after');
  for (const metric of ['previewOpportunityS','finalS','modelNetworkActiveS','knownTransportBytes']) {
    const before = numericRange(b.map(r=>r[metric])), after = numericRange(a.map(r=>r[metric]));
    const complete = b.length >= 3 && a.length >= 3;
    comparisons.push({ photo, mbps, pass, metric, beforeCount: b.length, afterCount: a.length, before, after,
      medianChange: complete && before && after ? after.median-before.median : null,
      decision: !complete ? 'incomplete' : !before || !after ? 'missing metric' : after.max < before.min ? 'lower separated ranges' : after.min > before.max ? 'higher separated ranges' : 'overlap; no measurable improvement claim' });
  }
}
writeFileSync('docs/benchmarks/photo-comparison-20261108.json', JSON.stringify(comparisons,null,2));
