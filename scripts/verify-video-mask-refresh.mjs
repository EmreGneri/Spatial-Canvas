// Live video mask requests (docs/benchmarks/video-mask-refresh.md): first mask, retry after a
// rejected one, periodic refresh also while separation is off, user-off latch, no refresh while
// paused, one job in flight. Simulated on the RECORDED IS-Net coverage timeline of personal clip A.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);
const { videoMaskeIstegi, videoMaskeAraligi, videoAyirmaDurumu, VIDEO_MASKE_TAZELEME_MS, VIDEO_MASKE_IS_PAYI, MASKE_UST_ESIK } = await import('../src/ui/maskeKarari.ts');
const { videoStats, logMaskJob } = await import('../src/engine/vision/videoStats.ts');

// IS-Net coverage of personal clip A every 0.5 s from 0.25 s (production captureLiveMask, sidecar off).
const COV = [0.077,0.071,0.088,0.051,0.054,0.068,0.009,0.05,0.171,0.058,0.084,0.118,0.094,0.209,0.084,0.192,0.045,0.191,0.117,0.16,
  0.165,0.06,0.077,0.151,0.162,0.014,0.213,0.16,0.145,0.138,0.149,0.146,0.136,0.13,0.158,0.178,0.184,0.128,0.124,0.132,0.154,0.123,
  0.173,0.159,0.217,0.14,0.392,0.13,0.118,0.281,0.065,0.089,0.249,0.226,0.057,0.199,0.09,0.056,0.137,0.139,0.147,0.052,0.143,0.112,
  0.124,0.118,0.248,0.029,0.037,0];
const DUR = 35.3, covAt = t => COV[Math.min(COV.length - 1, Math.round(((t % DUR) - 0.25) / 0.5)) | 0] ?? 0;

/** Mirrors App: 10 Hz depth frames, one job (0.5 s) in flight, App's reject backoff (15 s, x2). */
function simulate({ start, seconds = 60, userOff = false, pausedAt = Infinity, cov = covAt, refresh = true }) {
  let mask = false, sep = false, last = -Infinity, busyUntil = -1, pending = null, nextRetry = 0, invalid = 0;
  const jobs = [], dt = 0.1;
  for (let k = 0; k * dt < seconds; k++) {
    const now = k * dt, media = start + Math.min(now, pausedAt);
    if (pending && now >= busyUntil) { // job done: App's accept / reject branch
      const c = pending.c; pending = null;
      if (c === 0 || c > MASKE_UST_ESIK) { mask = false; invalid++; nextRetry = now + Math.min(60, 15 * 2 ** (invalid - 1)); }
      else { mask = true; invalid = 0; sep = videoAyirmaDurumu(c, sep); }
      jobs.at(-1).sep = sep;
    }
    const want = videoMaskeIstegi({ maskeVar: mask, kullaniciKapatti: userOff, duraklatildi: now >= pausedAt,
      hazirMaskeVar: false, ayirmaAcik: sep, gecenMs: (now - last) * 1000, sonIsMs: 500 });
    const allowed = want && (refresh || want === 'ilk');
    if (allowed && !pending && now >= nextRetry) { last = now; pending = { c: cov(media) }; busyUntil = now + 0.5; jobs.push({ at: now, why: want, c: pending.c }); }
    if (sep && jobs.at(-1)?.onAt === undefined) jobs.at(-1).onAt = now;
  }
  return { jobs, sep, onAt: jobs.find(j => j.onAt !== undefined)?.onAt ?? null };
}

// 1. Pure gate.
const base = { maskeVar: true, kullaniciKapatti: false, duraklatildi: false, hazirMaskeVar: false, ayirmaAcik: true, gecenMs: 1e9, sonIsMs: 500 };
assert.equal(VIDEO_MASKE_TAZELEME_MS, 8000, 'upper bound: the measured 8 s period (15/8/4 s sweep)');
// Cost-bounded period: a job may take at most VIDEO_MASKE_IS_PAYI of the time, never rarer than 8 s.
assert.equal(VIDEO_MASKE_IS_PAYI, 0.25);
assert.equal(videoMaskeAraligi(500), 2000, '0.5 s job -> every 2 s');
assert.equal(videoMaskeAraligi(3000), 8000, 'slow device: capped at the old 8 s');
assert.equal(videoMaskeAraligi(null), 2400, 'unknown cost (first job pending): 0.6 s assumed');
assert.equal(videoMaskeAraligi(Number.NaN), 2400);
assert.equal(videoMaskeIstegi({ ...base, maskeVar: false }), 'ilk', 'no mask (first or after a rejected one) -> capture');
assert.equal(videoMaskeIstegi({ ...base, maskeVar: false, hazirMaskeVar: true }), null, 'paused prepared mask covers it');
assert.equal(videoMaskeIstegi(base), 'tazele');
assert.equal(videoMaskeIstegi({ ...base, ayirmaAcik: false }), 'ayirma-kapali', 'small mask, separation off: still refreshed');
assert.equal(videoMaskeIstegi({ ...base, gecenMs: 1999 }), null, 'one per period');
assert.equal(videoMaskeIstegi({ ...base, gecenMs: 2000 }), 'tazele');
// Tracker lost the subject: asked as soon as the cost bound allows, never sooner (no storm).
assert.equal(videoMaskeIstegi({ ...base, gecenMs: 2000, izKayip: true }), 'kayip');
assert.equal(videoMaskeIstegi({ ...base, gecenMs: 1999, izKayip: true }), null, 'lost still respects the cost bound');
assert.equal(videoMaskeIstegi({ ...base, izKayip: true, duraklatildi: true }), null);
assert.equal(videoMaskeIstegi({ ...base, izKayip: true, kullaniciKapatti: true }), null, 'user-off latch wins over lost');
assert.equal(videoMaskeIstegi({ ...base, duraklatildi: true }), null, 'paused: no refresh of the same frame');
for (const m of [true, false]) assert.equal(videoMaskeIstegi({ ...base, maskeVar: m, kullaniciKapatti: true }), null, 'user-off latch');

// 2. Rejected first mask (empty at 34.75 s) -> retried automatically, a mask is captured, separation turns on.
const rej = simulate({ start: 34.75 });
assert.equal(rej.jobs[0].c, 0, 'first job sees the empty frame');
assert.ok(rej.jobs.length >= 2 && rej.jobs[1].why === 'ilk' && rej.jobs[1].at >= 15, 'retried after the 15 s backoff');
assert.ok(rej.onAt !== null, 'separation turns on after the retry');

// 3. Small but VALID first mask (single dancer, 5.1 % at 1.75 s): never activates without refresh; with it, a later mask does.
const small = simulate({ start: 1.75 }), smallOld = simulate({ start: 1.75, refresh: false });
assert.ok(small.jobs[0].c > 0.04 && small.jobs[0].c < 0.08 && small.jobs[0].sep === false, 'initial 5 % mask keeps separation off');
assert.equal(smallOld.onAt, null, 'old behaviour: never re-captured, never on');
assert.equal(smallOld.jobs.length, 1);
assert.ok(small.onAt !== null && small.onAt <= 2 * VIDEO_MASKE_TAZELEME_MS / 1000 + 1, `on after a refresh (${small.onAt} s)`);

// 4. Every possible start frame of the clip: time until separation is on, with the refresh.
const onAt = COV.map((_, i) => simulate({ start: 0.25 + i * 0.5 }).onAt);
assert.ok(onAt.every(x => x !== null), 'every start frame eventually enables separation');
const sorted = [...onAt].sort((a, b) => a - b);
console.log(`time to separation on over 70 start frames: p50 ${sorted[35].toFixed(1)} s, max ${sorted.at(-1).toFixed(1)} s (` +
  `${onAt.filter(x => x > 1).length} start with a small/rejected mask)`);
assert.ok(sorted.at(-1) <= 40, 'worst start (rejected first mask, 15 s backoff) within 40 s');

// 5. User off: zero jobs. Paused: no new jobs after the pause.
assert.equal(simulate({ start: 9, userOff: true }).jobs.length, 0);
const paused = simulate({ start: 9, pausedAt: 3, seconds: 40 });
assert.ok(paused.jobs.every(j => j.at <= 3.05), 'no refresh while paused');
// One in flight: no job starts before the previous one finished.
const busy = simulate({ start: 9, seconds: 60 }).jobs;
for (let i = 1; i < busy.length; i++) assert.ok(busy[i].at - busy[i - 1].at >= 0.5);

// 6. App wiring.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(app, /const istek = videoMaskeIstegi\(\{ maskeVar: !!videoMask, kullaniciKapatti: segmentKapaliRef\.current,\s*duraklatildi: video\.paused,/);
assert.match(app, /if \(istek\) captureMask\(istek\);/);
assert.match(app, /izKayip: maskLost, sonIsMs: lastJobMs \}\);/, 'tracker state and last job cost reach the gate');
assert.doesNotMatch(app, /trackLiveMask|kutleMerkezi\(d\.data/, 'depth-centroid shift replaced by the image tracker');
// No early IS-Net download: measured cold at 100 Mbit/s it delayed the first depth frame by
// 0.6-3 s for a 0-2 s earlier mask (docs/benchmarks/video-mask-tracking.md).
assert.doesNotMatch(app, /preloadLiveMaskModel|whenDepthModelFetched/);
assert.doesNotMatch(app, /maskeYenilenmeliMi|VIDEO_MASK_MIN_REFRESH_MS|maskBaseline/, 'drift gate (never fired on personal clip A) removed');
assert.match(app, /if \(segmentKapaliRef\.current \|\| iptal \|\| maskBusy \|\|/, 'single flight: a busy request is dropped, no queue');
assert.match(app, /if \(iptal \|\| videoRef\.current !== video \|\| revision !== maskRevision\) \{ job\.dropped = true; return; \}/,
  'a job finishing after a video switch / seek / toggle is dropped');
// No timers: requests are driven by depth frames, so a stopped driver (video switch / clear) asks nothing more.
assert.match(app, /liveDepthStopRef\.current = \(\) => \{\s*iptal = true;/, 'switch/clear: the source closure is cancelled');
assert.match(app, /const syncMaskRequest = \(\) => \{\s*if \(requestedRevision === segmentRevisionRef\.current\) return;\s*requestedRevision = segmentRevisionRef\.current;\s*maskRevision\+\+;/,
  'separation toggle bumps the revision: an in-flight job is dropped');
assert.doesNotMatch(app.slice(app.indexOf('const captureMask'), app.indexOf('videoMaskRequestRef.current = captureMask')), /setTimeout|setInterval/, 'no mask timers to leak');
assert.match(app, /maskNextRetryAt = performance\.now\(\) \+ Math\.min\(60_000, 15_000 \* 2 \*\* \(invalidMasks - 1\)\)/, 'reject backoff the simulation mirrors');

// 7. Job log is bounded.
for (let i = 0; i < 520; i++) logMaskJob({ reason: 'tazele', startAt: i, mediaTime: 0, doneAt: null, appliedAt: null, coverage: null, separation: null, dropped: false });
assert.equal(videoStats.maskLog.length, 500);
assert.equal(videoStats.maskLog[0].startAt, 20);
console.log('OK video mask requests: retry after reject, refresh while separation off, user latch, paused, single flight');
