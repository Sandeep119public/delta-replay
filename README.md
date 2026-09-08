# Delta Replay

Delta Replay is a browser trading replay application backed by a FastAPI trading engine.

## Durable session persistence

The backend persists replay and paper-trading state in PostgreSQL when `DATABASE_URL` is configured. Without it, local development and tests use the in-memory repository.

Required environment variables:

```text
DATABASE_URL=postgresql://user:password@host:5432/delta_replay
CORS_ORIGINS=https://your-frontend.example.com
SESSION_RETENTION_HOURS=168
```

The persistence schema is defined in `backend/migrations/001_create_replay_sessions.sql`. Apply it with:

```bash
DATABASE_URL='postgresql://user:password@host:5432/delta_replay' python backend/scripts/migrate.py
```

The application also performs a safe `CREATE TABLE IF NOT EXISTS` bootstrap when the PostgreSQL repository is initialized. The checked-in migration remains the canonical deployment artifact.

Each browser session is keyed by the `X-Session-ID` UUID header. Mutable session state includes replay position and status plus account, positions, orders, trades, risk settings, fees, margin configuration, engine index, and the next order sequence. Replay candle batches are stored separately in `replay_datasets` using a content-addressed ID, so identical datasets are stored once and replay steps do not rewrite the immutable candle payload.

Replay advancement and trading execution are committed atomically, with per-session in-process serialization and PostgreSQL row locking for cross-process serialization. Recovery tests cover manager/cache loss, PostgreSQL rehydration, concurrent managers, rollback after simulated operation failure, and migration of legacy inline candle datasets. Persisted state is rejected when its schema version, replay state, trading state, or JSON numeric safety is invalid.

## Session cleanup

Durable sessions are retained according to `SESSION_RETENTION_HOURS`, defaulting to 168 hours (7 days). Cleanup is intentionally run as an operational job rather than during user requests:

```bash
DATABASE_URL='postgresql://user:password@host:5432/delta_replay' SESSION_RETENTION_HOURS=168 python backend/scripts/cleanup_sessions.py
```

The cleanup job uses a PostgreSQL transaction-scoped advisory lock so overlapping cleanup processes do not race. It deletes expired sessions first, then removes replay datasets that are no longer referenced by any session. Recently active sessions and referenced datasets are preserved.

## Development quick start

```bash
npm install
npm run dev
```

Useful commands:

- `npm run check` — run the complete frontend regression gate (architecture, UI contracts, tests, build).
- `npm run vibe` — friendly alias for the full safety gate before pushing exploratory changes.
- `npm run test:watch` — keep Vitest running while iterating.
- `npm run dev:host` — expose Vite on the local network for device testing.

### Vibe-coding workflow

For fast experimentation, keep changes small and loop through:

1. Make one focused change.
2. Run the narrowest relevant test while iterating.
3. Run `npm run check` before pushing.
4. If you change markup IDs or controller contracts, update the UI contract tests in the same change.

The app deliberately keeps composition in `src/app/Application.js`, layout construction in `src/ui/PaperUI.js`, and behavior in focused controllers. Treat DOM IDs as contracts: change the controller and its contract tests together.
