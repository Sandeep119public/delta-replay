# Agent Navigation Map

## Where to start

| Change | Start |
|---|---|
| Application wiring | `src/app/Application.js` |
| Service construction | `src/app/createCoreServices.js` |
| Replay lifecycle | `src/app/bindReplayLifecycle.js` |
| Trading behavior | `src/trading/` |
| Replay behavior | `src/replay/` |
| UI markup and controls | `src/ui/` |
| Charts | `src/chart/` |
| Data and caching | `src/data/` |
| Backend APIs | `backend/` |

## Flow

`user action → UI → application action/port → domain capability → service/provider`

Trace this path before editing orchestration.

## Hotspots

### Application.js
Composition root. Avoid adding feature logic here when a focused runtime, binding, or adapter can own it.

### UI contracts
DOM IDs are contracts. Intentional changes require updates to `tests/architecture/ui-contracts.test.js`.

### Architecture
Run `npm run test:architecture:graph` after cross-layer changes.
