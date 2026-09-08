import json
import os
from typing import Optional

import psycopg
from psycopg.rows import dict_row

from .session_repository import SessionDocument, SessionRepository


class PostgresSessionRepository(SessionRepository):
    """PostgreSQL implementation of the session persistence boundary."""

    def __init__(self, dsn: str | None = None, *, connect_timeout: int = 5) -> None:
        self.dsn = dsn or os.getenv("DATABASE_URL")
        if not self.dsn:
            raise ValueError("DATABASE_URL is required for PostgreSQL session persistence")
        self.connect_timeout = connect_timeout
        self._ensure_schema()

    def _connect(self):
        return psycopg.connect(
            self.dsn,
            connect_timeout=self.connect_timeout,
            row_factory=dict_row,
        )

    def _ensure_schema(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS replay_sessions (
                    session_id UUID PRIMARY KEY,
                    state JSONB NOT NULL,
                    revision BIGINT NOT NULL DEFAULT 1,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS replay_sessions_updated_at_idx
                    ON replay_sessions (updated_at)
                """
            )

    def get(self, session_id: str) -> Optional[SessionDocument]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT state, revision FROM replay_sessions WHERE session_id = %s",
                (session_id,),
            ).fetchone()
        if row is None:
            return None
        document = dict(row["state"])
        document["revision"] = row["revision"]
        return document

    def save(self, session_id: str, document: SessionDocument) -> None:
        clean_document = dict(document)
        clean_document.pop("revision", None)
        encoded = json.dumps(clean_document, separators=(",", ":"))
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO replay_sessions (session_id, state, revision)
                VALUES (%s, %s::jsonb, 1)
                ON CONFLICT (session_id) DO UPDATE
                SET state = EXCLUDED.state,
                    revision = replay_sessions.revision + 1,
                    updated_at = NOW()
                """,
                (session_id, encoded),
            )

    def delete(self, session_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM replay_sessions WHERE session_id = %s",
                (session_id,),
            )

    def save_if_revision(
        self,
        session_id: str,
        document: SessionDocument,
        expected_revision: int,
    ) -> int:
        clean_document = dict(document)
        clean_document.pop("revision", None)
        encoded = json.dumps(clean_document, separators=(",", ":"))
        with self._connect() as connection:
            row = connection.execute(
                """
                UPDATE replay_sessions
                SET state = %s::jsonb,
                    revision = revision + 1,
                    updated_at = NOW()
                WHERE session_id = %s AND revision = %s
                RETURNING revision
                """,
                (encoded, session_id, expected_revision),
            ).fetchone()
            if row is None:
                raise RuntimeError("session revision conflict")
            return int(row["revision"])
