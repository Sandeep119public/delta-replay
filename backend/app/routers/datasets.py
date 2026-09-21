from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ..services.binance_dataset_download import BinanceDatasetDownloadService
from ..services.github_dataset_repository import GitHubDatasetRepository
from ..services.experiment_fingerprint import fingerprint


router = APIRouter()
repository = GitHubDatasetRepository()
downloads = BinanceDatasetDownloadService(repository)


class DatasetRangeRequest(BaseModel):
    symbol: str
    timeframe: str
    from_ms: int | None = Field(default=None, alias="from")
    to_ms: int | None = Field(default=None, alias="to")

    model_config = {"populate_by_name": True}


class PublishDatasetRequest(BaseModel):
    symbol: str
    timeframe: str
    from_ms: int | None = Field(default=None, alias="from")
    to_ms: int | None = Field(default=None, alias="to")
    candles: list[dict] = Field(min_length=1, max_length=100_000)
    metadata: dict = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


def _authorized_secret(authorization: str | None):
    if not authorization:
        return ""
    scheme, _, value = authorization.partition(" ")
    return value.strip() if scheme.lower() == "bearer" else ""


def _require_publish_secret(authorization: str | None):
    import os

    configured = os.getenv("DATASET_PUBLISH_SECRET", "").strip()
    supplied = _authorized_secret(authorization)
    if not configured:
        raise HTTPException(503, "DATASET_PUBLISH_SECRET is not configured")
    if not supplied or supplied != configured:
        raise HTTPException(401, "Dataset publish authorization is invalid")


@router.get("")
def list_datasets():
    try:
        return {"datasets": repository.list()}
    except Exception as exc:
        raise HTTPException(502, f"Unable to read GitHub datasets: {exc}") from exc


def _load(dataset_id):
    try:
        result = repository.get(dataset_id)
    except Exception as exc:
        raise HTTPException(502, f"Unable to read GitHub dataset: {exc}") from exc
    if result is None:
        raise HTTPException(404, "Dataset not found")
    return result


@router.get("/{dataset_id}")
def get_dataset(dataset_id: str):
    result = _load(dataset_id)
    return {"metadata": result["metadata"]}


@router.get("/{dataset_id}/fingerprint")
def get_dataset_fingerprint(
    dataset_id: str,
    feature_version: str = "unknown",
    model_version: str = "unknown",
    code_commit: str | None = None,
    seed: int | None = None,
):
    result = repository.get_partitions(dataset_id)
    if result is None:
        raise HTTPException(404, "Dataset not found")
    return fingerprint(
        dataset_content_id=result["metadata"]["contentId"],
        feature_version=feature_version,
        model_version=model_version,
        code_commit=code_commit,
        configuration={"symbol": result["metadata"].get("symbol"), "timeframe": result["metadata"].get("timeframe")},
        seed=seed,
    )


@router.get("/{dataset_id}/partitions")
def get_dataset_partitions(dataset_id: str):
    try:
        result = repository.get_partitions(dataset_id)
    except Exception as exc:
        raise HTTPException(502, f"Unable to read GitHub dataset partitions: {exc}") from exc
    if result is None:
        raise HTTPException(404, "Dataset not found")
    return result


@router.get("/{dataset_id}/range")
def get_dataset_range(
    dataset_id: str,
    from_time: int | None = None,
    to_time: int | None = None,
    offset: int = 0,
    limit: int = 5000,
):
    if offset < 0:
        raise HTTPException(422, "offset must be non-negative")
    try:
        result = repository.get_candle_range(
            dataset_id,
            from_time=from_time,
            to_time=to_time,
            offset=offset,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Unable to read dataset range: {exc}") from exc
    if result is None:
        raise HTTPException(404, "Dataset not found")
    return result


@router.get("/{dataset_id}/candles")
def get_dataset_candles(dataset_id: str):
    result = _load(dataset_id)
    return {"metadata": result["metadata"], "candles": result["candles"]}


@router.get("/{dataset_id}/csv")
def get_dataset_csv(dataset_id: str):
    result = _load(dataset_id)
    return {"metadata": result["metadata"], "csv": result["csv"]}


@router.post("/download")
def start_download(payload: DatasetRangeRequest, authorization: str | None = Header(default=None)):
    _require_publish_secret(authorization)
    try:
        return downloads.start(
            symbol=payload.symbol,
            timeframe=payload.timeframe,
            from_ms=int(payload.from_ms) * 1000,
            to_ms=int(payload.to_ms) * 1000,
        )
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Unable to start Binance download: {exc}") from exc


@router.post("/downloads/{job_id}/cancel")
def cancel_download(job_id: str, authorization: str | None = Header(default=None)):
    _require_publish_secret(authorization)
    result = downloads.cancel(job_id)
    if result is None:
        raise HTTPException(404, "Download job not found")
    return result


@router.get("/downloads/{job_id}")
def download_status(job_id: str, authorization: str | None = Header(default=None)):
    _require_publish_secret(authorization)
    result = downloads.get(job_id)
    if result is None:
        raise HTTPException(404, "Download job not found")
    return result


@router.post("/publish")
def publish_dataset(payload: PublishDatasetRequest, authorization: str | None = Header(default=None)):
    _require_publish_secret(authorization)
    try:
        return repository.publish(
            symbol=payload.symbol,
            timeframe=payload.timeframe,
            from_ms=payload.from_ms,
            to_ms=payload.to_ms,
            candles=payload.candles,
            metadata=payload.metadata,
        )
    except PermissionError as exc:
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Unable to publish dataset to GitHub: {exc}") from exc
