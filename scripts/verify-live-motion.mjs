// Real temporal-filter checks. No model, DOM or GPU substitute is involved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  zamansalDurumAc, zamansalYumusat, depthResultFromTensor, resetLiveDepthState,
} from '../src/engine/vision/liveDepth.ts';

const width = 96, height = 64, count = width * height;
const copy = (data) => Float32Array.from(data);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const rms = (values) => Math.sqrt(mean(values.map((value) => value * value)));
function apply(data, state, luminance, options = {}) {
  return zamansalYumusat(copy(data), state, undefined, undefined, {
    luminance, width, height, ...options,
  });
}
function frame(shift = 0, relief = 0.01, contrast = 0.16) {
  const depth = new Float32Array(count).fill(0.5);
  const luminance = new Float32Array(count).fill(0.3);
  for (let y = 16; y < 48; y++) for (let x = 20 + shift; x < 52 + shift; x++) {
    depth[y * width + x] += relief;
    luminance[y * width + x] += contrast;
  }
  return { depth, luminance };
}
function responseFrames(relief, threshold, contrast = 0.16, useLuma = true) {
  const state = zamansalDurumAc();
  const initial = frame(0, relief, contrast), moved = frame(4, relief, contrast);
  apply(initial.depth, state, useLuma ? initial.luminance : null, { threshold });
  const pixel = 32 * width + 54;
  for (let k = 1; k <= 40; k++) {
    const out = apply(moved.depth, state, useLuma ? moved.luminance : null, { threshold });
    if (Math.abs(out[pixel] - moved.depth[pixel]) <= relief * 0.1) return k;
  }
  return Infinity;
}

// The sweep compares the shipped depth-only filter with candidate luma thresholds
// on the SAME deterministic inputs. Contrast and noise fixtures are fixed upfront.
export function measure(threshold) {
  const baseline = zamansalDurumAc(), candidate = zamansalDurumAc();
  const rawNoise = [], baselineNoise = [], candidateNoise = [];
  for (let k = 0; k < 48; k++) {
    const d = new Float32Array(count), l = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      d[i] = 0.5 + 0.008 * Math.sin(0.9 * k + i * 0.37);
      l[i] = 0.45 + 0.12 * Math.sin(i * 0.13) + 0.012 * Math.sin(1.1 * k + i * 0.71);
    }
    const a = apply(d, baseline, null), b = apply(d, candidate, l, { threshold });
    if (k >= 16) for (let i = 0; i < count; i += 11) {
      rawNoise.push(d[i] - 0.5); baselineNoise.push(a[i] - 0.5); candidateNoise.push(b[i] - 0.5);
    }
  }
  const aState = zamansalDurumAc(), bState = zamansalDurumAc();
  const aTrail = [], bTrail = [], stopErrors = [], baselineStopErrors = [];
  for (let k = 0; k < 24; k++) {
    const d = new Float32Array(count), l = new Float32Array(count);
    const shift = Math.min(k, 16) * 1.5;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const wave = Math.sin((x - shift) / 6);
      d[y * width + x] = 0.5 + 0.015 * wave;
      l[y * width + x] = 0.45 + 0.2 * wave;
    }
    const a = apply(d, aState, null), b = apply(d, bState, l, { threshold });
    if (k >= 8 && k <= 16) for (let x = 16; x < width - 16; x++) {
      aTrail.push(a[32 * width + x] - d[32 * width + x]);
      bTrail.push(b[32 * width + x] - d[32 * width + x]);
    }
    if (k === 17) for (let x = 16; x < width - 16; x++) {
      stopErrors.push(b[32 * width + x] - d[32 * width + x]);
      baselineStopErrors.push(a[32 * width + x] - d[32 * width + x]);
    }
  }
  return {
    threshold, rawNoise: rms(rawNoise), baselineNoise: rms(baselineNoise), noise: rms(candidateNoise),
    baselineTrail: rms(aTrail), trail: rms(bTrail), stoppedTrail: rms(stopErrors), baselineStoppedTrail: rms(baselineStopErrors),
    strongEdge90: responseFrames(0.01, threshold), weakEdge90: responseFrames(0.01, threshold, 0.04),
  };
}

if (process.argv.includes('--bench')) {
  // Pure CPU filter cost; no model/GPU/readback/renderer time. Both paths get
  // identical preallocated inputs, restored OUTSIDE the timer. Report, don't
  // assert host-dependent timing. Use alternating order to reduce warmup bias.
  for (const [w, h] of [[252, 252], [448, 252], [384, 384]]) {
    const n = w * h, raw = new Float32Array(n), data = new Float32Array(n);
    const lum = [0, 1].map((k) => Float32Array.from({ length: n }, (_, i) => 0.4 + 0.15 * Math.sin(i * 0.13 + k * 0.1)));
    const states = [zamansalDurumAc(), zamansalDurumAc()], times = [[], []];
    for (let k = 0; k < 180; k++) {
      for (let i = 0; i < n; i++) raw[i] = 0.5 + 0.008 * Math.sin(i * 0.37 + k * 0.9);
      for (const mode of k % 2 ? [0, 1] : [1, 0]) {
        data.set(raw);
        const appearance = { luminance: mode ? lum[k % 2] : null, width: w, height: h };
        const start = performance.now();
        zamansalYumusat(data, states[mode], undefined, undefined, appearance);
        const elapsed = performance.now() - start;
        if (k >= 60) times[mode].push(elapsed);
      }
    }
    const medians = times.map((samples) => samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]);
    console.log(JSON.stringify({ node: process.version, width: w, height: h, baselineMs: medians[0], lumaMs: medians[1], extraMs: medians[1] - medians[0], extraHistoryBytes: n * 4 + 511 * 4 }));
  }
} else if (process.argv.includes('--sweep')) {
  for (const threshold of [0.02, 0.04, 0.06, 0.08, 0.12]) console.log(JSON.stringify(measure(threshold)));
} else {
  test('lateral shallow edges reach 90% within two accepted frames, including after stopping', () => {
    for (const relief of [0.005, 0.01, 0.02, 0.04]) {
      const before = responseFrames(relief, undefined, 0.16, false);
      const after = responseFrames(relief);
      console.log(`relief ${relief}: depth-only ${before} frames, appearance-aware ${after} frames`);
      assert.ok(after <= 2, `shallow lateral motion still trails by ${after} frames`);
      const state = zamansalDurumAc(), a = frame(0, relief), b = frame(4, relief);
      apply(a.depth, state, a.luminance);
      const moved = apply(b.depth, state, b.luminance);
      const stopped = apply(b.depth, state, b.luminance);
      for (const pixel of [32 * width + 21, 32 * width + 54]) {
        assert.ok(Math.abs(moved[pixel] - b.depth[pixel]) < relief * 0.1, 'leading/trailing edge history leaked');
        assert.ok(Math.abs(stopped[pixel] - b.depth[pixel]) < relief * 0.1, 'motion left a slow residual tail');
      }
    }
  });

  test('stationary appearance retains depth-only smoothing, including uniform light flashes', () => {
    const reference = zamansalDurumAc(), actual = zamansalDurumAc();
    for (let k = 0; k < 20; k++) {
      const d = Float32Array.from({ length: count }, (_, i) => 0.5 + 0.008 * Math.sin(k * 0.9 + i * 0.37));
      const l = Float32Array.from({ length: count }, (_, i) => 0.3 + 0.15 * Math.sin(i * 0.01) + (k % 2) * 0.25);
      assert.deepEqual(apply(d, actual, l), apply(d, reference, null), 'a uniform flash disabled static noise suppression');
    }
  });

  test('appearance noise stays within 10% of current jitter while smooth motion trails less', () => {
    const m = measure();
    console.log('default filter metrics', JSON.stringify(m));
    assert.ok(m.noise <= m.baselineNoise * 1.1, 'luminance noise defeated depth smoothing');
    assert.ok(m.trail < m.baselineTrail * 0.8, 'smooth lateral motion did not gain at least 20%');
    assert.ok(m.weakEdge90 <= 3, `weak-contrast edge takes ${m.weakEdge90} frames`);
    assert.ok(m.stoppedTrail < m.baselineStoppedTrail * 0.5, 'motion leaves too much residual error after stopping');
  });

  test('global exposure gain/offset does not disable stationary noise suppression', () => {
    const reference = zamansalDurumAc(), actual = zamansalDurumAc();
    const before = [], after = [];
    for (let k = 0; k < 40; k++) {
      const d = Float32Array.from({ length: count }, (_, i) => 0.5 + 0.008 * Math.sin(k * 0.9 + i * 0.37));
      const l = Float32Array.from({ length: count }, (_, i) => (0.3 + 0.15 * Math.sin(i * 0.13)) * (k % 2 ? 1.5 : 1) + (k % 2 ? 0.05 : 0));
      const a = apply(d, reference, null), b = apply(d, actual, l);
      if (k >= 16) for (let i = 0; i < count; i += 11) { before.push(a[i] - 0.5); after.push(b[i] - 0.5); }
    }
    console.log(`exposure gain jitter: depth-only ${rms(before)}, appearance-aware ${rms(after)}`);
    assert.ok(rms(after) <= rms(before) * 1.1, 'global exposure gain was mistaken for local motion');
  });

  test('exposure compensation preserves local motion in an otherwise stationary textured scene', () => {
    const a = frame(), b = frame(4), state = zamansalDurumAc();
    for (let i = 0; i < count; i++) {
      const texture = 0.07 * Math.sin(i * 0.13);
      a.luminance[i] += texture;
      b.luminance[i] = (b.luminance[i] + texture) * 1.5 + 0.05;
    }
    apply(a.depth, state, a.luminance);
    const out = apply(b.depth, state, b.luminance);
    for (const pixel of [32 * width + 21, 32 * width + 54]) assert.ok(Math.abs(out[pixel] - b.depth[pixel]) < 0.001, 'global exposure compensation hid local motion');
  });

  test('clipped exposure, flat and near-black frames retain depth-only noise suppression', () => {
    for (const [name, exposure] of [
      ['clipped', (v, k) => Math.min(1, v * (k % 2 ? 3 : 1) + (k % 2 ? 0.15 : 0))],
      ['dark', (_v, k) => 0.002 + (k % 2 ? 0.002 : 0)],
      ['flat', (_v, k) => 0.3 * (k % 2 ? 1.5 : 1)],
    ]) {
      const reference = zamansalDurumAc(), actual = zamansalDurumAc();
      let before = 0, after = 0;
      for (let k = 0; k < 40; k++) {
        const d = Float32Array.from({ length: count }, (_, i) => 0.5 + 0.008 * Math.sin(k * 0.9 + i * 0.37));
        const l = Float32Array.from({ length: count }, (_, i) => exposure(0.3 + 0.15 * Math.sin(i * 0.13), k));
        const a = apply(d, reference, null), b = apply(d, actual, l);
        if (k >= 16) for (let i = 0; i < count; i++) { before += (a[i] - 0.5) ** 2; after += (b[i] - 0.5) ** 2; }
      }
      console.log(`${name}: stationary jitter ratio ${Math.sqrt(after / before)}`);
      assert.ok(after <= before * 1.1 ** 2, `${name} exposure disabled smoothing`);
    }
  });

  test('minority motion does not poison exposure fitting for the stationary background', () => {
    for (const shift of [4, 8, 16]) {
      const reference = zamansalDurumAc(), actual = zamansalDurumAc();
      let before = 0, after = 0;
      for (let k = 0; k < 40; k++) {
        const d = new Float32Array(count), l = new Float32Array(count), s = k % 2 ? shift : 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = y * width + x, inside = y >= 16 && y < 48 && x >= 20 + s && x < 52 + s;
          d[i] = 0.5 + 0.008 * Math.sin(0.9 * k + 0.37 * i) + (inside ? 0.01 : 0);
          l[i] = (k % 2 ? 1.3 : 1) * (inside ? 0.65 : 0.3 + 0.1 * Math.sin(0.11 * x) + 0.02 * Math.cos(0.13 * y)) + (k % 2 ? 0.02 : 0);
        }
        const a = apply(d, reference, null), b = apply(d, actual, l);
        if (k >= 16) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (y < 16 || y >= 48 || x < 20 || x >= 52 + shift) {
            const i = y * width + x; before += (a[i] - 0.5) ** 2; after += (b[i] - 0.5) ** 2;
          }
        }
      }
      assert.ok(after <= before * 1.1 ** 2, `${shift}px moving subject poisoned background exposure compensation`);
    }
  });

  test('luminance history owns its buffer and missing frames do not compare stale appearance', () => {
    const state = zamansalDurumAc(), a = frame(), b = frame(4);
    const pooled = copy(a.luminance);
    apply(a.depth, state, pooled);
    pooled.set(b.luminance);
    const result = apply(b.depth, state, pooled);
    assert.equal(result[32 * width + 54], b.depth[32 * width + 54], 'pooled luminance overwrote previous appearance');
    const fallback = zamansalDurumAc(), optional = zamansalDurumAc();
    apply(a.depth, optional, a.luminance); apply(a.depth, fallback, null);
    apply(a.depth, optional, null); apply(a.depth, fallback, null);
    assert.deepEqual(apply(b.depth, optional, b.luminance), apply(b.depth, fallback, null), 'returning luma compared a nonadjacent frame');
  });

  test('invalid optional luminance falls back safely without corrupting finite depth', () => {
    for (const invalid of [new Float32Array(2), new Float32Array(count).fill(NaN), new Float32Array(count).fill(Infinity)]) {
      const a = frame(), b = frame(4), actual = zamansalDurumAc(), baseline = zamansalDurumAc();
      apply(a.depth, actual, a.luminance); apply(a.depth, baseline, null);
      assert.deepEqual(apply(b.depth, actual, invalid), apply(b.depth, baseline, null));
    }
  });

  test('same-length grids and crop rebindings do not mix incompatible histories', () => {
    const a = frame(), b = frame(4), state = zamansalDurumAc();
    apply(a.depth, state, a.luminance);
    assert.deepEqual(apply(b.depth, state, b.luminance, { width: height, height: width }), b.depth);
    const cropState = zamansalDurumAc();
    apply(a.depth, cropState, a.luminance, { sourceWindow: { x: 0.1, y: 0.1, w: 0.7, h: 0.8 } });
    assert.deepEqual(apply(b.depth, cropState, b.luminance, { sourceWindow: { x: 0.2, y: 0.1, w: 0.7, h: 0.8 } }), b.depth);
  });

  test('crop-edge padding cannot act as observed motion or bias the exposure estimate', () => {
    const a = frame(), b = frame(4), state = zamansalDurumAc(), reference = zamansalDurumAc();
    const sourceWindow = { x: 0.15, y: 0.15, w: 0.7, h: 0.7 };
    apply(a.depth, state, a.luminance, { sourceWindow });
    apply(a.depth, reference, null, { sourceWindow });
    const paddingPixel = 0;
    b.depth[paddingPixel] += 0.01;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if ((x + 0.5) / width < 0.15 || (x + 0.5) / width > 0.85 || (y + 0.5) / height < 0.15 || (y + 0.5) / height > 0.85) b.luminance[y * width + x] += 0.3;
    }
    const actual = apply(b.depth, state, b.luminance, { sourceWindow });
    const expected = apply(b.depth, reference, null, { sourceWindow });
    assert.equal(actual[paddingPixel], expected[paddingPixel], 'unobserved crop padding triggered motion bypass');
    assert.equal(actual[32 * width + 54], b.depth[32 * width + 54], 'padding biased the exposure offset');
  });

  test('production tensor postprocessing receives luma and resets all history on source reset', () => {
    const a = frame(), b = frame(4);
    // Fix global normalization endpoints away from the shallow foreground.
    for (const f of [a, b]) for (let i = 0; i < count; i++) {
      if (i < 2 * width) f.depth[i] = 0;
      if (i >= count - 2 * width) f.depth[i] = 1;
    }
    const run = (firstLuma) => {
      resetLiveDepthState();
      depthResultFromTensor([height, width], copy(a.depth), null, firstLuma);
      return depthResultFromTensor([height, width], copy(b.depth), null, b.luminance).data;
    };
    const stale = run(b.luminance), responsive = run(a.luminance);
    const pixel = 32 * width + 54;
    assert.ok(responsive[pixel] > stale[pixel] + 0.001, 'luma motion cue never reached the production filter');
    resetLiveDepthState();
    const clean = depthResultFromTensor([height, width], copy(b.depth), null, b.luminance).data;
    run(a.luminance);
    resetLiveDepthState();
    assert.deepEqual(depthResultFromTensor([height, width], copy(b.depth), null, b.luminance).data, clean);
  });
}
