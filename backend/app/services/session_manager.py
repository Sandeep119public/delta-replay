from dataclasses import dataclass, field
import os
from threading import RLock
from uuid import UUID

from fastapi import HTTPException, Request

from .paper_engine import PaperTradingEngine
from .replay_service import ReplayService
from .session_repository import InMemorySessionRepository, SessionRepository
from .session_state import restore_session, serialize_session


SESSION_HEADER = "X-Session-ID"


@dataclass
class SessionState:
    replay: ReplayService = field(default_factory=ReplayService)
    trading: PaperTradingEngine = field(default_factory=PaperTradingEngine)


class SessionManager:
    def __init__(self, repository: SessionRepository | None = None):
        self.repository = repository or self._repository_from_environment()
        self._sessions = {}
        self._lock = RLock()

    @staticmethod
    def _repository_from_environment() -> SessionRepository:
        database_url = os.getenv("DATABASE_URL", "").strip()
        if database_url:
            from .postgres_session_repository import PostgresSessionRepository

            return PostgresSessionRepository(database_url)
        return InMemorySessionRepository()

    def _validate_session_id(self, session_id: str) -> None:
        try:
            UUID(session_id)
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(status_code=400, detail=f"{SESSION_HEADER} must be a valid UUID")

    def get(self, session_id: str) -> SessionState:
        self._validate_session_id(session_id)
        with self._lock:
            session = self._sessions.get(session_id)
            if session is not None:
                return session

            document = self.repository.get(session_id)
            if document is None:
                session = SessionState()
                self.repository.save(session_id, serialize_session(session.replay, session.trading))
            else:
                try:
                    replay, trading = restore_session(document)
                except (TypeError, ValueError, KeyError) as exc:
                    raise RuntimeError(f"unable to restore session state: {exc}") from exc
                session = SessionState(replay=replay, trading=trading)
            self._sessions[session_id] = session
            return session

    def save(self, session_id: str, state: SessionState) -> None:
        self._validate_session_id(session_id)
        document = serialize_session(state.replay, state.trading)
        with self._lock:
            self.repository.save(session_id, document)
            self._sessions[session_id] = state

    def delete(self, session_id: str) -> None:
        self._validate_session_id(session_id)
        with self._lock:
            self._sessions.pop(session_id, None)
            self.repository.delete(session_id)

    def clear_cache(self) -> None:
        """Drop in-process objects without touching the repository."""
        with self._lock:
            self._sessions.clear()


manager = SessionManager()


def get_session(request: Request) -> SessionState:
    session_id = request.headers.get(SESSION_HEADER, "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail=f"{SESSION_HEADER} header is required")
    return manager.get(session_id)
