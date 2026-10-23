import os
from pathlib import Path

import pytest

os.environ.setdefault("HUB_DATA_DIR", str(Path("/tmp/openshrooly-hub-test")))
os.environ.setdefault("OPENSHROOLY_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))
os.environ.setdefault("HUB_ENABLE_PSILOCYBIN", "0")

from fastapi.testclient import TestClient

from hub.app import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DATA_DIR", str(tmp_path))
    from hub import config
    from hub import db as hubdb

    config.DB_PATH = tmp_path / "hub.sqlite"
    config.ENABLE_PSILOCYBIN = False
    with TestClient(app) as test_client:
        yield test_client


def test_health_and_seeded_profiles(client):
    assert client.get("/health").json()["ok"] is True
    profiles = client.get("/api/profiles").json()
    ids = {row["id"] for row in profiles}
    assert "pearl-oyster" in ids
    assert "golden-teacher" not in ids


def test_import_and_export_json(client):
    pearl = client.get("/profiles/pearl-oyster.json").json()
    pearl["id"] = "pearl-oyster-copy"
    pearl["name"] = "Pearl copy"
    res = client.post("/profiles/import", data={"document": __import__("json").dumps(pearl)}, follow_redirects=False)
    assert res.status_code in {303, 200}
    exported = client.get("/profiles/pearl-oyster-copy.json").json()
    assert exported["id"] == "pearl-oyster-copy"


def test_rejects_psilocybin_when_disabled(client):
    raw = Path(__file__).resolve().parents[1].joinpath("data/profiles/psilocybin/golden-teacher.json").read_text()
    page = client.post("/profiles/import", data={"document": raw})
    assert page.status_code == 200
    assert b"disabled" in page.content
