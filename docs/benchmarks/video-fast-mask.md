# Live video: what the lighter region is, and a fast per-frame person mask (`?hizliMaske`)

Browser-only path (sidecar blocked), same harness and clip sections as
`docs/benchmarks/video-mask-tracking.md` (A1, A2, B1, B2, C1). Local Vite dev builds, nothing deployed.
Default behaviour is unchanged: the new mask source is behind `?hizliMaske=multiclass|selfie` and
stays **off**.

## Step 0: the lighter region in the reported screenshot

Reproduced on C1 (and A2) in the app, default quality, separation on. The video overlay
('maskeyi göster') was fixed first: it only drew the photo mask, so with a video it was an empty
box; it now draws the mask the engine received (`fix(video): 'maskeyi göster' shows the applied
video mask`). Evidence also came from hooking `engine.setDepth` and the engine's post-render tap
(scratch diagnosis script, not committed).

What the screen shows with a video mask (code + an A/B on a paused frame: same depth with the mask
removed, and the same mask with the depth flattened):

1. **Sampling window**: the point cloud is only sampled inside the bounding box of the applied mask
   plus 6 % (`maskeBboxPenceresi`, `Engine.setDepth`). With the mask removed the whole frame is drawn;
   with the depth flattened the same rectangle stays. So the hard-edged rectangle is the window of the
   applied (old) mask: limbs and head outside it are **not drawn at all**.
2. **Lighter shape inside it** = the interior of the applied mask: opacity 1 inside, 0.2 outside
   (`VIDEO_BACKDROP_OPACITY`, dimmed, additive). The arch in the screenshot is an IS-Net mask of the
   lit green backdrop arch of an earlier frame (C1, paused at 0.89 s: applied mask from 6.87 s, i.e.
   across the loop and a hard cut).
3. The depth model also runs on a crop box from the same mask (`canliKirpmaKutusu`), outside it the
   depth is edge-clamped.

How far the applied mask was from the subject (snapshots during playback; reference = the same
IS-Net run on the exact frame on screen, checked by eye on the overlays; offset = mask centroid
distance in source pixels):

| section | snapshots | mask age ms, median [min-max] | centroid offset px | subject pixels outside the applied mask |
|---|---|---|---|---|
| C1 (1248x1178) | 10 | 1594 [477-3624] | 285 [84-548] | 57 % [13-91] |
| A2 (1080x1920) | 8 | 2216 [794-4873] | 302 [95-760] | 63 % [28-100] |

Most refreshes in these runs were `kayip` (tracker lost the subject), so the translation tracker did
not move the mask; on fast dancing the mask stays where the subject was 0.5-3.6 s earlier.

## Candidate: MediaPipe Image Segmenter

| | selfie_segmenter (float16) | selfie_multiclass_256x256 (float32) |
|---|---|---|
| licence (model card) | "LICENSED UNDER Apache License, Version 2.0" | same |
| download | 0.25 MB | 16.4 MB |
| ms / frame, GPU delegate (WebGL), 384 px colour frame, incl. readback | 2.6-3.2 (p95 7) | 12.4-12.9 (p95 29) in isolation; 7-9 (p95 10-15) inside the app |
| ms / frame, CPU delegate (WASM) | 7.5-7.8 | 190-193 |
| B2 (no people), frames > 8 % | 2 of 20 (a building facade, 14 %) | 0 of 20 (max 1.7 %) |
| B1 (small pedestrians) | 0-14 %, includes a bench/bags | 0-9 %, pedestrians only, misses some |

Same `@mediapipe/tasks-vision` 1.0.1 runtime the face landmarker already vendors; WebGPU not
needed. Model-card limits: several people at different scales, people beyond ~4 m, degradation
with fast motion and large occluders. Chosen for the app test: **multiclass** (selfie forces a mask
on a people-free street).

Seen by eye (`hizli-maske/spike`, `bench-r*`, multiclass unless stated): on C1 the dancer's arms,
hands and hair are in the mask on the exact frame (IS-Net misses raised arms at 3.03 s); motion-blurred
frames add green background streaks (3.23 s); several dancers are all included (A, C); audience heads
and raised arms in front of the stage are included (they are people); a backlit trio on A1 at 9.6 s
is almost missed (1.7 %, selfie 39 %); a dancer entering or leaving is in or out on that frame;
partial occlusion by the audience cuts the lower body.

## Rule (flag on)

On every model depth frame, the segmenter runs synchronously on that frame's own colour frame.
If person coverage passes the separation hysteresis (on at 8 %, off below 4 %, never above 92 %),
that mask is the applied mask (sampling window, crop box, opacity) and IS-Net is not asked
(an IS-Net job in flight is dropped). Otherwise the IS-Net path runs exactly as before (tracked,
cost-bounded refresh) - so the people-free B2 keeps its old behaviour. The user's separation-off
latch disables both. No queue: the call is synchronous, a seek/cut/switch needs no extra handling.
The model goes through the Cache Storage + ETag helper (first version re-downloaded 16.4 MB per visit).

## Before / after

`bench-video-mask.mjs --query ?hizliMaske=multiclass`, 2 interleaved runs per cell (r1, r2; r1
without the model cache), median [min-max], 100 Mbit/s, sidecar blocked. Same build, flag off vs on.
Times from file-input change. *IoU vs shown frame* compares with IS-Net on the shown frame, so for
the fast mask it is a model difference, not lag.

| section | pass | flag | first masked frame (s) | mask age p50 / p95 (s) | depth upd/s | frame p99 (ms) | frames >50 ms /min | masked depth frames % |
|---|---|---|---|---|---|---|---|---|
| A1 | cold | off | 19.5 | 0 [0-1.19] / 0 [0-2.46] | 5.9 [5.9-9.8] | 60.8 [60.8-66.6] | 94 [94-197] | 0 [0-44] |
| A1 | cold | on | 18.2 [18.2-19.9] | 0.03 [0.03-0.05] / 0.15 [0.15-0.16] | 5.6 [5.6-7.2] | 72.8 [72.8-102.9] | 146 [146-210] | 44 [44-55] |
| A1 | warm | off | 6.3 [6.3-9.6] | 1.36 [1.36-1.39] / 2.97 [2.97-3.4] | 8 [8-10.5] | 54.6 [54.6-84.9] | 68 [68-202] | 85 [85-88] |
| A1 | warm | on | 6.7 [6.7-9.3] | 0.02 [0.02-0.03] / 0.06 | 7.3 [7.3-9.9] | 66.8 [66.8-78.9] | 260 [260-410] | 95 [95-97] |
| A2 | cold | off | 19.8 [19.8-22.9] | 1.44 [1.44-1.46] / 1.98 [1.98-2.55] | 7 [7-8.7] | 54.5 [54.5-66.7] | 49 [49-172] | 21 [21-44] |
| A2 | cold | on | 18.2 [18.2-22.9] | 0.03 [0.03-7.72] / 0.17 [0.17-7.96] | 1.9 [1.9-7.3] | 78.7 [78.7-1006] | 70 [70-161] | 13 [13-57] |
| A2 | warm | off | 6.8 [6.8-9.7] | 1.4 [1.4-1.73] / 3.43 [3.43-4.7] | 1 [1-9.6] | 60.6 [60.6-1006] | 56 [56-147] | 84 [84-100] |
| A2 | warm | on | 6.6 [6.6-12.5] | 0.02 [0.02-0.08] / 0.04 [0.04-0.28] | 3.4 [3.4-9.8] | 66.7 [66.7-151.6] | 271 [271-328] | 91 [91-96] |
| B1 | cold | off | 22.8 | 0 [0-10.8] / 0 [0-11] | 6.6 [6.6-11.5] | 42.5 [42.5-60.8] | 14 [14-252] | 0 [0-3] |
| B1 | cold | on | 19.9 [19.9-23.3] | 0.02 [0.02-0.07] / 0.18 [0.18-1.29] | 5.5 [5.5-8.1] | 72.8 [72.8-115.3] | 60 [60-241] | 10 [10-13] |
| B1 | warm | off | 10.3 [10.3-24.2] | 0.83 [0.83-1.42] / 1.19 [1.19-2.55] | 8.6 [8.6-13.7] | 42.4 [42.4-66.8] | 3 [3-221] | 4 [4-45] |
| B1 | warm | on | 7.2 [7.2-11.3] | 0.02 [0.02-0.03] / 0.04 [0.04-3.86] | 10.1 [10.1-12.1] | 66.7 [66.7-72.5] | 58 [58-266] | 20 [20-27] |
| B2 | cold | off | 18.8 [18.8-20.1] | 1.3 [1.3-8.87] / 2.07 [2.07-9.01] | 10 [10-11.2] | 42.5 [42.5-54.5] | 18 [18-53] | 1 [1-17] |
| B2 | cold | on | - | - (no mask) | 7 [7-7.7] | 60.5 [60.5-78.7] | 67 [67-126] | 0 |
| B2 | warm | off | 13.1 | 0 [0-1.16] / 0 [0-1.96] | 11.1 [11.1-12.1] | 48.6 [48.6-60.6] | 30 [30-67] | 0 [0-11] |
| B2 | warm | on | - | - (no mask) | 11.1 [11.1-11.8] | 54.5 [54.5-54.6] | 49 [49-93] | 0 |
| C1 | cold | off | 19.3 [19.3-24.1] | 1.61 [1.61-3.58] / 2.66 [2.66-3.85] | 4.2 [4.2-10] | 60.5 [60.5-121.3] | 76 [76-296] | 8 [8-44] |
| C1 | cold | on | 18.3 [18.3-18.4] | 0.04 [0.04-0.05] / 0.13 [0.13-0.19] | 6.4 [6.4-7.2] | 66.9 [66.9-72.7] | 90 [90-126] | 56 [56-58] |
| C1 | warm | off | 9.3 [9.3-11.8] | 1.39 [1.39-2.76] / 2.52 [2.52-4.51] | 4.8 [4.8-9.8] | 72.8 [72.8-121.4] | 161 [161-381] | 69 [69-94] |
| C1 | warm | on | 6.7 [6.7-6.9] | 0.03 [0.03-0.04] / 0.04 [0.04-0.11] | 9.1 [9.1-11.1] | 54.6 [54.6-78.9] | 66 [66-220] | 100 |

Fast-mask cost from the app's own job log (r2): steady 7-9 ms p50, 10-15 ms p95 per depth frame on
the main thread. **First call: 2.4 s (cold) / 0.2 s (warm) main-thread stall** (WebGL delegate set-up
on the first `segment`). It runs only on model depth frames, so not during stalls; between them the
mask is that of the depth frame on screen. Load: system CPU 23-52 %, GPU 6-28 %; A2 r1 had a
1-2 depth/s machine state in both flags (excluded from conclusions, kept in the ranges).

With the mask from the same frame, the C1 overlay check gives subject pixels outside the applied
mask 7 % [2-21] (8 snapshots, age 85 ms [25-681]) vs 57 % [13-91] before.

## Verdict

Mask age drops from ~1.4 s to ~0.03 s on every person section, and on C1 the limbs are in the
drawn window. But frames > 50 ms rise in 7 of 8 warm pairs (A1 260-410 vs 68-202 /min, A2
271-328 vs 56-147); long frames carry no script attribution, so the cause (WebGL readback against
the WebGPU depth queue, or the window/crop changing every frame) is not established. There is also
the 2.4 s cold first-call stall, 16 MB to download, and B1 pedestrians now switch separation on (a
behaviour change). **Default stays off.** Next steps if pursued: run the segmenter in a worker
(moves the stall and readback off the main thread, needs stale-result handling), and re-measure long
frames on a quieter machine.

## Not verified

Production build, the iGPU path, other browsers; selfie_segmenter in the app (spike only); hair
segmenter / DeepLab not evaluated.
