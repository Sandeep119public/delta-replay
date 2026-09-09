# AI Coding Guide

## Before editing

1. Identify the owning area using `ARCHITECTURE.md`.
2. Read the target module and its direct caller before changing a contract.
3. Prefer the smallest patch that preserves existing ports and lifecycle ownership.
4. Run `npm run vibe:context` to load the current machine-backed ownership, architecture, and impact rules.

## Change rules

- Keep `src/app/Application.js` as composition-only code. Extract cohesive wiring helpers when a concern becomes difficult to review, but do not move feature logic into the app layer.
- Keep UI behavior inside `src/ui/` controllers/views.
- Keep chart-specific behavior inside `src/chart/`.
- Keep market-data behavior inside `src/data/`.
- Treat DOM IDs, ARIA attributes, and tab relationships as contracts.
- Reuse existing adapters and ports instead of introducing direct cross-layer calls.
- Every listener, timer, subscription, observer, or resource needs an explicit cleanup path.
- Make teardown idempotent when multiple lifecycle signals can reach the same resource.
- Avoid broad formatting changes in focused bug fixes.

## Test runner convention

- `tests/architecture/boundaries.test.js` and `tests/architecture/ui-contracts.test.js` use Node's built-in test runner.
- Product and regression tests use Vitest unless the existing suite explicitly uses another runner.
- Do not mix `node:test` and Vitest APIs in the same test file.

## Focused commands

- `npm run vibe:context` for the current AI-facing ownership and architecture context.
- `npm run vibe:context:json` for versioned machine-readable context suitable for coding agents and tools.
- `npm run vibe:ui` for markup and DOM contracts.
- `npm run vibe:architecture` for dependency-boundary changes.
- `npm run vibe:verify` for a compact architecture + frontend gate.
- `npm run vibe:baseline` for the fast architecture/UI baseline.
- `npm run vibe:changed` to see recommended checks for the current diff.
- `npm run vibe:changed:json` for versioned machine-readable changed-file routing.

The architecture policy used by `check-architecture.mjs`, `vibe-context.mjs`, and `vibe-changed.mjs` lives in `scripts/architecture-policy.mjs`; update that source rather than duplicating ownership, dependency, or impact rules elsewhere.

## Verification

During iteration:

```bash
npm run vibe:fast
```

Before pushing:

```bash
npm run vibe:check
```

For a frontend-only contract change, also run:

```bash
npm run test:ui-contracts
```

## Commit hygiene

Use focused commits with a single intent. A good commit should answer one question: what behavior or developer workflow became safer?

## Regression discipline

When fixing a bug, add or strengthen the nearest regression test when practical. Do not remove a test merely because the implementation changed.
