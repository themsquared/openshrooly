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
    pearl = client.get("/api/profiles/pearl-oyster").json()
    pearl["id"] = "pearl-oyster-copy"
    pearl["name"] = "Pearl copy"
    res = client.post("/profiles/import", data={"document": __import__("json").dumps(pearl)}, follow_redirects=False)
    assert res.status_code == 303
    exported = client.get("/api/profiles/pearl-oyster-copy").json()
    assert exported["id"] == "pearl-oyster-copy"


def test_rejects_psilocybin_when_disabled(client):
    raw = Path(__file__).resolve().parents[1].joinpath("data/profiles/psilocybin/golden-teacher.json").read_text()
    page = client.post("/profiles/import", data={"document": raw})
    assert page.status_code == 200
    assert b"disabled" in page.content


def test_push_sends_only_authored_profiles(client):
    from hub.app import all_profiles, authored_profiles
    from hub import db as hubdb

    conn = client.app.state.conn
    seed_ids = {profile.id for profile in all_profiles(conn)}
    assert "pearl-oyster" in seed_ids
    assert authored_profiles(conn) == []

    pearl = client.get("/api/profiles/pearl-oyster").json()
    pearl["id"] = "pearl-oyster-authored"
    pearl["name"] = "Pearl authored"
    res = client.post("/profiles/import", data={"document": __import__("json").dumps(pearl)}, follow_redirects=False)
    assert res.status_code == 303
    authored = authored_profiles(conn)
    assert {profile.id for profile in authored} == {"pearl-oyster-authored"}
    assert "pearl-oyster" not in {profile.id for profile in authored}

    hubdb.upsert_profile(conn, "pulled-oyster", pearl, "community")
    assert "pulled-oyster" not in {profile.id for profile in authored_profiles(conn)}

    authored_doc = authored[0].to_dict()
    authored_doc["author"] = "hub-user"
    existing = conn.execute("SELECT source FROM profiles WHERE id=?", ("pearl-oyster-authored",)).fetchone()
    assert existing["source"] == "import"
    source = existing["source"]
    hub_user = "hub-user"
    if source and source not in ("seed", "community"):
        kept = source
    elif hub_user and authored_doc.get("author") == hub_user:
        kept = "import"
    else:
        kept = "community"
    hubdb.upsert_profile(conn, "pearl-oyster-authored", authored_doc, kept)
    assert conn.execute("SELECT source FROM profiles WHERE id=?", ("pearl-oyster-authored",)).fetchone()["source"] == "import"
    assert "pearl-oyster-authored" in {profile.id for profile in authored_profiles(conn)}


def test_species_photo_picks_specific_harvest_shots():
    from hub.species_art import species_photo

    assert species_photo("Pleurotus ostreatus var. columbinus", "Blue", "Blue Oyster").endswith("species-blue-oyster.jpg")
    assert species_photo("Hypsizygus tessulatus", "Brown beech", "Beech / Buna Shimeji").endswith("species-beech.jpg")
    assert species_photo("Agaricus bisporus", "Brown cremini", "Button / Cremini").endswith("species-cremini.jpg")
    assert species_photo("Unknownia fictionalis", "", "Mystery").endswith("species-generic.jpg")
