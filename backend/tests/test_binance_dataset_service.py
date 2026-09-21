from pathlib import Path

from app.services.binance_dataset_service import BinanceDatasetService


class FakeResponse:
    def __init__(self, rows):
        self._rows = rows

    def raise_for_status(self):
        return None

    def json(self):
        return self._rows


class FakeHTTPClient:
    def __init__(self):
        self.calls = []

    def get(self, url, params, headers):
        self.calls.append((url, params, headers))
        return FakeResponse([
            [1000_000, "10", "12", "9", "11", "100"],
            [1060_000, "11", "13", "10", "12", "120"],
        ])


def test_download_persists_immutable_parquet_and_manifest(tmp_path: Path):
    http = FakeHTTPClient()
    service = BinanceDatasetService(root=tmp_path, http_client=http)

    manifest = service.download(
        symbol="SOLUSDT",
        timeframe="1m",
        start=1000,
        end=1060,
    )

    parquet_path = tmp_path / manifest["path"]
    manifest_path = parquet_path.with_suffix(".json")

    assert manifest["format"] == "parquet"
    assert manifest["count"] == 2
    assert parquet_path.exists()
    assert manifest_path.exists()
    assert len(http.calls) == 1

    candles = service.read_candles(
        symbol="SOLUSDT",
        timeframe="1m",
        start=1000,
        end=1060,
    )
    assert candles == [
        {"time": 1000, "open": 10.0, "high": 12.0, "low": 9.0, "close": 11.0, "volume": 100.0},
        {"time": 1060, "open": 11.0, "high": 13.0, "low": 10.0, "close": 12.0, "volume": 120.0},
    ]


def test_replay_read_does_not_call_binance(tmp_path: Path):
    class ExplodingClient:
        def get(self, *args, **kwargs):
            raise AssertionError("Replay must never call Binance")

    writer = BinanceDatasetService(root=tmp_path, http_client=FakeHTTPClient())
    writer.download(
        symbol="BTCUSDT",
        timeframe="1m",
        start=1000,
        end=1060,
    )

    reader = BinanceDatasetService(root=tmp_path, http_client=ExplodingClient())
    candles = reader.read_candles(
        symbol="BTCUSDT",
        timeframe="1m",
        start=1000,
        end=1060,
    )

    assert len(candles) == 2
