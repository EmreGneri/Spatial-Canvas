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
- Playback reads at most one frame at a time and retains only the latest pending decoded frame. RGB is captured before the asynchronous read. Seek invalidates pending publication; a successful read older than250ms also requests fallback. Paused videos refresh when preparation completes.

Metadata and stalled decoding have timeouts. An in-flight ORT run cannot be interrupted, but cancellation prevents the remaining encoder/window work and stale publication.

## Checks

```powershell
node scripts/verify-video-precompute.mjs
node scripts/verify-buffered-video-playback.mjs
node scripts/verify-video-precompute-browser.mjs
node scripts/bench-vda-offline.mjs
```

The browser integration test uses actual video decoding and OPFS with a deterministic test provider. The offline benchmark separately runs the real temporal32 model. Neither alone establishes sustained full-application playback FPS or accuracy on a long real clip.
