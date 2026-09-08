from copy import deepcopy
from typing import Any, Dict, Optional, Protocol


SessionDocument = Dict[str, Any]


class SessionRepository(Protocol):
    """Storage boundary for serialized replay/trading session state."""

    def get(self, session_id: str) -> Optional[SessionDocument]:
        ...

    def save(self, session_id: str, document: SessionDocument) -> None:
        ...

    def delete(self, session_id: str) -> None:
        ...


class InMemorySessionRepository:
    """Reference repository used by tests and local development.

    Production persistence will replace this implementation without changing
    the session manager or trading/replay domain services.
    """

    def __init__(self) -> None:
        self._documents: Dict[str, SessionDocument] = {}

    def get(self, session_id: str) -> Optional[SessionDocument]:
        document = self._documents.get(session_id)
        return deepcopy(document) if document is not None else None

    def save(self, session_id: str, document: SessionDocument) -> None:
        self._documents[session_id] = deepcopy(document)

    def delete(self, session_id: str) -> None:
        self._documents.pop(session_id, None)
