from dataclasses import dataclass, field

from .paper_engine import PaperTradingEngine
from .replay_service import ReplayService
from .replay_timeline import ReplayTimeline


@dataclass
class ReplaySession:
    """Aggregate root for one replay session.

    Child state is mutated through the aggregate so timeline ownership and
    trading replacement cannot drift apart.
    """

    replay: ReplayService = field(default_factory=ReplayService)
    trading: PaperTradingEngine = field(default_factory=PaperTradingEngine)
    _timeline: ReplayTimeline = field(default_factory=ReplayTimeline, repr=False)

    @property
    def history(self) -> list[dict]:
        return self._timeline.snapshot()

    @property
    def timeline(self) -> ReplayTimeline:
        return self._timeline

    def replace_history(self, events) -> None:
        self._timeline.replace(events)

    def record(self, command_type: str, replay_index: int, payload: dict) -> None:
        self._timeline.record(command_type, replay_index, payload)

    def truncate_future_history(self, replay_index: int) -> None:
        self._timeline.truncate_after(replay_index)

    def replace_trading(self, trading: PaperTradingEngine) -> None:
        if not isinstance(trading, PaperTradingEngine):
            raise TypeError("trading must be a PaperTradingEngine")
        self.trading = trading
