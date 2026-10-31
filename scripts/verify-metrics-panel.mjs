import assert from 'node:assert/strict';
import { parseEvalReport } from '../src/ui/metricsReport.ts';

const report = {
  run: 'synthetic-focusOn', date: '2026-09-24T08:00:00Z', commit: 'abc1234',
  params: { ao: null, focusBoost: 0.55, edgeStrength: null, letterbox_vs_distort: null,
    importanceSampling: null, depthSmoothing: null, foregroundStretch: null },
  results: [{ metric: 'AbsRel', value: 0.37, dataset: 'synthetic-lab', split: 'focusOn', column: 'depth' }],
};
assert.equal(parseEvalReport(report).results[0].dataset, 'synthetic-lab');

const malformedColumn = structuredClone(report);
malformedColumn.results[0].column = 'unknown';
assert.throws(() => parseEvalReport(malformedColumn), /column/);

const malformedValue = structuredClone(report);
malformedValue.results[0].value = Infinity;
assert.throws(() => parseEvalReport(malformedValue), /value/);

const malformedArm = structuredClone(report);
malformedArm.params.focusBoost = '0.55';
assert.throws(() => parseEvalReport(malformedArm), /focusBoost/);

console.log('OK metrics report validates source columns, finite values and ablations');

// Production first screen: nothing is requested on open (no /eval-out 404, no terminal command shown), and the
// file inputs are visually hidden but keyboard-focusable (display:none removes them from Tab).
import { readFileSync } from 'node:fs';
const panel = readFileSync(new URL('../src/ui/MetricsPanel.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(panel, /useEffect/, 'the metrics panel must not request the local report on mount');
assert.match(panel, /import\.meta\.env\.DEV && \(\s*<button/, 'the local-report refresh exists only in development');
for (const f of ['../src/App.tsx', '../src/ui/CapturePanel.tsx', '../src/ui/MetricsPanel.tsx']) {
  const src = readFileSync(new URL(f, import.meta.url), 'utf8');
  assert.doesNotMatch(src, /type="file"[^>]*style=\{\{ display: 'none' \}\}/s, `${f}: file input must not be display:none`);
}
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /input\.gizli-dosya \{[^}]*opacity: 0/, 'visually hidden, focusable file input');
assert.match(html, /label:has\(> input\.gizli-dosya:focus-visible\)/, 'focus ring on the label');
console.log('OK first screen requests nothing and file inputs are keyboard-focusable (source)');
