# MoGe-2 browser photo benchmark

Measured 2026-10-23 using actual learned ONNX outputs on three deterministic
raytraced RGB scenes. **This run does not establish a MoGe quality improvement.**
Mean relative-shape AbsRel was 0.06839 for MoGe and 0.06313 for V2-small.
MoGe's direct metric-depth error was large on these synthetic scenes.

Run from the repository root:

```powershell
node scripts/bench-moge-photo.mjs --chrome
```

Results and rendered inputs: `olcum-out/moge-photo/results.json` and the three
scene PNGs in the same directory. This directory is a local measurement artifact.

## Protocol

- Browser MoGe-2 ViT-S, official dynamic FP32 graph, 1,800 tokens, 518x518 input.
  The published graph names its metric-scale output `scale`.
- Browser Depth Anything V2-small through `estimateDepth`, with detail,
  foreground stretch, Sobel relief, smoothing and tile detail disabled. Existing
  percentile normalization and slope limiting remain part of the baseline.
- Explicit `?inference=browser`; the sidecar is disabled for both models.
- Exact pinhole camera Z comes from CPU ray intersections. Camera focal is
  429.94 pixels, principal point (259,259), square 518x518 image. Scenes are a
  textured slanted plane, a shaded sphere with backdrop/floor, and a textured room.
- Separately fit `a * predicted_inverse_depth + b` to true inverse depth on even
  `(x+y)` pixels. Score camera-Z AbsRel on odd pixels only. V2's normalized
  disparity is its predicted inverse-depth coordinate. MoGe uses `1 / metric_Z`.
  Both models use the identical intersection of valid pixels and identical split.
- Direct MoGe metric-Z AbsRel uses those same heldout pixels **without** the
  ground-truth affine fit. Focal relative error is reported separately.
- A nonpositive calibrated inverse depth makes the corresponding full heldout
  score unavailable; no such predictions occurred in this run.
- Adapter was captured on the actual `requestDevice` call: vendor `nvidia`,
  architecture `blackwell`. Chrome withheld device/description strings; exact GPU
  model is therefore not asserted. Max buffer limit was 2,147,483,648 bytes.

## Results

Lower error is better. Coverage is the common evaluation mask, not independent
coverage for each model.

| Scene | Common coverage | MoGe shape AbsRel | V2 shape AbsRel | MoGe direct metric AbsRel | MoGe focal relative error |
|---|---:|---:|---:|---:|---:|
| Slanted plane | 100% | 0.01317 | 0.02508 | 0.86448 | 0.12272 |
| Sphere/backdrop | 71.36% | 0.14810 | 0.13422 | 0.74104 | 0.09907 |
| Room | 100% | 0.04389 | 0.03010 | 0.68155 | 0.19984 |
| Scene mean | — | **0.06839** | **0.06313** | **0.76236** | **0.14054** |

First image cold time, including local model loading and CPU postprocessing:
MoGe 4,083 ms; V2 2,681 ms. Warm second calls were MoGe 232–257 ms and V2
150–183 ms. The first calls on later scenes reuse the loaded models.

## Interpretation and limits

MoGe wins the slanted plane and loses the sphere and room in this small test.
Its mean shape error is approximately 8.3% higher than V2 here. Direct metric
error averages 76.2%; focal error averages 14.1%. Solver recovery on constructed
XYZ points is a separate unit test and must not be presented as learned-model
accuracy.

These three stylized scenes are not representative real photos. Their absolute
scale is visually ambiguous. The sphere result excludes 28.64% of pixels rejected
by MoGe's predicted validity mask; matched coverage makes the model comparison
fair within that subset, but does not measure full-scene quality. Adjacent-pixel
calibration/evaluation splits test interpolation within one image rather than
generalization to another scene. Results do not justify replacing V2 by default
or treating arbitrary image reconstructions as calibrated physical measurements.

The initial result JSON accidentally reused the name `shift` for both inverse
depth alignment and raw point Z shift. Report cleanup renamed that saved raw
quantity to `rawPointShift`; no error/timing values changed. The script now keeps
the two quantities separate on future runs.

## Upstream references

- [Official ONNX support](https://github.com/microsoft/MoGe/blob/main/docs/onnx.md)
- [Raw forward and inference postprocessing](https://github.com/microsoft/MoGe/blob/main/moge/model/v2.py)
- [Focal/shift reprojection objective](https://github.com/microsoft/MoGe/blob/main/moge/utils/geometry_numpy.py)
- [Pinned ViT-S asset and SHA256](https://huggingface.co/Ruicheng/moge-2-vits-normal-onnx/commit/e50ffda41565591092adea54c6ac83d6212e1e23)

ViT-S ONNX lacks its own model-card license declaration. The same author's
[upstream ViT-S checkpoint](https://huggingface.co/Ruicheng/moge-2-vits-normal)
declares MIT; that provenance must not be described as an independently explicit
license declaration inside the ONNX repository.
