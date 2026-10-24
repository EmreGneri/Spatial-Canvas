# VDA GPU cache and context experiment

`?videoDerinlik=vda` now keeps temporal caches and encoder features on the ORT WebGPU device. The input image is uploaded once and only the final 154x266 depth is read back. A fixed 43-slot GPU history preserves the upstream first-two/latest-29 attention schedule; a WGSL gather packs the selected slots without downloading caches. Bound input/output buffers keep shapes and addresses stable.

The existing fp16 graphs are used. Their weights/operators are fp16 and external cache/feature I/O is float32, matching the existing verified exports. This change removes CPU cache packing and cache transfers; it does not claim a pure fp16 external cache.

Flags:

- `?videoDerinlik=vda`: GPU cache, context32. VDA itself remains opt-in.
- `?videoDerinlik=vda&vdaGpu=0`: previous CPU cache path.
- `?videoDerinlik=vda&vdaContext=16`: experimental 15-frame attention cache, separate local exported assets.
- `?videoDerinlik=vda&vdaCapture=1`: try temporal-head graph capture. The installed ORT build fails capture replay on this device, so runtime retries ordinary GPU cache. Capture is never enabled automatically.

`vdaRuntimeInfo()` reports the actual mode, context and precision after fallback. Missing/unsupported context16 retries context32; failed capture retries uncaptured GPU; failed GPU cache retries the previous CPU-cache implementation; the existing caller finally falls back to V2 if VDA fails entirely. Warmup runs bootstrap and two streamed frames, then resets the user context.

## Reproduce

```powershell
node scripts/verify-vda-gpu.mjs
node scripts/verify-video-depth-anything.mjs
npm run typecheck
node scripts/bench-vda-gpu.mjs --compare
node scripts/bench-vda-gpu.mjs --context16
node scripts/bench-vda-quality.mjs --quick --gpu-contexts --synthetic-only
```

Run visible GPU benchmarks one at a time, with their window visible. `--compare` checks 48 successive GPU outputs against the previous float32-I/O fp16 runtime, covering history deletion and slot reuse. Timing excludes the first three compilation/warmup frames. Raw graph throughput is different from whole-application throughput.

The context16 exporter uses the pinned official checkpoint and upstream commit, preserves the checkpoint's 32-position sinusoidal embedding, and passes 15 cached frames so upstream attention slices its first 16 positions. This is an experiment with a pretrained context32 model, not retraining. Its history keeps the same 41-frame anchor horizon and selects first-two/latest-13. Export is staged and published only after torch/fp32/fp16 parity succeeds. It refuses to overwrite a directory containing another context size.

```powershell
& .bench-tmp/vda-export-env/Scripts/python.exe scripts/export-video-depth-anything.py --source .bench-tmp/vda-upstream --checkpoint .bench-tmp/vda-source-download/video_depth_anything_vits.pth --output public/models/DepthAnything/video-depth-anything-small-stream-154x266-context16 --context 16
```

Export dependencies: CPU torch2.7.1, torchvision0.22.1, numpy, onnx, onnxruntime, einops, easydict, tqdm, opencv-python-headless, onnxconverter-common. Upstream code/checkpoint are local build inputs; no network or package installation occurs in the exporter. Generated models remain ignored local assets; clean deployments fall back to context32 until context16 assets are supplied.
