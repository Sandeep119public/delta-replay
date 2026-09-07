from fastapi import APIRouter, UploadFile, File, HTTPException
from ..services.data_service import DataService
router=APIRouter(); service=DataService()
@router.post("/csv")
async def upload(file:UploadFile=File(...)):
    try:
        candles=service.parse_csv((await file.read()).decode("utf-8-sig"))
        return {"candles":candles,"count":len(candles)}
    except ValueError as e: raise HTTPException(422,str(e))
