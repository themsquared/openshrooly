import os
from pathlib import Path

import pytest

os.environ.setdefault("HUB_DATA_DIR", str(Path("/tmp/openshrooly-hub-test")))
os.environ.setdefault("OPENSHROOLY_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))
os.environ.setdefault("HUB_ENABLE_PSILOCYBIN", "0")
os.environ.setdefault("HUB_ADMIN_PASSWORD", "test-admin-9x")

from fastapi.testclient import TestClient

from hub.app import app
from hub import auth
from hub import config


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HUB_ADMIN_PASSWORD", "test-admin-9x")
    config.DB_PATH = tmp_path / "hub.sqlite"
    config.ENABLE_PSILOCYBIN = False
    config.ADMIN_PASSWORD = "test-admin-9x"
    auth.reset_login_guard()
    with TestClient(app) as test_client:
        yield test_client
    auth.reset_login_guard()


def _login(client):
    client.get("/login")
    token = client.cookies.get("hub_csrf")
    return client.post(
        "/login",
        data={"username": "admin", "password": "test-admin-9x", "csrf": token, "next": "/smart-home"},
        headers={"Origin": "http://testserver"},
        follow_redirects=False,
    )


def test_health_and_seeded_profiles(client):
    assert client.get("/health").json()["ok"] is True
    profiles = client.get("/api/profiles").json()
    ids = {row["id"] for row in profiles}
    assert "pearl-oyster" in ids
    assert "golden-teacher" not in ids


def test_import_and_export_json(client):
    assert _login(client).status_code == 303
    pearl = client.get("/api/profiles/pearl-oyster").json()
    pearl["id"] = "pearl-oyster-copy"
    pearl["name"] = "Pearl copy"
    token = client.cookies.get("hub_csrf")
    res = client.post(
        "/profiles/import",
        data={"document": __import__("json").dumps(pearl), "csrf": token},
        headers={"Origin": "http://testserver"},
        follow_redirects=False,
    )
    assert res.status_code == 303
    exported = client.get("/api/profiles/pearl-oyster-copy").json()
    assert exported["id"] == "pearl-oyster-copy"


def test_rejects_psilocybin_when_disabled(client):
    assert _login(client).status_code == 303
    raw = Path(__file__).resolve().parents[1].joinpath("data/profiles/psilocybin/golden-teacher.json").read_text()
    token = client.cookies.get("hub_csrf")
    page = client.post(
        "/profiles/import",
        data={"document": raw, "csrf": token},
        headers={"Origin": "http://testserver"},
    )
    assert page.status_code == 200
    assert b"disabled" in page.content


def test_species_photo_picks_specific_harvest_shots():
    from hub.species_art import species_photo

    assert species_photo("Pleurotus ostreatus var. columbinus", "Blue", "Blue Oyster").endswith("species-blue-oyster.jpg")
    assert species_photo("Hypsizygus tessulatus", "Brown beech", "Beech / Buna Shimeji").endswith("species-beech.jpg")
    assert species_photo("Agaricus bisporus", "Brown cremini", "Button / Cremini").endswith("species-cremini.jpg")
    assert species_photo("Unknownia fictionalis", "", "Mystery").endswith("species-generic.jpg")
