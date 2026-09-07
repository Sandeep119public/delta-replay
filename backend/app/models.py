from pydantic import BaseModel, Field
from typing import Literal

class Candle(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0

class CandleBatch(BaseModel):
    candles: list[Candle] = Field(min_length=1)

class OrderRequest(BaseModel):
    side: Literal["buy", "sell"]
    quantity: float = Field(gt=0)

class Position(BaseModel):
    side: Literal["long", "short"]
    quantity: float
    entry_price: float

class AccountSnapshot(BaseModel):
    balance: float
    equity: float
    position: Position | None
