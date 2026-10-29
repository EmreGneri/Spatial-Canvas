# Video mask: separation threshold and refresh (personal clip A)

Clip: `personal clip A` (concert, 1080x1920 HEVC, 35.3 s, 3–5 dancers on stage). Browser IS-Net
(`captureLiveMask`, sidecar blocked), NVIDIA RTX 5070 adapter, installed Chrome headed 1280x800,
harness `scripts/bench-video-vs-reference.mjs` (A/B cells served from source snapshots, `--variants`).
One clip, one GPU, a noisy machine (see "Speed").

## 1. Threshold: 15/10 excluded masks that select people → 8/4

IS-Net coverage every 0.5 s (70 frames, `--phases coverage`): p50 13 %; 33 % of frames ≥ 15 %,
73 % ≥ 8 %. The interim runs' first captures (13.50 s / 14.15 s) are 12.1 % / 13.5 %.


Mask outline (cyan) on the frame, selected frames (ffmpeg frame vs browser-seek mask, ±1 frame):


What is seen: at 4.5–6.5 % the mask selects ONE of the 3–5 dancers and its edge follows that person;
the others are excluded (1.75 s also takes the next dancer's torso). At 11.7 % one dancer, at 21.3 % two,
outlines close with holes at costume cut-outs. At 0–3.7 % the mask is a body fragment (leg, head + torso
part). Nothing here says which dancer is "the subject"; there is no ground truth.

Decision: on at ≥ 8 %, off below 4 % (`AYIRMA_ACMA_ORANI` / `AYIRMA_KAPATMA_ORANI`, `src/ui/maskeKarari.ts`,
single source for the live path and keyframe capture). Off sits just above the fragments (≤ 3.7 %).

**Known limit (not fixed by 8/4):** a small but person-selecting first mask (4–8 %, 14 of 70 start frames)
does not switch separation on. With the old "never refresh" rule it stayed off for the whole clip; with
the refresh below a later larger mask switches it on (simulated over all 70 start frames on the recorded
coverages: p50 0.5 s, worst 24.5 s, `verify-video-mask-refresh.mjs`). The on-threshold was not lowered
below 8 %: the synthetic "swallowed frame" mask that motivated `MASKE_ALT_ESIK` was 4.7 %, and on this
clip fragments (≤ 3.7 %) and single-person masks (≥ 4.5 %) are too close to separate safely from one clip.

Same frame (13.5 s), same IS-Net job (11.6 %), default camera; left old gate, right new gate:


## 2. What blocked refresh (App instrumentation, `videoStats.maskLog` / `maskGate`)

Per depth frame with a mask, why no refresh was requested (one 20 s window each):

| state | blocked by | count | refreshes |
|---|---|---|---|
| separation off (first mask < on-threshold) | `captureMask()` only ran when no mask existed | 416–469 frames | 0 |
| separation on | miss gate (`maskeYenilenmeliMi`) said "fine" | 109–196 frames | 0–1 per run |
| separation on | 15 s minimum interval | 0–7 frames | – |

The 15 s interval was not the bottleneck; the drift ("mask misses the subject") gate almost never fired
while the applied mask was 9–17 s old (p50). Single flight already held: `maskBusy` drops 5–12 requests
per run, no queue. Per job: request → compute done 349–810 ms (first job 2.4–5.8 s incl. model load),
compute done → first render with it 41–88 ms (one 439 ms outlier).

Fix: `videoMaskeIstegi` (`maskeKarari.ts`, pure, used by App) — no mask (first, or after a rejected one):
capture (reject backoff 15/30/60 s and error retry unchanged); mask present and not paused: refresh every
`VIDEO_MASKE_TAZELEME_MS` = 8 s, also while separation is off; user turned separation off: nothing. The
drift gate was removed. Requests are driven by depth frames (no timers); a job finishing after a video
switch, seek or separation toggle is dropped (`iptal` / `maskRevision`). Shift tracking between refreshes
is unchanged.

## 3. Measurements — interim, speed comparison NOT completed

Interval sweep, same snapshot of HEAD + the user's uncommitted tree; `base` = that tree with only the
instrumentation, `thr` = + 8/4, `rNN` = + 8/4 + refresh every NN s. Median [runs]; base has one valid run
(runs 2–3 failed: the OS temp cleaner deleted old-dated files from the source snapshot; fixed afterwards).

| metric | base | thr | r15 | r8 | r4 |
|---|---|---|---|---|---|
| first masked frame (s) | never [never] | 26.0 [never/29.8/26.0] | 31.1 [31.1/32.9/16.8] | 32.4 [32.4/30.0/48.7] | 31.6 [18.4/31.6/32.0] |
| applied-mask age p50 (s) | – | 9.0 [–/9.0/16.9] | 9.8 [9.8/9.9/7.7] | 3.7 [3.5/3.7/4.8] | 2.3 [2.3/2.2/2.4] |
| applied-mask age p95 (s) | – | 14.5 [–/14.5/25.8] | 14.2 [14.2/14.4/13.9] | 8.0 [8.0/8.0/7.8] | 4.3 [4.3/4.2/4.5] |
| IoU vs fresh mask, p50 | – | 0.23 | 0.16 [0.09/0.16/0.35] | 0.15 [0.14/0.15/0.17] | 0.17 [0.17/0.06/0.24] |
| mask jobs / s | 0 | 0–0.05 | 0.05 | 0.15 | 0.25 |
| separation on-fraction | 0 | 1.0 [0/1/1] | 1.0 | 1.0 | 1.0 |
| depth Hz | 5.5 | 5.3 [5.2/5.3/5.8] | 5.5 [5.2/5.5/8.9] | 4.8 [4.8/5.3/4.6] | 4.4 [7.9/4.4/3.4] |
| depth inference (ms, app label) | 107 | 112 | 112 [112/118/61] | 120 [120/114/151] | 119 [70/119/180] |
| frames > 25 ms / min | 984 | 908 | 933 | 852 [852/941/830] | 807 [807/855/734] |
| frame p99 (ms) | 123 | 126 | 118 | 139 [139/116/175] | 158 [94/158/202] |
| 1 % low fps | 8.1 | 7.9 | 8.5 | 7.2 [7.2/8.6/5.7] | 6.3 [10.6/6.3/4.9] |
| CPU during / GPU before (%) | 41 / 7 | 39 / 8–23 | 36 / 5–11 | 33–42 / 13–17 | 38–48 / 0–24 |

IoU reference: the same app's IS-Net run again on the exact presented frame after playback. It measures
staleness against that model, not correctness. It stays low (0.06–0.35) at every interval; the dancers move
and the measure has no motion alignment, so no conclusion about the cause is drawn from it.

Live check of the fixed build (`reports/vmr-final.json`, runs stopped early): run 1 had a first mask of
3.1 % (separation off), refreshed at 1.6 % (still off), then 20.7 % → separation on; run 2 refreshed every
8 s with separation on, mask age p50 3.8 s.

**Speed: not established.** Depth inference ran at 61–180 ms here vs ~55 ms in the earlier quiet bench,
because of background GPU load (the user's own Chrome and sidecar). r4 showed the worst 1 % low and p99
in two of three runs, so 4 s was not taken; 8 s was chosen for the age gain (p50 9.8 → 3.7 s). Whether 8 s
costs depth Hz is within this noise and remains to be measured on a quiet machine. Render "fps p50" is the
rAF cadence, not visible smoothness, and is not reported as a result. The the reference build equal-conditions
comparison was dropped from this change.

## Reproduce

```powershell
node scripts/bench-video-vs-reference.mjs '<clip>' '<reference-root>' --phases coverage --grid 1.75,13.5
node scripts/bench-video-vs-reference.mjs '<clip>' '<reference-root>' --variants base=<dir>,fix=<dir> --cells base,fix --phases live --runs 3 --img-t 13.5 --max-gpu 30
node scripts/verify-video-mask-refresh.mjs
```

Raw: `reports/video-mask-refresh.json`, `reports/vmr-thr.json`, `reports/vmr-main.json`, `reports/vmr-final.json`,
`reports/vvp/coverage-raw.json` (local, not committed).
