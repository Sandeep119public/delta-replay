from copy import deepcopy
from typing import Any, Callable, Dict, Optional, Protocol, TypeVar


SessionDocument = Dict[str, Any]
T = TypeVar("T")
SessionMutation = Callable[[SessionDocument], tuple[SessionDocument, T]]


class SessionRepository(Protocol):
    """Storage boundary for serialized replay/trading session state."""

    def get(self, session_id: str) -> Optional[SessionDocument]:
        ...

    def save(self, session_id: str, document: SessionDocument) -> None:
        ...

    def delete(self, session_id: str) -> None:
        ...

    def atomic_update(self, session_id: str, mutation: SessionMutation[T]) -> T:
        """Apply one mutation and persist it atomically."""
        ...


class InMemorySessionRepository:
    """Reference repository used by tests and local development."""

    def __init__(self) -> None:
        self._documents: Dict[str, SessionDocument] = {}

    def get(self, session_id: str) -> Optional[SessionDocument]:
        document = self._documents.get(session_id)
        return deepcopy(document) if document is not None else None

    def save(self, session_id: str, document: SessionDocument) -> None:
        self._documents[session_id] = deepcopy(document)

    def delete(self, session_id: str) -> None:
        self._documents.pop(session_id, None)

    def atomic_update(self, session_id: str, mutation: SessionMutation[T]) -> T:
        current = self._documents.get(session_id)
        if current is None:
            raise KeyError(f"session {session_id} not found")
        updated, result = mutation(deepcopy(current))
        self._documents[session_id] = deepcopy(updated)
        return result
