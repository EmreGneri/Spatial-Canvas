# Video start-up: late mask and stutter (personal clip A)

Report: after a video is loaded, (1) the subject mask arrives very late, (2) playback stutters.
Clip: `personal clip A` (1080x1920 HEVC, 35.3 s). One laptop (RTX 5070 Laptop + Intel iGPU; browser
WebGPU adapter checked every run: `nvidia/blackwell`), installed Chrome headed 1280x800, fresh profile per
run (cold model caches), Vite dev server per run. Two cells:

- **sidecar**: the user's `npm run dev` setup. The running local helper on 127.0.0.1:8765 (DirectML) is used,
  so the video mask is BiRefNet (helper, CPU execution provider) intersected with DAViD (helper, DirectML).
- **browser**: the helper is blocked, so the video mask is IS-Net in the browser.

Live depth is depth-anything-v2-small fp16 on browser WebGPU in both cells.

## Method

The timeline harness injects hooks at serve time through a Vite transform, so the measured source is unchanged.
It was a scratch script and is not committed. Hooks: the app's own log lines (`say`); every `gpuSirasinaGir` job
(queue wait and run time, tagged by caller stack: depth session, depth inference, IS-Net load and run);
helper `fetch` calls; model resource timing; `engine.setDepth` (duration, model or preview, masked or not);
rAF frame times; Long Animation Frame entries with script attribution; visibility and focus every 0.5 s;
`__videoStats.maskLog` (request, compute done, applied). Machine load: system CPU and `nvidia-smi` GPU every 2 s.
A 10 s CDP CPU profile was taken during steady playback.

Runs whose steady rAF p50 was above 20 ms are excluded. They hit a ~1 Hz window throttle even though the
page reported visible and focused, likely because another window covered it while the machine was in use.
Ambient load was not controllable: the user's own Chrome, two other dev servers and a filesystem scan were running.
System CPU averaged 36–73 %.

## Timeline from upload (cold, before the fix, browser cell, typical run)

| t (s) | event |
|---|---|
| 0.5 | video decoded and playing; brightness preview starts |
| 1–2.5 | depth model bytes (47 MB) from the local server |
| 2.5–7.8 | depth ORT session creation on the GPU queue: **4.8–5.3 s** |
| 7.8–17.2 | first depth inference (WebGPU pipeline compile): **9.2–9.9 s** |
| 17.2 | first model depth frame; the first mask is requested here |
| 17.4–18.6 | IS-Net bytes (86 MB); session 0.4 s; first run 0.6–0.8 s |
| 20.0–21.3 | first masked frame |

In the sidecar cell the mask request also waits for the first depth frame. Each helper `/infer/mask` call then
takes 10.5–11.7 s, and DAViD takes 0.35–0.43 s. First masked frame: 28.9–42.7 s.

## Root causes

### A. Start-up (late first depth, so late mask; heavy stutter before the model): the brightness preview starves the main thread

Until the model's first frame, `startLuminanceLoop` runs `luminanceHeightMap` + `setDepth` on **every decoded
video frame**. One tick costs 60–180 ms (the app's own `luminance · video · N ms` log, and LoAF attribution
`App.tsx:tick`). At ~30 fps that keeps the main thread ~100 % busy (LoAF sum 9.8 s per 10 s). ORT session
creation and first-inference pipeline compile need the main thread, so they ran ~3–5x slower.

Proof: an A/B with the preview limited to its first frame, 3 interleaved runs each, browser cell:

| | preview on every frame | preview off |
|---|---|---|
| depth session creation | 5.0–5.3 s | 2.2–2.5 s |
| first depth inference | 9.2–9.95 s | 1.8–2.0 s |
| first model depth frame | 17.1–18.2 s | 5.3–5.9 s |
| frame p50 in the first 10 s | 67–70 ms | 6.1 ms |

### B. Sidecar cell: BiRefNet on the helper's CPU (late mask on every job, and stutter while a job runs)

- Calling the running helper directly (no browser): `/infer/mask` 7.9–8.6 s, `david-mask` 52–72 ms. The helper runs
  BiRefNet on the CPU execution provider on purpose (`sidecar/server.py`: DirectML BiRefNet added ~4.4 GB VRAM and
  pushed DA3 into paging). DAViD on DirectML runs on the same worker thread in tens of ms. So this is **not** the
  known thread-affinity or EcoQoS slowdown: the process priority is AboveNormal, and the DML model on the same
  thread is fast.
- In the app the call takes 10.5–14 s, because the browser is competing for the CPU. Every video mask is
  DAViD ∩ BiRefNet, so every job pays this. With 8 s refresh the helper is busy almost all the time.
- While a call is in flight, system CPU peaks at 98–100 %. A/B, sidecar cell, 3 interleaved runs: refresh
  disabled after the first mask, compared with refresh on. The table splits steady playback by whether a mask call
  was in flight:

| | mask call in flight | no call in flight (refresh off) |
|---|---|---|
| depth updates / s | 3.2–3.7 | 7.9–8.2 |
| frame p99 | 182–217 ms | 75–77 ms |
| `setDepth` p50 / p95 | 77–82 / 124–162 ms | 38–39 / 45–46 ms |

Not changed here. Swapping BiRefNet for browser IS-Net inside the chain (DAViD ∩ IS-Net) costs 0.71–0.79 s
instead of 10.7–11.4 s (warm; 3.6 s on the cold first call). On 12 frames of the clip, though, it agreed with
the current chain at IoU 0.93–1.0 on only 5 frames and 0.01–0.55 on the other 7 (mostly lower coverage, i.e. it drops people). There is no ground truth, so this is a
quality change that needs a decision. The other options are BiRefNet on DirectML (the known VRAM risk) or fewer
CPU threads (smoother, but an even later mask).

### C. Browser cell, steady playback: one long frame per depth update (not changed)

CDP profile, 10 s of steady playback: the main thread is ~98 % busy. Per depth frame (~7 Hz):

- `Engine.setDepth`: ~40 ms (`sampleVolumePositions` ~18 ms, `fillImageColorTexture` ~18 ms)
- `estimateDepthLive` work: ~45 ms
  - video `drawImage` readbacks: ~18 ms
  - post-processing (`postProcessLiveDepth`, `limitDepthSlope`, `smoothDepthSteps`, temporal smoothing): ~19 ms
  - ORT JS side: ~19 ms

`setDepth` runs synchronously inside one task, so each depth update gives one 40–90 ms frame
(~800–900 frames > 25 ms per minute). There is no single small cause; moving this work off the main thread
(a worker) is an architectural change and was not attempted.

## Fix (A only)

`src/engine/vision/previewBudget.ts`: the preview may use at most 25 % of the main thread
(`previewNextAt(start, end) = end + 3 * (end - start)`). It applies only while a live model is starting
(`liveDepthStopRef` set). The no-WebGPU fallback keeps a preview on every frame. The first frame is still shown
at once. Test: `scripts/verify-preview-budget.mjs` (failed before the module existed; part of `npm run verify`).

## Before / after (median [min–max], valid runs; "late window" = 25 s after upload to the end)

| metric | browser before (n=6) | browser after (n=6) | sidecar before (n=3) | sidecar after (n=6) |
|---|---|---|---|---|
| upload → first model depth frame (s) | 17.4 [15.4–31.5] | **9.5 [6.1–10.7]** | 30.3 [16.8–31.5] | **6.4 [5.1–15.6]** |
| upload → first masked frame (s) | 20.6 [18.1–49.5] | 17.2 [10.2–19.8] | 35.8 [28.9–42.7] | 18.7 [17.7–32.1] |
| frame p50 before the first depth (ms) | 66.8 [59.5–108.8] | **6.1 [6.0–6.1]** | 116.8 [65.3–117.4] | **6.1 [6.1–6.4]** |
| frames > 50 ms per minute before the first depth | 770 [430–853] | **126 [100–157]** | 442 [441–797] | **143 [81–155]** |
| mask job request → done (s) | 0.5 [0.4–0.9] | 0.6 [0.5–0.9] | 12.2 [11.3–14.4] | 11.8 [11.1–13.6] |
| applied mask age p50 (s) | 4.9 [1.5–5.0] | 4.7 [4.4–5.1] | 16.5 [16.0–17.0] | 18.7 [16.2–25.5] |
| late window: frame p99 (ms) | 89 [67–241] | 108 [72–184] | 201 [195–247] | 227 [176–267] |
| late window: frames > 25 ms per minute | 825 [566–896] | 865 [724–934] | 545 [473–600] | 543 [439–592] |
| late window: depth updates / s | 6.9 [2.6–9.5] | 6.0 [3.9–7.9] | 2.8 [2.3–3.3] | 2.7 [2.0–3.4] |
| system CPU / GPU during run (%) | 47 / 22 | 46 / 28 | 56 / 24 | 66 / 27 |

What changed: first depth and the pre-model phase. The first masked frame moves earlier with it, by about 17 s
in the sidecar cell. The browser cell's first-mask gain is smaller and noisier: after the fix, the IS-Net cold
load (0.7–6.6 s of the 86 MB download in a fresh profile) is now the visible gap.

What did not change, within noise: steady-state long frames, frame p99 and depth Hz (causes B and C). Sidecar-cell
CPU is higher after the fix because helper mask calls start earlier and therefore fill more of the run.

## Limits

- One clip, one machine, uncontrolled background load. 3–7 valid runs per cell; ranges overlap for every
  steady-state metric.
- Fresh profile every run, so model downloads are cold. The app caches models in Cache Storage, so a returning user
  mostly skips the download share. It was not measured whether Chrome's WebGPU pipeline cache shortens the 1.8–2 s
  first inference for a returning user.
- A first mask below the separation threshold (4–8 %, common in the first seconds of this clip) still waits for the
  8 s refresh. This is unchanged and is described in `video-mask-refresh.md`.
- The no-WebGPU fallback path and the camera path were not measured. The camera uses the same start-up loop and
  gets the same budget.
