# DAViD mask bytes prefetch at the photo preview (audit item 13)

The 180,404,556-byte DAViD int8 mask model used to start downloading only after the subject mask and detail steps (about 2–5 s of work). The mask stage itself is ~25–30 s of GPU work during which the network sits idle, so the bytes now start right after the first preview.

What runs early: only `ilerlemeliGetir` (fetch + Cache Storage), low priority, one shared promise. ORT session creation and inference keep their place in the GPU queue; the final output is unchanged.

Not started when: the plan will not use the browser model (`?maske=isnet`, sidecar lists `david-mask`, no WebGPU, earlier DAViD failure), `navigator.connection.saveData`, or `effectiveType` `slow-2g`/`2g`/`3g` (the final path still downloads on use, as before).

## Known cost: rejected mask

At preview time the subject mask is not known yet; the code assumes it will come. If the mask is then rejected (empty or full-frame mask, e.g. synthetic/abstract images, or a segmentation failure) DAViD never runs and up to **180 MB is downloaded for nothing**. The bytes stay in Cache Storage (https deployments), so a later photo does not download them again.

## Measurement

`node scripts/bench-photo-david.mjs` - assets/thumbnail.jpg, fresh Chrome profile, CDP 100 Mbit/s, sidecar blocked, adapter nvidia/blackwell, before/after alternated (2 rounds each). Times from the file `change` event.

| | cold preview | cold final | warm preview | warm final | DAViD download start (cold) |
|---|---:|---:|---:|---:|---:|
| before | 36.1 / 41.7 s | 106.9 / 115.2 s | 8.3 / 7.9 s | 64.6 / 64.8 s | 64.5 / 70.0 s |
| after | 31.1 / 36.7 s | 98.7 / 100.7 s | 8.1 / 9.6 s | 61.8 / 57.9 s | 44.6 / 50.6 s |

On localhost the mask URL is absolute http, so it is never stored in Cache Storage and the warm pass downloads it again; on https deployments a warm visit reads the cache and the prefetch has nothing to overlap. The download starts ~13 s after the preview (not immediately) and takes longer while the mask stage runs; not investigated. Single machine, two rounds: indicative, not a stable median.
