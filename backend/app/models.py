from pydantic import BaseModel, Field
from typing import Any

class Candle(BaseModel):
    time: int | float
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

class CandleBatch(BaseModel):
    candles: list[Candle] = Field(default_factory=list)

class ReplaySnapshot(BaseModel):
    index: int
    total: int
    candle: dict[str, Any] | None
