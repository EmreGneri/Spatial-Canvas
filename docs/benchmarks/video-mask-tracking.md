# Live video mask without the local helper: first mask, age, tracking, cost

Target: a visitor who opens the hosted site with no local helper (sidecar). The video mask is IS-Net
in the browser (`captureLiveMask`, quality `video`). Measured code: base `e9cd25f` (clean worktree)
vs fix `4557b49` (clean worktree). Local builds only: **nothing here is deployed**; the hosted site
was only observed (model headers and HTTP-cache behaviour).

## Method

`scripts/bench-video-mask.mjs` (clip path is an argument; outputs go outside the repo):

```powershell
node scripts/bench-video-mask.mjs <clip> --root <app-worktree> --label base|fix --out <dir> --seconds 25
node scripts/bench-video-mask.mjs <clip> --track-eval --root <app-worktree> --out <dir>   # tracking only
node scripts/bench-video-mask.mjs --summarize <dir> [<dir> ...]                            # median [min-max]
```

- Installed Chrome, headed, 1280x800, fresh profile per clip and build, Vite dev server of the given
  worktree. WebGPU adapter `nvidia/blackwell` in every run. Background-throttling switches off;
  visibility/focus sampled every 0.5 s (0 hidden or unfocused samples in every run).
- Sidecar: `127.0.0.1:8765` / `localhost:8765` blocked with CDP `Network.setBlockedURLs` (1-2
  blocked health requests per run, so the app looked for it and did not get it). Not `page.route`:
  routing disables Chrome's HTTP cache and made an earlier "warm" pass re-download everything.
- Network throttled to 100 Mbit/s, 20 ms latency (CDP). **cold** = empty profile; **warm** = same
  profile, page reloaded, clip uploaded again (a returning visitor).
- Per pass, from the file-input change: first model depth frame, first mask job request / done,
  first depth frame drawn with a mask; then from first depth + 2 s to 25 s: depth updates/s, rAF frame
  p99 and frames > 50 ms per minute, mask jobs (from the app's own `__videoStats.maskLog`).
- **Mask age** = media time of the frame on screen (rVFC) minus media time of the frame the applied
  mask was computed on (loop wrap handled), sampled at every model depth frame with a mask.
- **IoU vs shown frame**: at 8 moments per pass the applied mask (as passed to `setDepth`) is saved
  with the shown media time; after playback the same mask pipeline runs on that exact frame. This
  is a *lag* measure against the same model, not an accuracy score: IS-Net itself picks different
  people on nearby frames (`still` IoU below). Overlays (applied mask: frame darkened outside, red
  edge; same model on the shown frame: cyan edge) were checked by eye.
- Machine: the user's laptop with its own Chrome and other processes running; system CPU 38-48 %,
  GPU 26-33 % during runs. Run-to-run spread is large for long-frame counts (base A1 warm 62-290 /min
  in identical runs), so 3+ runs per cell are reported as median [min-max].

## Clips (short sections, H.264 re-encodes of the originals)

| section | content | why |
|---|---|---|
| A1, clip A 0-10 s | handheld concert, portrait 1080x1920, 3-5 dancers on a stage screen, audience heads in front, zoom at ~4 s | start, several people, camera motion, zoom |
| A2, clip A 11-19 s | flash/cut at 12 s, close dancers moving fast | cut, fast motion, partial occlusion |
| B1, clip B 0-12 s | walking camera 854x480, pedestrians entering/leaving, small subjects | start, camera motion, small valid subjects |
| B2, clip B 160-170 s | street without people (trucks, cars, trees) | no human subject |
| C1, clip C 0-7 s | stage performance 1248x1178, close fast arm motion, hard cuts to multi-person shots | cuts, fast motion |

## What was wrong (base `e9cd25f`)

1. **The mask model was downloaded again on every visit.** The 88 MB IS-Net file is a same-origin
   `/models/...` fetch; Chrome's HTTP cache does not keep it. Hosted site, fresh Chrome profile,
   same page, two fetches: both transferred 81.9 MB (status 200). The depth model is kept by
   transformers.js in Cache Storage, IS-Net was not. So even a returning visitor's first mask job
   took 8.6-9.1 s (7.5 s of it the download at 100 Mbit/s).
2. **First mask timeline** (cold): first depth 10.9-11.8 s; the first mask is requested at that
   first depth frame; job 8.6-9.1 s; applied ~50 ms after it finishes; first masked frame
   20.3-21.7 s. Warm: first depth 5.5-5.8 s, first masked frame 14.5-15.6 s.
3. **Stale masks**: fixed 8 s refresh, mask age p50 2.2-3.7 s, p95 3.7-7.9 s. The depth-centroid
   shift between refreshes follows the nearest depth (audience heads, pavement), not the subject.
   Overlays: in C1 the applied mask sits on the green stage background while the dancer is
   elsewhere (t = 1.55 / 4.63 / 6.55 s, ages 0.7-5.7 s); after a cut or loop a mask from another
   shot stays applied (C1 t = 0.53 s shows the mask of t = 6.82 s; A1 t = 0.07 s shows a zoomed
   frame's mask on the wide shot).
4. **Per-job cost**: one browser mask job held the main thread ~190 ms (profile, 6 jobs on a
   576x1024 mask): post-processing `minMaxPass` 37 ms, `boxBlur` 28 ms, components 24 ms, input
   packing 15 ms, `getImageData` 10 ms; GPU work is small. Every finished job also re-ran `setDepth`
   on the last frame (~40 ms) and dropped the depth inference in flight.

## Changes

- `ilerlemeliGetir`: same-origin model files are stored in Cache Storage with their ETag and
  revalidated with one conditional request (304 -> stored bytes); no ETag -> not stored.
- `estimateMaskShift` (replaces the depth-centroid shift): where did the masked pixels of the
  mask's own capture frame move to in each depth frame's colour frame (zero-mean block matching on
  a 96 px grid, coarse-to-fine). Always measured from the capture frame (no drift). A poor match
  (error / template contrast > 0.6) marks the mask **lost**: it is not shifted and a refresh is asked.
- Refresh period from the measured job cost: a job may take 15 % of the time (0.35 s job -> 2.3 s),
  never rarer than the old 8 s; the first job (includes the model session) does not set it. A lost
  mask is refreshed at that bound. User-off latch, paused, seek and source switch unchanged.
- Per-job cost: `minMaxPass` / `boxBlur` bit-identical but cheaper (photo masks unchanged,
  `verify-mask-filter-parity`); one yield inside video post-processing; the last depth frame is
  re-applied only while paused; a refreshed mask keeps the in-flight depth inference.
- Tried and removed: downloading IS-Net before the first depth frame. Cold at 100 Mbit/s it delayed
  the first depth frame by 0.6-3 s for a 0-2 s earlier mask (main-thread / bandwidth contention
  with depth session creation and shader compile). Not kept.

## Tracking alone (`--track-eval`, IS-Net on frame pairs t / t + d, every 0.5 s)

IoU of IS-Net(t + d) against IS-Net(t) as captured (**still**) and as the app applies it
(**app**: shifted unless lost). Same model on both sides, so the difference is the tracker.

| section | d | pairs | still p50 | app p50 | mean gain | better / worse | lost |
|---|---|---|---|---|---|---|---|
| A1 | 0.5 s | 19 | 0.39 | 0.39 | +0.007 | 1 / 0 | 18 |
| A2 | 0.5 s | 14 | 0.53 | 0.53 | +0.013 | 2 / 0 | 11 |
| B1 | 0.5 s | 22 | 0.20 | 0.16 | +0.050 | 8 / 2 | 8 |
| B1 | 1 s | 21 | 0.01 | 0.00 | +0.076 | 5 / 2 | 8 |
| C1 | 0.5 s | 13 | 0.35 | 0.35 | +0.001 | 0 / 0 | 12 |

Reading: translation tracking helps on camera motion (B1); on dancing, flashes and cuts (A, C) it
mostly reports *lost* (no shift, so nothing gets worse) and the gain there comes from the refresh it
triggers. Shifting even when lost was measured worse (A2 d = 2 s: mean -0.10), hence the gate.
`still` p50 0.2-0.5 at 0.5 s shows how much IS-Net itself changes between nearby frames.

## Before / after

Median [min–max] over valid runs, 100 Mbit/s, sidecar blocked. Fix = `4557b49` (A, C: 2 interleaved
pairs; B: 1 run of `4557b49` + 3 of `55270e6`, which differs only in the job share and keeps separation
off on B). Times from the file-input change. *IoU vs shown frame* is a lag measure (see Method).

| section | pass | build | n | first depth (s) | first mask ready (s) | first masked frame (s) | mask age p50 / p95 (s) | IoU vs shown frame | depth upd/s | frame p99 (ms) | frames >50 ms /min |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | cold | base | 7 | 10.9 [10.1–11.6] | 19.3 [18.3–20.8] | 19.5 [18.6–21.7] | 3 [0–3.48] / 5.36 [0–6.24] | 0.15 [0–0.18] | 9.9 [6.6–10.9] | 54.6 [45.6–78.7] | 69.5 [19.5–378.5] |
| A1 | cold | fix | 2 | 10.3 [10.3–10.7] | 19 [19–19.3] | 19.5 [19.5–19.5] | 1.17 [1.17–1.34] / 1.96 [1.96–2.59] | 0.42 [0.42–0.47] | 9.9 [9.9–10.7] | 46.1 [46.1–47.1] | 14.2 [14.2–24.4] |
| A1 | warm | base | 7 | 5.6 [4.7–5.8] | 14.5 [14.2–15.3] | 14.8 [14.5–15.6] | 4.12 [3.34–4.32] / 7.89 [7.76–7.97] | 0.3 [0.13–0.47] | 9.5 [6.8–10.6] | 54.6 [46.5–66.8] | 86.5 [24.2–289.5] |
| A1 | warm | fix | 2 | 6.1 [6.1–6.2] | 8.3 [8.3–8.7] | 8.4 [8.4–8.9] | 1.26 [1.26–1.35] / 3.36 [3.36–3.37] | 0.24 [0.24–0.25] | 10.2 [10.2–10.5] | 53.7 [53.7–61.1] | 96 [96–135.9] |
| A2 | cold | base | 6 | 11.1 [9.9–11.8] | 19.3 [18.1–20.9] | 20.7 [18.7–21.1] | 2.23 [0–3.53] / 3.95 [0–6.36] | 0.16 [0–0.41] | 6.9 [6.7–11.3] | 60.7 [44.5–66.7] | 191.9 [14–233.1] |
| A2 | cold | fix | 2 | 10.2 [10.2–11.2] | 18.8 [18.8–19.8] | 19 [19–20] | 1.14 [1.14–1.32] / 2.22 [2.22–2.37] | 0.44 [0.44–0.71] | 10.5 [10.5–10.6] | 46.1 [46.1–46.9] | 25.5 [25.5–28.2] |
| A2 | warm | base | 6 | 5.2 [4.7–5.8] | 14.5 [14.2–15.3] | 14.7 [14.4–15.4] | 3.43 [3.05–3.79] / 7.5 [7.47–7.6] | 0.14 [0.1–0.38] | 7 [6.8–10.4] | 61.4 [47.1–84.9] | 47.2 [26.3–333.9] |
| A2 | warm | fix | 2 | 5.5 [5.5–6.2] | 7.9 [7.9–8.2] | 8 [8–8.3] | 1.32 [1.32–1.33] / 2.83 [2.83–3.46] | 0.47 [0.47–0.71] | 10.2 [10.2–10.8] | 46.3 [46.3–53.3] | 7.1 [7.1–55] |
| B1 | cold | base | 4 | 11 [10.2–11.3] | 20 [18.4–20.4] | 20.4 [20.3–20.7] | 9.05 [0–9.25] / 9.22 [0–9.42] | 0 [0–0] | 7.2 [6.6–12.5] | 60.8 [39.7–73] | 183.6 [14–394] |
| B1 | cold | fix | 4 | 10.2 [10–10.6] | 18.7 [18.6–19.1] | 19.1 [18.8–23.8] | 0.73 [0.72–8.67] / 1.96 [1.16–8.8] | 0 [0–0.38] | 10.6 [10.5–11.7] | 46.6 [40.1–68.6] | 14.3 [14.1–87.2] |
| B1 | warm | base | 4 | 5.6 [5.5–5.9] | 14.8 [14.3–15.8] | 23.9 | 0 [0–1.33] / 0 [0–1.76] | 0 [0–0.37] | 8.5 [7.8–11.7] | 60.6 [39.7–66.7] | 215.7 [20.7–267.3] |
| B1 | warm | fix | 4 | 5.2 [4.6–8.2] | 8.2 [6.7–9.3] | 10.1 [10.1–22.4] | 0 [0–0.67] / 0 [0–1.14] | 0 [0–0.28] | 11.3 [10.6–12.8] | 39.2 [39–45.7] | 6.5 [0–10.1] |
| B2 | cold | base | 5 | 11.1 [10.3–11.2] | 19.9 [18.6–20.3] | 20.6 | 0 [0–2.6] / 0 [0–4.73] | 0 [0–0] | 8.1 [7.3–12.5] | 66.7 [39.8–78.8] | 198 [18.9–387.1] |
| B2 | cold | fix | 4 | 10 [9.9–10.6] | 18.7 [18.5–19.2] | 18.9 [18.7–19] | 0.71 [0–8.73] / 8.82 [0–8.87] | 0 [0–0] | 11.6 [11.6–12] | 45.5 [39.7–46.5] | 23.3 [9.7–27.8] |
| B2 | warm | base | 5 | 5.4 [4.6–5.7] | 14.5 [14–14.6] | - | 0 [0–0] / 0 [0–0] | 0 [0–0] | 9.2 [7.3–12.1] | 54.4 [39.2–96.9] | 47.8 [19.6–337.4] |
| B2 | warm | fix | 4 | 5 [4.6–6.7] | 7.2 [6.2–8.8] | 10 [10–10.1] | 0 [0–0.81] / 0 [0–1.27] | 0 [0–0.17] | 12 [11.8–13.3] | 39.2 [39–40] | 9.8 [0–13.3] |
| C1 | cold | base | 5 | 11.1 [10.4–11.4] | 19.9 [18.6–20.4] | 20.6 [18.9–20.8] | 2.83 [2.38–3.15] / 4.73 [4.04–5.75] | 0.15 [0.01–0.45] | 7.9 [6.3–12.5] | 66.7 [32.1–109] | 118.9 [24.3–206.4] |
| C1 | cold | fix | 2 | 9.8 [9.8–10] | 18.4 [18.4–18.5] | 18.5 [18.5–18.7] | 1.27 [1.27–1.3] / 2.14 [2.14–2.18] | 0.33 [0.33–0.53] | 11.1 [11.1–11.8] | 54.1 [54.1–68.4] | 45.5 [45.5–198.1] |
| C1 | warm | base | 4 | 5.3 [5.1–5.6] | 14.3 [14.1–14.7] | 14.6 [14.3–15.5] | 2.3 [2.21–2.53] / 6.35 [6.34–6.45] | 0.07 [0–0.36] | 7.5 [6.8–11.5] | 60.7 [39.7–78.8] | 151.6 [26.9–287.8] |
| C1 | warm | fix | 2 | 5.2 [5.2–5.6] | 7.4 [7.4–8.3] | 8.5 [8.5–8.6] | 1.4 [1.4–1.43] / 2.79 [2.79–2.92] | 0.23 [0.23–0.3] | 8.9 [8.9–8.9] | 77.1 [77.1–82.7] | 266.2 [266.2–327.4] |

Excluded (slow machine state, both builds): r5 A2 base cold (3.1 Hz, GPU 11 %); r5 A2 base warm (3.5 Hz, GPU 7 %); r6 B1 base cold (4.2 Hz, GPU 3 %); r6 B1 base warm (3.8 Hz, GPU 11 %); r6 C1 base cold (4 Hz, GPU 7 %); r6 C1 base warm (3.2 Hz, GPU 7 %); r8 C1 base warm (4.2 Hz, GPU 10 %); r9 C1 base cold (4.4 Hz, GPU 9 %); r9 C1 base warm (2.6 Hz, GPU 5 %). These runs hit a machine state with GPU utilisation 3–11 % and ~3–4 depth
updates/s; fix runs at `55270e6` hit it too (A1 warm, C1 warm). Not caused by either build.

**Cost, same period only** (the base set above also contains an earlier, busier period: system CPU
38–48 % vs 16–23 %, so its depth/s and long frames are not comparable with the fix runs). Interleaved
pairs r8/r9, valid runs, depth updates/s · frames > 50 ms /min:

| section | base | fix |
|---|---|---|
| A1 cold | 10.9 · 19.5 / 10.5 · 23.3 | 9.9 · 24.4 / 10.7 · 14.2 |
| A1 warm | 10.3 · 86.5 / 9.5 · 213.7 | 10.5 · 96.0 / 10.2 · 135.9 |
| A2 cold | 10.9 · 30.1 / 10.1 · 233.1 | 10.6 · 28.2 / 10.5 · 25.5 |
| A2 warm | 10.4 · 33.1 / 10.1 · 47.2 | 10.2 · 55.0 / 10.8 · 7.1 |
| C1 cold | 12.5 · 24.3 / (excluded) | 11.1 · 198.1 / 11.8 · 45.5 |
| C1 warm | (both excluded) | 8.9 · 266.2 / 8.9 · 327.4 |

On A no cost is visible within the run-to-run spread. C1 (large mask, separation on 100 % of the
time with the fix vs ~60 % in base) has more long frames and fewer depth updates in the warm runs;
the only valid same-period C1 warm base runs are earlier ones (r5: 11.5 · 26.9), so C1 warm is a real
regression candidate, not a proven one. Before the 15 % share (`55270e6`, 25 %) the same comparison
was clearly worse on A2/C1 (e.g. A2 warm 8.6–9.1 depth/s, 136–157 long frames /min vs base 10.1, 26).

## Checked by eye (overlays, warm/cold r9 and r5/r8; local, not committed)

- A1 base: t = 1.38 s, mask age 6.9 s — the mask of a zoomed frame on the wide shot, covering the
  stage screen and floor; t = 9.51 s, age 5.0 s — displaced onto background at the right.
  A1 fix: ages 0.8–1.3 s, on the dancers; but IS-Net takes one of three dancers (t = 4.96 s), the
  bright screen between two dancers (t = 6.91 s) or the stage floor (t = 0.74 s): model choice, not lag.
- C1 base: t = 1.15 s, age 1.65 s — a polygon on the right-hand background, dancer missed;
  t = 6.35 s, age 3 s — blob over two dancers and background. C1 fix: t = 0.62 s, age 0.35 s —
  follows the dancer's body; t = 3.70 / 5.62 s — partly background (hair swing, blurred foreground
  dancer).
- B1, both builds: separation stays off; the same model on the shown frame outlines single
  pedestrians correctly (1–6 % of the frame). B2 base/fix: a building facade or truck when a mask
  is applied.

## Not solved / limits

- **Cold first mask** (empty cache) is still bound by the 88 MB download at the first depth frame
  (~20 s at 100 Mbit/s). Starting it earlier hurt the first depth frame (see Changes).
- **Small valid subjects** (B1 pedestrians, 1-6 % of the frame, correctly outlined by IS-Net on the
  exact frame) still do not switch separation on: the 8 % on-threshold is unchanged. A temporal
  consistency rule was considered, but IS-Net picks a different pedestrian on nearby frames (B1
  `still` IoU ~0 at 1 s), so it would not help; lowering the area floor would admit clip A's body
  fragments (<= 3.7 %). Needs a person-level signal, not an area rule.
- **Wrong regions from the model itself**: IS-Net selects one or two of several dancers (A) and, on
  a street without people (B2), a building facade or a truck. Fresher masks do not change what the
  model picks. No alternative browser model was validated here (RMBG-1.4 excluded by licence).
- **Limbs moving against the body** still lag up to one refresh (tracker is translation only).
- **Cost**: mask jobs run ~3x as often (8-10 vs 3 per window). C1 warm may cost depth updates and long
  frames (see the same-period table); long-frame counts vary a lot between identical runs here.
- One machine, NVIDIA adapter, Vite dev build (React development mode), uncontrolled background load;
  a production build and the iGPU path were not measured.
