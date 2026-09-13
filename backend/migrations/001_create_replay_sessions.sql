CREATE TABLE IF NOT EXISTS replay_datasets (
    dataset_id TEXT PRIMARY KEY,
    candles JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS replay_sessions (
    session_id UUID PRIMARY KEY,
    state JSONB NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS replay_events (
    session_id UUID NOT NULL REFERENCES replay_sessions(session_id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL,
    replay_index INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS replay_sessions_updated_at_idx
    ON replay_sessions (updated_at);

CREATE INDEX IF NOT EXISTS replay_events_session_index_idx
    ON replay_events (session_id, replay_index, sequence);
