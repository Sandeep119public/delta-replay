# AI Coding Guide

## Before editing

1. Identify the owning area using `ARCHITECTURE.md`.
2. Read the target module and its direct caller before changing a contract.
3. Prefer the smallest patch that preserves existing ports and lifecycle ownership.

## Change rules

- Keep `src/app/Application.js` as composition-only code.
- Keep UI behavior inside `src/ui/` controllers/views.
- Keep chart-specific behavior inside `src/chart/`.
- Keep market-data behavior inside `src/data/`.
- Treat DOM IDs, ARIA attributes, and tab relationships as contracts.
- Reuse existing adapters and ports instead of introducing direct cross-layer calls.
- Every listener, timer, subscription, observer, or resource needs an explicit cleanup path.
- Avoid broad formatting changes in focused bug fixes.

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
