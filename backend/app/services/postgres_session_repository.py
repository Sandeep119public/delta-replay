import hashlib
import json
import os
from typing import Optional, TypeVar

import psycopg
from psycopg.rows import dict_row

from .session_repository import SessionDocument, SessionMutation, SessionRepository

T = TypeVar("T")
DATASET_GC_LOCK_KEY = 8443217


class PostgresSessionRepository(SessionRepository):
    """PostgreSQL session storage with content-addressed data and event history."""

    durable = True

    def __init__(self, dsn: str | None = None, *, connect_timeout: int = 5) -> None:
        self.dsn = dsn or os.getenv("DATABASE_URL")
        if not self.dsn:
            raise ValueError("DATABASE_URL is required for PostgreSQL session persistence")
        self.connect_timeout = connect_timeout
        self._ensure_schema()

    def _connect(self):
        return psycopg.connect(self.dsn, connect_timeout=self.connect_timeout, row_factory=dict_row)

    @staticmethod
    def _lock_dataset_gc(connection) -> None:
        connection.execute("SELECT pg_advisory_xact_lock(%s)", (DATASET_GC_LOCK_KEY,))

    @staticmethod
    def _dataset_id_from_state(state) -> Optional[str]:
        replay = state.get("replay", {}) if isinstance(state, dict) else {}
        dataset_id = replay.get("datasetId") if isinstance(replay, dict) else None
        return str(dataset_id) if dataset_id else None

    @staticmethod
    def _gc_dataset(connection, dataset_id: Optional[str]) -> None:
        if not dataset_id:
            return
        connection.execute(
            """DELETE FROM replay_datasets d
               WHERE d.dataset_id = %s
                 AND NOT EXISTS (
                   SELECT 1
                   FROM replay_sessions s
                   WHERE s.state->'replay'->>'datasetId' = d.dataset_id
                 )""",
            (dataset_id,),
        )

    def _ensure_schema(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS replay_datasets (
                    dataset_id TEXT PRIMARY KEY,
                    candles JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )"""
            )
            connection.execute(
                """CREATE TABLE IF NOT EXISTS replay_sessions (
                    session_id UUID PRIMARY KEY,
                    state JSONB NOT NULL,
                    revision BIGINT NOT NULL DEFAULT 1,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )"""
            )
            connection.execute(
                """CREATE TABLE IF NOT EXISTS replay_events (
                    session_id UUID NOT NULL REFERENCES replay_sessions(session_id) ON DELETE CASCADE,
                    sequence BIGINT NOT NULL,
                    replay_index INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (session_id, sequence)
                )"""
            )
            connection.execute(
                """CREATE INDEX IF NOT EXISTS replay_sessions_updated_at_idx
                   ON replay_sessions (updated_at)"""
            )
            connection.execute(
                """CREATE INDEX IF NOT EXISTS replay_events_session_index_idx
                   ON replay_events (session_id, replay_index, sequence)"""
            )

    @staticmethod
    def _encode(document: SessionDocument) -> str:
        clean_document = dict(document)
        clean_document.pop("revision", None)
        clean_document.pop("history", None)
        try:
            return json.dumps(clean_document, separators=(",", ":"), allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"session document is not JSON-safe: {exc}") from exc

    @staticmethod
    def _dataset_id(candles) -> str:
        try:
            encoded = json.dumps(candles, separators=(",", ":"), sort_keys=True, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"replay dataset is not JSON-safe: {exc}") from exc
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    @classmethod
    def _prepare_storage_document(cls, connection, document: SessionDocument) -> SessionDocument:
        clean = dict(document)
        replay = dict(clean.get("replay", {}))
        candles = replay.pop("candles", None)
        if candles is not None:
            dataset_id = cls._dataset_id(candles)
            connection.execute(
                """INSERT INTO replay_datasets (dataset_id, candles)
                   VALUES (%s, %s::jsonb)
                   ON CONFLICT (dataset_id) DO NOTHING""",
                (dataset_id, json.dumps(candles, separators=(",", ":"), allow_nan=False)),
            )
            replay["datasetId"] = dataset_id
        clean["replay"] = replay
        clean.pop("history", None)
        return clean

    @staticmethod
    def _hydrate_history(connection, session_id: str, inline_history=None):
        rows = connection.execute(
            """SELECT sequence, replay_index, event_type, payload
               FROM replay_events
               WHERE session_id = %s
               ORDER BY sequence""",
            (session_id,),
        ).fetchall()
        if rows:
            return [
                {
                    "type": row["event_type"],
                    "replayIndex": int(row["replay_index"]),
                    "payload": row["payload"],
                }
                for row in rows
            ]
        return inline_history if inline_history is not None else []

    @staticmethod
    def _hydrate_document(connection, document: SessionDocument, session_id: str | None = None) -> SessionDocument:
        hydrated = dict(document)
        replay = dict(hydrated.get("replay", {}))
        if "candles" not in replay and replay.get("datasetId"):
            row = connection.execute(
                "SELECT candles FROM replay_datasets WHERE dataset_id = %s",
                (replay["datasetId"],),
            ).fetchone()
            if row is None:
                raise RuntimeError(f"replay dataset {replay['datasetId']} not found")
            replay["candles"] = row["candles"]
        hydrated["replay"] = replay
        if session_id is not None:
            hydrated["history"] = PostgresSessionRepository._hydrate_history(
                connection, session_id, hydrated.get("history")
            )
        return hydrated

    @staticmethod
    def _sync_history(connection, session_id: str, old_history: list, new_history: list) -> None:
        prefix = 0
        limit = min(len(old_history), len(new_history))
        while prefix < limit and old_history[prefix] == new_history[prefix]:
            prefix += 1

        connection.execute(
            "DELETE FROM replay_events WHERE session_id = %s AND sequence > %s",
            (session_id, prefix),
        )
        for sequence, event in enumerate(new_history[prefix:], start=prefix + 1):
            connection.execute(
                """INSERT INTO replay_events
                   (session_id, sequence, replay_index, event_type, payload)
                   VALUES (%s, %s, %s, %s, %s::jsonb)""",
                (
                    session_id,
                    sequence,
                    int(event["replayIndex"]),
                    event["type"],
                    json.dumps(event["payload"], separators=(",", ":"), allow_nan=False),
                ),
            )

    def get(self, session_id: str) -> Optional[SessionDocument]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT state, revision FROM replay_sessions WHERE session_id = %s",
                (session_id,),
            ).fetchone()
            if row is None:
                return None
            document = self._hydrate_document(connection, dict(row["state"]), session_id)
        document["revision"] = row["revision"]
        return document

    def save(self, session_id: str, document: SessionDocument) -> None:
        with self._connect() as connection:
            self._lock_dataset_gc(connection)
            current = connection.execute(
                "SELECT state FROM replay_sessions WHERE session_id = %s FOR UPDATE",
                (session_id,),
            ).fetchone()
            old_dataset_id = self._dataset_id_from_state(current["state"]) if current else None
            current_document = (
                self._hydrate_document(connection, dict(current["state"]), session_id)
                if current else {"history": []}
            )
            storage_document = self._prepare_storage_document(connection, document)
            encoded = self._encode(storage_document)
            connection.execute(
                """INSERT INTO replay_sessions (session_id, state, revision)
                   VALUES (%s, %s::jsonb, 1)
                   ON CONFLICT (session_id) DO UPDATE
                   SET state = EXCLUDED.state,
                       revision = replay_sessions.revision + 1,
                       updated_at = NOW()""",
                (session_id, encoded),
            )
            self._sync_history(connection, session_id, current_document.get("history", []), document.get("history", []))
            self._gc_dataset(connection, old_dataset_id)

    def delete(self, session_id: str) -> None:
        with self._connect() as connection:
            self._lock_dataset_gc(connection)
            current = connection.execute(
                "SELECT state FROM replay_sessions WHERE session_id = %s",
                (session_id,),
            ).fetchone()
            old_dataset_id = self._dataset_id_from_state(current["state"]) if current else None
            connection.execute("DELETE FROM replay_sessions WHERE session_id = %s", (session_id,))
            self._gc_dataset(connection, old_dataset_id)

    def save_if_revision(self, session_id: str, document: SessionDocument, expected_revision: int) -> int:
        with self._connect() as connection:
            self._lock_dataset_gc(connection)
            current = connection.execute(
                "SELECT state FROM replay_sessions WHERE session_id = %s FOR UPDATE",
                (session_id,),
            ).fetchone()
            if current is None:
                raise RuntimeError("session revision conflict")
            old_dataset_id = self._dataset_id_from_state(current["state"])
            current_document = self._hydrate_document(connection, dict(current["state"]), session_id)
            storage_document = self._prepare_storage_document(connection, document)
            encoded = self._encode(storage_document)
            row = connection.execute(
                """UPDATE replay_sessions
                   SET state = %s::jsonb, revision = revision + 1, updated_at = NOW()
                   WHERE session_id = %s AND revision = %s
                   RETURNING revision""",
                (encoded, session_id, expected_revision),
            ).fetchone()
            if row is None:
                raise RuntimeError("session revision conflict")
            self._sync_history(connection, session_id, current_document.get("history", []), document.get("history", []))
            self._gc_dataset(connection, old_dataset_id)
            return int(row["revision"])

    def atomic_update(self, session_id: str, mutation: SessionMutation[T]) -> T:
        with self._connect() as connection:
            self._lock_dataset_gc(connection)
            row = connection.execute(
                "SELECT state FROM replay_sessions WHERE session_id = %s FOR UPDATE",
                (session_id,),
            ).fetchone()
            if row is None:
                raise KeyError(f"session {session_id} not found")
            old_dataset_id = self._dataset_id_from_state(row["state"])
            document = self._hydrate_document(connection, dict(row["state"]), session_id)
            old_history = document.get("history", [])
            updated, result = mutation(document)
            storage_document = self._prepare_storage_document(connection, updated)
            connection.execute(
                "UPDATE replay_sessions SET state = %s::jsonb, revision = revision + 1, updated_at = NOW() WHERE session_id = %s",
                (self._encode(storage_document), session_id),
            )
            self._sync_history(connection, session_id, old_history, updated.get("history", []))
            self._gc_dataset(connection, old_dataset_id)
            return result
