import base64
import csv
import hashlib
import io
import json
import os
import re
from threading import RLock

import httpx

from .dataset_identity import dataset_id


MAX_FILE_BYTES = 90 * 1024 * 1024
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

    The repository is configured with DATASET_GITHUB_REPO (owner/name).
    Reads work for public repositories without a token. Writes require a
    caller-supplied fine-grained GitHub token with Contents: write permission.
    """

    def __init__(self, repo=None, branch=None):
        self.repo = (repo or os.getenv("DATASET_GITHUB_REPO", "Sandeep119public/delta-replay")).strip()
        self.branch = (branch or os.getenv("DATASET_GITHUB_BRANCH", "master")).strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", self.repo):
            raise ValueError("DATASET_GITHUB_REPO must be owner/name")
        if not self.branch:
            raise ValueError("DATASET_GITHUB_BRANCH is required")
        self._manifest_lock = RLock()

    @property
    def configured(self):
        return bool(self.repo and self.branch)

    def _headers(self, token=None, accept="application/vnd.github.raw+json"):
        headers = {
            "Accept": accept,
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "delta-replay-dataset-service",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _url(self, path):
        return f"{GITHUB_API}/repos/{self.repo}/contents/{path.lstrip('/')}"

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

    def _get_json(self, path, token=None):
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            response = client.get(self._url(path), headers=self._headers(token, "application/vnd.github.object+json"))
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    def _get_raw(self, path, token=None):
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            response = client.get(self._url(path), headers=self._headers(token, "application/vnd.github.raw+json"))
        if response.status_code == 404:
            return None
        response.raise_for_status()
        if len(response.content) > MAX_FILE_BYTES:
            raise ValueError("dataset file exceeds the configured GitHub size safety limit")
        return response.content

    def _read_manifest(self, token=None):
        raw = self._get_raw(MANIFEST_PATH, token)
        if raw is None:
            return {"schemaVersion": 1, "datasets": []}
        try:
            manifest = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"GitHub dataset manifest is invalid: {exc}") from exc
        if manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("datasets"), list):
            raise RuntimeError("GitHub dataset manifest schema is invalid")
        return manifest

    def list(self, token=None):
        manifest = self._read_manifest(token)
        return sorted(manifest["datasets"], key=lambda item: item.get("updatedAt", 0), reverse=True)

    def get(self, dataset_id_value, token=None):
        manifest = self._read_manifest(token)
        metadata = next((item for item in manifest["datasets"] if item.get("id") == dataset_id_value), None)
        if metadata is None:
            return None
        raw = self._get_raw(metadata["path"], token)
        if raw is None:
            raise RuntimeError("manifest references a missing dataset file")
        actual_hash = hashlib.sha256(raw).hexdigest()
        if actual_hash != metadata.get("sha256"):
            raise RuntimeError("dataset checksum does not match manifest")
        candles = self._parse_csv(raw)
        if len(candles) != int(metadata["count"]):
            raise RuntimeError("dataset row count does not match manifest")
        if dataset_id(candles) != metadata["contentId"]:
            raise RuntimeError("dataset content identity does not match manifest")
        return {"metadata": dict(metadata), "candles": candles, "csv": raw.decode("utf-8")}

    def publish(self, *, symbol, timeframe, from_ms, to_ms, candles, token, metadata=None):
        if not token or not token.strip():
            raise PermissionError("GitHub publish token is required")
        symbol = str(symbol or "").strip().upper()
        timeframe = str(timeframe or "").strip()
        if not re.fullmatch(r"[A-Z0-9._-]{2,32}", symbol):
            raise ValueError("invalid dataset symbol")
        if timeframe not in _TIMEFRAME_SECONDS:
            raise ValueError("unsupported dataset timeframe")
        normalized = self._normalize_candles(candles)
        raw = self._csv_bytes(normalized)
        if len(raw) > MAX_FILE_BYTES:
            raise ValueError("dataset is too large for GitHub regular-file storage; split the range before publishing")

        content_id = dataset_id(normalized)
        sha256 = hashlib.sha256(raw).hexdigest()
        existing_manifest = self._read_manifest(token)
        existing = next((item for item in existing_manifest["datasets"] if item.get("contentId") == content_id), None)
        if existing:
            return existing

        start = int(from_ms if from_ms is not None else normalized[0]["time"])
        end = int(to_ms if to_ms is not None else normalized[-1]["time"])
        path = f"datasets/{symbol}/{timeframe}/{content_id}.csv"
        now = __import__("time").time_ns() // 1_000_000
        record = {
            "id": f"{symbol}-{timeframe}-{content_id[:16]}",
            "contentId": content_id,
            "schemaVersion": 1,
            "symbol": symbol,
            "timeframe": timeframe,
            "timeframeSec": _TIMEFRAME_SECONDS[timeframe],
            "from": start,
            "to": end,
            "count": len(normalized),
            "format": "CSV",
            "path": path,
            "sha256": sha256,
            "byteLength": len(raw),
            "source": "binance",
            "status": "validated",
            "version": 1,
            "createdAt": now,
            "updatedAt": now,
            **(metadata or {}),
        }

        encoded = base64.b64encode(raw).decode("ascii")
        with self._manifest_lock:
            self._put(path, encoded, f"data: publish {record['id']}", token)
            manifest = self._read_manifest(token)
            if any(item.get("contentId") == content_id for item in manifest["datasets"]):
                return next(item for item in manifest["datasets"] if item.get("contentId") == content_id)
            manifest["datasets"].append(record)
            manifest["datasets"].sort(key=lambda item: item.get("updatedAt", 0), reverse=True)
            manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
            current = self._get_json(MANIFEST_PATH, token)
            self._put(
                MANIFEST_PATH,
                base64.b64encode(manifest_bytes).decode("ascii"),
                f"data: update dataset manifest ({record['id']})",
                token,
                sha=current.get("sha") if current else None,
            )
        return record

    def _put(self, path, content_b64, message, token, sha=None):
        body = {
            "message": message,
            "content": content_b64,
            "branch": self.branch,
        }
        if sha:
            body["sha"] = sha
        with httpx.Client(timeout=120.0, follow_redirects=True) as client:
            response = client.put(self._url(path), headers=self._headers(token, "application/vnd.github+json"), json=body)
        if response.status_code in (409, 422):
            raise RuntimeError(f"GitHub refused dataset write ({response.status_code}): {response.text[:500]}")
        response.raise_for_status()
        return response.json()
