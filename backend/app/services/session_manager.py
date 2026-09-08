from dataclasses import dataclass, field
from threading import RLock
from uuid import UUID
from fastapi import HTTPException, Request

from .replay_service import ReplayService
from .paper_engine import PaperTradingEngine


SESSION_HEADER = "X-Session-ID"


@dataclass
class SessionState:
    replay: ReplayService = field(default_factory=ReplayService)
    trading: PaperTradingEngine = field(default_factory=PaperTradingEngine)


class SessionManager:
    def __init__(self):
        self._sessions = {}
        self._lock = RLock()

    def get(self, session_id: str) -> SessionState:
        try:
            UUID(session_id)
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(status_code=400, detail=f"{SESSION_HEADER} must be a valid UUID")

        with self._lock:
            return self._sessions.setdefault(session_id, SessionState())


manager = SessionManager()


def get_session(request: Request) -> SessionState:
    session_id = request.headers.get(SESSION_HEADER, "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail=f"{SESSION_HEADER} header is required")
    return manager.get(session_id)
