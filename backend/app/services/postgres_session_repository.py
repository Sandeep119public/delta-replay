import hashlib
import json
import os
from typing import Optional, TypeVar

import psycopg
from psycopg.rows import dict_row

from .session_repository import SessionDocument, SessionMutation, SessionRepository
from .storage_locks import DATASET_GC_LOCK_KEY

T = TypeVar("T")


class PostgresSessionRepository(SessionRepository):
    """PostgreSQL session storage with content-addressed data and event history."""

    durable = True

    def __init__(self, dsn: str | None = None, *, connect_timeout: int = 5) -> None:
        self.dsn = dsn or os.getenv("DATABASE_URL")
        if not self.dsn:
            raise ValueError("DATABASE_URL is required for PostgreSQL session persistence")
        self.connect_timeout = connect_timeout
        self._verify_schema()

    def _connect(self):
        return psycopg.connect(self.dsn, connect_timeout=self.connect_timeout, row_factory=dict_row)

    def _verify_schema(self) -> None:
        required_tables = {"schema_migrations", "replay_datasets", "replay_sessions", "replay_events"}
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT table_name
                   FROM information_schema.tables
                   WHERE table_schema = 'public'
                     AND table_name = ANY(%s)""",
                (list(required_tables),),
            ).fetchall()
            columns = connection.execute(
                """SELECT table_name, column_name
                   FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND table_name = ANY(%s)""",
                (list(required_tables),),
            ).fetchall()
            migration_rows = connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        present = {row["table_name"] for row in rows}
        missing = sorted(required_tables - present)
        if missing:
            raise RuntimeError(
                "PostgreSQL schema is not initialized; apply backend/migrations before starting the application. "
                f"Missing tables: {', '.join(missing)}"
            )
        required_columns = {
            "schema_migrations": {"version", "checksum", "applied_at"},
            "replay_datasets": {"dataset_id", "candles"},
            "replay_sessions": {"session_id", "state", "revision", "updated_at"},
            "replay_events": {"session_id", "sequence", "replay_index", "event_type", "payload"},
        }
        observed = {}
        for row in columns:
            observed.setdefault(row["table_name"], set()).add(row["column_name"])
        missing_columns = {
            table: sorted(fields - observed.get(table, set()))
            for table, fields in required_columns.items()
            if fields - observed.get(table, set())
        }
        if missing_columns:
            details = "; ".join(f"{table}: {', '.join(fields)}" for table, fields in missing_columns.items())
            raise RuntimeError(f"PostgreSQL schema is incomplete: {details}")

        required_migrations = {
            "000_schema_migrations",
            "001_create_replay_sessions",
            "002_add_replay_events",
        }
        applied_versions = {str(row["version"]) for row in migration_rows}
        if not required_migrations.issubset(applied_versions):
            missing_versions = sorted(required_migrations - applied_versions)
            raise RuntimeError(
                "PostgreSQL migrations are incomplete; apply backend/migrations before starting the application. "
                f"Missing versions: {', '.join(missing_versions)}"
            )

    @staticmethod
    def _dataset_id_from_state(state) -> Optional[str]:
        replay = state.get("replay", {}) if isinstance(state, dict) else {}
        dataset_id = replay.get("datasetId") if isinstance(replay, dict) else None
        return str(dataset_id) if dataset_id else None

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
            derived_dataset_id = cls._dataset_id(candles)
            persisted_dataset_id = replay.get("datasetId")
            if persisted_dataset_id is not None and persisted_dataset_id != derived_dataset_id:
                raise ValueError("replay datasetId does not match candle data")
            dataset_id = persisted_dataset_id or derived_dataset_id
            exists = connection.execute(
                "SELECT 1 FROM replay_datasets WHERE dataset_id = %s",
                (dataset_id,),
            ).fetchone()
            if exists is None:
                connection.execute("SELECT pg_advisory_xact_lock(%s)", (DATASET_GC_LOCK_KEY,))
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

    @classmethod
    def _hydrate_document(cls, connection, document: SessionDocument, session_id: str | None = None) -> SessionDocument:
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
            hydrated["history"] = cls._hydrate_history(connection, session_id, hydrated.get("history"))
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

    @staticmethod
    def _gc_dataset(connection, dataset_id: Optional[str]) -> None:
        if not dataset_id:
            return
        connection.execute("SELECT pg_advisory_xact_lock(%s)", (DATASET_GC_LOCK_KEY,))
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
            new_dataset_id = self._dataset_id_from_state(storage_document)
            if old_dataset_id and old_dataset_id != new_dataset_id:
                self._gc_dataset(connection, old_dataset_id)

    def delete(self, session_id: str) -> None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT state FROM replay_sessions WHERE session_id = %s FOR UPDATE",
                (session_id,),
            ).fetchone()
            if row is None:
                return
            dataset_id = self._dataset_id_from_state(row["state"])
            connection.execute("DELETE FROM replay_sessions WHERE session_id = %s", (session_id,))
            self._gc_dataset(connection, dataset_id)

    def save_if_revision(self, session_id: str, document: SessionDocument, expected_revision: int) -> int:
        with self._connect() as connection:
            current = connection.execute(
                "SELECT state FROM replay_sessions WHERE session_id = %s FOR UPDATE",
                (session_id,),
            ).fetchone()
            if current is None:
                raise RuntimeError("session revision conflict")
            current_document = self._hydrate_document(connection, dict(current["state"]), session_id)
            old_dataset_id = self._dataset_id_from_state(current["state"])
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
            new_dataset_id = self._dataset_id_from_state(storage_document)
            if old_dataset_id and old_dataset_id != new_dataset_id:
                self._gc_dataset(connection, old_dataset_id)
            return int(row["revision"])

    def atomic_update(self, session_id: str, mutation: SessionMutation[T]) -> T:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT state FROM replay_sessions WHERE session_id = %s FOR UPDATE",
                (session_id,),
            ).fetchone()
            if row is None:
                raise KeyError(f"session {session_id} not found")
            document = self._hydrate_document(connection, dict(row["state"]), session_id)
            old_history = document.get("history", [])
            old_dataset_id = self._dataset_id_from_state(row["state"])
            updated, result = mutation(document)
            storage_document = self._prepare_storage_document(connection, updated)
            connection.execute(
                "UPDATE replay_sessions SET state = %s::jsonb, revision = revision + 1, updated_at = NOW() WHERE session_id = %s",
                (self._encode(storage_document), session_id),
            )
            self._sync_history(connection, session_id, old_history, updated.get("history", []))
            new_dataset_id = self._dataset_id_from_state(storage_document)
            if old_dataset_id and old_dataset_id != new_dataset_id:
                self._gc_dataset(connection, old_dataset_id)
            return result
