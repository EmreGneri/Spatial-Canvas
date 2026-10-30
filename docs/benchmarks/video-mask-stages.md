# Video mask: where a wrong selection first appears (browser IS-Net path)

Local Vite dev build, installed Chrome, `nvidia/blackwell`. The sidecar probe is switched off
(`?inference=browser`), 0 requests to the helper port were observed in every run. Three clips: A = a
concert with several dancers (0-19 s, portrait), B = a street walk with small pedestrians (0-12 s), C = a
close stage performance (7 s). The B section was not replaced.

## Method

Per mask job, on the exact source frame the app captured (640 px canvas, same code path as the app), the
stages were recorded and drawn side by side: the model's raw output (>= 0.5), after `keepMainComponents`,
and the final mask (`dilateAndFeatherMask`). During playback the mask the engine received (after the
image tracker and its shift) was sampled every ~0.8 s and drawn on the frame on screen. Dropped parts of
the components stage were drawn in magenta. Two runs: the first (jobs A 18, B 15, C 14; 120 applied-mask samples)
for the stage panels and the tracker counts, the second (jobs A 19, B 12, C 16 = 47) with the components stage
measured numerically; the dropped-part counts below are from the second run.

## Findings

| stage | what goes wrong | evidence |
|---|---|---|
| model (raw) | picks the wrong thing or misses people | A at 12.5 s: only an audience head selected, all three dancers missing; A at 5.8 and 10.3 s: some dancers missing; B at 8.5 s: a lamp post is part of the selection. Not fixable after the model; nothing here changes it. |
| components (post) | **drops a second, valid person** | 8 of 47 jobs lost a part >= 0.10 of the main one, and every such part was a real person: A (4 of 19 jobs): 0.12, 0.59, 0.90, 0.36 of the main (a dancer each time); B (4 of 12): 0.10, 0.42, 0.46, 0.64 (a second walker or a seated person). C: none. The raw mask had them. |
| dilate / feather | grows the mask by ~1 point of the frame | expected (the dilation), no wrong region added |
| tracker (applied) | reports "lost" and leaves the mask where it was captured | with age 0.5-1 s: lost in 18 of 19 samples (A 6/7, B 4/4, C 8/8), above 1 s about 95 %. The mask then keeps the captured position; this is timing, not selection. |

`keepMainComponents` keeps the largest component plus parts within 12 px of it. It was written for the
photo path (door frame, floor patches); in a video with two people apart from each other it keeps one.

## Fix (video only)

`keepMainComponents(..., farMinFrac)`: a component at least `VIDEO_FAR_MIN_FRAC` (0.10) of the largest one is
kept however far it is. Photos and the helper path (`kaynak === 'foto'`) pass nothing and keep the old rule.
Test: `scripts/verify-maske-zamansal.mjs` (far second person kept for video, small far part still dropped,
default unchanged).

## Before / after on the same frames

Raw mask computed once per frame, then both rules applied (so only the rule differs). A at 0.5 s steps (37
frames), B at 0.5 s steps (23), C at 0.5 s steps (14).

| clip | frames where the rule changed the mask (> 0.3 pt) | foreground, mean before -> after |
|---|---|---|
| A | 7 of 37 | 11.8 % -> 12.8 % |
| B | 10 of 23 | 4.3 % -> 5.2 % |
| C | 1 of 14 | 25.8 % -> 26.2 % |

Added regions seen on the frames: A at 6.5 s the left dancer, at 14 s the right dancer; B at 3 s and 11 s the
second and third walkers; C at 3.25 s a second face. Not fixed and still visible: A at 12.5 s (only an audience
head, the model's selection), B at 8.5 s (the lamp post, now kept together with the walker instead of alone).

Side effect to know: the larger mask can cross the 8 % separation threshold (A 1 frame, B 2 frames of the
sections above), so separation may open on the street clip where it did not before.

Not verified: the integrated GPU, other browsers, the helper (sidecar) mask path (unchanged), whether a false
large component (a big audience head next to a small dancer) can be kept; none occurred in these 47 jobs.

## Box jumps: how much the far rule adds (replay of one recorded raw sequence)

The raw model masks of clip A (37 frames, 0.5 s apart) were recorded once and fed to both rules, so only the
rule differs (no comparison of separate live runs). Refreshes were replayed with a 2.5 s stride from five
start offsets (32 refresh steps per rule), through the real sampling-window (`maskeBboxPenceresi`) and depth
crop (`canliKirpmaKutusu`) code with their own hysteresis.

| per refresh, clip A | near-only rule | far rule |
|---|---|---|
| mask bounding box jump (centre or size, fraction of frame) median / mean / max | 0.18 / 0.22 / 0.45 | 0.21 / 0.21 / 0.40 |
| sampling window edge jump, median / mean | 0.19 / 0.21 | 0.19 / 0.20 |
| area drawn at a clearly different opacity (>0.5), mean | 12.6 % | 13.9 % |
| area at the faint window band (0 <-> 0.2), mean | 16.4 % | 16.1 % |
| depth crop switches (on <-> off or box -> box), of 32 | 13 | 20 |

So the far rule does not make the bounding box or the sampling window jump more (the live comparison of two
separate runs that showed 0.15 -> 0.27 was mostly the model choosing different people from run to run). It adds
about 1.3 points of clearly visible change, which is the second dancer being drawn at full opacity (content, not
a jump). Both rules already change the window at almost every refresh on this clip.

The depth crop switched more (13 -> 20 of 32): the crop gate (box area 0.35 .. 0.75) had no hysteresis, and
with the mask alternating between one and two dancers the area sits around 0.35, so the crop turned on and off
and each switch re-normalises the depth. Fix: the crop starts only `KIRPMA_HISTEREZIS` inside the limits and
keeps the old limits once on; the lower limit is never relaxed. Replay: 5 (near-only) and 9 (far rule) of 32.
Cost check on the frames the gate now skips (8 frames of A with box area 0.35-0.40, same mask, crop forced on
vs off): relief gradient inside the mask 5.47 (off) vs 3.00 (on) at input 154 (on >= off in 0 of 8 frames) and
8.13 vs 7.42 at input 252 (2 of 8), so skipping the crop there lost no detail by this metric (one clip, one
metric, 8 frames; the box-area guard's own note says nothing below 0.49 was ever measured as a gain).

Open: the mask itself still changes between refreshes with the model's selection (different people), and
that moves the window. The replay cannot separate that from the rule.

## Known negative example of the far rule

Live check, 12 mask jobs of A and B had parts added by the rule: all but two were a real second person. One
is wrong: A at 17.8 s, a tall strip at the right frame edge (dark audience area), 0.26 of the main part; one
is ambiguous: B at 11.1 s, a thin streak below a walker (a shadow or the walker's legs), 0.28 of the main
part. The area ratio does not separate them from the valid additions (0.095 .. 0.45), so no new threshold was
introduced; the false part is left as a known limitation of the rule.
