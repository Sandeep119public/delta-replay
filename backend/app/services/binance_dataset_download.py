import os
import threading
import time
import uuid

import httpx

from .github_dataset_repository import GitHubDatasetRepository
from .dataset_job_repository import DatasetJobRepository


_INTERVAL_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
    "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
    "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000,
    "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
}


class BinanceDatasetDownloadService:
    """Server-owned Binance historical downloader and GitHub publisher."""

    def __init__(self, repository=None, job_repository=None):
        self.repository = repository or GitHubDatasetRepository()
        self.job_repository = job_repository or DatasetJobRepository()
        self._jobs = {}
        self._lock = threading.RLock()
        self._cancelled = set()
        self._running_jobs = set()
        self._worker_id = uuid.uuid4().hex
        self._workers = threading.BoundedSemaphore(max(1, int(os.getenv('DATASET_DOWNLOAD_CONCURRENCY', '1'))))
        self._recover()

    def _recover(self):
        for job in self.job_repository.recoverable():
            self._jobs[job['jobId']] = job
            threading.Thread(target=self._run, args=(job['jobId'],), daemon=True).start()

    def start(self, *, symbol, timeframe, from_ms, to_ms):
        symbol = str(symbol or "").strip().upper()
        timeframe = str(timeframe or "").strip()
        start = int(from_ms)
        end = int(to_ms)
        if timeframe not in _INTERVAL_MS:
            raise ValueError("unsupported dataset timeframe")
        if not symbol or start < 0 or end <= start:
            raise ValueError("invalid dataset download range")
        existing = self.job_repository.active(symbol, timeframe, start, end)
        if existing:
            with self._lock:
                self._jobs[existing['jobId']] = existing
                running = existing['jobId'] in self._running_jobs
            if not running:
                with self._lock:
                    self._running_jobs.add(existing['jobId'])
                threading.Thread(target=self._run, args=(existing['jobId'],), daemon=True).start()
            return existing
        durable = self.job_repository.create(symbol=symbol, timeframe=timeframe, from_ms=start, to_ms=end, total=max(1, (end-start)//_INTERVAL_MS[timeframe]))
        job_id = durable['jobId'] if durable else uuid.uuid4().hex
        with self._lock:
            self._jobs[job_id] = durable or {
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
        with self._lock:
            self._running_jobs.add(job_id)
        thread = threading.Thread(target=self._run, args=(job_id,), daemon=True)
        thread.start()
        return self.get(job_id)

    def get(self, job_id):
        with self._lock:
            job = self._jobs.get(str(job_id))
        if job:
            return dict(job)
        durable = self.job_repository.get(job_id)
        if durable:
            with self._lock: self._jobs[str(job_id)] = durable
            return dict(durable)
        return None

    def cancel(self, job_id):
        with self._lock:
            job = self._jobs.get(str(job_id)) or self.job_repository.get(job_id)
            if not job:
                return None
            if job['status'] in {'complete', 'failed', 'cancelled'}:
                return job
            self._cancelled.add(str(job_id))
        self._update(job_id, status='cancelled', error='Cancelled by operator')
        return self.get(job_id)

    def _update(self, job_id, **changes):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.update(changes)
        self.job_repository.update(job_id, **changes)

    @staticmethod
    def _fetch_page(client, params):
        last_error = None
        for attempt in range(3):
            try:
                response = client.get(
                    "https://fapi.binance.com/fapi/v1/klines",
                    params=params,
                )
                if response.status_code == 429:
                    retry_after = float(response.headers.get('Retry-After', '2'))
                    time.sleep(min(30, max(1, retry_after)))
                    continue
                if response.status_code == 418:
                    raise RuntimeError('Binance IP temporarily banned; retry later')
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"Binance kline request failed after retries: {last_error}")

    def _run(self, job_id):
        job = self.get(job_id)
        if not job:
            with self._lock:
                self._running_jobs.discard(str(job_id))
            return
        acquired = False
        try:
            acquired = self._workers.acquire()
            if not acquired:
                return
            if not self.job_repository.claim(job_id, self._worker_id):
                return
            persisted_chunks = self.job_repository.load_chunks(job_id)
        candles = [candle for chunk in persisted_chunks for candle in chunk]
        cursor = int(job.get('cursor', job['from']))
        interval_ms = _INTERVAL_MS[job["timeframe"]]
        if candles:
            cursor = max(cursor, candles[-1]['time'] * 1000 + interval_ms)
        if str(job_id) in self._cancelled:
            return
        self._update(job_id, worker_id=self._worker_id, status="running")
            with httpx.Client(timeout=60.0, follow_redirects=True) as client:
                while cursor < job["to"]:
                    if str(job_id) in self._cancelled or not self.job_repository.claim(job_id, self._worker_id):
                        return
                    rows = self._fetch_page(client, {
                        "symbol": job["symbol"],
                        "interval": job["timeframe"],
                        "startTime": cursor,
                        "endTime": job["to"] - 1,
                        "limit": 1000,
                    })
                    if not rows:
                        break
                    page_candles = []
                    for row in rows:
                        open_time = int(row[0])
                        if open_time < job["from"] or open_time >= job["to"]:
                            continue
                        page_candles.append({
                            "time": open_time // 1000,
                            "open": float(row[1]),
                            "high": float(row[2]),
                            "low": float(row[3]),
                            "close": float(row[4]),
                            "volume": float(row[5]),
                        })
                    if page_candles:
                        candles.extend(page_candles)
                        self.job_repository.append_chunk(job_id, len(persisted_chunks), page_candles[0]['time']*1000, page_candles[-1]['time']*1000, page_candles)
                        persisted_chunks.append(page_candles)
                    last_time = int(rows[-1][0])
                    next_cursor = last_time + interval_ms
                    if next_cursor <= cursor:
                        raise RuntimeError("Binance returned a non-advancing kline page")
                    cursor = next_cursor
                    self._update(
                        job_id,
                        worker_id=self._worker_id,
                        cursor=cursor,
                        loaded=len(candles),
                        pct=min(99, (cursor - job["from"]) / max(1, job["to"] - job["from"]) * 100),
                    )
                    if len(rows) < 1000:
                        break

            if not candles:
                raise ValueError("Binance returned no candles for the requested range")
            if any(b["time"] <= a["time"] for a, b in zip(candles, candles[1:])):
                raise ValueError("Binance returned duplicate or unordered candles")
            expected_step = interval_ms // 1000
            if any((b["time"] - a["time"]) != expected_step for a, b in zip(candles, candles[1:])):
                raise ValueError("Binance returned a gap in the requested candle range")
            dataset = self.repository.publish(
                symbol=job["symbol"],
                timeframe=job["timeframe"],
                from_ms=job["from"] // 1000,
                to_ms=job["to"] // 1000,
                candles=candles,
                metadata={"downloadedBy": "server", "candleSource": "binance-futures"},
            )
            if not self.job_repository.claim(job_id, self._worker_id):
                return
            self._update(job_id, worker_id=self._worker_id, status="complete", loaded=len(candles), pct=100, dataset=dataset)
            self.job_repository.clear_chunks(job_id)
        except Exception as exc:
            self._update(job_id, worker_id=self._worker_id, status="failed", pct=100, error=str(exc))
        finally:
            if acquired:
                self._workers.release()
            self.job_repository.release(job_id, self._worker_id)
            with self._lock:
                self._cancelled.discard(str(job_id))
                self._running_jobs.discard(str(job_id))
