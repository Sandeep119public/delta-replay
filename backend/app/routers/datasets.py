from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ..services.github_dataset_repository import GitHubDatasetRepository


router = APIRouter()
repository = GitHubDatasetRepository()


class PublishDatasetRequest(BaseModel):
    symbol: str
    timeframe: str
    from_ms: int | None = Field(default=None, alias="from")
    to_ms: int | None = Field(default=None, alias="to")
    candles: list[dict]
    metadata: dict = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


@router.get("")
def list_datasets():
    try:
        return {"datasets": repository.list()}
    except Exception as exc:
        raise HTTPException(502, f"Unable to read GitHub datasets: {exc}") from exc


@router.get("/{dataset_id}")
def get_dataset(dataset_id: str):
    try:
        result = repository.get(dataset_id)
    except Exception as exc:
        raise HTTPException(502, f"Unable to read GitHub dataset: {exc}") from exc
    if result is None:
        raise HTTPException(404, "Dataset not found")
    return result


@router.post("/publish")
def publish_dataset(payload: PublishDatasetRequest, authorization: str | None = Header(default=None)):
    token = ""
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer":
            token = value.strip()
    if not token:
        raise HTTPException(401, "GitHub publish token is required")
    try:
        return repository.publish(
            symbol=payload.symbol,
            timeframe=payload.timeframe,
            from_ms=payload.from_ms,
            to_ms=payload.to_ms,
            candles=payload.candles,
            token=token,
            metadata=payload.metadata,
        )
    except PermissionError as exc:
        raise HTTPException(401, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Unable to publish dataset to GitHub: {exc}") from exc
