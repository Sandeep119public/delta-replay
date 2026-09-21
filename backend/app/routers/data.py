from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from ..models import DatasetDownloadRequest
from ..services.binance_dataset_service import BinanceDatasetService
from ..services.data_service import DataService

router = APIRouter()
service = DataService()
dataset_service = BinanceDatasetService()
MAX_CSV_BYTES = 10 * 1024 * 1024


@router.post("/download")
def download(request: DatasetDownloadRequest):
    try:
        return dataset_service.download(
            symbol=request.symbol.strip().upper(),
            timeframe=request.timeframe.strip(),
            start=request.start,
            end=request.end,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Binance dataset download failed: {exc}") from exc


@router.get("/datasets")
def list_datasets(
    symbol: str | None = Query(default=None),
    timeframe: str | None = Query(default=None),
):
    return {
        "datasets": dataset_service.list_datasets(
            symbol=symbol.strip().upper() if symbol else None,
            timeframe=timeframe.strip() if timeframe else None,
        ),
    }


@router.get("/candles")
def stored_candles(
    symbol: str = Query(min_length=1),
    timeframe: str = Query(min_length=1),
    start: int = Query(ge=0, alias="from"),
    end: int = Query(gt=0, alias="to"),
):
    try:
        candles = dataset_service.read_candles(
            symbol=symbol.strip().upper(),
            timeframe=timeframe.strip(),
            start=start,
            end=end,
        )
        if not candles:
            raise ValueError(
                f"No stored Binance dataset covers {symbol.upper()} {timeframe} between {start} and {end}"
            )
        return {"candles": candles, "count": len(candles), "source": "BINANCE_PARQUET"}
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"Stored dataset read failed: {exc}") from exc


@router.post("/csv")
async def upload(file: UploadFile = File(...)):
    payload = await file.read(MAX_CSV_BYTES + 1)
    if len(payload) > MAX_CSV_BYTES:
        raise HTTPException(413, "CSV file is too large")
    try:
        candles = service.parse_csv(payload.decode("utf-8-sig"))
        return {"candles": candles, "count": len(candles)}
    except UnicodeDecodeError as exc:
        raise HTTPException(422, "CSV file must be valid UTF-8") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
