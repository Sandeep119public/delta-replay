import hashlib
import json

import pytest

from app.services.github_dataset_repository import GitHubDatasetRepository


def candles():
    return [
        {"time": 100, "open": 10, "high": 11, "low": 9, "close": 10.5, "volume": 2},
        {"time": 160, "open": 10.5, "high": 12, "low": 10, "close": 11, "volume": 3},
    ]


def test_csv_is_canonical_and_round_trips():
    repo = GitHubDatasetRepository()
    raw = repo._csv_bytes(repo._normalize_candles(candles()))
    assert raw.startswith(b"time,open,high,low,close,volume\n")
    assert repo._parse_csv(raw) == repo._normalize_candles(candles())
    assert hashlib.sha256(raw).hexdigest()


def test_manifest_defaults_to_empty(monkeypatch):
    repo = GitHubDatasetRepository()
    monkeypatch.setattr(repo, "_get_raw", lambda path, token=None: None)
    assert repo._read_manifest() == {"schemaVersion": 1, "datasets": []}


def test_publish_rejects_missing_token():
    repo = GitHubDatasetRepository()
    with pytest.raises(PermissionError):
        repo.publish(symbol="BTCUSDT", timeframe="1m", from_ms=100, to_ms=160, candles=candles(), token="")


def test_manifest_schema_is_stable():
    manifest = {"schemaVersion": 1, "datasets": []}
    assert json.loads(json.dumps(manifest))["schemaVersion"] == 1
