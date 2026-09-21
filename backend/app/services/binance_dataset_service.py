from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

import httpx
import pyarrow as pa
import pyarrow.parquet as pq

from ..models import Candle, MAX_CANDLES

BINANCE_FUTURES_BASE = "https://fapi.binance.com"
BINANCE_KLINE_ENDPOINT = "/fapi/v1/klines"
BINANCE_LIMIT = 1500
DATASET_ROOT = Path(os.getenv("DATASET_DIR", Path(__file__).resolve().parents[2] / "datasets"))
SAFE_NAME = re.compile(r"[^A-Za-z0-9_.-]+")


def _safe(value: str) -> str:
    return SAFE_NAME.sub("_", str(value).strip())


def _manifest_path(dataset_path: Path) -> Path:
    return dataset_path.with_suffix(".json")


class BinanceDatasetService:
    """Download Binance Futures candles once and persist immutable Parquet datasets."""

    def __init__(self, root: Path | str = DATASET_ROOT, http_client: httpx.Client | None = None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._client = http_client
        self._owned_client = http_client is None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()

    def close(self):
        if self._owned_client and self._client is not None:
            self._client.close()
            self._client = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))
        return self._client

    @staticmethod
    def _validate_request(symbol: str, timeframe: str, start: int, end: int) -> None:
        if not symbol or not isinstance(symbol, str):
            raise ValueError("symbol is required")
        if not timeframe or not isinstance(timeframe, str):
            raise ValueError("timeframe is required")
        if not isinstance(start, int) or not isinstance(end, int):
            raise ValueError("start and end must be Unix seconds")
        if start >= end:
            raise ValueError("end must be after start")

    @staticmethod
    def _map_row(row: list) -> dict:
        return {
            "time": int(int(row[0]) // 1000),
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5]),
        }

    @staticmethod
    def _validate_candles(candles: list[dict]) -> None:
        if not candles:
            raise ValueError("Binance returned no candles")
        if len(candles) > MAX_CANDLES:
            raise ValueError(f"requested dataset exceeds {MAX_CANDLES} candles")
        previous = None
        for candle in candles:
            Candle.model_validate(candle)
            if previous is not None and candle["time"] <= previous:
                raise ValueError("Binance candles are not strictly chronological")
            previous = candle["time"]

    @staticmethod
    def _dataset_id(candles: list[dict]) -> str:
        payload = json.dumps(candles, separators=(",", ":"), sort_keys=True, allow_nan=False)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def download(self, *, symbol: str, timeframe: str, start: int, end: int) -> dict:
        self._validate_request(symbol, timeframe, start, end)
        candles: list[dict] = []
        next_ms = start * 1000
        end_ms = end * 1000

        while next_ms <= end_ms:
            response = self._http().get(
                f"{BINANCE_FUTURES_BASE}{BINANCE_KLINE_ENDPOINT}",
                params={
                    "symbol": symbol.upper(),
                    "interval": timeframe,
                    "startTime": next_ms,
                    "endTime": end_ms,
                    "limit": BINANCE_LIMIT,
                },
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list):
                raise ValueError("Binance returned an invalid kline payload")
            page = [_map_row(row) for row in payload if isinstance(row, list) and len(row) >= 6]
            if not page:
                break
            candles.extend(page)
            if len(candles) > MAX_CANDLES:
                raise ValueError(f"requested dataset exceeds {MAX_CANDLES} candles")
            last_time = page[-1]["time"]
            if last_time * 1000 >= end_ms:
                break
            next_ms = (last_time + 1) * 1000
            if len(page) < BINANCE_LIMIT and next_ms > end_ms:
                break

        deduped = {candle["time"]: candle for candle in candles}
        ordered = [deduped[key] for key in sorted(deduped)]
        ordered = [candle for candle in ordered if start <= candle["time"] <= end]
        self._validate_candles(ordered)

        dataset_id = self._dataset_id(ordered)
        parquet_name = f"{_safe(symbol.upper())}_{_safe(timeframe)}_{dataset_id[:16]}.parquet"
        parquet_path = self.root / parquet_name
        manifest = {
            "datasetId": dataset_id,
            "symbol": symbol.upper(),
            "venue": "BINANCE_FUTURES",
            "timeframe": timeframe,
            "start": ordered[0]["time"],
            "end": ordered[-1]["time"],
            "requestedStart": start,
            "requestedEnd": end,
            "count": len(ordered),
            "format": "parquet",
            "path": parquet_name,
        }

        if not parquet_path.exists():
            table = pa.Table.from_pydict(
                {
                    "time": [c["time"] for c in ordered],
                    "open": [c["open"] for c in ordered],
                    "high": [c["high"] for c in ordered],
                    "low": [c["low"] for c in ordered],
                    "close": [c["close"] for c in ordered],
                    "volume": [c["volume"] for c in ordered],
                }
            )
            fd, temp_name = tempfile.mkstemp(prefix=f".{parquet_name}.", suffix=".tmp", dir=self.root)
            os.close(fd)
            temp_path = Path(temp_name)
            try:
                pq.write_table(table, temp_path, compression="zstd")
                temp_path.replace(parquet_path)
            finally:
                temp_path.unlink(missing_ok=True)

        _manifest_path(parquet_path).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return manifest

    def list_datasets(self, *, symbol: str | None = None, timeframe: str | None = None) -> list[dict]:
        wanted_symbol = symbol.upper() if symbol else None
        wanted_timeframe = timeframe if timeframe else None
        datasets = []
        for path in sorted(self.root.glob("*.parquet")):
            manifest_path = _manifest_path(path)
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if wanted_symbol and manifest.get("symbol") != wanted_symbol:
                continue
            if wanted_timeframe and manifest.get("timeframe") != wanted_timeframe:
                continue
            datasets.append(manifest)
        return datasets

    def read_candles(self, *, symbol: str, timeframe: str, start: int, end: int) -> list[dict]:
        self._validate_request(symbol, timeframe, start, end)
        candidates = [
            item
            for item in self.list_datasets(symbol=symbol, timeframe=timeframe)
            if int(item["end"]) >= start and int(item["start"]) <= end
        ]
        by_time: dict[int, dict] = {}
        for manifest in candidates:
            path = self.root / manifest["path"]
            table = pq.read_table(
                path,
                filters=[
                    ("time", ">=", int(start)),
                    ("time", "<=", int(end)),
                ],
            )
            data = table.to_pylist()
            for row in data:
                candle = {
                    "time": int(row["time"]),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row["volume"]),
                }
                by_time[candle["time"]] = candle

        candles = [by_time[key] for key in sorted(by_time)]
        self._validate_candles(candles) if candles else None
        return candles
