from copy import deepcopy
from math import isfinite

from ..models import Candle


class ReplayService:
    VALID_STATUSES = {"idle", "ready", "paused", "ended"}

    def __init__(self):
        self.candles = []
        self.index = -1
        self.start_index = -1
        self.speed = 1
        self.status = "idle"

    @staticmethod
    def _index(value, name="replay index"):
        if isinstance(value, bool):
            raise ValueError(f"{name} must be an integer")
        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be an integer") from exc
        if not isfinite(numeric) or numeric != int(numeric):
            raise ValueError(f"{name} must be an integer")
        return int(numeric)

    @staticmethod
    def _validate_chronology(candles):
        times = [candle.time for candle in candles]
        if any(current <= previous for previous, current in zip(times, times[1:])):
            raise ValueError("candles must be strictly ordered by increasing time")

    def load(self, candles):
        validated = [Candle.model_validate(candle) for candle in candles]
        self._validate_chronology(validated)
        self.candles = [candle.model_dump() for candle in validated]
        self.index = -1
        self.start_index = -1
        self.status = "ready" if self.candles else "idle"
        return self.state()

    def start(self, index=0):
        index = self._index(index)
        if not self.candles:
            return self.state()
        self.start_index = max(0, min(index, len(self.candles) - 1))
        self.index = self.start_index
        self.status = "ended" if self.index == len(self.candles) - 1 else "paused"
        return self.state()

    def step(self):
        if self.index < 0:
            return self.state()
        self.index = min(self.index + 1, len(self.candles) - 1)
        self.status = "ended" if self.index == len(self.candles) - 1 else "paused"
        return self.state()

    def seek(self, index):
        index = self._index(index)
        if not self.candles or index < 0 or index >= len(self.candles):
            raise ValueError("Invalid replay index")
        self.index = index
        self.status = "ended" if index == len(self.candles) - 1 else "paused"
        return self.state()

    def reset(self):
        self.index = self.start_index if self.start_index >= 0 else -1
        self.status = "paused" if self.index >= 0 else ("ready" if self.candles else "idle")
        return self.state()

    def state(self):
        return {
            "status": self.status,
            "index": self.index,
            "startIndex": self.start_index,
            "total": len(self.candles),
            "speed": self.speed,
            "candle": deepcopy(self.candles[self.index]) if self.index >= 0 else None,
            "visibleCandles": deepcopy(self.candles[: self.index + 1]) if self.index >= 0 else [],
        }

    def export_state(self):
        """Return all replay state required to reconstruct this service."""
        return {
            "candles": deepcopy(self.candles),
            "index": self.index,
            "startIndex": self.start_index,
            "speed": self.speed,
            "status": self.status,
        }

    @classmethod
    def from_state(cls, state):
        if not isinstance(state, dict):
            raise ValueError("replay state must be an object")
        required = ("candles", "index", "startIndex", "speed", "status")
        missing = [key for key in required if key not in state]
        if missing:
            raise ValueError(f"replay state missing fields: {', '.join(missing)}")
        if not isinstance(state["candles"], list):
            raise ValueError("replay candles must be a list")
        try:
            index = cls._index(state["index"], "replay index")
            start_index = cls._index(state["startIndex"], "replay start index")
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        try:
            speed = float(state["speed"])
        except (TypeError, ValueError) as exc:
            raise ValueError("replay speed must be positive and finite") from exc
        if isinstance(state["speed"], bool) or not isfinite(speed) or speed <= 0:
            raise ValueError("replay speed must be positive and finite")
        status = state["status"]
        if status not in cls.VALID_STATUSES:
            raise ValueError("unsupported replay status")

        replay = cls()
        try:
            replay.candles = [Candle.model_validate(candle).model_dump() for candle in state["candles"]]
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid persisted candle data: {exc}") from exc
        replay._validate_chronology([Candle.model_validate(candle) for candle in replay.candles])
        replay.index = index
        replay.start_index = start_index
        replay.speed = speed
        replay.status = status
        if replay.candles:
            if replay.index < -1 or replay.index >= len(replay.candles):
                raise ValueError("replay index is outside candle range")
            if replay.start_index < -1 or replay.start_index >= len(replay.candles):
                raise ValueError("replay start index is outside candle range")
            if replay.status == "idle":
                raise ValueError("non-empty replay cannot be idle")
            if replay.status == "ready" and (replay.index != -1 or replay.start_index != -1):
                raise ValueError("ready replay cannot have an active index")
            if replay.status in {"paused", "ended"} and (replay.index < 0 or replay.start_index < 0):
                raise ValueError("active replay must have active indices")
            if replay.status == "ended" and replay.index != len(replay.candles) - 1:
                raise ValueError("ended replay must point to the final candle")
        elif replay.index != -1 or replay.start_index != -1:
            raise ValueError("empty replay cannot have an active index")
        elif replay.status != "idle":
            raise ValueError("empty replay must be idle")
        return replay
