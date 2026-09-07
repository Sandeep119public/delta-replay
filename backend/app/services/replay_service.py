from ..domain.replay import ReplayEngine
from ..models import CandleBatch

class ReplayService:
    def __init__(self) -> None:
        self.engine = ReplayEngine()

    def load(self, batch: CandleBatch) -> dict:
        self.engine.load([c.model_dump() for c in batch.candles])
        return self.engine.snapshot()

    def step(self) -> dict:
        self.engine.step()
        return self.engine.snapshot()

    def reset(self) -> dict:
        self.engine.reset()
        return self.engine.snapshot()

    def state(self) -> dict:
        return self.engine.snapshot()
