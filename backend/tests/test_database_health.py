from unittest.mock import patch

from fastapi.testclient import TestClient

from app.database import engine
from app.main import app


def test_health_endpoint_reports_database_connection():
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    database = response.json()["database"]
    assert database["status"] == "connected"
    assert database["type"] == engine.dialect.name
    if engine.dialect.name == "sqlite":
        assert database["journal_mode"] == "wal"
        assert database["foreign_keys"] is True
        assert database["busy_timeout_ms"] == 30000
        assert database["synchronous"] == 2
        assert database["deployment_mode"] == "single_host"
        assert database["network_shared_database_supported"] is False
    else:
        assert database["deployment_mode"] == "multi_host"
        assert database["network_shared_database_supported"] is True


def test_health_endpoint_reports_database_unavailable_without_leaking_details():
    with patch.object(engine, "connect", side_effect=RuntimeError("private connection detail")):
        with TestClient(app) as client:
            response = client.get("/api/health")

    assert response.status_code == 503
    assert response.json() == {
        "status": "degraded",
        "application": "SchoolBridge",
        "version": "0.2.0",
        "database": {"status": "unavailable", "type": engine.dialect.name},
    }
    assert "private connection detail" not in response.text
