# Delta Replay

Delta Replay is a browser trading replay application backed by a FastAPI trading engine.

## Simulation model

`PaperTradingEngine` is the single canonical paper-trading and execution engine. Replay and backtest paths share the same OHLC fill rules and ambiguity policy through `backend/app/domain/execution.py`.

Replay sessions persist the immutable candle dataset separately from mutable session state. User trading commands and replay market-step symbols are stored as deterministic history, allowing arbitrary seek and reconstruction instead of forbidding seek after trading activity.

The account ledger tracks wallet balance, realized and unrealized P&L, fees, margin, and funding with state invariants. Funding is available through the trading API and participates in deterministic replay.

## Durable session persistence

The backend persists replay and paper-trading state in PostgreSQL when `DATABASE_URL` is configured. Without it, local development and tests use the in-memory repository.

Required environment variables:

```text
DATABASE_URL=postgresql://user:password@host:5432/delta_replay
CORS_ORIGINS=https://your-frontend.example.com
SESSION_RETENTION_HOURS=168
```

The persistence schema is defined in `backend/migrations/001_create_replay_sessions.sql` and `backend/migrations/002_add_replay_events.sql`. Apply all migrations before starting a PostgreSQL-backed application:

```bash
DATABASE_URL='postgresql://user:password@host:5432/delta_replay' python backend/scripts/migrate.py
```

The runtime does not create or mutate database schema. Missing tables are reported as a startup configuration error so schema changes remain controlled by the migration path.

Each browser session is keyed by the `X-Session-ID` UUID header. Mutable session state includes replay position and status plus account, positions, orders, trades, risk settings, fees, margin configuration, funding, engine index, next order sequence, and deterministic command history. Replay candle batches are stored separately in `replay_datasets` using a content-addressed ID; replay history is stored as ordered PostgreSQL event rows for durable sessions.

Replay advancement and trading execution are committed atomically, with per-session serialization and PostgreSQL row locking for cross-process serialization. Dataset garbage collection is intentionally outside the request path, using the dedicated cleanup job and maintenance lock. Persisted state is rejected when its schema version, replay state, trading state, command history, or JSON numeric safety is invalid.

## Session cleanup

Durable sessions are retained according to `SESSION_RETENTION_HOURS`, defaulting to 168 hours (7 days). Cleanup is intentionally run as an operational job rather than during user requests:

```bash
DATABASE_URL='postgresql://user:password@host:5432/delta_replay' SESSION_RETENTION_HOURS=168 python backend/scripts/cleanup_sessions.py
```

The cleanup job uses a PostgreSQL transaction-scoped advisory lock so overlapping cleanup processes do not race. It deletes expired sessions first, then removes replay datasets that are no longer referenced by any session. Recently active sessions and referenced datasets are preserved.

## Scale behavior

The server accepts at most 100,000 candles per dataset and CSV upload is bounded by 10 MiB. Replay UI state exposes a sliding 2,000-candle window while retaining the full immutable dataset for persistence and reconstruction.

## Development quick start

```bash
npm install
npm run dev
```

Useful commands:

- `npm run check` — run the root application architecture, UI-contract, test, and build gate.
- `npm run test:watch` — keep Vitest running while iterating.
- `npm run dev:host` — expose Vite on the local network for device testing.

### Architecture map

When exploring the codebase, start with `ARCHITECTURE.md` and the current context command.

- `src/app/` — application composition, remote replay/trading adapters, and lifecycle wiring.
- `src/ui/` — DOM rendering and interaction.
- `src/data/` — market-data providers and caches.
- `src/indicators/` — indicator calculations.
- `src/state/` — application state.
- `src/core/` — framework-neutral core primitives.
- `src/chart/` — chart integration and replay/chart translation.
- `src/pages/` — page composition.
- `src/router/` — route selection and navigation.
- `src/ports/` — narrow cross-layer contracts.
- `src/utils/` — shared low-level utilities.
- `src/personality/` — personality and assistant-facing behavior.
- `backend/app/services/paper_engine.py` — canonical backend execution/accounting engine.
- `backend/app/domain/execution.py` — shared fill and risk-exit semantics.
- `backend/app/services/replay_timeline.py` — deterministic replay reconstruction.

The frontend architecture policy describes these actual source boundaries. It does not declare replay, trading, or strategy directories that are not present in the current tree.

A useful exploration rule: trace one user action end-to-end before changing code. For example, follow PLAY from UI control → replay API → engine → persisted session → UI state.

### Fast iteration commands

```bash
npm run vibe:context
npm run vibe:changed
npm run vibe:fast
npm run vibe:check
```

Recommended rhythm: edit → vibe:fast → inspect → repeat → vibe:check before push.
