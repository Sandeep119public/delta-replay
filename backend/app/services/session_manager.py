from dataclasses import dataclass, field
import os
from threading import RLock
from uuid import UUID

from fastapi import HTTPException, Request

from .paper_engine import PaperTradingEngine
from .replay_service import ReplayService
from .session_repository import InMemorySessionRepository, SessionRepository
from .session_state import extract_history, restore_session, serialize_session


SESSION_HEADER = "X-Session-ID"


@dataclass
class SessionState:
    replay: ReplayService = field(default_factory=ReplayService)
    trading: PaperTradingEngine = field(default_factory=PaperTradingEngine)
    history: list[dict] = field(default_factory=list)

    def record(self, command_type: str, replay_index: int, payload: dict):
        self.history = [
            item for item in self.history
            if item.get("replayIndex", -1) <= replay_index or item.get("replayIndex", -1) == replay_index
        ]
        self.history.append({
            "type": command_type,
            "replayIndex": int(replay_index),
            "payload": dict(payload),
        })

    def truncate_future_history(self, replay_index: int):
        self.history = [
            item for item in self.history
            if item.get("replayIndex", -1) <= replay_index
        ]


class SessionManager:
    def __init__(self, repository: SessionRepository | None = None):
        self.repository = repository or self._repository_from_environment()
        self._sessions = {}
        self._session_locks = {}
        self._cache_generation = 0
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

    def _lock_for(self, session_id: str) -> RLock:
        with self._lock:
            return self._session_locks.setdefault(session_id, RLock())

    def get(self, session_id: str) -> SessionState:
        self._validate_session_id(session_id)
        session_lock = self._lock_for(session_id)
        with session_lock:
            with self._lock:
                cache_generation = self._cache_generation
            if not self.repository.durable:
                session = self._sessions.get(session_id)
                if session is not None:
                    return session

            document = self.repository.get(session_id)
            if document is None:
                session = SessionState()
                self.repository.save(
                    session_id,
                    serialize_session(session.replay, session.trading, session.history),
                )
            else:
                session = self._restore(document)

            with self._lock:
                if cache_generation == self._cache_generation:
                    self._sessions[session_id] = session
            return session

    @staticmethod
    def _restore(document) -> SessionState:
        try:
            replay, trading = restore_session(document)
            history = extract_history(document)
        except (TypeError, ValueError, KeyError, RuntimeError) as exc:
            raise RuntimeError(f"unable to restore session state: {exc}") from exc
        return SessionState(replay=replay, trading=trading, history=history)

    def atomic(self, session_id: str, operation):
        """Run a session mutation with one serialized repository commit."""
        self._validate_session_id(session_id)
        session_lock = self._lock_for(session_id)
        with session_lock:
            self._ensure_exists(session_id)
            with self._lock:
                cache_generation = self._cache_generation

            def mutate(document):
                session = self._restore(document)
                result = operation(session)
                return serialize_session(
                    session.replay,
                    session.trading,
                    session.history,
                ), (result, session)

            result, session = self.repository.atomic_update(session_id, mutate)
            with self._lock:
                if cache_generation == self._cache_generation:
                    self._sessions[session_id] = session
            return result

    def _ensure_exists(self, session_id: str) -> None:
        if self.repository.get(session_id) is None:
            session = SessionState()
            self.repository.save(
                session_id,
                serialize_session(session.replay, session.trading, session.history),
            )

    def delete(self, session_id: str) -> None:
        self._validate_session_id(session_id)
        session_lock = self._lock_for(session_id)
        with session_lock:
            self._sessions.pop(session_id, None)
            self.repository.delete(session_id)

    def clear_cache(self) -> None:
        """Drop in-process objects without touching the repository."""
        with self._lock:
            self._cache_generation += 1
            self._sessions.clear()


manager = SessionManager()


def _session_id(request: Request) -> str:
    session_id = request.headers.get(SESSION_HEADER, "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail=f"{SESSION_HEADER} header is required")
    return session_id


def get_session(request: Request) -> SessionState:
    return manager.get(_session_id(request))


def atomic_session(request: Request, operation):
    return manager.atomic(_session_id(request), operation)
