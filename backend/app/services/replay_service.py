from copy import deepcopy


class ReplayService:
    def __init__(self):
        self.candles = []
        self.index = -1
        self.start_index = -1
        self.speed = 1
        self.status = "idle"

    def load(self, candles):
        self.candles = candles
        self.index = -1
        self.start_index = -1
        self.status = "ready"
        return self.state()

    def start(self, index=0):
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
            "candle": self.candles[self.index] if self.index >= 0 else None,
            "visibleCandles": self.candles[: self.index + 1] if self.index >= 0 else [],
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

        replay = cls()
        replay.candles = deepcopy(state["candles"])
        replay.index = int(state["index"])
        replay.start_index = int(state["startIndex"])
        replay.speed = int(state["speed"])
        replay.status = str(state["status"])
        if replay.speed <= 0:
            raise ValueError("replay speed must be positive")
        if replay.candles:
            if replay.index < -1 or replay.index >= len(replay.candles):
                raise ValueError("replay index is outside candle range")
            if replay.start_index < -1 or replay.start_index >= len(replay.candles):
                raise ValueError("replay start index is outside candle range")
        elif replay.index != -1 or replay.start_index != -1:
            raise ValueError("empty replay cannot have an active index")
        return replay
