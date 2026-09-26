# Task 2 — Gaussian BASE access and cleanup

Status: DONE_WITH_CONCERNS (trained-video end-to-end evidence unavailable; actual WebGPU synthetic scene passed).

## Implementation

- `Egitim.gaussianlar(): Promise<GaussianState>` returns a detached copy of the BASE trained state, regardless of current effects. `{data, n, stride: 16}` documents positions at 0–2, log scales at 3–5, quaternion wxyz at 6–9, DC at 10–12, opacity logit at 13, padding at 14–15. Mutating the returned array cannot mutate the session. It is documented as read-only selection input.
- `Egitim.temizle(indices): Promise<GaussianUndo>` validates the complete selection, deduplicates indices, changes only BASE opacity logits to `-20`, and reapplies the active deform and fade in exactly one GPU write. `-20` lies below the vendored export threshold `Math.log(1 / 254)` (alpha 1/255).
- Undo stores original selected opacity values and renders from the restored BASE. `geriAl()` is idempotent and requires reverse edit order, so overlapping deletions cannot revive another outstanding deletion. Invalid indices reject atomically. Synchronous failed writes roll back BASE changes and allow retry.
- `restoreForTraining()` restores the cleaned BASE before continuation and invalidates its snapshot. Old undo tokens expire on continuation/disposal. The API explicitly documents that trainer refinement can relocate dead splats: clients must fetch new indices after `devamEt`.
- The existing deform/fade math was moved into a shared rendering closure without changing its arithmetic. Uncropped photo, video/live, neon and vendored sources are untouched. No cleanup UI rewrite or additional UI wiring was needed; the API is available on the existing `Egitim` handle.
- The new verify script was added to the package verify chain. CHANGELOG has a Turkish contract entry.

## TDD evidence

Wrote `scripts/verify-egitim-cleanup.mjs` before production changes. It exercises the real controller, real `Session.exportPlyBlob()` and real `klipKareleri()`; only GPU transport is replaced with an in-memory parameter buffer for the Node test.

RED command:

```powershell
node scripts/verify-egitim-cleanup.mjs
```

Exit 1, expected missing-feature assertion:

```text
AssertionError [ERR_ASSERTION]: BASE Gaussian inspection API must exist
+ 'undefined'
- 'function'
scripts/verify-egitim-cleanup.mjs:23:8
```

GREEN command (after minimal implementation):

```powershell
node scripts/verify-egitim-cleanup.mjs
```

Exit 0:

```text
egitim cleanup verified: BASE copy, single-write composition, real PLY cut, clip/zero restore, exact undo, validation, lifecycle
```

The test covers detached BASE access while effects are active, duplicate index handling, exactly one write with active deform/fade, real PLY live count and reduced byte size, deform/fade zero restore, both `yok` and `yana` clip restore, bit-exact undo including signed zero, repeat undo, negative/out-of-range/fractional/NaN indices, overlapping LIFO edits, failed-write rollback, cleaned continuation input, stale undo rejection, and rejection while training is not ready.

## Verification

- `node scripts/verify-egitim-bend.mjs` — exit 0, `3DGS post-training bend integration: OK`.
- `npm run verify` — exit 0. Entire chain completed, including the new cleanup script, existing bend/fade/dome/noise, clip, photo/crop, video/live, and final `verify-mod-kalite: OK` checks. Existing informational runtime output from model loading and DPR adaptation appeared; no failed gate.
- `npx tsc --noEmit` — exit 0, no output. Repeated after final source formatting.
- `node scripts/verify-egitim-cleanup.mjs` — exit 0 after final source formatting.
- `git diff --check` — no whitespace errors (Git emitted ordinary LF/CRLF conversion warnings).
- `git diff --name-only -- src/vendor/splat.js` — empty.

One tooling detour: `python` was not on PATH, so an initial edit command did not run or change files. The edit was applied with Node instead. No test failure was hidden by that detour.

## Real browser evidence

Fixture: `.superpowers/sdd/2026-09-26-followups/task-2-smoke.html` (local ignored diagnostic, retained).

Opened `http://localhost:5173/.superpowers/sdd/2026-09-26-followups/task-2-smoke.html` in the available in-app browser. Chrome was unavailable, and a visible tab is unsupported from a subagent, so the supported background tab was used. This is a real browser WebGPU check, not a canvas stand-in:

1. Actual `Session.seedFrom(..., {viewOnly: true})` creates a real trainer/GPU buffer with 138 deterministic synthetic Gaussians in two visible clusters.
2. Actual vendored rasterizer draws both clusters. The browser fixture exposes direct delegates to the same production controller methods used by `Egitim`.
3. The visible “Remove right cluster (BASE x > 0.5)” button reads `gaussianlar()`, selects 69 BASE indices in that region, then calls `temizle(indices)`.
4. The right cluster disappears while the left cluster remains visible.
5. The fixture runs real `klipKareleri` sequences with `yok` and `yana`, including their fade/deform restore paths, then exports again. Deleted splats remain absent.
6. The visible Undo button calls the returned `geriAl()`; the original BASE byte comparison is true and export count/size return to their initial values.

| State | PLY splats | Blob bytes |
|---|---:|---:|
| Before | 138 | 9,797 |
| After region cleanup | 69 | 5,104 |
| After clip restore | 69 | 5,104 |
| Undo (`undoBitExact: true`) | 138 | 9,797 |

Screenshots saved under `.superpowers/sdd/2026-09-26-followups/shots/`:

- `task2-cleanup-before.png` — both clusters and initial export metrics.
- `task2-cleanup-after.png` — right cluster removed, after/clip metrics.
- `task2-cleanup-undo.png` — restored clusters and `undoBitExact: true`.

![Cleanup after region selection](shots/task2-cleanup-after.png)

The fixture and screenshots remain local ignored artifacts; they are not application entry points or production UI.

## Concerns / limits

- No source video or completed trained session was available. This proves actual GPU parameter writes, rasterization, controller API, export and clip restore using synthetic seeded Gaussians; it does not claim the full `egitimBaslat` video/SfM/training UI path was exercised.
- Cleanup is intentionally post-training and index-based. Continuing training may reuse dead splats; undo tokens intentionally expire rather than applying old indices to a new trained state.
- Undo is LIFO, documented in the public token contract. Clients should await edits and undo in reverse order.
- The pre-existing modified Task 1 report and all untracked root diagnostics were preserved and excluded from staging. Vendored sources were untouched.

## Changed production/test files

- `src/engine/reconstruction/egitim3dgs.ts`
- `scripts/verify-egitim-cleanup.mjs`
- `package.json`
- `CHANGELOG.md`
- This task report (evidence record).

No push performed.
