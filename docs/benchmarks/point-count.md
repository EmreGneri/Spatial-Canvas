# Visible point-count benchmark

Run `npm run bench:points`, or open `/bench/points.html` from the application's **Point count benchmark** link. The page displays measurements and exports JSON.

The benchmark uses the production point cloud material and exact147456/262144/524288/1048576 point counts, a moving camera, a fixed960x540 viewport and DPR1. It checks visibility, context loss and the number of points actually drawn. It excludes inference, GPGPU simulation and postprocessing; RAF frame time includes display pacing.

## Measured results

Visible Chrome runs on 2026-10-25 (Europe/Istanbul) identified `ANGLE NVIDIA GeForce RTX 5070 Laptop GPU, Direct3D11` for both low-power and high-performance preferences. All four point counts reached approximately165FPS; p50 was6.10ms and p95 was6.20–6.30ms. These are display-limited raster results, not end-to-end application capacity.

Raw reports and screenshots are in `olcum-out/points/`, including `results.json` and `high-performance.png`. They record the requested preference separately from actual hardware. Intel was unavailable in these runs: requesting low-power still returned NVIDIA. No Intel figures or free/paid thresholds are inferred from the RTX result. Repeat on an independently verified Intel adapter before making that product decision.
