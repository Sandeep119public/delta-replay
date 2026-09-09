from fastapi import APIRouter, UploadFile, File, HTTPException

from ..services.data_service import DataService

router = APIRouter()
service = DataService()
MAX_CSV_BYTES = 10 * 1024 * 1024


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
