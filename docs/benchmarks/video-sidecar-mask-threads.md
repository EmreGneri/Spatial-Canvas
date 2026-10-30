# Video mask: BiRefNet CPU thread count on the helper (personal clip A)

Question: the helper runs BiRefNet on the CPU execution provider (on purpose, see `sidecar/server.py`). While a
video mask job is in flight, system CPU sits at 92–94 % and playback suffers (`video-startup-mask-latency.md`,
cause B). Does a smaller ORT intra-op thread pool for that one session give smoother playback, and at what
cost in mask latency?

Switch: `SIDECAR_MASK_THREADS=<n>` in the helper's environment. Unset or `0` keeps ORT's default pool, so
behaviour is unchanged. When set, only the BiRefNet session gets it (small, DA3 and DAViD are not affected).
Test: `sidecar/test_mask_threads.py`, run by `scripts/verify-sidecar-errors.mjs`. The default stays unset.

## Method

- Clip `personal clip A` (1080x1920 HEVC, 35.3 s, looping). One laptop: i7-13620H (10 cores / 16 threads),
  RTX 5070 Laptop 8 GB + Intel iGPU. Browser WebGPU adapter checked on every run: `nvidia/blackwell`.
- Same as production for everything except the thread count: same BiRefNet file (`birefnet_lite_fp16_tree`,
  CPU EP), 1024² input, same app preprocessing, same DAViD (DirectML) chain on the same worker thread. Live depth is
  depth-anything-v2-small on browser WebGPU (default quality).
- A separate helper instance on port 8777 (the user's helper on 8765 kept running and was not touched). The app
  was pointed at it with the existing `VITE_SIDECAR_URL`. To fit in VRAM next to the resident user helper, the
  experiment instance did not load small/DA3. Neither is used by the live video mask chain. Peak GPU memory in use
  during runs: 6.4–7.0 GB of 8 GB.
- Each run: wait for system CPU < 35 % (3 s samples), start the helper with the setting, 3 direct
  `/infer/mask` calls (no browser), wait for the quiet gate again, then headed installed Chrome 1280x800, fresh profile,
  upload the clip, 95 s of playback with the app's own mask refresh (one job after another, each is
  BiRefNet then DAViD). Then a **hold window**: the next `/infer/mask` request is intercepted and never forwarded, so
  no BiRefNet work runs while the app keeps its last mask (20 s; "no mask" baseline in the same run).
- Settings interleaved: 0,4,0,4,0,4, then 0,6,2,6,2,6,2, then 2,6. Harness scratch only, not committed.
- In-flight windows: every mask job that starts ≥ 25 s after upload (request → result, `__videoStats.maskLog`).
  Per window: live depth inferences/s (`__videoStats.liveInfers`), rAF frame p99, frames > 25 ms per minute,
  `setDepth` p50, system CPU (1 s samples).
- Exclusions (applied the same way to all settings): rAF p50 > 20 ms or hidden page (none); a run whose own hold
  baseline was below 3 depth/s (one 6-thread run, 2.4/s in the hold window: the whole machine was slow, not the
  setting); one 2-thread run where the Vite page did not load within 30 s (no data). Load not controllable: the
  user's Chrome, their helper and a filesystem scan (one core) ran throughout.

## Results

Median [min–max] of per-run medians. n = valid runs.

| threads | n | mask job in app (s) | direct call (s) | depth inferences/s, in flight | frame p99, in flight (ms) | frames > 25 ms / min, in flight | `setDepth` p50 (ms) | system CPU in flight (%) |
|---|---|---|---|---|---|---|---|---|
| default (0) | 4 | **10.0** [9.7–10.2] | 7.7 [7.4–8.4] | 2.6 [2.4–2.8] | 258 [236–279] | 476 [439–499] | 79 [75–80] | 93 [92–94] |
| 6 | 3 | 10.5 [9.9–10.8] | 7.5 [7.1–7.6] | 4.0 [3.9–4.1] | 151 [133–152] | 609 [608–617] | 61 [59–61] | 84 [82–84] |
| 4 | 3 | 12.1 [10.9–14.3] | 8.1 [8.1–8.9] | 4.0 [3.7–4.8] | 133 [121–134] | 625 [603–650] | 61 [54–62] | 77 [70–83] |
| 2 | 3 | 14.7 [14.2–15.1] | 10.7 [10.6–10.8] | 5.4 [5.2–5.6] | 115 [97–133] | 682 [680–721] | 49 [48–50] | 62 [57–63] |

Hold window (no BiRefNet running), same runs:

| threads | depth inferences/s | frame p99 (ms) | frames > 25 ms / min | system CPU (%) |
|---|---|---|---|---|
| default (0) | 4.7 [4.0–6.4] | 182 [85–212] | 656 [606–799] | 67 [47–72] |
| 6 | 5.4 [5.2–5.9] | 115 [115–163] | 702 [676–720] | 62 [62–67] |
| 4 | 5.1 [4.4–6.0] | 109 [91–121] | 711 [635–743] | 62 [58–74] |
| 2 | 6.0 [5.5–6.3] | 91 [91–97] | 743 [729–755] | 57 [49–64] |

The hold baseline is noisy (one 20 s window per run, background load) and does not depend on the setting.
The default's spread there (4.0–6.4/s) is as wide as the gap between settings.

Mask output: same model, same frames, thread counts 2/4/8 against the default session on 5 frames of the clip
(probability > 0.5): IoU 0.99991–1.0, max absolute probability difference ≤ 4.6e-3. Floating-point reduction
order only, no visible change. Masks were compared in memory and not saved.

DAViD on the same worker stayed at 63 ms (p50) in every setting.

## Reading

- The thread count is a trade-off, not a fix. Fewer BiRefNet threads leave more CPU to the browser: depth
  inferences per second while a mask is computed rise from 2.6 to 4.0 (6 or 4 threads) and 5.4 (2 threads). Frame
  p99 falls from ~258 ms to 115–151 ms. The mask arrives later: +0.5 s (6, ranges overlap with the default),
  +2.1 s (4), +4.7 s (2).
- Frames > 25 ms per minute **rise** with fewer threads (476 → 609–682). Each depth update costs one 40–90 ms frame
  on the main thread (cause C in `video-startup-mask-latency.md`), so more depth updates bring more long frames.
  The worst frames get shorter (p99), but long frames become more frequent. Neither setting gets near the hold window.
- 6 threads is the only point where playback is clearly better (depth/s and p99 do not overlap with the default)
  and the mask is not clearly later (10.5 s vs 10.0 s median, overlapping ranges). 4 and 2 threads pay
  2–5 s more per mask. With the 8 s refresh, that makes the applied mask older.
- Direct calls with a quiet browser are about the same for default, 6 and 4 (7.4–8.1 s). A smaller pool mostly
  loses time when the browser competes for the CPU, which is when it frees CPU.

## Recommendation

Default unchanged (unset). `SIDECAR_MASK_THREADS=6` is a reasonable opt-in for smoother playback while a mask is
computed: depth/s 2.6 → 4.0 and p99 258 → 151 ms, for about +0.5 s per mask and more frames > 25 ms per minute.
Making it the default needs a decision on that last point and more than one machine. The thread limit does not
remove the ~10 s mask latency.

BiRefNet on DirectML (step 2) was not run. The earlier failure (`sidecar/server.py`,
`docs/superpowers/specs/2026-10-10-sidecar-design.md`, 2026-10-10): BiRefNet's 1024² activations added ~4.4 GB
VRAM next to the resident DA3 (~2.5–2.8 GB) → 7.2 of 8 GB, DA3 went from 0.25 s to 11.6 s per request (memory paged
to system RAM) and finally failed out of memory. The same notes put DirectML BiRefNet at ~5 s per call vs 7.3 s on
the CPU, so the expected latency gain is small. Today the user's helper with small + DA3 + DAViD resident already
puts the GPU at ~5.2 GB in use, with the browser's WebGPU depth on the same GPU. That leaves no clear room for 4.4 GB
more without unloading DA3/DAViD around each mask call. A sequential load/unload design has its own per-call session cost
that was not measured.

## Limits

- One clip, one machine, uncontrolled background load (system CPU 47–74 % in hold windows). 3–4 valid runs per
  setting. The 6 vs default mask-time difference is within noise.
- Default thread count is ORT's choice (`intra_op_num_threads = 0`). The actual pool size was not read back.
  Thread spinning (`session.intra_op.allow_spinning`) and E-core/P-core placement were not varied.
- The experiment helper did not have small/DA3 loaded. They are idle in the live video path but the user's helper
  carries them. VRAM pressure there is a little higher than measured here.
- Only steady playback after 25 s was measured. The first mask after upload was not compared.
