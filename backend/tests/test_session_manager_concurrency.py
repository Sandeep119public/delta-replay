from uuid import uuid4

from app.services.session_manager import SessionManager
from app.services.session_repository import InMemorySessionRepository


def test_clear_cache_cannot_be_undone_by_an_inflight_get(monkeypatch):
    repository = InMemorySessionRepository()
    manager = SessionManager(repository)
    session_id = str(uuid4())
    manager.get(session_id)
    manager.clear_cache()

    original_restore = manager._restore
    entered = False

    def restore(document):
        nonlocal entered
        entered = True
        manager.clear_cache()
        return original_restore(document)

    monkeypatch.setattr(manager, '_restore', restore)
    manager.get(session_id)

    assert entered
    assert session_id not in manager._sessions
