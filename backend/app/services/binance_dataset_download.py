import threading
import time
import uuid

import httpx

from .github_dataset_repository import GitHubDatasetRepository


_INTERVAL_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
    "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
    "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000,
    "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
}


class BinanceDatasetDownloadService:
    """Server-owned Binance historical downloader and GitHub publisher."""

    def __init__(self, repository=None):
        self.repository = repository or GitHubDatasetRepository()
        self._jobs = {}
        self._lock = threading.RLock()

    def start(self, *, symbol, timeframe, from_ms, to_ms):
        symbol = str(symbol or "").strip().upper()
        timeframe = str(timeframe or "").strip()
        start = int(from_ms)
        end = int(to_ms)
        if timeframe not in _INTERVAL_MS:
            raise ValueError("unsupported dataset timeframe")
        if not symbol or start < 0 or end <= start:
            raise ValueError("invalid dataset download range")
        job_id = uuid.uuid4().hex
        with self._lock:
            self._jobs[job_id] = {
                "jobId": job_id,
                "status": "starting",
                "symbol": symbol,
                "timeframe": timeframe,
                "from": start,
                "to": end,
                "loaded": 0,
                "total": max(1, (end - start) // _INTERVAL_MS[timeframe]),
                "pct": 0,
                "error": None,
                "dataset": None,
                "createdAt": int(time.time() * 1000),
            }
        thread = threading.Thread(target=self._run, args=(job_id,), daemon=True)
        thread.start()
        return self.get(job_id)

    def get(self, job_id):
        with self._lock:
            job = self._jobs.get(str(job_id))
            return dict(job) if job else None

    def _update(self, job_id, **changes):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.update(changes)

    def _run(self, job_id):
        job = self.get(job_id)
        candles = []
        cursor = job["from"]
        interval_ms = _INTERVAL_MS[job["timeframe"]]
        try:
            self._update(job_id, status="running")
            with httpx.Client(timeout=60.0, follow_redirects=True) as client:
                while cursor < job["to"]:
                    response = client.get(
                        "https://fapi.binance.com/fapi/v1/klines",
                        params={
                            "symbol": job["symbol"],
                            "interval": job["timeframe"],
                            "startTime": cursor,
                            "endTime": job["to"] - 1,
                            "limit": 1000,
                        },
                    )
                    response.raise_for_status()
                    rows = response.json()
                    if not rows:
                        break
                    for row in rows:
                        open_time = int(row[0])
                        if open_time < job["from"] or open_time >= job["to"]:
                            continue
                        candles.append({
                            "time": open_time // 1000,
                            "open": float(row[1]),
                            "high": float(row[2]),
                            "low": float(row[3]),
                            "close": float(row[4]),
                            "volume": float(row[5]),
                        })
                    last_time = int(rows[-1][0])
                    next_cursor = last_time + interval_ms
                    if next_cursor <= cursor:
                        raise RuntimeError("Binance returned a non-advancing kline page")
                    cursor = next_cursor
                    self._update(
                        job_id,
                        loaded=len(candles),
                        pct=min(99, (cursor - job["from"]) / max(1, job["to"] - job["from"]) * 100),
                    )
                    if len(rows) < 1000:
                        break

            if not candles:
                raise ValueError("Binance returned no candles for the requested range")
            if any(b["time"] <= a["time"] for a, b in zip(candles, candles[1:])):
                raise ValueError("Binance returned duplicate or unordered candles")
            dataset = self.repository.publish(
                symbol=job["symbol"],
                timeframe=job["timeframe"],
                from_ms=job["from"] // 1000,
                to_ms=job["to"] // 1000,
                candles=candles,
                metadata={"downloadedBy": "server", "candleSource": "binance-futures"},
            )
            self._update(job_id, status="complete", loaded=len(candles), pct=100, dataset=dataset)
        except Exception as exc:
            self._update(job_id, status="failed", pct=100, error=str(exc))
