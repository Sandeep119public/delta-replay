# Delta Replay Architecture Guide

This document is the fast orientation layer for human and AI-assisted changes.

## Ownership map

| Area | Owns | Prefer changing here first |
| --- | --- | --- |
| `src/app/` | application composition, runtime wiring, lifecycle, intent bridges | cross-feature behavior |
| `src/ui/` | DOM rendering, controls, interaction, accessibility | UI and interaction behavior |
| `src/data/` | candle providers, stores, caches, historical data | market-data behavior |
| `src/chart/` | chart integration and chart/replay translation | chart behavior |
| `src/state/` | application state | state shape and state transitions |
| `backend/` | HTTP API, persistence, backend tests | server behavior |
| `tests/architecture/` | architectural and UI contract tests | boundary changes |

## Composition rules

`src/app/Application.js` is a composition root. Keep feature logic out of it.

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

Prefer `destroy()` or an unsubscribe function and register it with the application lifecycle.

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
