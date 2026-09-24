import type { EvalReport, MetricColumn } from '../engine/vision/types';

const COLUMNS: MetricColumn[] = ['depth', 'seg', 'pose', 'timing'];
const ARMS = [
  'ao', 'focusBoost', 'edgeStrength', 'letterbox_vs_distort',
  'importanceSampling', 'depthSmoothing', 'foregroundStretch',
] as const;

/** Validate uploaded reports before displaying any result as a measured value. */
export function parseEvalReport(raw: unknown): EvalReport {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('report must be an object');
  const report = raw as Record<string, unknown>;
  for (const field of ['run', 'date', 'commit']) {
    if (typeof report[field] !== 'string' || !report[field]) throw new Error(`missing ${field}`);
  }
  if (!report.params || typeof report.params !== 'object' || Array.isArray(report.params)) {
    throw new Error('missing params');
  }
  const params = report.params as Record<string, unknown>;
  if (Object.keys(params).length !== ARMS.length) throw new Error('params must contain seven ablation arms');
  for (const arm of ARMS) {
    const value = params[arm];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`invalid ${arm}`);
    }
  }
  if (!Array.isArray(report.results)) throw new Error('results must be an array');
  for (const row of report.results) {
    if (!row || typeof row !== 'object') throw new Error('invalid result row');
    if (typeof row.metric !== 'string' || !row.metric ||
        typeof row.value !== 'number' || !Number.isFinite(row.value) ||
        typeof row.dataset !== 'string' || !row.dataset ||
        typeof row.split !== 'string' || !row.split ||
        !COLUMNS.includes(row.column)) {
      throw new Error('invalid result metric, value, dataset, split or column');
    }
  }
  return raw as EvalReport;
}
