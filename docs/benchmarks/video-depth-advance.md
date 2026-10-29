# Live video: advancing depth toward the shown colour (`?derinlikIlerlet=1`)

Experiment, **off by default**. It follows [video-color-depth-lag.md](video-color-depth-lag.md),
which measured the live colour running about 100 ms ahead of the geometry.

**Verdict: Dokunma.** On clip A the geometry offset did not drop beyond run-to-run noise,
the model rate and the frame-time tail got worse, and moving depth edges lost more luma
support. Clip B shows nothing either way. The flag stays, unused.

## What the flag does

While the GPU runs the model on frame t1, the existing flow Worker (`liveDepthFlowWorker`,
`fieldOnly` request) computes the backward flow between the previous model RGB (t0) and
t1. This is the same code `propagateLiveDepth` uses (split out as `liveFlowField`, output
identical to before). When depth(t1) arrives, `advanceByField` samples it
`k = (now - t1) / (t1 - t0)` flow steps upstream (constant-velocity guess, k <= 1.5).
Untrusted pixels keep the model depth.

- No extra model inference, no extra `setDepth`, and none of araKare's interpolation or
  stale drop. If both flags are set, araKare wins.
- The flow runs hidden behind inference. A first version warped onto the frame captured at
  depth arrival instead, but its in-app Worker round trip was about 110 ms, which ate the
  whole gain.
- Main-thread cost is the depth warp: 3.5 ms per model frame on A (154x280 grid) and
  1.7 ms on B.
- If the field is not ready or not usable (scene cut, under 12 % trusted), the model frame
  is presented unchanged.

`scripts/verify-depth-advance.mjs` covers the flag parsing, the flag-off wiring (same object
into `onDepth`, no extra option to `estimateDepthLive`) and the warp behaviour.

## Method

`node scripts/measure-video-color-depth-lag.mjs A.mp4 B.mp4 --seconds 20 --runs 3 --modes live,advance --out reports/video-depth-advance.json`

It is the same harness, clips, warm-up and phases as the baseline. Each run is a fresh
headed installed Chrome session (`tarayici-oturumu.mjs`) on the RTX 5070 (`nvidia /
blackwell`). Runs are interleaved: A live, A advance, B live, B advance, then repeat.

What the harness adds:

- **Frame times**: p99 and frames over 25 ms per minute.
- **Edge metrics**: `depthEdgeDensity` is the fraction of grid px with |grad depth| > 0.06.
  `depthEdgeWithoutShownLumaEdge` is the share of those px with no shown-luma edge
  (> 0.06) within 2 px, measured over all px and over moving px.
- **Advance counters**: from `window.__videoStats`.
- **advance mode only**: the RGB that the advanced geometry corresponds to is the model RGB
  warped with the same field and k. The harness does that warp itself during phase B, so the
  app does not pay for it. *colour - depth ms* then uses the extrapolation target time. That
  number shrinks by construction, so it is not evidence. The block displacement and the edge
  shift are the geometry checks.

**Session conditions were noisy.** Unrelated Codex, dev-server and sidecar processes were
running. Default fps on A varied 32-48 between sessions, against 70.5 in the baseline doc.
Each cell below gives the 3 fps values and the median of the other per-run values.

## Results (3 runs per cell, 20 s windows)

| clip | mode | render fps (runs) | frame ms p99 | frames > 25 ms /min | depth Hz | colour - depth ms p50 / p95 | block displ. src px p50 / p95 (per run p50) | edge shift shown px p50 / p95 | depth-edge density | depth edges w/o luma edge, all / moving | warp ms | trusted flow | k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | default | 32.2 / 48.1 / 46.5 (sd 8.7) | 115 | 536 | 7.0 | 153 / 315 | **19.4** / 40.7 (24, 19, 19) | 14.8 / 30.5 | 0.033 | 0.17 / 0.08 | - | - | - |
| A | advance | 46.8 / 36.8 / 35.2 (sd 6.3) | 188 | 510 | 5.1 | 82 / 403 * | **21.9** / 40.7 (18, 22, 26) | 16.1 / 28.1 | 0.022 | 0.16 / 0.14 | 3.5 | 0.41 | 0.66 |
| B | default | 56.2 / 61.1 / 68.0 (sd 5.9) | 91 | 635 | 9.1 | 103 / 230 | 0 / 8 (0, 0, 0) | 48 / 68 | 0.105 | 0.00 / 0.00 | - | - | - |
| B | advance | 61.7 / 61.4 / 60.4 (sd 0.7) | 79 | 633 | 9.1 | 71 / 211 * | 0 / 8 (0, 0, 0) | 48 / 68 | 0.104 | 0.00 / 0.00 | 1.7 | 0.52 | 0.58 |

\* Target time of the extrapolation (by construction), not measured alignment.

Advance applied/fell back per run: A 136/4, 92/6, 95/7. B 85/91, 89/92, 87/95: on B about
half of the model frames had no ready, usable field.

## Reading

- **Offset (clip A).** Moving-block displacement is 21.9 px p50 with advance against
  19.4 px for default. The per-run ranges overlap: advance 18-26, default 19-24. The p95
  stays at the search bound, and the edge shift moves from 14.8 to 16.1 px. The geometry
  did not visibly catch up with the colour.
- **Why it doesn't catch up.** The existing flow tracks about 80 corners on a 112 px grid,
  and only about 41 % of pixels pass its consistency check. On a deforming person the
  moving pixels are mostly the untrusted ones, so they keep the model depth. An offline
  check on real clip-A frames 150 ms apart agrees. Moving-pixel luma error fell only
  5-11 % with this extrapolation. It fell 10-15 % even with the measured flow to the true
  next frame, which is what araKare uses. More corners or a larger densify radius gained
  under 2 points. The flow, not the extrapolation, is the ceiling.
- **Speed (clip A).** fps is 39.6 mean with advance against 42.3 for default, within noise
  (sd 6-9). Depth Hz is 5.1 against 7.0, and frame p99 is 188 ms against 115 ms. Both are
  worse, and both are consistent with the extra main-thread and Worker work competing on an
  already loaded CPU. On clip B, fps, Hz and p99 are flat or slightly better, which is
  within noise.
- **Edges.** On A, the share of moving depth edges without a shown-luma edge rises from
  0.08 to 0.14. Untrusted pixels keep the old depth next to warped neighbours, so edges are
  torn rather than holed. Overall edge density drops from 0.033 to 0.022, which is smearing
  rather than new discontinuities. On B the edge metrics carry no information: luma edges
  are everywhere in the crowd, and the edge shift sits at its search bound as in the
  baseline.

By the user's decision rule (no offset gain beyond noise, worse depth rate and tail): not
default, flag left unused.

## Limits

- One machine and one GPU, under unrelated background load, with 3 runs per cell. fps sd
  is 6-9 on A, so differences under about 10 fps are noise.
- The proxies are source-space grid measures (160 px wide): block SAD bound ±8 grid px,
  absolute 0.06 edge thresholds, and a moving mask taken from consecutive depth-frame RGB.
  The advance-mode block metric uses the harness's own warp of the model RGB. That warp
  equals the depth warp by construction, but it was not rendered.
- The high B fallback rate (about 50 %) was not investigated. A tuned or GPU flow could
  change the verdict. That would be new machinery, outside this experiment.
