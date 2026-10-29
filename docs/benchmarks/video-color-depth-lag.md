# Live video: colour vs depth lag (baseline)

Measurement only. No behaviour changed.

```powershell
node scripts/measure-video-color-depth-lag.mjs '<clip.mp4>' ['<clip2.mp4>'] --seconds 20
```

Raw output: `reports/video-color-depth-lag.json` (local, not committed).

## Method

- Real app (`/`), video uploaded through the file input, live path only (no
  offline preparation), remote requests blocked, local models. One fresh
  headed installed-Chrome session per clip x mode (playwright-core via
  `tarayici-oturumu.mjs`, not the built-in pane, which throttles rAF). The
  WebGPU adapter reported `nvidia / blackwell`, so this run used the RTX 5070,
  not the iGPU. Viewport 1280x720, DPR 1.
- Modes: **live** = default (realtime `VideoTexture` colour, no araKare);
  **araKare** = `?araKare=1` (the app turns realtime colour off itself);
  **aligned** = default plus `setRealtimeVideoColor(false)`, so colour is the
  depth-time RGB (`imageColorTexture`).
- Depth timestamp: an init script tags every `ImageData` read from a canvas
  drawn from the video with `video.currentTime` at draw time. This is the same
  value liveDepth stores as `mediaTime`. A wrapper on `engine.setDepth` reads
  the tag of the colour frame passed with each depth frame (0 untagged calls in
  every run).
- Colour timestamp, per rAF: if `uImageTexture` is the `VideoTexture`, the
  latest `requestVideoFrameCallback` `mediaTime`. Otherwise, the depth frame's
  own time. *colour - depth* is the age gap between them. *Shown colour vs
  clock* is `video.currentTime - colourTime`, which is how stale the shown
  image is.
- 2 x 20 s phases after a 6 s warm-up. Phase A records timing only (fps, Hz
  and lag numbers in the table). Phase B adds pixel analysis at about 3 Hz on a
  160-px-wide grid. That analysis costs fps, so its fps is not used.
- Moving pixels: luma change > 0.06 between consecutive depth frames' RGB,
  dilated by 1 px.
- **Block displacement**: 12x12 SAD block match (+/-8 grid px). It compares the
  depth-time RGB (which by construction lines up with the geometry) against
  the colour actually shown, on moving, textured blocks. The result is
  reported in source px.
- **Edge shift**: the integer shift (+/-6 grid px) that maximises the NCC of
  |grad depth| vs |grad luma(shown colour)| over moving pixels. It is also
  computed against the depth-time luma as a baseline, because model depth
  edges do not sit exactly on luma edges.

## Results (single run each, 20 s windows)

Clip A: `personal clip B`, the bench clip: 576x1024, 30 fps,
15 s, one person moving. Clip B: `Tokyo-Walk_rgb.mp4` from the VDA examples:
1280x720, 15 fps, 13 s, walking crowd.

| clip | mode | render fps | frame ms p95 | depth Hz (model) | colour - depth ms p50 / p95 | shown colour vs clock ms p50 / p95 | block displ. src px p50 / p95 (n) | edge shift shown px p50 / p95 | edge shift baseline px p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|
| A | live | 70.5 | 42.6 | 10.6 (10.6) | **97 / 143** | 18 / 69 | **18 / 41** (4162) | 13.0 / 28.1 | 0.0 / 22.8 |
| A | araKare | 42.1 | 97.2 | 5.7 (4.9) | 0 / 0 | 198 / 414 | 0 / 0 | 3.6 / 22.8 | 3.6 / 22.8 |
| A | aligned | 66.5 | 48.5 | 10.0 (10.0) | 0 / 0 | 119 / 244 | 0 / 0 | 3.6 / 21.9 | 3.6 / 21.9 |
| B | live | 59.4 | 48.6 | 8.9 (8.9) | **100 / 297** | 29 / 85 | 0 / 8 (3410) | 48 / 68 | 40 / 68 |
| B | araKare | 57.5 | 60.6 | 8.4 (7.5) | 0 / 0 | 133 / 295 | 0 / 0 | 25 / 68 | 25 / 68 |
| B | aligned | 67.5 | 48.4 | 10.1 (10.1) | 0 / 0 | 119 / 192 | 0 / 0 | 32 / 68 | 32 / 68 |

In the araKare and aligned modes, colour - depth and the block displacement
are 0 by construction: the shown RGB is the depth frame's RGB. Those rows
mainly show what is traded instead, which is staleness against the playback
clock.

## Is the lag material?

**Yes, on clip A; inconclusive on clip B.** In default live mode, the colour is
about 100 ms ahead of the geometry at p50 on both clips (p95 143 ms and 297 ms).
On clip A's moving person, this shows up as an 18 px median and a 41 px p95
displacement in source px (about 3% / 7% of the 576 px width) between the
colour shown and the frame the geometry came from. The edge proxy agrees in
direction: 13 px against a 0 px baseline at p50. Aligning the colour removes
that offset, but the whole image is then about 120 ms stale against the clock
(about 200 ms with araKare, whose model rate also dropped to 4.9 Hz on
clip A).

On clip B, the block displacement is small (p50 0, p95 8 px), because the
walkers move only a few px per 100 ms at this grid. The edge proxy there is
saturated at the search bound (68 px = hypot(6,6) x 8 px) even in the
baseline, so it carries no information.

## Limits

- One machine and GPU (RTX 5070 in headed Chrome), two clips, one run per
  cell: run-to-run variance was not measured. A 4 s pilot on clip A gave
  37-59 fps for the same modes. Treat the fps differences between modes as
  noisy.
- The proxies are measured in source space, not on rendered pixels. The block
  match tops out at +/-8 grid px (about 29 px on A, 64 px on B), and it uses
  the moving-pixel mask from consecutive depth frames. The edge-NCC proxy is
  only usable where model depth edges coincide with luma edges (A, not B).
- The colour time in live mode is the latest presented video frame. GPU upload
  latency of the `VideoTexture` is ignored.
- Each session's mask/segmentation timing varies, and this changes the depth
  rate. Phase B's analysis costs a few ms per sample on the main thread.

Direction the data supports: the offset comes from colour running ahead, so
advancing depth toward the colour time (not moving colour back, which adds
about 120 ms of whole-image staleness) is the better-supported direction,
provided it avoids the fps and model-rate cost araKare showed on clip A.
