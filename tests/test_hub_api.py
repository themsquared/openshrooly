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
    config.DATA_DIR = tmp_path
    config.ENABLE_PSILOCYBIN = False
    config.ADMIN_PASSWORD = "test-admin-9x"
    auth.reset_login_guard()
    auth.reset_sessions()
    with TestClient(app) as test_client:
        yield test_client
    auth.reset_login_guard()
    auth.reset_sessions()


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


def test_push_sends_only_authored_profiles(client):
    from hub.app import all_profiles, authored_profiles
    from hub import db as hubdb

    conn = client.app.state.conn
    seed_ids = {profile.id for profile in all_profiles(conn)}
    assert "pearl-oyster" in seed_ids
    assert authored_profiles(conn) == []

    assert _login(client).status_code == 303
    pearl = client.get("/api/profiles/pearl-oyster").json()
    pearl["id"] = "pearl-oyster-authored"
    pearl["name"] = "Pearl authored"
    token = client.cookies.get("hub_csrf")
    res = client.post(
        "/profiles/import",
        data={"document": __import__("json").dumps(pearl), "csrf": token},
        headers={"Origin": "http://testserver"},
        follow_redirects=False,
    )
    assert res.status_code == 303
    authored = authored_profiles(conn)
    assert {profile.id for profile in authored} == {"pearl-oyster-authored"}
    assert "pearl-oyster" not in {profile.id for profile in authored}

    hubdb.upsert_profile(conn, "pulled-oyster", pearl, "community")
    assert "pulled-oyster" not in {profile.id for profile in authored_profiles(conn)}


def test_pull_keeps_authored_source(client, monkeypatch):
    import json
    import urllib.request

    from hub import config

    assert _login(client).status_code == 303
    pearl = client.get("/api/profiles/pearl-oyster").json()
    pearl["id"] = "pearl-oyster-authored"
    pearl["name"] = "Pearl authored"
    token = client.cookies.get("hub_csrf")
    imported = client.post(
        "/profiles/import",
        data={"document": json.dumps(pearl), "csrf": token},
        headers={"Origin": "http://testserver"},
        follow_redirects=False,
    )
    assert imported.status_code == 303
    conn = client.app.state.conn
    assert conn.execute("SELECT source FROM profiles WHERE id=?", ("pearl-oyster-authored",)).fetchone()["source"] == "import"

    pulled = dict(pearl)
    pulled["author"] = "hub-user"
    body = json.dumps({"hub_user": "hub-user", "profiles": [pulled]}).encode()

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return body

    monkeypatch.setattr(config, "COMMUNITY_TOKEN", "test-token")
    monkeypatch.setattr(urllib.request, "urlopen", lambda *args, **kwargs: FakeResp())
    token = client.cookies.get("hub_csrf")
    pull = client.post(
        "/sync/pull",
        data={"csrf": token},
        headers={"Origin": "http://testserver"},
        follow_redirects=False,
    )
    assert pull.status_code == 303
    assert conn.execute("SELECT source FROM profiles WHERE id=?", ("pearl-oyster-authored",)).fetchone()["source"] == "import"


def test_species_photo_picks_specific_harvest_shots():
    from hub.species_art import species_photo

    assert species_photo("Pleurotus ostreatus var. columbinus", "Blue", "Blue Oyster").endswith("species-blue-oyster.jpg")
    assert species_photo("Hypsizygus tessulatus", "Brown beech", "Beech / Buna Shimeji").endswith("species-beech.jpg")
    assert species_photo("Agaricus bisporus", "Brown cremini", "Button / Cremini").endswith("species-cremini.jpg")
    assert species_photo("Unknownia fictionalis", "", "Mystery").endswith("species-generic.jpg")


def test_script_payload_in_summary_stays_text_and_pages_send_csp(client):
    import json

    from openshrooly_lib.webutil import json_dumps

    payload = "hi </script><script>window.__pwn=1</script>"
    encoded = json_dumps({"summary": payload})
    assert "</script>" not in encoded
    assert "\\u003c/script\\u003e" in encoded
    assert json.loads(encoded)["summary"] == payload

    assert _login(client).status_code == 303
    pearl = client.get("/api/profiles/pearl-oyster").json()
    pearl["id"] = "xss-oyster"
    pearl["name"] = "XSS oyster"
    pearl["summary"] = payload
    token = client.cookies.get("hub_csrf")
    imported = client.post(
        "/profiles/import",
        data={"document": json.dumps(pearl), "csrf": token},
        headers={"Origin": "http://testserver"},
        follow_redirects=False,
    )
    assert imported.status_code == 303
    listing = client.get("/profiles")
    edit = client.get("/profiles/xss-oyster/edit")
    for page in (listing, edit):
        assert page.headers.get("content-security-policy", "").startswith("default-src 'self'")
        assert "script-src 'self'" in page.headers.get("content-security-policy", "")
        assert "</script><script>" not in page.text
        assert "window.__pwn" in page.text
        assert "\\u003c/script\\u003e" in page.text or "\\u003cscript\\u003e" in page.text


def test_profile_edit_form_saves_with_csrf(client):
    import json

    assert _login(client).status_code == 303
    edit = client.get("/profiles/pearl-oyster/edit")
    assert edit.status_code == 200
    assert 'name="csrf"' in edit.text
    pearl = client.get("/api/profiles/pearl-oyster").json()
    pearl["name"] = "Pearl saved"
    token = client.cookies.get("hub_csrf")
    saved = client.post(
        "/profiles/import",
        data={"document": json.dumps(pearl), "csrf": token},
        headers={"Origin": "http://testserver"},
        follow_redirects=False,
    )
    assert saved.status_code == 303
    assert client.get("/api/profiles/pearl-oyster").json()["name"] == "Pearl saved"
