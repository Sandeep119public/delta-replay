# Delta Replay Architecture Guide

This document is the fast orientation layer for human and AI-assisted changes. The machine-enforced dependency, ownership, verification, and changed-file impact policy lives in `scripts/architecture-policy.mjs`.

## Ownership map

| Area | Owns | Prefer changing here first |
| --- | --- | --- |
| `src/app/` | application composition, runtime wiring, lifecycle, intent bridges | cross-feature behavior |
| `src/ui/` | DOM rendering, controls, interaction, accessibility | UI and interaction behavior |
| `src/data/` | candle providers, stores, caches, historical data | market-data behavior |
| `src/indicators/` | indicator calculations and indicator data | technical indicators |
| `src/replay/` | replay state and playback behavior | replay mechanics |
| `src/trading/` | trading domain and execution behavior | orders, positions, risk, execution |
| `src/strategy/` | strategy and signal behavior | strategy logic |
| `src/state/` | application state | state shape and state transitions |
| `src/chart/` | chart integration and chart/replay translation | chart behavior |
| `src/pages/` | page-level composition | route/page wiring |
| `src/router/` | route selection and navigation wiring | routing |
| `src/ports/` | narrow cross-layer contracts | integration interfaces |
| `src/utils/` | shared low-level utilities | generic helpers |
| `backend/` | HTTP API, persistence, backend tests | server behavior |
| `tests/architecture/` | architectural and UI contract tests | boundary changes |

## Composition rules

`src/app/Application.js` is a composition root. Keep feature logic out of it. Small application helpers may own one wiring concern, but should not become alternate feature layers.

Prefer this flow:

`UI intent -> application action/port -> domain or adapter -> state/event -> UI`

Avoid making UI components reach directly into backend services or low-level engines when an existing port/adapter exists.

## DOM contracts

DOM IDs and ARIA relationships are public contracts between markup and controllers.

When changing a required ID, role, tab relationship, hidden state, or compatibility control:

1. Change the owning markup.
2. Change the controller that consumes it.
3. Update the relevant UI contract test in the same change.

## Lifecycle rules

Every listener, subscription, timer, observer, chart handle, or cache handle created by application code should have an obvious cleanup owner.

Prefer `destroy()` or an unsubscribe function and register it with the application lifecycle. Cleanup should be idempotent because multiple lifecycle signals can converge on the same teardown path.

## AI context and changed-file routing

Use the same machine-backed architecture policy that the verifier uses:

```bash
npm run vibe:context
npm run vibe:context:json
npm run vibe:changed
npm run vibe:changed:json
```

The JSON variants use schema version `1` and expose ownership, dependency rules, verification commands, and changed-file impact routing. Treat this output as an agent-facing API. Do not copy ownership, dependency, or impact tables into new scripts; update `scripts/architecture-policy.mjs` instead.

## Safe vibe-coding loop

Use the smallest useful verification command while iterating, then run the full gate before pushing:

```bash
npm run vibe:fast
npm run vibe:check
```

Useful project commands:

```bash
npm run dev
npm run dev:host
npm run vibe:where
npm run vibe:context
npm run test:ui-contracts
npm test
npm run build
```

## Change-size rule

A small behavior change should normally have a small diff. If an experiment requires touching unrelated modules, look for a missing boundary before continuing.

## AI-assisted development rules

- Read the owning module before editing a call site.
- Preserve injected dependencies and ports.
- Do not duplicate initialization or DOM rendering.
- Do not silently swallow new errors unless the surrounding contract explicitly requires it.
- Add a regression test when fixing a previously observed bug.
- Keep commits focused enough to revert independently.
