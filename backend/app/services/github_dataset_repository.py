import base64
import csv
import hashlib
import io
import json
import os
import re
import tempfile
import time
from pathlib import Path
from collections import OrderedDict
from urllib.parse import quote
from datetime import datetime, timezone
from threading import RLock

import httpx
import pyarrow as pa
import pyarrow.parquet as pq

from .dataset_identity import dataset_id, dataset_id_iter


MAX_FILE_BYTES = 90 * 1024 * 1024
MAX_PARTITION_CANDLES = 80_000
MANIFEST_PATH = "datasets/manifest.json"
GITHUB_API = "https://api.github.com"
CSV_HEADER = ("time", "open", "high", "low", "close", "volume")
_TIMEFRAME_SECONDS = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "8h": 28800,
    "12h": 43200, "1d": 86400, "3d": 259200, "1w": 604800,
}


class GitHubDatasetRepository:
    """Immutable replay datasets backed by GitHub repository files.

    GitHub is the durable source of truth. Writes use the server-side
    DATASET_GITHUB_TOKEN and are committed atomically with the manifest.
    """

    def __init__(self, repo=None, branch=None, token=None):
        self.repo = (repo or os.getenv("DATASET_GITHUB_REPO", "Sandeep119public/delta-replay")).strip()
        self.branch = (branch or os.getenv("DATASET_GITHUB_BRANCH", "datasets")).strip()
        self.token = (token or os.getenv("DATASET_GITHUB_TOKEN", "")).strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", self.repo):
            raise ValueError("DATASET_GITHUB_REPO must be owner/name")
        if not self.branch:
            raise ValueError("DATASET_GITHUB_BRANCH is required")
        self._lock = RLock()
        self._cache = {}
        self._partition_cache = OrderedDict()
        self._partition_cache_limit = max(16, int(os.getenv("DATASET_PARTITION_CACHE_SIZE", "64")))
        self._cache_ttl = max(5, int(os.getenv("DATASET_CACHE_TTL_SECONDS", "60")))

    def _headers(self, token=None, accept="application/vnd.github.raw+json"):
        headers = {
            "Accept": accept,
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "delta-replay-dataset-service",
        }
        active = token or self.token
        if active:
            headers["Authorization"] = f"Bearer {active}"
        return headers

    def _url(self, path):
        return f"{GITHUB_API}/repos/{self.repo}/{path.lstrip('/')}"

    @staticmethod
    def _normalize_candles(candles):
        if not isinstance(candles, list) or not candles:
            raise ValueError("dataset must contain at least one candle")
        normalized = []
        previous = None
        for raw in candles:
            try:
                candle = {
                    "time": int(raw["time"]),
                    "open": float(raw["open"]),
                    "high": float(raw["high"]),
                    "low": float(raw["low"]),
                    "close": float(raw["close"]),
                    "volume": float(raw.get("volume", 0)),
                }
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"invalid candle: {exc}") from exc
            if previous is not None and candle["time"] <= previous:
                raise ValueError("candles must be strictly ordered by increasing time")
            if min(candle["open"], candle["high"], candle["low"], candle["close"]) <= 0:
                raise ValueError("candle prices must be positive")
            if candle["volume"] < 0:
                raise ValueError("candle volume must be non-negative")
            if candle["high"] < max(candle["open"], candle["close"]) or candle["low"] > min(candle["open"], candle["close"]) or candle["high"] < candle["low"]:
                raise ValueError("invalid candle OHLC relationship")
            normalized.append(candle)
            previous = candle["time"]
        return normalized

    @staticmethod
    def _csv_bytes(candles):
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(CSV_HEADER)
        for c in candles:
            writer.writerow((c["time"], c["open"], c["high"], c["low"], c["close"], c["volume"]))
        return output.getvalue().encode("utf-8")

    @staticmethod
    def _parquet_bytes(candles):
        table = pa.Table.from_pylist(candles, schema=pa.schema([
            pa.field("time", pa.int64()),
            pa.field("open", pa.float64()),
            pa.field("high", pa.float64()),
            pa.field("low", pa.float64()),
            pa.field("close", pa.float64()),
            pa.field("volume", pa.float64()),
        ]))
        sink = pa.BufferOutputStream()
        pq.write_table(table, sink, compression="zstd")
        return sink.getvalue().to_pybytes()

    @staticmethod
    def _parse_parquet(data):
        table = pq.read_table(pa.BufferReader(data))
        return GitHubDatasetRepository._normalize_candles(table.to_pylist())

    @staticmethod
    def _parse_csv(data):
        reader = csv.DictReader(io.StringIO(data.decode("utf-8")))
        if tuple(reader.fieldnames or ()) != CSV_HEADER:
            raise ValueError("dataset CSV schema is invalid")
        candles = []
        for row in reader:
            candles.append({
                "time": int(row["time"]),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"]),
            })
        return GitHubDatasetRepository._normalize_candles(candles)

    def _request(self, method, path, *, token=None, headers=None, **kwargs):
        request_headers = self._headers(token)
        if headers:
            request_headers.update(headers)
        with httpx.Client(timeout=120.0, follow_redirects=True) as client:
            response = client.request(
                method,
                self._url(path),
                headers=request_headers,
                **kwargs,
            )
        if response.status_code == 404:
            return None
        if response.status_code in (409, 422):
            raise RuntimeError(f"GitHub dataset operation rejected ({response.status_code}): {response.text[:500]}")
        response.raise_for_status()
        return response

    def _get_raw(self, path, token=None):
        ref = quote(self.branch, safe="")
        response = self._request(
            "GET",
            f"contents/{path.lstrip('/')}?ref={ref}",
            token=token,
            headers={"Accept": "application/vnd.github.raw+json"},
        )
        if response is None:
            return None
        if len(response.content) > MAX_FILE_BYTES:
            raise ValueError("dataset file exceeds the configured GitHub size safety limit")
        return response.content

    def _get_json(self, path, token=None):
        ref = quote(self.branch, safe="")
        response = self._request(
            "GET",
            f"contents/{path.lstrip('/')}?ref={ref}",
            token=token,
            headers={"Accept": "application/vnd.github.object+json"},
        )
        return None if response is None else response.json()

    def _read_manifest(self, token=None):
        raw = self._get_raw(MANIFEST_PATH, token)
        if raw is None:
            return {"schemaVersion": 2, "datasets": []}
        try:
            manifest = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"GitHub dataset manifest is invalid: {exc}") from exc
        if manifest.get("schemaVersion") not in (1, 2) or not isinstance(manifest.get("datasets"), list):
            raise RuntimeError("GitHub dataset manifest schema is invalid")
        return {"schemaVersion": 2, "datasets": manifest["datasets"]}

    def _manifest_cached(self):
        cached = self._cache.get("manifest")
        if cached and cached["expires"] > time.monotonic():
            return json.loads(json.dumps(cached["value"]))
        manifest = self._read_manifest()
        self._cache["manifest"] = {"expires": time.monotonic() + self._cache_ttl, "value": manifest}
        return json.loads(json.dumps(manifest))

    def _invalidate_cache(self):
        self._cache.clear()
        self._partition_cache.clear()

    def _partition_bytes(self, partition, token=None):
        cache_key = partition["sha256"]
        if token is None:
            cached = self._partition_cache.get(cache_key)
            if cached is not None:
                self._partition_cache.move_to_end(cache_key)
                return cached
        raw = self._get_raw(partition["path"], token)
        if raw is None:
            raise RuntimeError("manifest references a missing dataset partition")
        digest = hashlib.sha256(raw).hexdigest()
        if digest != partition["sha256"]:
            raise RuntimeError("dataset partition checksum does not match manifest")
        if token is None:
            self._partition_cache[cache_key] = raw
            self._partition_cache.move_to_end(cache_key)
            while len(self._partition_cache) > self._partition_cache_limit:
                self._partition_cache.popitem(last=False)
        return raw

    def list(self, token=None):
        manifest = self._manifest_cached() if token is None else self._read_manifest(token)
        return sorted(manifest["datasets"], key=lambda item: item.get("updatedAt", 0), reverse=True)

    def get(self, dataset_id_value, token=None):
        metadata = next((item for item in self.list(token) if item.get("id") == dataset_id_value), None)
        if metadata is None:
            return None
        if metadata.get("partitions"):
            candles = []
            for partition in metadata["partitions"]:
                raw = self._partition_bytes(partition, token)
                part_candles = self._parse_parquet(raw) if metadata.get("format") == "PARQUET" else self._parse_csv(raw)
                if len(part_candles) != int(partition["count"]):
                    raise RuntimeError("dataset partition row count does not match manifest")
                candles.extend(part_candles)
        else:
            ref = quote(self.branch, safe="")
            raw = self._get_raw(metadata["path"], token)
            if raw is None:
                raise RuntimeError("manifest references a missing dataset file")
            if hashlib.sha256(raw).hexdigest() != metadata.get("sha256"):
                raise RuntimeError("dataset checksum does not match manifest")
            candles = self._parse_parquet(raw) if metadata.get("format") == "PARQUET" else self._parse_csv(raw)
        if len(candles) != int(metadata["count"]):
            raise RuntimeError("dataset row count does not match manifest")
        if dataset_id(candles) != metadata["contentId"]:
            raise RuntimeError("dataset content identity does not match manifest")
        return {"metadata": dict(metadata), "candles": candles, "csv": self._csv_bytes(candles).decode("utf-8")}

    def get_partitions(self, dataset_id_value, token=None):
        metadata = next((item for item in self.list(token) if item.get("id") == dataset_id_value), None)
        if metadata is None:
            return None
        return {"metadata": dict(metadata), "partitions": list(metadata.get("partitions", []))}

    def get_candle_range(self, dataset_id_value, *, from_time=None, to_time=None, offset=0, limit=5000, token=None):
        if limit < 1 or limit > 20_000:
            raise ValueError("limit must be between 1 and 20000")
        metadata = next((item for item in self.list(token) if item.get("id") == dataset_id_value), None)
        if metadata is None:
            return None
        result = []
        skipped = 0
        for partition in metadata.get("partitions", []):
            if from_time is not None and int(partition["to"]) < int(from_time):
                continue
            if to_time is not None and int(partition["from"]) > int(to_time):
                continue
            raw = self._partition_bytes(partition, token)
            parser = self._parse_parquet if metadata.get("format") == "PARQUET" else self._parse_csv
            for candle in parser(raw):
                if from_time is not None and candle["time"] < int(from_time):
                    continue
                if to_time is not None and candle["time"] > int(to_time):
                    continue
                if skipped < offset:
                    skipped += 1
                    continue
                result.append(candle)
                if len(result) >= limit:
                    return {"metadata": dict(metadata), "candles": result, "nextOffset": offset + skipped + len(result)}
        return {"metadata": dict(metadata), "candles": result, "nextOffset": None}

    def _partition(self, candles, format_name="CSV"):
        groups = []
        current_key = None
        current = []
        for candle in candles:
            key = datetime.fromtimestamp(candle["time"], tz=timezone.utc).strftime("%Y-%m")
            if current and (key != current_key or len(current) >= MAX_PARTITION_CANDLES):
                groups.append((current_key, current))
                current = []
            current_key = key
            current.append(candle)
        if current:
            groups.append((current_key, current))

        parts = []
        for number, (month, chunk) in enumerate(groups, start=1):
            raw = self._parquet_bytes(chunk) if format_name == "PARQUET" else self._csv_bytes(chunk)
            if len(raw) > MAX_FILE_BYTES:
                raise ValueError("dataset partition exceeds GitHub size safety limit")
            parts.append((f"{month}-{number:04d}", chunk, raw))
        return parts

    @staticmethod
    def _quality_report(candles, timeframe):
        step = _TIMEFRAME_SECONDS[timeframe]
        gaps = []
        duplicates = 0
        for previous, current in zip(candles, candles[1:]):
            delta = current["time"] - previous["time"]
            if delta == 0:
                duplicates += 1
            elif delta != step:
                gaps.append({"from": previous["time"], "to": current["time"], "delta": delta})
        return {
            "status": "validated" if not gaps and duplicates == 0 else "issues",
            "rowCount": len(candles),
            "invalidCount": 0,
            "duplicateCount": duplicates,
            "gapCount": len(gaps),
            "gaps": gaps[:100],
            "firstTime": candles[0]["time"],
            "lastTime": candles[-1]["time"],
            "expectedIntervalSec": step,
        }

    def publish_chunks(self, *, symbol, timeframe, from_ms, to_ms, chunks, token=None, metadata=None):
        """Publish a validated iterable of candle chunks without retaining the full dataset in RAM."""
        active_token = (token or self.token).strip()
        if not active_token:
            raise PermissionError("DATASET_GITHUB_TOKEN is not configured")

        symbol = str(symbol or "").strip().upper()
        timeframe = str(timeframe or "").strip()
        if not re.fullmatch(r"[A-Z0-9._-]{2,32}", symbol):
            raise ValueError("invalid dataset symbol")
        if timeframe not in _TIMEFRAME_SECONDS:
            raise ValueError("unsupported dataset timeframe")

        format_name = str(os.getenv("DATASET_FORMAT", "CSV")).strip().upper()
        if format_name not in {"CSV", "PARQUET"}:
            raise ValueError("DATASET_FORMAT must be CSV or PARQUET")

        step = _TIMEFRAME_SECONDS[timeframe]
        previous = None
        first_time = None
        last_time = None
        count = 0
        duplicate_count = 0
        gaps = []
        temp_partitions = []

        with tempfile.TemporaryDirectory(prefix="delta-replay-dataset-") as temp_dir:
            current = []
            current_month = None

            def finalize_partition():
                nonlocal current, current_month
                if not current:
                    return
                extension = "parquet" if format_name == "PARQUET" else "csv"
                raw = self._parquet_bytes(current) if format_name == "PARQUET" else self._csv_bytes(current)
                if len(raw) > MAX_FILE_BYTES:
                    raise ValueError("dataset partition exceeds GitHub size safety limit")
                index = len(temp_partitions) + 1
                temp_path = Path(temp_dir) / f"partition-{index:06d}.{extension}"
                temp_path.write_bytes(raw)
                temp_partitions.append({
                    "month": current_month,
                    "from": current[0]["time"],
                    "to": current[-1]["time"],
                    "count": len(current),
                    "byteLength": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "tempPath": temp_path,
                })
                current = []
                current_month = None

            for chunk in chunks:
                normalized_chunk = self._normalize_candles(chunk)
                for candle in normalized_chunk:
                    if previous is not None:
                        delta = candle["time"] - previous["time"]
                        if delta <= 0:
                            if delta == 0:
                                duplicate_count += 1
                            raise ValueError("dataset contains duplicate or unordered candles")
                        if delta != step:
                            gaps.append({
                                "from": previous["time"],
                                "to": candle["time"],
                                "delta": delta,
                            })
                            if len(gaps) >= 100:
                                raise ValueError("dataset contains gaps; refusing to publish")
                    if first_time is None:
                        first_time = candle["time"]
                    last_time = candle["time"]
                    count += 1
                    month = datetime.fromtimestamp(candle["time"], tz=timezone.utc).strftime("%Y-%m")
                    if current and (month != current_month or len(current) >= MAX_PARTITION_CANDLES):
                        finalize_partition()
                    if current_month is None:
                        current_month = month
                    current.append(candle)
                    previous = candle

            finalize_partition()

            if not count:
                raise ValueError("dataset must contain at least one candle")
            if gaps:
                raise ValueError("dataset integrity report contains gaps or duplicates")

            def partition_candles():
                for partition in temp_partitions:
                    raw = partition["tempPath"].read_bytes()
                    if format_name == "PARQUET":
                        parsed = self._parse_parquet(raw)
                    else:
                        parsed = self._parse_csv(raw)
                    yield from parsed

            content_id = dataset_id_iter(partition_candles())
            existing = next(
                (item for item in self._read_manifest(active_token)["datasets"] if item.get("contentId") == content_id),
                None,
            )
            if existing:
                return existing

            start = int(from_ms if from_ms is not None else first_time)
            end = int(to_ms if to_ms is not None else last_time)
            now = int(time.time() * 1000)
            quality = {
                "status": "validated",
                "rowCount": count,
                "invalidCount": 0,
                "duplicateCount": duplicate_count,
                "gapCount": 0,
                "gaps": [],
                "firstTime": first_time,
                "lastTime": last_time,
                "expectedIntervalSec": step,
            }
            record = {
                "id": f"{symbol}-{timeframe}-{content_id[:16]}",
                "contentId": content_id,
                "schemaVersion": 2,
                "symbol": symbol,
                "timeframe": timeframe,
                "timeframeSec": step,
                "from": start,
                "to": end,
                "count": count,
                "format": format_name,
                "source": "binance",
                "status": "validated",
                "qualityReport": quality,
                "validationVersion": 1,
                "version": 1,
                "createdAt": now,
                "updatedAt": now,
                "partitions": [],
                **(metadata or {}),
            }

            entries = []
            extension = "parquet" if format_name == "PARQUET" else "csv"
            for number, partition in enumerate(temp_partitions, start=1):
                partition_key = f"{partition['month']}-{number:04d}"
                path = f"datasets/{symbol}/{timeframe}/{content_id[:16]}/{partition_key}.{extension}"
                record["partitions"].append({
                    "id": f"{record['id']}-{partition_key}",
                    "path": path,
                    "from": partition["from"],
                    "to": partition["to"],
                    "count": partition["count"],
                    "byteLength": partition["byteLength"],
                    "sha256": partition["sha256"],
                })
                entries.append((path, partition["tempPath"]))

            with self._lock:
                latest = self._read_manifest(active_token)
                existing = next(
                    (item for item in latest["datasets"] if item.get("contentId") == content_id),
                    None,
                )
                if existing:
                    return existing
                latest["schemaVersion"] = 2
                latest["datasets"].append(record)
                latest["datasets"].sort(key=lambda item: item.get("updatedAt", 0), reverse=True)
                manifest_raw = (json.dumps(latest, indent=2, sort_keys=True) + "\n").encode("utf-8")
                self._atomic_commit_files(
                    entries + [(MANIFEST_PATH, manifest_raw)],
                    f"data: publish dataset {record['id']}",
                    active_token,
                )
                self._invalidate_cache()
            return record

    def publish(self, *, symbol, timeframe, from_ms, to_ms, candles, token=None, metadata=None):
        active_token = (token or self.token).strip()
        if not active_token:
            raise PermissionError("DATASET_GITHUB_TOKEN is not configured")
        symbol = str(symbol or "").strip().upper()
        timeframe = str(timeframe or "").strip()
        if not re.fullmatch(r"[A-Z0-9._-]{2,32}", symbol):
            raise ValueError("invalid dataset symbol")
        if timeframe not in _TIMEFRAME_SECONDS:
            raise ValueError("unsupported dataset timeframe")
        normalized = self._normalize_candles(candles)
        format_name = str(os.getenv("DATASET_FORMAT", "CSV")).strip().upper()
        if format_name not in {"CSV", "PARQUET"}:
            raise ValueError("DATASET_FORMAT must be CSV or PARQUET")
        content_id = dataset_id(normalized)
        existing = next((item for item in self._read_manifest(active_token)["datasets"] if item.get("contentId") == content_id), None)
        if existing:
            return existing

        start = int(from_ms if from_ms is not None else normalized[0]["time"])
        end = int(to_ms if to_ms is not None else normalized[-1]["time"])
        now = int(time.time() * 1000)
        quality = self._quality_report(normalized, timeframe)
        if quality["status"] != "validated":
            raise ValueError("dataset integrity report contains gaps or duplicates")
        record = {
            "id": f"{symbol}-{timeframe}-{content_id[:16]}",
            "contentId": content_id,
            "schemaVersion": 2,
            "symbol": symbol,
            "timeframe": timeframe,
            "timeframeSec": _TIMEFRAME_SECONDS[timeframe],
            "from": start,
            "to": end,
            "count": len(normalized),
            "format": format_name,
            "source": "binance",
            "status": "validated",
            "qualityReport": quality,
            "validationVersion": 1,
            "version": 1,
            "createdAt": now,
            "updatedAt": now,
            "partitions": [],
            **(metadata or {}),
        }
        entries = []
        for partition_key, chunk, raw in self._partition(normalized, format_name):
            extension = "parquet" if format_name == "PARQUET" else "csv"
            path = f"datasets/{symbol}/{timeframe}/{content_id[:16]}/{partition_key}.{extension}"
            record["partitions"].append({
                "id": f"{record['id']}-{partition_key}",
                "path": path,
                "from": chunk[0]["time"],
                "to": chunk[-1]["time"],
                "count": len(chunk),
                "byteLength": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            })
            entries.append((path, raw))

        with self._lock:
            latest = self._read_manifest(active_token)
            existing = next((item for item in latest["datasets"] if item.get("contentId") == content_id), None)
            if existing:
                return existing
            latest["schemaVersion"] = 2
            latest["datasets"].append(record)
            latest["datasets"].sort(key=lambda item: item.get("updatedAt", 0), reverse=True)
            manifest_raw = (json.dumps(latest, indent=2, sort_keys=True) + "\n").encode("utf-8")
            self._atomic_commit(entries + [(MANIFEST_PATH, manifest_raw)], f"data: publish dataset {record['id']}", active_token)
            self._invalidate_cache()
        return record

    def _atomic_commit_files(self, entries, message, token):
        for attempt in range(3):
            ref = self._request("GET", f"git/ref/heads/{self.branch}", token=token)
            if ref is None:
                raise RuntimeError(f"GitHub branch not found: {self.branch}")
            parent_sha = ref["object"]["sha"]
            parent = self._request("GET", f"git/commits/{parent_sha}", token=token).json()
            base_tree = parent["tree"]["sha"]
            tree_entries = []
            for path, source in entries:
                if isinstance(source, Path):
                    raw = source.read_bytes()
                else:
                    raw = source
                blob = self._request(
                    "POST",
                    "git/blobs",
                    token=token,
                    json={"content": base64.b64encode(raw).decode("ascii"), "encoding": "base64"},
                ).json()
                tree_entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
            tree = self._request("POST", "git/trees", token=token, json={"base_tree": base_tree, "tree": tree_entries}).json()
            commit = self._request(
                "POST",
                "git/commits",
                token=token,
                json={"message": message, "tree": tree["sha"], "parents": [parent_sha]},
            ).json()
            try:
                self._request(
                    "PATCH",
                    f"git/refs/heads/{self.branch}",
                    token=token,
                    json={"sha": commit["sha"], "force": False},
                )
                return commit["sha"]
            except RuntimeError:
                if attempt == 2:
                    raise
        raise RuntimeError("GitHub atomic dataset commit failed")

    def _atomic_commit(self, entries, message, token):
        for attempt in range(3):
            ref = self._request("GET", f"git/ref/heads/{self.branch}", token=token)
            if ref is None:
                raise RuntimeError(f"GitHub branch not found: {self.branch}")
            parent_sha = ref["object"]["sha"]
            parent = self._request("GET", f"git/commits/{parent_sha}", token=token).json()
            base_tree = parent["tree"]["sha"]
            tree_entries = []
            for path, raw in entries:
                blob = self._request(
                    "POST",
                    "git/blobs",
                    token=token,
                    json={"content": base64.b64encode(raw).decode("ascii"), "encoding": "base64"},
                ).json()
                tree_entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
            tree = self._request("POST", "git/trees", token=token, json={"base_tree": base_tree, "tree": tree_entries}).json()
            commit = self._request(
                "POST",
                "git/commits",
                token=token,
                json={"message": message, "tree": tree["sha"], "parents": [parent_sha]},
            ).json()
            try:
                self._request(
                    "PATCH",
                    f"git/refs/heads/{self.branch}",
                    token=token,
                    json={"sha": commit["sha"], "force": False},
                )
                return commit["sha"]
            except RuntimeError:
                if attempt == 2:
                    raise
        raise RuntimeError("GitHub atomic dataset commit failed")
