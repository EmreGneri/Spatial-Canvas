# Video depth = reference pipeline live path, plus a frame stabilizer (2026-10-25)

User decision: the reference pipeline's live video depth looks better; v2 must produce the same depth.
Its only flaw is flicker. Reference: `C:\Users\Emre\Desktop\reference build`
(read-only; its `liveDepth.ts` is imported unchanged by the bench).

## What changed (defaults)

| | before | now |
|---|---|---|
| uploaded video depth | prepared VDA cache (auto for short clips), live V2 meanwhile | live V2-small, reference pipeline pipeline |
| subject crop for video | off | on (`canliKirpmaKutusu`, reference pipeline) |
| input size | 154, 252 probe on fast GPUs; 378 paused | Detaylı: 252 playing, 378 paused; 154 only after 3 frames < 1 Hz |
| range EMA | media-time half-life (450/500 ms) | per frame 0.15 / `STRETCH_RANGE_ALPHA` (reference pipeline) |
| mask in post-process | paused frame only | always; produced by itself after the first depth frame, turns object separation on (reference pipeline), shift arm between refreshes; gate = non-empty and ≤92% |
| flow blend + stale-frame drop | on | only with `?araKare=1` |
| edge cleanup | 2 | 0 (slider keeps 1–4) |
| offline preparation | on | off (setting, or `?videoHazirla=1`) |
| frame stabilizer | — | on (`?titremeFiltresi=0` = raw reference pipeline) |

Kept v2-only: GPU grab canvas (see match below), `fillSoftMaskInterior` (p99 diff 0.0025 → 0.0052
on a real IS-Net mask, relief +1.4%; prevents the soft-mask face inversion), scene-cut/gap reset
(only fires on cuts), warmup, sidecar opt-in rule (same model either way).

## Scope: depth parity is measured, mask parity is NOT

- **Depth parity** (below) holds only when both pipelines are fed the same mask. The bench does that.
- **Mask parity is unverified.** The reference pipeline segments with `briaai/RMBG-1.4`
  (`src/engine/reconstruction/segmentation.ts:54`, `const MODEL = 'briaai/RMBG-1.4'`; sidecar
  `sidecar/server.py:54`, `briaai/RMBG-1.4/onnx/model_fp16.onnx`; the video path calls
  `segmentForeground` at `src/App.tsx:635`). RMBG-1.4 is non-commercial. Production v2 uses IS-Net
  (browser-only) or BiRefNet + DAViD (sidecar) in `src/engine/vision/liveMask.ts`, so production masks
  differ from the reference's and nothing here says by how much.
- `docs/benchmarks/maske-olcumu.md` (DAVIS-2017 ground truth) measures mask accuracy on a different
  dataset. It is not evidence that v2 masks look like the reference's.
- Paths above are relative to `C:\Users\Emre\Desktop\the reference project`; the
  `C:\Users\Emre\Desktop\reference build` path named at the top does not exist on this machine.

## reference pipeline vs v2: same frames

`node scripts/bench-video-depth-reference.mjs` — NOTE: this script does not exist in the repo
(`scripts/` has no `bench-video-depth-reference.mjs`); the numbers below cannot be regenerated from
a committed script. Both `estimateDepthLive` on one seeked frame, one mask per
clip (v2 chain, reference pipeline gate). Cuts: nyc 18–23 s (stride 3, 50 frames), pixabay-forest-29721
0–5 s (stride 3), forest-3679072 0–5 s (24 fps, stride 2, 60 frames), input 252.
Mask: nyc 0% (IS-Net found none on the first frame), pixabay 0%, forest-3679072 10% (used).

| clip | GPU | before: mean / p99 |ref−v2| | now: mean / p99 | now, CPU grab canvas |
|---|---|---|---|---|
| nyc | RTX 5070 | 0.054 / 0.20 | 6.9e-5 / 3.3e-4 | 0 / 0 |
| pixabay-forest | RTX 5070 | 0.038 / 0.10 | 0 / 0 | 0 / 0 |
| forest-3679072 | RTX 5070 | 0.038 / 0.18 | 4.6e-4 / 5.2e-3 | 0 / 0 (fill off) |
| nyc | Intel gen-12lp | — | 1.6e-4 / 5.0e-4 | — |
| forest-3679072 | Intel gen-12lp | — | 7.1e-4 / 6.3e-3 | — |

Bit-identical when v2 uses the reference pipeline's `willReadFrequently` grab canvas (and no soft-fill). The
remaining difference is ±1 RGB level from Chrome's GPU-canvas video downscale on 854×480 H.264
(measured: mean 0.029 levels, max 1); it decays after the first frame (frame 0 mean 1.9e-3,
single-pixel max 0.75 at a slope-limited edge). v2 keeps the GPU canvas (4K grab 2 ms vs 22 ms).

Before (old App wiring, no mask while playing + flow blend) v2 had 15–25% less gradient than
reference pipeline: grad 3.61 vs 4.84 (nyc), 3.55 vs 4.11, mask relief 0.201 vs 0.278.

## Flicker vs detail (reference pipeline → v2 + stabilizer)

Metrics: `flicker` = mean |Δdepth| between consecutive frames (all pixels / pixels whose luma
changed < 0.01), `flow` = |Δdepth| along LK tracks / median depth (bench-vda-quality proxy),
`grad` = mean |∇d| in frame units, `relief` = mask p25–p75, `trail` = |stab − ref| where luma
changed > 0.05 (lag/ghost proxy).

Intel Iris Xe gen-12lp (Edge), `output/video-depth-reference/final-intel.json`:

| clip | flicker all | still | flow | grad | mask grad | relief | trail |
|---|---|---|---|---|---|---|---|
| nyc ref | 0.0352 | 0.0227 | 0.114 | 4.833 | | | |
| nyc v2+stab | 0.0305 (−14%) | 0.0161 (−29%) | 0.109 (−5%) | 5.020 (+3.9%) | | | 0.0078 |
| pixabay ref | 0.0119 | 0.0090 | 0.0200 | 4.114 | | | |
| pixabay v2+stab | 0.0096 (−19%) | 0.0065 (−28%) | 0.0164 (−18%) | 4.154 (+1.0%) | | | 0.0032 |
| forest4K ref | 0.0206 | 0.0192 | 0.092 | 2.643 | 7.719 | 0.279 | |
| forest4K v2+stab | 0.0122 (−41%) | 0.0107 (−44%) | 0.073 (−21%) | 2.662 (+0.7%) | 7.741 (+0.3%) | 0.284 (+1.7%) | 0.0078 |

RTX 5070 (Chrome, `sweep-rtx.json`) gives the same within 1%. Sweep (RTX, Δ vs ref flicker-all /
grad): full alignment (1.0) −22/−26/−45% but grad −4…−5% and trail ×3; no alignment −10/−16/−35%;
taban 0.25 + esik 0.3 −19/−23/−54% but nyc grad +8.9%. The default (alignment 0.5, taban 0.35,
esik 0.15) keeps every detail measure within 5%. Gradient rising slightly is blending of two
noisy frames on moving content, not new detail. Moving-camera clips (nyc) gain least: without
motion compensation a moving pixel must take the new value.

## Live rate (real app, uploaded 8 s cut, steady state after the mask)

| clip | RTX 5070 (Chrome) | Intel gen-12lp (Edge) |
|---|---|---|
| nyc 854×480 | 6.8 Hz · 31 fps | 3.1 Hz · 63 fps |
| pixabay 1080p | 8.6 Hz · 33 fps | 2.9–3.3 Hz · 65 fps |
| forest 4K | 3.2–3.6 Hz · 28 fps | 3.0 Hz · 27 fps |

All at 252 (Detaylı), well above the 1 Hz floor, so no fallback to 154. Stabilizer cost is inside
these numbers (a 4000-sample fit plus one zamansalYumusat pass).

## Evidence

`output/video-depth-reference/`: `v2-before-*.png` (RGB | ref | v2 before | diff×10), `v2-new-*.png`
(RGB | ref | v2 | diff×10), `sweep-rtx-*.png` and `final-intel-*.png` (RGB | ref | v2 | v2+stab |
diff×10), `app-*.png` app screenshots, JSON per run.

## Open

- Auto object separation (reference pipeline behaviour) hides everything outside the mask. IS-Net gives
  small masks on non-portrait clips (nyc 3–7%, forest 10–13%), so those show only a blob/trunk.
  The toggle turns it off for that source (then depth runs maskless, full frame).
- Mask parity with the reference is unmeasured. A measurement would need the same clips run through
  both mask models (RMBG-1.4 vs v2's IS-Net / BiRefNet+DAViD), compared per frame with IoU and an
  edge distance (e.g. boundary distance between the two silhouettes).
- Renderer is v2's (full-frame projection), not the reference pipeline's; only depth is matched.
