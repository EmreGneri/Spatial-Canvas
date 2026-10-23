# Video Depth Anything Small vs V2-small: live video depth (2026-10-24)

Opt-in: `?videoDerinlik=vda`. Default stays Depth Anything V2-small.

## Setup

- Model: official Apache-2.0 VDA Small (`video_depth_anything_vits.pth`, rev
  `256875362cff76724b920335dfb4b29dd611f66e`), our own streaming export at
  154x266 (`scripts/export-video-depth-anything.py`, CPU parity in
  `export-manifest.json`), fp16 ONNX, onnxruntime-web WebGPU. The community
  T32 518x910 head hung the D3D12 device and is not used. VDA Base/Large are
  CC-BY-NC and are not used.
- Both models run through the real live path: `estimateDepthLive` plus the
  driver's flow stabilization (`src/bench/vdaKiyas.ts`, `bench/vda.html`).
  Each model gets its own page load. Frames are seeked, so both models see the
  same frames. Stride 5 at 30 fps (6 Hz) is the live cadence; stride 1 is shown
  for reference.
- Resolution: V2 154 short side (280x154 for 16:9, the live default
  `LIVE_INPUT_SIZE`); VDA 266x154 (fixed export). Same short side, 5% fewer
  VDA pixels.
- Browser: visible headed Chrome (Playwright `channel: chrome`), tab
  `visibilityState = visible`, `hasFocus = true`.
- **Adapter at `requestDevice`: `nvidia / blackwell` (RTX 5070 Laptop) for
  every run.** In this session Chrome did not give the Intel iGPU, and the
  power-preference flags did not change it (`force-low-power` found no
  adapter). Earlier raw-graph smoke on `intel / gen-12lp` measured VDA at
  151-172 ms/frame steady (~6.3 Hz, encoder + head only), see
  `scripts/bench-vda-stream-smoke.mjs`. V2-small on the same iGPU earlier
  measured 64 ms at 154. An end-to-end Intel run of this benchmark is still
  open.
- Errors: no device loss, no console errors, no fallback (every VDA frame
  reported `depthModel = vda`).

Run it with `node scripts/bench-vda-quality.mjs` (`--quick` runs 12 frames per clip). Output goes to
`olcum-out/vda/quality.json`.

## Metrics

- **AbsRel / δ1, per-frame fit**: per-frame affine fit in disparity to GT 1/z,
  then depth clipped to the GT range. Accuracy only; this hides flicker.
- **seq AbsRel**: one affine fit for the whole sequence. Scale drift counts.
- **TAE**: pose + depth symmetric AbsRel between consecutive frames
  (`scripts/vda-temporal-metrics.mjs`), using the sequence fit. **TAE pf** uses
  the per-frame fit.
- **OPW**: GT-flow warp, GT occlusion rejected, RGB-weighted depth L1 in metres
  (proxy; not the published RAFT benchmark).
- **Flow flicker** (real clips, no GT): |Δ disparity| along LK tracks,
  divided by the model's sequence median. Lower is steadier. This is a proxy
  only, because true depth changes under camera motion count too.
- `raw` is the network output. `chain` is what the app renders (the live
  normalization, temporal filter, post-processing and flow stabilization).

## Results

Synthetic forest path (`sentetik-orman-yolu.webm` + `.gt.json`), 72 frames, stride 5:

| Model | Output | AbsRel ↓ | δ1 ↑ | seq AbsRel ↓ | TAE ↓ | TAE pf ↓ | OPW m ↓ | Flow flicker ↓ |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| V2-small | raw | 0.195 | 0.683 | 0.232 | 0.142 | 0.143 | 0.937 | 0.092 |
| V2-small | chain | 0.196 | 0.680 | 0.285 | 0.128 | 0.133 | 0.961 | 0.094 |
| VDA-S | raw | **0.179** | **0.713** | **0.207** | 0.123 | 0.129 | 0.842 | **0.064** |
| VDA-S | chain | 0.182 | 0.699 | 0.300 | **0.116** | **0.124** | **0.834** | 0.072 |

Same clip, 90 consecutive frames (stride 1, 30 fps):

| Model | Output | AbsRel ↓ | δ1 ↑ | TAE ↓ | TAE pf ↓ | OPW m ↓ | Flow flicker ↓ |
|---|---|---:|---:|---:|---:|---:|---:|
| V2-small | raw | 0.178 | 0.737 | 0.077 | 0.067 | 0.675 | 0.058 |
| V2-small | chain | 0.176 | 0.738 | 0.063 | 0.061 | 0.635 | 0.052 |
| VDA-S | raw | 0.167 | 0.729 | 0.060 | 0.051 | 0.560 | 0.039 |
| VDA-S | chain | 0.168 | 0.724 | 0.053 | 0.049 | 0.539 | 0.039 |

Real clips, stride 5, no GT. Flow flicker:

| Clip | V2 raw | V2 chain | VDA raw | VDA chain |
|---|---:|---:|---:|---:|
| forest-3679072.mp4 (60 frames from 1 s) | 0.166 | 0.184 | **0.041** | 0.046 |
| nyc.mp4 (60 frames from 10 s) | 0.126 | 0.143 | **0.043** | 0.062 |

Throughput, end to end per `estimateDepthLive` call (grab, inference, live
chain), NVIDIA Blackwell. Warm-up is the time to load and compile before the
first frame. JS heap was read at the end of each run.

| Clip | V2 ms mean / p95 | V2 Hz | VDA ms mean / p95 | VDA Hz | V2 / VDA heap MB | V2 / VDA warm-up ms |
|---|---:|---:|---:|---:|---:|---:|
| synthetic s5 | 48 / 60 | 20.6 | 135 / 160 | 7.4 | 85 / 162 | 2159 / 4439 |
| synthetic s1 | 53 / 62 | 18.8 | 131 / 151 | 7.7 | 111 / 179 | 1363 / 1767 |
| forest | 83 / 104 | 12.0 | 186 / 225 | 5.4 | 94 / 145 | 1954 / 1852 |
| nyc | 43 / 72 | 23.2 | 107 / 132 | 9.4 | 109 / 147 | 1408 / 1798 |

## Reading

- VDA is better on every temporal measure. On the synthetic clip its TAE is 13%
  lower than V2's at the live cadence (raw) and 9% lower through the app
  chain. On real footage its flow flicker is 3-4x lower.
- VDA does not lose accuracy: per-frame AbsRel is 0.179 vs 0.195 and δ1 is
  0.713 vs 0.683.
- The app's live chain helps V2's TAE (0.142 → 0.128) but costs seq AbsRel
  (its range EMA rescales frames). On VDA the chain changes little and
  slightly worsens flow flicker on real clips. Bypassing the 2D temporal
  filters for VDA is a candidate follow-up; it is not done here.
- VDA costs 2.2-2.8x time per frame: 5.4-9.4 Hz vs 12-23 Hz on this GPU. It is
  not faster on the RTX than the earlier Intel raw-graph number, which points
  at the CPU side: about 32 MB of cache is packed and uploaded per frame.
  Keeping the cache GPU-resident (ORT IO binding) is the upgrade path.

## Decision

**Default stays V2-small.** VDA wins clearly on TAE and is not worse on accuracy,
but:

1. Its frame rate is 2.2-2.8x lower, and on the Intel iGPU, the user's usual
   browser adapter, the raw graph alone is ~6 Hz. End to end it would be lower.
2. The export is not hosted, so a clean Vercel build has no VDA files.

Revisit once the cache is GPU-resident, Intel end-to-end is measured, and
hosting is decided.

## Behaviour of the opt-in path

- `?videoDerinlik=vda` only affects uploaded and live video
  (`estimateDepthLive` with an `HTMLVideoElement`). It needs an aspect ratio
  within 15% of 266:154 (16:9 and 16:10). Other ratios and canvases use V2,
  logged once.
- Temporal context (31 cached frames, official first-2 + latest-29 schedule)
  resets on new clip, seek, loop, gap > 1 s, scene cut (luma signature),
  mask/size change, and every `resetLiveDepthState`. A frame in flight across
  a reset does not seed the new context. Pausing switches the live input size
  and also resets it.
- Any failure (no WebGPU, session load including missing files, device lost,
  shape error, non-finite or constant output) logs once, finishes the frame on
  V2-small, and keeps the page on V2.

## Open decisions

- **Hosting the export** (~73 MB fp16: encoder 43.3 MB, bootstrap 14.2 MB,
  stream 15.5 MB). It is our own Apache-2.0 derivative, built locally by
  `scripts/export-video-depth-anything.py`, and uploaded nowhere.
  `fetch-assets` skips it with instructions when absent and ships it only if
  present in `public/models`. Until hosting is decided, the flag falls back
  to V2 on deployed builds.
