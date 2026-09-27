// gradcheck.js — finite-difference validation of the analytic gradients.
// Runs project+sort+render+chain (no Adam) on one fixed camera, reads the
// analytic gradient from gradF, then central-differences the training loss
// (stats[1], fixed-point x4096) w.r.t. randomly sampled parameters.
//
// Invoke from the console:
//   const { gradCheck } = await import('./js/gs/gradcheck.js');
//   await gradCheck(window.__app.trainer);

const TILE = 16;

/** Validate the CAMERA gradients (rotation, translation, shared log-focal)
 *  against finite differences on the small rig.
 *    (await import('./js/gs/gradcheck.js')).gradCheckPose() */
export async function gradCheckPose(opts = {}) {
  const { rodrigues, m3mul } = await import('../sfm/geometry.js');
  // opts.depth (true | 'only'): the pose gradients WITH the depth loss (it
  // reaches the camera through the chain's dL/dpc.z) — see gradCheckSmall
  const { trainer, destroy, depth } = await makeRig(opts.depth ? { depthWeight: opts.depthWeight ?? 1 } : {}, opts.depth);
  const meta = trainer.camMeta[0];
  try {
    if (opts.depth) await maskDepthGate(trainer, depth);
    // analytic
    const a0 = await trainer._evalPass(0);
    const nr = trainer.camMeta.length;
    const analytic = [];
    for (let k = 0; k < 6; k++) analytic.push(a0.camGrad[k] / 64);
    analytic.push(a0.camGrad[nr * 8] / 64); // dlogf (both axes)
    analytic.push(a0.camGrad[6] / 64);      // d(log gain)
    analytic.push(a0.camGrad[7] / 64);      // d(bias)
    analytic.push(a0.camGrad[nr * 8 + 1] / 64); // dlog(fy) alone = pixel-aspect gradient

    // FD via loss (stats[1], fixed x32768)
    const d = trainer.device;
    const readLoss = async () => {
      const rb = d.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = d.createCommandEncoder();
      enc.copyBufferToBuffer(trainer.bufStats, 0, rb, 0, 16);
      d.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const v = new Uint32Array(rb.getMappedRange())[1];
      rb.unmap(); rb.destroy();
      return v / 32768;
    };
    const lossOf = async (override) => {
      const d2 = trainer.device;
      d2.queue.writeBuffer(trainer.bufStats, 0, trainer.statsZero);
      const uni = trainer._camUniform({ ...meta, ...(override || {}) }, 1, meta.offset, 0);
      d2.queue.writeBuffer(trainer.uniTrain, 0, uni);
      d2.queue.writeBuffer(trainer.bufTileCnt, 0, trainer.tileZero);
      const enc = d2.createCommandEncoder();
      const p = enc.beginComputePass();
      trainer.encodeRaster(p, meta, true);
      p.setPipeline(trainer.pipeChain); p.setBindGroup(0, trainer.bgChain);
      p.dispatchWorkgroups(Math.ceil(trainer.n / 256));
      p.end();
      d2.queue.submit([enc.finish()]);
      d2.queue.writeBuffer(trainer.bufCamGrad, 0, new Int32Array((nr + 1) * 8));
      return await readLoss();
    };

    const results = [];
    const names = ['rot.x', 'rot.y', 'rot.z', 't.x', 't.y', 't.z', 'logf', 'expGain', 'expBias', 'logfy'];
    const fy0 = meta.fy ?? meta.f;
    for (let k = 0; k < 10; k++) {
      const h = k < 3 ? 1e-3 : (k < 6 ? 2e-3 : (k === 6 || k === 9 ? 1e-3 : 5e-3));
      const pose = (sign) => {
        if (k < 3) {
          const w = [0, 0, 0]; w[k] = sign * h;
          return { R: Array.from(m3mul(rodrigues(w), meta.R)) };
        }
        if (k < 6) {
          const t = meta.t.slice(); t[k - 3] += sign * h;
          return { t };
        }
        if (k === 6) return { f: meta.f * Math.exp(sign * h), fy: fy0 * Math.exp(sign * h) };
        if (k === 7) return { g: sign * h };
        if (k === 9) return { fy: fy0 * Math.exp(sign * h) };
        return { b: sign * h };
      };
      const lp = await lossOf(pose(1));
      const lm = await lossOf(pose(-1));
      const fd = (lp - lm) / (2 * h);
      const a = analytic[k];
      const denom = Math.max(Math.abs(a), Math.abs(fd));
      results.push({
        name: names[k],
        analytic: +a.toFixed(4), fd: +fd.toFixed(4),
        relErr: denom < 1e-3 ? 0 : +(Math.abs(a - fd) / denom).toFixed(4),
      });
    }
    return { ok: results.every((r) => r.relErr < 0.05), results };
  } finally {
    destroy();
  }
}

/** Depth-supervision rig (opts.depth): a smooth target depth over the 64x64
 *  camera (the splats sit at z 2..4) with an invalid (NaN) column band.
 *  depth === 'only' also invalidates the COLOUR target (the -1 sentinel), so
 *  the loss is pure depth — the colour-invalid-but-depth-valid path. */
function rigTarget(W, H, rgb, depth) {
  if (!depth) return { tw: W, th: H, rgb };
  if (depth === 'only') rgb.fill(-1);
  const dep = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      dep[y * W + x] = x >= 40 && x < 44 ? NaN : 3 + 0.6 * Math.sin(x * 0.13) * Math.cos(y * 0.09);
  return { tw: W, th: H, rgb, depth: dep };
}

/** Depth rigs render denser (bigger, more opaque splats): the depth loss needs
 *  coverage O > 0.5, which the sparse colour rig reaches on few pixels. */
function densifyRig(data, n) {
  for (let i = 0; i < n; i++) {
    const b = i * 16;
    for (let k = 3; k < 6; k++) data[b + k] += Math.log(1.5);
    data[b + 13] += 1.5;
  }
}

/** The depth loss applies only where the rendered coverage O > 0.5 — a step.
 *  Invalidate the target where O sits within +-band of it, so no central
 *  difference straddles the gate (the colour loss has no such step). Returns
 *  { supervised, gated } pixel counts. */
async function maskDepthGate(trainer, dep, band = 0.1) {
  const d = trainer.device;
  const meta = trainer.camMeta[0];
  d.queue.writeBuffer(trainer.uniTrain, 0, trainer.camUniforms[0]);
  d.queue.writeBuffer(trainer.bufTileCnt, 0, trainer.tileZero);
  d.queue.writeBuffer(trainer.bufStats, 0, trainer.statsZero);
  const np = meta.w * meta.h;
  const rb = d.createBuffer({ size: np * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = d.createCommandEncoder();
  const p = enc.beginComputePass();
  trainer.encodeRaster(p, meta, true);
  p.setPipeline(trainer.pipeChain); p.setBindGroup(0, trainer.bgChain); // drains gradP
  p.dispatchWorkgroups(Math.ceil(trainer.n / 256));
  p.end();
  enc.copyBufferToBuffer(trainer.bufOut, 0, rb, 0, np * 16);
  d.queue.submit([enc.finish()]);
  // drain what this pass accumulated outside gradP (the pose check reads it)
  d.queue.writeBuffer(trainer.bufCamGrad, 0, new Int32Array((trainer.camMeta.length + 1) * 8));
  d.queue.writeBuffer(trainer.bufStats, 0, trainer.statsZero);
  await rb.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(rb.getMappedRange().slice(0));
  rb.unmap(); rb.destroy();
  const masked = new Float32Array(np);
  let supervised = 0, gated = 0;
  for (let i = 0; i < np; i++) {
    const z = dep[i], O = out[i * 4 + 3];
    if (!(z > 0 && z < Infinity)) continue;
    if (Math.abs(O - 0.5) < band) { gated++; continue; }
    masked[i] = z;
    if (O > 0.5) supervised++;
  }
  d.queue.writeBuffer(trainer.bufTarget, meta.depthOff * 4, masked);
  return { supervised, gated };
}

/** Shared tiny-rig construction (also used by gradCheckSmall). */
async function makeRig(extraOpts = {}, depth = false) {
  const { GSTrainer } = await import('./trainer.js');
  const trainer = await GSTrainer.create({ eCut: 9, aMin: 1e-4, radClamp: 10, anisoReg: 0, camGrads: true, ...extraOpts });
  const n = 160;
  const stride = 16;
  let s = 123456789 >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const data = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) {
    const b = i * stride;
    data[b] = (rnd() - 0.5) * 2.4;
    data[b + 1] = (rnd() - 0.5) * 2.4;
    data[b + 2] = 2 + rnd() * 2;
    data[b + 3] = Math.log(0.04 + rnd() * 0.1);
    data[b + 4] = Math.log(0.04 + rnd() * 0.1);
    data[b + 5] = Math.log(0.04 + rnd() * 0.1);
    data[b + 6] = rnd() * 2 - 1;
    data[b + 7] = rnd() * 2 - 1;
    data[b + 8] = rnd() * 2 - 1;
    data[b + 9] = rnd() * 2 - 1;
    data[b + 10] = (rnd() - 0.5) * 4;
    data[b + 11] = (rnd() - 0.5) * 4;
    data[b + 12] = (rnd() - 0.5) * 4;
    data[b + 13] = Math.log(0.4 / 0.6) + rnd() * 2 - 1;
  }
  const W = 64, H = 64;
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      rgb[i] = 0.5 + 0.4 * Math.sin(x * 0.31) * Math.cos(y * 0.17);
      rgb[i + 1] = 0.5 + 0.4 * Math.sin(x * 0.11 + 1) * Math.cos(y * 0.23 + 2);
      rgb[i + 2] = 0.5 + 0.4 * Math.sin((x + y) * 0.19);
    }
  if (depth) densifyRig(data, n);
  const images = [rigTarget(W, H, rgb, depth)];
  // fy != f on purpose: exercises the per-axis focal paths (aspect 0.95)
  const cams = [{ imgIdx: 0, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], f: 60, fy: 57, cx: W / 2, cy: H / 2, w: W, h: H }];
  trainer.setup({ data, n }, cams, images, W, H, 1.5);
  return { trainer, depth: images[0].depth, destroy: () => trainer.device.destroy() };
}

/** Build a small dedicated trainer (160 splats, one 64x64 camera with a
 *  procedural target) — fast and free of sort-order discontinuities, the
 *  right rig for validating backward-pass math.
 *    const { gradCheckSmall } = await import('./js/gs/gradcheck.js');
 *    await gradCheckSmall();
 *  opts.depth: true adds a target depth (the depth-supervision loss, weight
 *  opts.depthWeight, default 1, on top of the colour loss); 'only' makes the
 *  colour target invalid so the checked loss is the depth term alone.
 */
export async function gradCheckSmall(opts = {}) {
  const { GSTrainer } = await import('./trainer.js');
  // strict cutoffs: boundary discontinuities become ~A_MIN-sized, so finite
  // differences measure the smooth gradient. opts.trainer forwards extra
  // trainer options (e.g. { tileGrad: true } to validate that shader variant)
  const trainer = await GSTrainer.create({
    eCut: 9, aMin: 1e-4, radClamp: 10, anisoReg: 0, camGrads: true,
    ...(opts.depth ? { depthWeight: opts.depthWeight ?? 1 } : {}), ...(opts.trainer || {}),
  });
  const n = 160;
  const stride = 16;
  let s = 123456789 >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const data = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) {
    const b = i * stride;
    data[b] = (rnd() - 0.5) * 2.4;
    data[b + 1] = (rnd() - 0.5) * 2.4;
    data[b + 2] = 2 + rnd() * 2;
    // distinct per-axis scales + random rotation to exercise anisotropy
    data[b + 3] = Math.log(0.04 + rnd() * 0.1);
    data[b + 4] = Math.log(0.04 + rnd() * 0.1);
    data[b + 5] = Math.log(0.04 + rnd() * 0.1);
    data[b + 6] = rnd() * 2 - 1;
    data[b + 7] = rnd() * 2 - 1;
    data[b + 8] = rnd() * 2 - 1;
    data[b + 9] = rnd() * 2 - 1;
    data[b + 10] = (rnd() - 0.5) * 4;
    data[b + 11] = (rnd() - 0.5) * 4;
    data[b + 12] = (rnd() - 0.5) * 4;
    data[b + 13] = Math.log(0.4 / 0.6) + rnd() * 2 - 1;
  }
  const W = 64, H = 64;
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      rgb[i] = 0.5 + 0.4 * Math.sin(x * 0.31) * Math.cos(y * 0.17);
      rgb[i + 1] = 0.5 + 0.4 * Math.sin(x * 0.11 + 1) * Math.cos(y * 0.23 + 2);
      rgb[i + 2] = 0.5 + 0.4 * Math.sin((x + y) * 0.19);
    }
  if (opts.depth) densifyRig(data, n);
  const images = [rigTarget(W, H, rgb, opts.depth)];
  // fy != f on purpose: exercises the per-axis focal paths (aspect 0.95)
  const cams = [{ imgIdx: 0, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], f: 60, fy: 57, cx: W / 2, cy: H / 2, w: W, h: H }];
  trainer.setup({ data, n }, cams, images, W, H, 1.5);
  if (opts.depth && !trainer.hasDepth) throw new Error('gradCheckSmall: depth requested but the trainer built no depth variant');
  const gate = opts.depth ? await maskDepthGate(trainer, images[0].depth) : null;
  const { depth, depthWeight, trainer: _t, ...checkOpts } = opts;
  const res = await gradCheck(trainer, { samples: 80, tol: 0.05, ...checkOpts });
  if (gate) res.depthPixels = gate;
  trainer.device.destroy();
  return res;
}

/** Validate the SH coefficient gradients AND the position-through-direction
 *  term: the rig gets random nonzero SH coeffs (so dY/ddir matters), then
 *  (a) the generic param check reruns (pos slots now include the dir term)
 *  and (b) sampled SH coeffs are FD-checked against bufSHGrad.
 *    (await import('./js/gs/gradcheck.js')).gradCheckSH(3) */
export async function gradCheckSH(deg = 3, { samples = 60, tol = 0.05, trainer: extra = {} } = {}) {
  const { trainer, destroy } = await makeRig({ shDeg: deg, ...extra });   // extra.shUp: the horizontal-SH path
  try {
    const d = trainer.device;
    const K = trainer.shK;
    const total = trainer.n * 3 * K;
    let s = 424242 >>> 0;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const shArr = new Float32Array(total);
    for (let i = 0; i < total; i++) shArr[i] = (rnd() - 0.5) * 0.5;
    d.queue.writeBuffer(trainer.bufSH, 0, shArr);

    // (a) param gradients with active view dependence
    const params = await gradCheck(trainer, { samples: 80, tol });

    // (b) SH coefficient gradients vs finite differences
    const meta = trainer.camMeta[0];
    const runPass = () => {
      d.queue.writeBuffer(trainer.uniTrain, 0, trainer.camUniforms[0]);
      d.queue.writeBuffer(trainer.bufTileCnt, 0, trainer.tileZero);
      d.queue.writeBuffer(trainer.bufStats, 0, trainer.statsZero);
      const enc = d.createCommandEncoder();
      const p = enc.beginComputePass();
      trainer.encodeRaster(p, meta, true);
      p.setPipeline(trainer.pipeChain); p.setBindGroup(0, trainer.bgChain);
      p.dispatchWorkgroups(Math.ceil(trainer.n / 256));
      p.end();
      d.queue.submit([enc.finish()]);
    };
    const readBuf = async (buf, bytes) => {
      const rb = d.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = d.createCommandEncoder();
      enc.copyBufferToBuffer(buf, 0, rb, 0, bytes);
      d.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const out = rb.getMappedRange().slice(0);
      rb.unmap(); rb.destroy();
      return out;
    };
    const readLoss = async () => new Uint32Array(await readBuf(trainer.bufStats, 16))[1] / 32768;

    runPass();
    const grad = new Float32Array(await readBuf(trainer.bufSHGrad, total * 4));
    const h = 0.02;
    const errs = [];
    let attempts = 0;
    while (errs.length < samples && attempts < samples * 10) {
      attempts++;
      const j = (rnd() * total) | 0;
      if (Math.abs(grad[j]) < 0.02 && rnd() < 0.9) continue; // prefer informative
      const orig = shArr[j];
      const set = (v) => d.queue.writeBuffer(trainer.bufSH, j * 4, new Float32Array([v]));
      set(orig + h); runPass(); const lp = await readLoss();
      set(orig - h); runPass(); const lm = await readLoss();
      set(orig);
      const fd = (lp - lm) / (2 * h);
      const a = grad[j];
      const denom = Math.max(Math.abs(a), Math.abs(fd));
      errs.push(denom < 1e-3 ? 0 : Math.abs(a - fd) / denom);
    }
    runPass(); // leave gradP zeroed
    errs.sort((a, b) => a - b);
    const median = errs[errs.length >> 1];
    const fails = errs.filter((e) => e > tol).length;
    return {
      ok: params.ok && median < tol,
      params,
      sh: { checked: errs.length, median: +median.toFixed(4), max: +errs[errs.length - 1].toFixed(4), failsOverTol: fails },
    };
  } finally {
    destroy();
  }
}

export async function gradCheck(trainer, { camIdx = 0, samples = 48, seed = 7, tol = 0.1 } = {}) {
  const d = trainer.device;
  const stride = trainer.stride || 8;
  const meta = trainer.camMeta[camIdx];
  const uni = trainer.camUniforms[camIdx];
  const tilesX = Math.ceil(meta.w / TILE), tilesY = Math.ceil(meta.h / TILE);

  const runPass = () => {
    d.queue.writeBuffer(trainer.uniTrain, 0, uni);
    d.queue.writeBuffer(trainer.bufTileCnt, 0, trainer.tileZero);
    d.queue.writeBuffer(trainer.bufStats, 0, trainer.statsZero);
    const enc = d.createCommandEncoder();
    const p = enc.beginComputePass();
    trainer.encodeRaster(p, meta, true);
    p.setPipeline(trainer.pipeChain); p.setBindGroup(0, trainer.bgChain);
    p.dispatchWorkgroups(Math.ceil(trainer.n / 256));
    p.end();
    d.queue.submit([enc.finish()]);
  };

  const readBuf = async (buf, bytes) => {
    const rb = d.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(buf, 0, rb, 0, bytes);
    d.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const out = rb.getMappedRange().slice(0);
    rb.unmap(); rb.destroy();
    return out;
  };
  const readLoss = async () => new Uint32Array(await readBuf(trainer.bufStats, 16))[1] / 32768;

  // analytic gradients + current parameters
  runPass();
  const grad = new Float32Array(await readBuf(trainer.bufGradF, trainer.n * stride * 4));
  const params = new Float32Array(await readBuf(trainer.bufParams, trainer.n * stride * 4));

  const hScale = arguments[1] && arguments[1].hScale ? arguments[1].hScale : 1;
  const hBySlot = trainer.hBySlot.map((h) => h * hScale);
  const slotName = trainer.slotNames;

  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

  const results = [];
  let attempts = 0;
  while (results.length < samples && attempts < samples * 8) {
    attempts++;
    const j = (rnd() * trainer.n * stride) | 0;
    const slot = j % stride;
    if (hBySlot[slot] === 0) continue;              // padding slot
    if (Math.abs(grad[j]) < 0.03 && rnd() < 0.9) continue; // prefer informative params
    const h = hBySlot[slot];
    const orig = params[j];
    const set = (v) => d.queue.writeBuffer(trainer.bufParams, j * 4, new Float32Array([v]));
    set(orig + h); runPass(); const lp = await readLoss();
    set(orig - h); runPass(); const lm = await readLoss();
    set(orig);
    const fd = (lp - lm) / (2 * h);
    const a = grad[j];
    const denom = Math.max(Math.abs(a), Math.abs(fd));
    const relErr = denom < 1e-3 ? 0 : Math.abs(a - fd) / denom;
    results.push({ slot, name: slotName[slot], analytic: a, fd, relErr });
  }
  runPass(); // leave gradP zeroed

  // summarize per slot type
  const bySlot = new Map();
  for (const res of results) {
    if (!bySlot.has(res.name)) bySlot.set(res.name, []);
    bySlot.get(res.name).push(res.relErr);
  }
  const summary = {};
  let worst = 0, fails = 0;
  for (const [name, errs] of bySlot) {
    errs.sort((a, b) => a - b);
    const med = errs[errs.length >> 1];
    const max = errs[errs.length - 1];
    worst = Math.max(worst, med);
    fails += errs.filter((e) => e > tol).length;
    summary[name] = { n: errs.length, median: +med.toFixed(4), max: +max.toFixed(4) };
  }
  return {
    ok: worst < tol,
    checked: results.length,
    failsOverTol: fails,
    summary,
    worstSamples: results.sort((a, b) => b.relErr - a.relErr).slice(0, 5)
      .map((x) => ({ name: x.name, analytic: +x.analytic.toFixed(5), fd: +x.fd.toFixed(5), relErr: +x.relErr.toFixed(3) })),
  };
}
