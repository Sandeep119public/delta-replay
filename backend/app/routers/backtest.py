from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from ..services.backtest_service import BacktestService

router = APIRouter()
service = BacktestService()

class Request(BaseModel):
    candles: list[dict] = Field(min_length=1)
    strategy: str = 'buy_and_hold'
    quantity: float = Field(default=1, gt=0)

@router.post('/run')
def run(request: Request):
    try:
        return service.run(request.candles, request.strategy, request.quantity)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
