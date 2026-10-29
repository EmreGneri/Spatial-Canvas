# Video: ours vs the reference build on personal clip A — INTERIM

Status: **interim, incomplete**. The run was stopped early so another change could start on this
machine. Nothing in `src/` was changed. Every number below is interim. The run did not
reach the planned crop panels or a valid BiRefNet+DAViD mask cell.

## Method

- Clip: `personal clip A` (iPhone recording, HEVC, 1080x1920 after −90° rotation, 29.67 fps, 35.3 s,
  concert footage: dancers on a stage screen with crowd heads in front). Installed Chrome 155 decodes
  it natively, so it was **not transcoded**.
- Harness: `scripts/bench-video-vs-reference.mjs`, which uses `tarayiciOturumu`. It runs headed, installed
  Chrome (playwright-core), a 1280x800 window, a fresh profile per run, and its own Vite server per app root.
  It passes the flags `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
  --disable-background-timer-throttling` to both apps. One pilot run showed a 1 Hz depth loop that
  matched an occluded window's timer clamp, and these flags remove that clamp.
- Backend: identical for both apps in the main cells. WebGPU on the **NVIDIA RTX 5070 (blackwell)**
  adapter (`requestAdapter()` default and high-performance both returned it). Depth uses
  depth-anything-v2-small fp16 in the browser in both apps. The sidecar on 127.0.0.1:8765 was
  **blocked** in those cells. Without the block, the reference build would send depth and mask requests to
  our running sidecar. Masks were therefore browser-only: ours used IS-Net (`captureLiveMask`
  with no sidecar → `segmentForeground(...,'video')`) and the reference build used RMBG-1.4.
- Extra cell `ours-sidecar`: ours with the sidecar allowed. This is the setup `npm run dev` gives.
  The live mask is BiRefNet + DAViD on DirectML. Live depth stays in the browser because the sidecar
  only takes over depth on an explicit opt-in.
- Three runs per cell, interleaved, with the order reversed on run 2. Before each run there is a quiet gate:
  no `npm run verify` / `verify-*` / other `bench-*` node process, and system CPU below 50 %.
  The ambient CPU never dropped below about 30–40 %, mostly from the user's own Chrome and a filesystem
  `find`. The table records CPU and GPU load for every run.
- Instrumentation sits in the page and is the same for both apps (both expose `window.__engine` in DEV):
  - `engine.setDepth` is wrapped. A model depth frame is identified by `liveDepth.ts` appearing in the call stack.
  - A frame counts as "masked" when the call carries a mask argument.
  - A rAF loop records frame times.
  - `requestVideoFrameCallback` gives the presented media time.
  - Video `drawImage` calls into canvases at mask-capture size are tagged, so each mask install can be
    matched to its capture time.
- t0 is the file input `change` event. "Rendered" is the first rAF after that `setDepth` call, so it
  carries ±1 frame of error.

## Before-table (median of 3; values in brackets are run1 / run2 / run3)

Run 1 of every cell ran under **25–32 % background GPU load** from the user's own Chrome tab.
Runs 2–3 saw about 4–11 % GPU and 25–28 % CPU. Most of the spread comes from that background load,
so treat run 1 as a loaded-machine sample.

| metric | ours (IS-Net) | the reference build (RMBG-1.4) | ours-sidecar (BiRefNet+DAViD) |
|---|---|---|---|
| upload → first model-depth frame rendered | **14.4 s** [30.1/14.4/13.7] | **14.1 s** [35.7/14.1/13.9] | 20.7 s [20.7/28.8/13.4] |
| upload → first masked frame rendered | **never in 2/3 runs** [36.4/–/–] | **16.5 s** [37.7/16.5/16.1] | [–/43.8/23.7] |
| render fps p50 | 152 [32/152/152] | 34 [58/34/34] | 80 [33/80/145] |
| 1 % low fps | 17.0 [7.4/17.0/17.5] | 15.2 [6.4/21.9/15.2] | 7.0 [7.8/4.6/7.0] |
| frame time p99 | 59 ms [136/59/57] | 66 ms [155/46/66] | 142 ms [129/217/142] |
| frames > 25 ms per minute | 847 [845/848/847] | 1508 [594/1711/1508] | 735 [847/613/735] |
| depth updates per second | 10.4 [4.6/10.4/10.6] | 12.6 [4.7/14.3/12.6] | 4.6 [4.6/3.2/7.1] |
| depth inference (app's own readout) | 56 ms [144/55/56] | 56 ms [154/53/56] | 145 ms [145/237/80] |
| model mask refresh, per second | 0 [0.05/0/0] | 0.10 [0.10/0.05/0.10] | 0.15 [0/0.50/0.15] |
| applied-mask age vs shown frame, p50 | [18.9 s/–/–] | 10.1 s [5.5/23.0/10.1] | [–/12.7/16.2] s |
| IoU of applied mask vs exact-frame reference*, p50 | [0.35/–/–] | 0.20 [0.26/0.20/0.11] | [–/0.15/0.23] |
| CPU during window | [44/27/25] % | [52/28/27] % | [50/77/52] % |
| GPU before run | [23/7/11] % | [26/4/7] % | [32/27/5] % |

\* **Reference for mask IoU:** each app's *own* production mask path, run again on the exact presented
frame (rVFC `mediaTime`) once playback has finished. For ours that path is `captureLiveMask` on a 640-px canvas,
which gives IS-Net in the `ours` cell and BiRefNet+DAViD (`david`) in `ours-sidecar`. For the reference build it is
`segmentForeground` on the full-resolution frame, which gives RMBG-1.4. Both masks are thresholded at 0.5
on a 144x256 grid. This IoU measures **staleness only**: how far the applied mask has drifted from what
the same model says now. It says nothing about whether the mask is correct.

### Not equivalent cells, read before comparing

- **Masks were on in the reference build but effectively off in ours.** In ours, runs 2 and 3 made exactly
  **one** mask capture in about 50 s and applied **zero** masks. IS-Net covered only about 4–9 % of the
  frame (`video özne maskesi hazır · isnet · %5 ön plan · nesne ayırma kapalı (maske küçük)`).
  Two separate things happen here:
  1. Separation stays off because of the hysteresis in `videoAyirmaDurumu` (`src/ui/maskeKarari.ts`):
     it switches on at ≥ 15 % coverage and off below 10 %. At 4–9 % it never switches on.
  2. The mask is never refreshed while separation is off. In `src/App.tsx` (live depth callback)
     `captureMask()` runs only when `!videoMask`. The refresh branch needs `mask = segmentRef.current ? videoMask : null`.
     A small but valid mask therefore sets `videoMask` and keeps separation off, and no later capture
     ever happens. This comes from reading the code and is confirmed by the capture count of 1 in runs 2–3.
- the reference build's depth runs on a mask-cropped window (sizes 168x306 to 257x384), while ours ran
  uncropped at 154x280. So the depth-Hz gap (10.4 vs 12.6) compares different work.
- **Render fps is not proof of visible smoothness.** Ours shows a rAF at about 152 fps p50 (6.6 ms)
  on this high-refresh panel. the reference build sits near 34 fps (29 ms). That is the rAF cadence, not
  pixels that changed, and depth geometry only changes 10–14 times a second in both apps. Ours still has
  about 850 frames over 25 ms per minute (roughly one per depth update) and a 1 % low of about 17 fps.

## Mask refresh timings and gates

- Capture → applied in `setDepth`, in ms (wall time from the tagged capture `drawImage` to the first
  `setDepth` carrying the new mask). Applied → rendered is at most one rAF.
  - ours (IS-Net): 12 739 ms, n=1, the first mask, which includes IS-Net load.
  - Reference: 1 196 / 5 320 (r1), 22 899 (r2, first mask after a failed attempt, so likely
    mis-paired), 587 / 1 632 (r3).
  - The app's own log shows 901 ms, 9 789 ms (cold) and 462 ms.
  - ours-sidecar: 16 270 ms p50 (8 564–23 182, n=10, r2) and 9 839 ms p50 (n=3, r3).
  - I did not measure **request start → compute done** separately from **compute done → applied**.
    The only isolated compute times are the reference-pass times below.
- Isolated mask compute per call, run after playback with the app paused:
  - IS-Net 322 ms; on the 22 fixed frames 255 ms p50.
  - RMBG-1.4 338–418 ms; on the fixed frames 321 ms p50.
  - **Sidecar BiRefNet+DAViD 9.6–12.3 s per call (DirectML).** This matches the known
    10 s/request sidecar problem.
- Refresh gates: in ours, `VIDEO_MASK_MIN_REFRESH_MS = 15_000` (`src/App.tsx:96`), and in the reference build,
  `MASKE_MIN_ARALIK_MS = 8000`. Both then need the miss gate to fire:
  `maskeYenilenmeliMi(miss, baseline)`, i.e. the miss ratio exceeds the baseline plus the rise. Between
  refreshes, both apps only translate the mask (shift, capped at a total of 0.25 of the frame).
  The observed refresh interval was 10–20 s in the reference build. In ours there were no refreshes, because
  of the separation-off path above.

## Production masks on identical frames (task d), partial

There were 22 frames: 12 spread over 1.5–32.3 s plus 10 consecutive frames from 9.0 s. The pass ran once,
in the browser on the same GPU, with masks resampled to 540x960 and thresholded at 0.5.

| model | ms/frame p50 | coverage p50 | IoU IS-Net↔RMBG | boundary F (±3 px) | consecutive-frame IoU |
|---|---|---|---|---|---|
| ours IS-Net | 255 | 9 % | 0.55 | 0.41 | 0.895 |
| Reference RMBG-1.4 | 321 | 19 % | (same pair) | (same pair) | 0.899 |

- **The BiRefNet+DAViD cell is invalid.** In the standalone mask page it silently fell back to IS-Net:
  every frame reported `model: isnet`, and its masks are identical to the IS-Net cell (IoU 1.00).
  A debug re-run was stopped before it finished. The three-model "consensus" reference in the JSON is
  therefore meaningless and is not reported here.
- Disagreement between models (IoU 0.55) does **not** say which mask is correct, because there is no
  ground truth. In the panel below (frame 12.72 s) IS-Net keeps only an arm fragment. RMBG keeps the
  dancers on the screen plus some crowd heads and phones. The middle column is labelled
  "birefnet-david-sidecar" but it is the IS-Net fallback.
- Hair and hand crop panels were not produced.


Same paused frame (12.0 s), same default camera `(0, 0, 3.5)`, fov 60. Left is ours, right is the reference build.
The WebGL canvases have different sizes because the page layouts differ, so the canvases were scaled
to the same height. Ours shows the whole frame because separation is off. the reference build shows the
masked silhouette:


These are the last masks applied before each screenshot. Ours (left) is **stale**: no new mask was
installed after the seek (`maskInstalled: false`).


## Single biggest bottleneck (mask follows motion)

**The mask refresh policy, not mask model speed.** In both apps the applied mask is 5–23 s old and
overlaps the same model's fresh mask at IoU 0.1–0.35. One mask call in isolation takes 0.25–0.42 s
(browser). The cadence is set by the 15 s / 8 s minimum interval plus the miss gate, with only
translation in between.

For ours on this clip there is a stronger, ours-only failure. A small first IS-Net mask (4–9 %) keeps
separation off **and** stops all later captures, so the mask never follows anything.

Recommended small fix (described only, not implemented): in the live depth callback, also allow
`captureMask()` when separation is off because the mask was small. For example, apply the same 15 s
gate to `videoMask && !segmentRef.current`, so a later frame where the subject is larger can switch
separation on. Measure separately whether lowering the minimum interval helps, since every IS-Net call
shares the GPU queue with depth.

Speed (depth Hz) is a weaker candidate. With the same ~55 ms inference, ours made 10.4 depth updates/s
and the reference build 12.6. The CPU profile puts main-thread `drawImage` at 14 % of samples in ours vs 7 % in
the reference build, plus `fillImageColorTexture` and the sampler. This is not established: the cells differ
in mask and crop state, and in the 8 s profile under 37 % GPU load ours updated faster (101 ms gap p50
vs 127 ms).

## Where ours is better (preserve)

- rAF cadence during playback: 152 vs 34 fps p50 in the quiet runs, a p99 of 57–59 ms vs 46–66 ms
  (similar), and a 1 % low of 17 vs 15–22 (similar).
- Time to first depth image is the same (about 14 s cold, fresh profile).

## What is NOT established

- Whether optical flow causes colour/depth drift. Flow is off by default in both apps and was not
  tested. `?derinlikIlerlet` was left off.
- Which mask model is more accurate. There is no ground truth, and the BiRefNet+DAViD cell is invalid.
- Visible smoothness. Only rAF cadence and depth-update rate were measured.
- Results on another GPU or on the Intel iGPU. Only one machine and one GPU were used, the ambient
  load was 25–50 % CPU and 4–32 % GPU, and n=3 per cell is small.
- The mask-age pairing (latest capture before install) is a proxy. One the reference build value (22.9 s) is
  probably mis-paired after a failed first attempt.

## Reproduce

```powershell
node scripts/bench-video-vs-reference.mjs --selftest
node scripts/bench-video-vs-reference.mjs '<clip>' '<reference-root>' --runs 3 --seconds 20 --max-cpu 50 --phases live,profile --cells ours,reference,ours-sidecar
node scripts/bench-video-vs-reference.mjs '<clip>' '<reference-root>' --phases masks,compose
```

Raw results are in `reports/video-vs-reference-dev.json` and `reports/vvp/` (local, not committed).
