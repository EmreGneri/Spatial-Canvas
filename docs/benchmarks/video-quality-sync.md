# Video synchronization and scene-local masks

This batch repairs existing buffered/prepared-video and optical-flow paths. It does not replace a model, increase particle counts, enable experimental interpolation, or change the default preparation/quality choices. DAViD remains enabled under its existing policy.

| Reproduced failure | Result after the fix |
| --- | --- |
| Prepared read finishes after playback becomes ineligible | The old read cannot publish or restore prepared mode. Re-enabling permits a fresh read without overlapping disk work. |
| Cache returns source frame 0.60 for requested time 0.65 | Publication retains 0.60; freshness and ordering use the actual source timestamp. |
| A scene cut lies between mask anchors | Masks from opposite scenes are not blended together. |
| Exact bilinear coordinate borders an uncovered Infinity cell | Zero-weight invalid neighbors do not invalidate the covered sample; positive-weight invalid contributors remain rejected. |
| Identical RGB frames enter optical flow | The unchanged-frame check runs before luminance conversion and preserves independent output buffers. |

The reader retains its existing symmetric 250 ms freshness window because the cache can clamp a request just before its first decoded timestamp to that first frame. Seek/disposal and source guards remain in place, as do single-flight reads, latest-target coalescing and sustained-miss fallback.

Only endpoint masks from the same detected scene can contribute to an interval. A scene without a reachable anchor gets an independent all-ones mask: it retains the scene instead of importing an unrelated silhouette or deleting pixels. This fallback can retain background. The scene-cut detector itself was not changed and can still miss a cut.

## Verification

Run from the repository in PowerShell:

```powershell
node scripts/verify-buffered-video-playback.mjs
node scripts/verify-video-mask-track.mjs
node scripts/verify-live-interpolation.mjs
npm run typecheck
npm run verify:video-sync
```

The buffered test adds sixteen named regressions to its existing invariants. Mask/flow regressions cover one/multiple cuts, missing anchors, no-cut identity, endpoint/buffer ownership, non-finite bilinear corners and unchanged-frame RGB read counts.

The browser check uses installed Chrome with real WebCodecs encoding/decoding, an HTMLVideoElement and OPFS. It generates a short local clip and injects deterministic depth rather than loading an AI model. Observed: requested 0.65 s, source/published 0.60 s; zero publications after disable; clean masks on each side of a cut; no JavaScript page errors or model requests.

These checks establish correctness of the repaired paths. They do not establish higher FPS, improved human hair/hand segmentation, or better AI depth accuracy. Real-model moving-subject visual acceptance remains separate work. Prepared video and intermediate optical-flow frames retain their existing opt-in/default policies.
