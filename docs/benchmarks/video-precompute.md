# Offline video preparation and buffered playback

Assignment row 5 uses a genuine official VDA Small temporal32 head at 154x266. It does not run the streaming model repeatedly and call that offline inference.

## Run

`npm run dev`, upload a video, and watch the **Video depth** progress display. Preparation runs beside the existing live preview. Finalized scenes play from Uint16 OPFS depth; uncached timestamps and slow reads resume live V2 depth. Cancel preparation or replace the source to stop work and release the temporary store.

Object separation keeps using the existing live mask/depth path because the prepared files contain depth only. Turning separation off resumes prepared playback when available. Camera input stays on the live path.

## Model assets

The encoder is the existing pinned VDA Small `encoder_fp16.onnx`; the separate offline head is `public/models/DepthAnything/video-depth-anything-small-offline-154x266/offline32_fp16.onnx`. The local exporter checks the official Small checkpoint SHA256 and upstream revision, verifies the wrapper against the official head, then checks fp32/fp16 ONNX outputs against PyTorch. Assets are ignored local files. A clean deployment needs those assets supplied; absent models fall back explicitly. No model was uploaded to hosting by this change.

```powershell
& .bench-tmp/vda-export-env/Scripts/python.exe scripts/export-vda-offline.py --source .bench-tmp/vda-upstream --checkpoint .bench-tmp/vda-source-download/video_depth_anything_vits.pth --output public/models/DepthAnything/video-depth-anything-small-offline-154x266
```

## Processing and storage

- Decode a separate muted video element, preserving actual presented media timestamps. Pause during disk writes to bound RGB memory; reject detected frame drops rather than inventing frames or FPS.
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
