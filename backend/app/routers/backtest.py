from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..models import CandleBatch
from ..services.backtest_service import BacktestService, TAKER_FEE_RATE

router = APIRouter()
service = BacktestService()


class BacktestRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    candles: CandleBatch
    strategy: str = "buy_and_hold"
    quantity: float = Field(default=1, gt=0)
    feeRate: float = Field(default=TAKER_FEE_RATE, ge=0, lt=1)


@router.post("/run")
def run(request: BacktestRequest):
    try:
        return service.run(
            request.candles.candles,
            request.strategy,
            request.quantity,
            request.feeRate,
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
