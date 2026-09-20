"""Small, persistence-neutral experiment model built on deterministic replay."""

from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4


@dataclass
class Experiment:
    """Research metadata that references, but does not mutate, a replay session."""

    name: str
    simulation_id: str
    hypothesis: str = ""
    id: str = field(default_factory=lambda: str(uuid4()))
    annotations: list[dict[str, Any]] = field(default_factory=list)

    def annotate(self, replay_index: int, text: str, kind: str = "observation") -> dict[str, Any]:
        if isinstance(replay_index, bool) or not isinstance(replay_index, int) or replay_index < 0:
            raise ValueError("annotation replay index must be a non-negative integer")
        text = str(text).strip()
        if not text:
            raise ValueError("annotation text is required")
        kind = str(kind).strip() or "observation"
        annotation = {"replayIndex": replay_index, "type": kind, "text": text}
        self.annotations.append(annotation)
        return dict(annotation)

    def export(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "simulationId": self.simulation_id,
            "hypothesis": self.hypothesis,
            "annotations": [dict(item) for item in self.annotations],
        }
