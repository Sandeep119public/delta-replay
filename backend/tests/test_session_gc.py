import json
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import psycopg
import pytest

from app.services.session_gc import SessionGarbageCollector

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is not configured",
)


def test_gc_requires_positive_retention():
    with pytest.raises(ValueError, match="retention_hours"):
        SessionGarbageCollector(os.environ["DATABASE_URL"], retention_hours=0)


def test_gc_keeps_fresh_session_and_referenced_dataset():
    collector = SessionGarbageCollector(os.environ["DATABASE_URL"], retention_hours=1)
    session_id = str(uuid4())
    dataset_id = "phase7-live-dataset-" + uuid4().hex
    state = {"version": 1, "replay": {"datasetId": dataset_id}, "trading": {}}
    try:
        with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
            connection.execute(
                "INSERT INTO replay_datasets (dataset_id, candles) VALUES (%s, %s::jsonb)",
                (dataset_id, "[]"),
            )
            connection.execute(
                "INSERT INTO replay_sessions (session_id, state, revision, updated_at) VALUES (%s, %s::jsonb, 1, NOW())",
                (session_id, json.dumps(state)),
            )

        result = collector.collect()
        assert result == {"sessions": 0, "datasets": 0}
        with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
            assert connection.execute("SELECT 1 FROM replay_sessions WHERE session_id = %s", (session_id,)).fetchone() is not None
            assert connection.execute("SELECT 1 FROM replay_datasets WHERE dataset_id = %s", (dataset_id,)).fetchone() is not None
    finally:
        with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
            connection.execute("DELETE FROM replay_sessions WHERE session_id = %s", (session_id,))
            connection.execute("DELETE FROM replay_datasets WHERE dataset_id = %s", (dataset_id,))


def test_gc_deletes_expired_session_and_orphan_dataset():
    collector = SessionGarbageCollector(os.environ["DATABASE_URL"], retention_hours=1)
    session_id = str(uuid4())
    dataset_id = "phase7-test-dataset-" + uuid4().hex
    state = {"version": 1, "replay": {"datasetId": dataset_id}, "trading": {}}
    try:
        with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
            connection.execute(
                "INSERT INTO replay_datasets (dataset_id, candles) VALUES (%s, %s::jsonb)",
                (dataset_id, "[]"),
            )
            connection.execute(
                "INSERT INTO replay_sessions (session_id, state, revision, updated_at) VALUES (%s, %s::jsonb, 1, %s)",
                (session_id, json.dumps(state), datetime.now(timezone.utc) - timedelta(hours=2)),
            )
        result = collector.collect()
        assert result["sessions"] >= 1
        assert result["datasets"] >= 1
        with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
            assert connection.execute("SELECT 1 FROM replay_sessions WHERE session_id = %s", (session_id,)).fetchone() is None
            assert connection.execute("SELECT 1 FROM replay_datasets WHERE dataset_id = %s", (dataset_id,)).fetchone() is None
    finally:
        with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
            connection.execute("DELETE FROM replay_sessions WHERE session_id = %s", (session_id,))
            connection.execute("DELETE FROM replay_datasets WHERE dataset_id = %s", (dataset_id,))
