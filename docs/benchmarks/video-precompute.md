# Offline video preparation and buffered playback

Assignment row 5 uses a genuine official VDA Small temporal32 head at 154x266. It does not run the streaming model repeatedly and call that offline inference.

## Run

`npm run dev`, upload a video, and watch the **Video depth** progress display. Preparation runs beside the existing live preview. Finalized scenes play from Uint16 OPFS depth; uncached timestamps and slow reads resume live V2 depth. Cancel preparation or replace the source to stop work and release the temporary store.

Object separation: turning it on after (or during) preparation builds a mask track. Every 48th frame of a scene (plus the scene's first and last frame) goes through the existing live mask chain (BiRefNet + DAViD with the sidecar, else the browser segmenter); the frames in between get the mask by forward and backward optical flow over the stored 266x154 RGB, blended by distance, with untrusted pixels keeping the previous mask. Masks are stored as Uint8 per scene in OPFS. While a region has no mask yet, the live mask/depth path runs (live V2 throttled to 2 Hz); once it has one, prepared depth plays with the stored mask. The RGB file is therefore kept until the source is released. No mask work runs unless separation is turned on. Camera input stays on the live path.

## Policy

Videos shorter than 2 minutes are prepared automatically. For longer ones the app asks first and shows an estimate (4x the video length, from the speed measured on the RTX GPU). The "background video processing" setting (on by default, stored in `localStorage` as `arkaPlanVideoIsleme`) turns preparation off; turning it off cancels a running preparation, turning it on starts one for the loaded video. Cancel stays available while preparing.

## Model assets

The encoder is the existing pinned VDA Small `encoder_fp16.onnx`; the separate offline head is `public/models/DepthAnything/video-depth-anything-small-offline-154x266/offline32_fp16.onnx`. The local exporter checks the official Small checkpoint SHA256 and upstream revision, verifies the wrapper against the official head, then checks fp32/fp16 ONNX outputs against PyTorch. Assets are ignored local files. A clean deployment needs those assets supplied; absent models fall back explicitly. No model was uploaded to hosting by this change.

```powershell
& .bench-tmp/vda-export-env/Scripts/python.exe scripts/export-vda-offline.py --source .bench-tmp/vda-upstream --checkpoint .bench-tmp/vda-source-download/video_depth_anything_vits.pth --output public/models/DepthAnything/video-depth-anything-small-offline-154x266
```

## Processing and storage

- Decode with WebCodecs (Mediabunny `VideoSampleSink`), preserving source timestamps. Each 4K frame is resized on the GPU with an asynchronous `createImageBitmap`; only the 266x154 result is copied to the CPU. Rotated tracks keep the `CanvasSink` path.
- One OPFS file per stage, written sequentially: `rgb` for the whole clip, `float-<scene>` and `depth-<scene>` per scene. Per-frame `createWritable` cost ~45 ms per write on Windows.
- While a playback frame takes longer than 100 ms, preparation waits up to 1 s per step (decoded frame or window) so playback keeps priority.
- Reset temporal context at detected scene cuts. Within each scene use 32-frame windows, stride22, overlap10, the official previous-window indices `[0,12,24..31]`, two-anchor affine alignment and an eight-frame seam blend.
- Reuse encoder features for overlap/anchor frames with a bounded cache. Model calls share the existing GPU queue and check cancellation between frames.
- Normalize with one range per scene and store Uint16 depth. Temporary RGB/float files are removed after that scene is committed. Storage quota is checked before decoding; errors remove the partial store and retain live playback.
- Playback reads at most one frame at a time and retains only the latest pending decoded frame. No RGB is read back: prepared depth matches the presented frame, so particle color comes from the GPU video texture. Seek invalidates pending publication. A late (>250 ms), missing or failed read drops only that frame; live depth resumes only for an unprepared region or after 1 s without a published frame (hysteresis). Paused videos refresh when preparation completes.

Metadata and stalled decoding have timeouts. An in-flight ORT run cannot be interrupted, but cancellation prevents the remaining encoder/window work and stale publication.

## Checks

```powershell
node scripts/verify-video-precompute.mjs
node scripts/verify-buffered-video-playback.mjs
node scripts/verify-video-precompute-browser.mjs
node scripts/bench-vda-offline.mjs
```

The browser integration test uses actual video decoding and OPFS with a deterministic test provider. The offline benchmark separately runs the real temporal32 model. Neither alone establishes sustained full-application playback FPS or accuracy on a long real clip.

## Measurements (2026-10-25, review fixes)

Visible Chrome window launched by Playwright (`scripts/tarayici-oturumu.mjs`, `basli`), adapter reported as NVIDIA Blackwell (RTX 5070 laptop). 6 s windows, one run at a time. Clips: first 5 s of `forest-3679072.mp4` (3840x2160, 24 fps) and first 6 s of `pixabay-forest-29721.mp4` (1920x1080, 30 fps), cut with `ffmpeg -c copy` to keep preparation short. Script: rAF frame count and worst gap, `Engine.setDepth` wrapped for timing, DEV counters in `window.__videoStats`.

The reported 1.4 FPS baseline came from the user's normal Chrome, which gets the Intel iGPU. The Playwright Chrome gets the RTX GPU, so that number was not reproduced here. The per-frame costs below explain it: they scale up on the iGPU.

Measurement (a), `drawImage(4K video) + getImageData` at 384x216, 40 frames: `willReadFrequently: true` p50 22.1 ms / p95 60.1 ms; without it 2.1 / 7.4 ms; `createImageBitmap` resize 3.1 / 7.0 ms.

| Scenario | Before (a4828fe) | After item 1 |
| --- | --- | --- |
| 4K 5 s, preparation time | 75.9 s | 31.3 s |
| 4K 5 s, worst frame during preparation | 394 ms | 545 ms |
| 4K 5 s, prepared playback FPS | 118.9 | 157.4 |
| 4K 5 s, prepared playback per-frame color capture | 18.0 ms (23/s) | none |
| 4K 5 s, prepared playback setDepth | 10.7 ms avg | 8.8 ms avg |
| 4K 5 s, (b) fallbacks/s, (c) live infers/s during "ready" | 0 / 0 | 0 / 0 |
| 1080p 6 s, preparation time | 74.6 s | 19.4 s |
| 1080p 6 s, prepared playback FPS | 150.0 (color capture 6.5 ms/frame, setDepth 12.4 ms) | 160.1 (no capture, setDepth 5.9 ms, item 2) |
| 4K live path (preparation cancelled), FPS | 46.1, 44.1 (pre-110abf4 4f72066: 54.9, 59.5) | 56.1, 55.8 (4f72066 in the same session: 55.3, 56.4) |
| 4K live path, setDepth | 13.4-15.4 ms, plus ~17 interpolation readbacks/s | 10.2-11.0 ms, no interpolation |

On the RTX run no prepared/live ping-pong occurred (b = 0, c = 0), so F1 was not the cause there; the hysteresis guards slower machines. Live flow interpolation stays opt-in (`?araKare=1`): even capped at 12 Hz it measured ~42 FPS and 6 model Hz against ~53 FPS and 9 model Hz without it.

Item 2 check: during "ready" playback the counters show 0 live inferences, 0 interpolations and 0 fallbacks per second on both clips, so no live pipeline runs beside prepared playback. Prepared playback renders far above video fps on the RTX GPU (157 FPS 4K, 160 FPS 1080p). A screenshot confirmed particle colors come from the video texture.

Item 3 (hysteresis) landed with item 1: a late, missing or failed read keeps the last prepared frame; live depth resumes only for an unprepared region or after 1 s without a published frame; a hung read is never overlapped. `scripts/verify-buffered-video-playback.mjs` covers these cases. Restart storms: 0 fallbacks/s and 0 live inferences/s during "ready" playback.

Item 4 (preparation must not freeze the tab), 4K 5 s clip:

| Measure | Before | After item 4 |
| --- | --- | --- |
| Decoding stage | 9.2 s (OPFS puts 5.5 s, sync `getImageData` 3.4 s, max 77 ms per frame) | 3.4-7.0 s (`getImageData` 0.37 s total) |
| Long tasks while decoding | 14-26, max 228 ms | 2-12, max 228 ms |
| Long tasks while processing | max 83-104 ms | max 82-87 ms |
| Whole preparation | 75.9 s (a4828fe), 19.9-31.3 s (item 1) | 16.1-21.8 s |

The remaining worst frame during preparation (~450 ms) falls in the "loading" stage, while ORT compiles the encoder and offline head sessions on the main thread next to the live V2 startup. Moving preparation into a Worker would remove it; not done here.

Item 5 (prepared video with object separation), `pexels-lighthouse-orbit-20744392.mp4` first 5 s (3840x2160, 29.97 fps, 153 frames), Playwright Chrome on the RTX GPU, sidecar off:

- Preparation (depth only): 20.8-25.0 s. The mask track is extra and only runs when separation is turned on.
- Mask track with a key frame every 24 frames: 92-98 s (8 key frames). One key frame mask costs ~8.5 s here (BiRefNet in the browser, also measured standalone: 8.3-9.6 s per call; the first call ~15-17 s with model load). Flow fill between key frames: ~1 s per 24 frames.
- With a key frame every 48 frames (default): 72 s for 5 frames' worth of key masks, so roughly +3.4x the depth preparation time on this machine without the sidecar. With the sidecar the key frame masks are much cheaper.
- Playback with separation on and the mask track ready: 133-153 FPS, 0 live inferences/s, 0 fallbacks/s (before: separation forced the full live pipeline).

Item 8 (video edge cleanup): the CPU kernel got row/column lookup tables and a separable max filter for the maskless case. The output is bit-identical to the old kernel (432 random cases checked, including masks, guide masks and non-finite input). Node microbenchmark, 384x384 output grid, strength 2: 384x216 input 11.0 -> 3.1 ms, with mask 13.7 -> 5.2 ms, 266x154 input 8.5 -> 4.3 ms. In the app (visible Chrome, RTX), setDepth grows by ~4-5 ms with strength 2, but frame rate does not change: live 4K 55.8 / 57.5 FPS (strength 0: 58.2 / 55.3), prepared 1080p 158.9 FPS (strength 0: 162.1). Default strength is now 2.

Item 9 (full verification): `npx tsc --noEmit -p .` clean, `npm run verify` passes, `npx vite build --outDir <temp>` succeeds (the point count benchmark link is not in the production bundle). Full clips, visible Chrome on the RTX GPU, default settings (edge cleanup 2):

| Clip | Preparation | Worst frame while preparing | Prepared playback (5 s) |
| --- | --- | --- | --- |
| forest-3679072.mp4, 3840x2160, 24 fps, 16 s | 34.3 s | 406 ms | 156.4 FPS, worst frame 24 ms, setDepth 12.9 ms at 24/s, 0 live inferences, 0 fallbacks |
| pixabay-forest-29721.mp4, 1920x1080, 30 fps, 24 s | 46.4 s | 364 ms | 158.4 FPS, worst frame 24 ms, setDepth 11.4 ms at 30/s, 0 live inferences, 0 fallbacks |

Against the user's baseline on the 4K clip (1.4 FPS, frames over 1 s, setDepth 55 ms; measured on the Intel iGPU, not reproduced here), the per-frame 4K readback (~22 ms CPU canvas, worse on the iGPU) and the prepared/live ping-pong paths are gone. The Intel iGPU was not measured in this session.
