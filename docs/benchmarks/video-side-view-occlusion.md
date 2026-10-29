# Live video side-view occlusion (`?videoOrtme`): experiment, no benefit shown

**Result: in this trial, no candidate gave a clear visible improvement. The default stays off.**
The flag code and its verify script stay in the repo so the experiment can be repeated.
FPS was **not measured**. The scope said to measure it only if a candidate clearly helped, and none did.
This experiment does not touch the colour/depth lag.

## What the flag does

Live video draws soft additive sprites with `depthWrite` off. That matches the the reference build reference look,
but orbit and side views show surfaces through each other. `?videoOrtme` adds a **pre-pass** that reuses the
same grid geometry and uniforms (by reference). It is a child `THREE.Points` of the cloud in the opaque list, so it costs one
extra draw call. The unchanged additive pass is then depth-tested against it with three's default LessEqual.

| flag | pre-pass |
|---|---|
| off (default) | nothing is added; the scene and material are unchanged |
| `?videoOrtme=1` | (a) depth only, colour write off; sprites shrunk to the opaque core (`core` 0.5) and pushed `bias` world units away from the camera (default 0.03) |
| `?videoOrtme=2` | (b) the same, but the pre-pass also writes opaque colour (opaque core + additive halo) |

- Only the **point-cloud** draw mode honours the flag. ascii, neon, solid and crystal ignore it and log one
  `console.info` line each. Layer-visibility edits also skip it, because the pre-pass lacks that shader patch.
  In the browser I checked that all four modes keep rendering with no page errors and that the pre-pass is visible only in point-cloud.
- Code: `src/engine/videoOcclusion.ts`, plus `Engine.syncVideoOcclusion` / `setVideoOcclusion` (runtime tuning for benches).
- Verify: `scripts/verify-video-occlusion.mjs` (in `npm run verify`) checks four things:
  - flag off adds no object and leaves the material state, shader source and uniform keys unchanged, even after an on→off round trip;
  - (the default's no-alpha-cutoff contract is asserted by `verify-video-point-footprint.mjs`, which follows the committed look;
    the working tree's additive look passes it, HEAD's older cutoff look does not belong to this experiment);
  - with the flag on, the pre-pass state is right (depthWrite, colorWrite per mode, opaque list, shared uniforms, bias/core defines);
  - the other modes report that they ignore the flag.
- Browser identity: in each of the three poses, a flag-off frame captured before and after cycling all variants on the same frame
  is **bit-identical** (max pixel diff 0).

## Method

- `scripts/bench-video-occlusion.mjs`: headed installed Chrome via `tarayici-oturumu.mjs`, 1280x800 window,
  sidecar blocked (browser inference), clip `personal clip A` (1080x1920 HEVC).
- The video is paused on a frame and given 6–8 s for depth and mask. Then geometry is **frozen** (`setDepth` set to a no-op).
- Camera: orbit around the target at the default distance, sway off. Every variant is switched at runtime on the
  **same frame and the same geometry**.
- WebGL renderer: ANGLE on the RTX 5070 Laptop GPU (D3D11).
- Load before the image session: CPU 27 %, one GPU 3D engine at 43 %, nvidia-smi 42 %.
  External processes (Codex runtime, the user's dev servers and Chrome) were running. Load does not affect still images.

## Comparison images

1. **t = 12 s, bias sweep, poses 0 / 45 / 90°** ((image removed), zoom (image removed)).
2. **t = 4 s, genuine near/far overlap**: a performer well in front of the stage backdrop, poses 0 / 30 / 60 / 90°,
   off vs m1 (bias 0.03) and |diff|×4 ((image removed), 3× zoom (image removed)).
   I picked this frame by measurement. A partial scan of t = 2, 4, 6 s at five poses compared off with m1 at bias 0.03.
   That bias only hides surfaces well behind the front one. t = 4 had the largest change (about 2,000–4,000 px with |diff| > 24 from 30° on);
   t = 12 had almost none (≤ 0.25 %).

Raw PNGs: `reports/video-occlusion/` (pose*, burst45-*, mode-*, scan-t2/t4/t6-*). Run metadata (load, renderer, mode checks): `reports/video-occlusion.json`.

## What I saw (eyeballed)

- **m1 / m2 at the default bias 0.03, t = 12:** no visible effect at any pose, because this frame has no surfaces that overlap on screen.
  The 45° view is washed out white with or without the flag. That comes from the same surface piling up additively, and a 0.03 bias does not hide it.
  **Eliminated as useless on that frame.**
- **Small bias (0.01, 0.003, 0.001), t = 12:**
  - At 45° the whiteout drops and stage texture becomes readable. The cause is the surface culling its own neighbouring sprites, not real occlusion.
  - The price is a **front view that gets worse**. The lower half (the crowd) turns darker and more contrasty, and the additive haze is lost.
    At 0.001 the frame shows salt-and-pepper speckle.
  - At 45° the same speckle and grain appear, and the frame is 11–18 % darker on average (mean RGB 14.5 off vs 12.9 at 0.003 and 11.9 at 0.001).
  - **Eliminated:** it changes the reference front view, which must not get worse.
- **m2 (opaque core) at 0.003:** looks like m1 at the same bias, slightly lighter. Same front-view change. **Eliminated.**
- **m1 at bias 0.03, t = 4, real overlap:**
  - *Front (0°):* the near performer partly loses its additive brightness. Grey/black blotches appear on the shoulder and arm,
    where dark depth-edge "stretch" sprites now hide the bright backdrop behind them. These are **dark fringes**, and the front view gets worse.
  - *30°:* occlusion does work geometrically: the backdrop behind the near figure is hidden. But the figure turns grey and broken up, with **holes**,
    and a dark band of depth-edge sprites now covers part of the backdrop. It reads worse than the bright, see-through ghost with the flag off.
  - *60° / 90°:* the backdrop panel seen edge-on gets thinner, with its inside hidden. The streak of stretch particles between figure and backdrop
    is speckled either way. The improvement is small and hard to see.
  - In short, the hidden back surfaces are replaced mostly by dark edge sprites, not by a clean front surface.
- **Flicker:** I only have a rough proxy, the mean |diff| between consecutive playback screenshots at 45°, t ≈ 10–12 s. It was off 2.43, m1 3.24, m2 2.40.
  Content also moves between shots, so this is not evidence either way. I did not judge flicker visually during playback.

## Decision

Leave it off. The candidates either do nothing (bias 0.03 on frames without overlap) or hide back surfaces while adding
dark fringes, holes and speckle and changing the front view (every bias, at the overlap frame; small biases everywhere).
None is clearly better than the current additive look. Not measuring FPS follows from the scope rule, and the pre-pass
costs an extra draw call and vertex pass over 262,144 points no matter what. If this is tried again, the dark fringes point at the depth-edge stretch sprites:
excluding them from the pre-pass (e.g. by edge confidence) would be the next thing to test, not a different bias.

## Limits

One clip, three paused frames looked at (t = 2, 4, 6 partially scanned, 12 in full), one GPU (RTX 5070 Laptop via ANGLE D3D11),
one window size, a noisy machine. Images were judged by eye on still frames; motion artefacts (popping, flicker) were not
assessed beyond the proxy above. No FPS, stall or GPU-load numbers were measured.
