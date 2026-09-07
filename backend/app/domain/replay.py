from dataclasses import dataclass
from typing import Any

@dataclass
class ReplayState:
    index: int = -1
    total: int = 0

class ReplayEngine:
    def __init__(self) -> None:
        self._candles: list[dict[str, Any]] = []
        self._state = ReplayState()

    def load(self, candles: list[dict[str, Any]]) -> ReplayState:
        self._candles = list(candles)
        self._state = ReplayState(index=0 if self._candles else -1, total=len(self._candles))
        return self._state

    def step(self) -> ReplayState:
        if self._candles:
            self._state.index = min(self._state.index + 1, len(self._candles) - 1)
        return self._state

    def reset(self) -> ReplayState:
        self._state.index = 0 if self._candles else -1
        return self._state

    def snapshot(self) -> dict[str, Any]:
        candle = self._candles[self._state.index] if self._state.index >= 0 else None
        return {"index": self._state.index, "total": self._state.total, "candle": candle}
