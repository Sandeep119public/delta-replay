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

- `npm run check` — run the complete frontend regression gate.
- `npm run vibe` — friendly alias for the full safety gate before pushing exploratory changes.
- `npm run test:watch` — keep Vitest running while iterating.
- `npm run dev:host` — expose Vite on the local network for device testing.

### Vibe-coding workflow

For fast experimentation, keep changes small and use the repository's machine-backed context and impact routing:

```bash
npm run vibe:context
npm run vibe:changed
npm run vibe:fast
npm run vibe:check
```

Coding agents can consume the JSON forms:

```bash
npm run vibe:context:json
npm run vibe:changed:json
```

The architecture policy used by the verifier and context tools lives in `scripts/architecture-policy.mjs`. Treat it as the machine source of truth for ownership and dependency rules.

### Architecture map

When exploring the codebase, start with `ARCHITECTURE.md` and the current context command.

- `src/app/Application.js` — composition root: wires modules together, not business logic.
- `src/app/createCoreServices.js` — backend clients and stateful core services.
- `src/app/bindReplayLifecycle.js` — replay event subscriptions and replay-driven UI updates.
- `src/app/bindApplicationLifecycle.js` — teardown ownership and cleanup.
- `src/app/ReplayCapabilities.js` — narrow replay capability contract used by composition and callers.
- `src/ui/PaperUI.js` — UI composition and DOM-facing adapters.

A useful exploration rule: **trace one user action end-to-end before changing code**. For example, follow PLAY from markup → UI control → replay port → command controller → engine. This keeps fast experiments from becoming dependency archaeology.

### Fast iteration commands

- `npm run vibe:fast` — quick confidence loop for UI contracts and unit tests.
- `npm run vibe:check` — full regression gate before a push.
- `npm run vibe:context` — compact ownership and architecture context.
- `npm run vibe:changed` — changed-file impact routing.

Recommended rhythm: **edit → vibe:fast → inspect → repeat → vibe:check before push**.
