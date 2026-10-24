export const POINT_COUNTS = [147456, 262144, 524288, 1048576] as const;

export function pointTextureSize(count: number): [number, number] {
  if (!POINT_COUNTS.some(value => value === count)) throw new Error('Unsupported point count.');
  const width = count === 147456 ? 384 : count === 262144 ? 512 : 1024;
  return [width, count / width];
}

export function summarizeFrames(samples: number[]) {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Frame samples must contain positive finite durations.');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { frames: samples.length, fps: 1000 * samples.length / samples.reduce((a, b) => a + b, 0),
    frameMsP50: percentile(0.5), frameMsP95: percentile(0.95) };
}

export function classifyAdapter(renderer: string): 'intel' | 'rtx' | 'software' | 'unknown' {
  if (/swiftshader|llvmpipe|software|microsoft basic/i.test(renderer)) return 'software';
  if (/nvidia.*rtx|rtx.*nvidia/i.test(renderer)) return 'rtx';
  if (/intel/i.test(renderer)) return 'intel';
  return 'unknown';
}
