import os
from fastapi.testclient import TestClient

def test_health_endpoint():
    from app.main import app
    client=TestClient(app)
    response=client.get("/health")
    assert response.status_code==200

def test_cors_origins_are_environment_configurable(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS","https://app.example.com")
    import importlib
    import app.main
    module=importlib.reload(app.main)
    assert module.origins==["https://app.example.com"]
