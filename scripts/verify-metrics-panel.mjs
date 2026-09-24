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
