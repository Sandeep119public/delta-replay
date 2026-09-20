import uuid

from fastapi.testclient import TestClient

from app.main import app


def test_csv_upload_can_feed_the_replay_loader():
    client = TestClient(app)
    headers = {"X-Session-ID": str(uuid.uuid4())}
    csv = (
        "time,open,high,low,close,volume\n"
        "1,100,102,99,101,10\n"
        "2,101,103,100,102,11\n"
    )

    uploaded = client.post(
        "/api/v1/data/csv",
        headers=headers,
        files={"file": ("market.csv", csv, "text/csv")},
    )

    assert uploaded.status_code == 200
    candles = uploaded.json()["candles"]
    assert uploaded.json()["count"] == 2

    loaded = client.post(
        "/api/v1/replay/load",
        headers=headers,
        json={"candles": candles},
    )

    assert loaded.status_code == 200
    assert loaded.json()["total"] == 2
    assert loaded.json()["index"] == -1
    assert loaded.json()["status"] == "ready"
