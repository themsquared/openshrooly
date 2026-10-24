import base64
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("HUB_DATA_DIR", str(Path("/tmp/openshrooly-hub-auth-test")))
os.environ.setdefault("OPENSHROOLY_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))
os.environ.setdefault("HUB_ENABLE_PSILOCYBIN", "0")
os.environ.setdefault("HUB_ADMIN_PASSWORD", "test-admin-9x")

from hub.app import app
from hub import auth
from hub import config

PASSWORD = "test-admin-9x"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HUB_ADMIN_PASSWORD", PASSWORD)
    config.DB_PATH = tmp_path / "hub.sqlite"
    config.ENABLE_PSILOCYBIN = False
    config.ADMIN_PASSWORD = PASSWORD
    config.BRIDGE_STATUS_URL = "http://127.0.0.1:1"
    config.BRIDGE_STATUS_FILE = ""
    with TestClient(app) as test_client:
        yield test_client


def _login(client, password=PASSWORD, origin="http://testserver", csrf=None):
    client.get("/login")
    token = csrf if csrf is not None else client.cookies.get("hub_csrf")
    headers = {}
    if origin:
        headers["Origin"] = origin
    return client.post(
        "/login",
        data={"username": "admin", "password": password, "csrf": token, "next": "/smart-home"},
        headers=headers,
        follow_redirects=False,
    )


def test_unauthenticated_pairing_api_is_401(client):
    response = client.get("/api/smart-home/pairing")
    assert response.status_code == 401
    body = response.json()
    assert body["ok"] is False
    assert "qr" not in body
    assert "manual_code" not in body
    assert "WWW-Authenticate" in response.headers


def test_unauthenticated_smart_home_page_redirects_to_login(client):
    response = client.get("/smart-home", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"].startswith("/login")
    assert b"MT:" not in response.content
    assert b"pairing-code" not in response.content


def test_wrong_password_is_refused(client):
    page = _login(client, password="nope")
    assert page.status_code == 200
    assert b"Wrong user name or password" in page.content
    assert client.get("/api/smart-home/pairing").status_code == 401


def test_login_without_csrf_is_403(client):
    client.get("/login")
    response = client.post(
        "/login",
        data={"username": "admin", "password": PASSWORD, "csrf": "bogus"},
        headers={"Origin": "http://testserver"},
    )
    assert response.status_code == 403


def test_login_from_other_origin_is_403(client):
    response = _login(client, origin="http://evil.example")
    assert response.status_code == 403


def test_session_login_can_read_pairing_when_bridge_is_down(client):
    assert _login(client).status_code == 303
    response = client.get("/api/smart-home/pairing")
    assert response.status_code == 503
    page = client.get("/smart-home")
    assert page.status_code == 200
    assert b"Matter bridge is not running" in page.content
    assert b"Shown after you sign in" not in page.content


def test_basic_auth_matches_chamber_login(client):
    token = base64.b64encode(f"admin:{PASSWORD}".encode()).decode()
    response = client.get("/api/smart-home/pairing", headers={"Authorization": f"Basic {token}"})
    assert response.status_code == 503


def test_commissioned_pairing_hides_codes():
    visible = auth.public_pairing(
        {"ok": True, "reachable": True, "commissioned": False, "qr": "MT:ABC", "manual_code": "123-456"}
    )
    hidden = auth.public_pairing(
        {"ok": True, "reachable": True, "commissioned": True, "qr": "MT:ABC", "manual_code": "123-456"}
    )
    assert visible["qr"] == "MT:ABC"
    assert hidden["qr"] is None
    assert hidden["manual_code"] is None
    assert hidden["commissioned"] is True


def test_password_file_is_created_when_env_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    password = auth.admin_password()
    assert len(password) == 12
    saved = json.loads((tmp_path / "admin.json").read_text())
    assert saved["username"] == "admin"
    assert saved["password"] == password
    assert auth.admin_password() == password
