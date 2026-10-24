import base64
import json
import os
import time
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
OLD_DEFAULT_SECRET = "openshrooly-hub-dev-secret"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HUB_ADMIN_PASSWORD", PASSWORD)
    config.DB_PATH = tmp_path / "hub.sqlite"
    config.DATA_DIR = tmp_path
    config.ENABLE_PSILOCYBIN = False
    config.ADMIN_PASSWORD = PASSWORD
    config.BRIDGE_STATUS_URL = "http://127.0.0.1:1"
    config.BRIDGE_STATUS_FILE = ""
    auth.reset_login_guard()
    auth.reset_sessions()
    with TestClient(app) as test_client:
        yield test_client
    auth.reset_login_guard()
    auth.reset_sessions()


def _login(client, password=PASSWORD, origin="http://testserver", csrf=None, next_path="/smart-home"):
    client.get("/login")
    token = csrf if csrf is not None else client.cookies.get("hub_csrf")
    headers = {}
    if origin:
        headers["Origin"] = origin
    return client.post(
        "/login",
        data={"username": "admin", "password": password, "csrf": token, "next": next_path},
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
    path = tmp_path / "admin.json"
    saved = json.loads(path.read_text())
    assert saved["username"] == "admin"
    assert saved["password"] == password
    assert auth.admin_password() == password
    assert path.stat().st_mode & 0o777 == 0o600


def test_old_default_secret_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_SECRET", OLD_DEFAULT_SECRET)
    with pytest.raises(config.InsecureHubSecret, match="published default"):
        config.resolve_secret(tmp_path)


def test_stored_old_default_secret_is_refused(tmp_path, monkeypatch):
    monkeypatch.delenv("HUB_SECRET", raising=False)
    path = tmp_path / "hub.secret"
    path.write_text(OLD_DEFAULT_SECRET + "\n", encoding="utf-8")
    with pytest.raises(config.InsecureHubSecret, match="published default"):
        config.resolve_secret(tmp_path)


def test_generated_secret_file_is_private(tmp_path, monkeypatch):
    monkeypatch.delenv("HUB_SECRET", raising=False)
    secret = config.resolve_secret(tmp_path)
    path = tmp_path / "hub.secret"
    assert path.is_file()
    assert path.stat().st_mode & 0o777 == 0o600
    assert secret == path.read_text(encoding="utf-8").strip()
    assert secret != OLD_DEFAULT_SECRET
    assert config.resolve_secret(tmp_path) == secret


def test_cookie_signed_with_old_default_secret_is_rejected(client):
    expiry = int(time.time()) + auth.SESSION_TTL_S
    forged = auth.sign_with_secret(f"{auth.ADMIN_USER}:{expiry}", OLD_DEFAULT_SECRET)
    response = client.get("/api/smart-home/pairing", cookies={auth.SESSION_COOKIE: forged})
    assert response.status_code == 401
    body = response.json()
    assert body["ok"] is False
    assert "qr" not in body
    assert "manual_code" not in body


def test_safe_next_path_is_same_origin_only():
    assert auth.safe_next_path("/smart-home") == "/smart-home"
    assert auth.safe_next_path("/devices/1") == "/devices/1"
    assert auth.safe_next_path("//evil.example") == "/smart-home"
    assert auth.safe_next_path("/\\evil.example") == "/smart-home"
    assert auth.safe_next_path("https://evil.example") == "/smart-home"
    assert auth.safe_next_path("evil.example") == "/smart-home"
    assert auth.safe_next_path("///evil.example") == "/smart-home"


def test_login_rejects_protocol_relative_next(client):
    response = _login(client, next_path="//evil.example")
    assert response.status_code == 303
    assert response.headers["location"] == "/smart-home"


def test_login_get_sanitizes_protocol_relative_next(client):
    page = client.get("/login", params={"next": "//evil.example"})
    assert page.status_code == 200
    assert b'name="next" value="//evil.example"' not in page.content
    assert b'name="next" value="/smart-home"' in page.content


def test_per_ip_login_lockout(client):
    for _ in range(auth.LOGIN_IP_MAX_FAILURES - 1):
        page = _login(client, password="nope")
        assert page.status_code == 200
    locked = _login(client, password="nope")
    assert locked.status_code == 429
    assert locked.headers["retry-after"]
    still = _login(client, password=PASSWORD)
    assert still.status_code == 429


def test_global_failures_do_not_lock_other_ips(client):
    now = time.time()
    for index in range(auth.LOGIN_GLOBAL_SOFT_MAX + 10):
        auth.LOGIN_GUARD.record_failure(f"203.0.113.{index}", now=now)
    allowed = _login(client, password=PASSWORD)
    assert allowed.status_code == 303


def _basic(client, password=PASSWORD):
    token = base64.b64encode(f"admin:{password}".encode()).decode()
    return client.get("/api/smart-home/pairing", headers={"Authorization": f"Basic {token}"})


def test_wrong_basic_passwords_hit_login_guard(client):
    for _ in range(auth.LOGIN_IP_MAX_FAILURES - 1):
        page = _basic(client, password="nope")
        assert page.status_code == 401
    locked = _basic(client, password="nope")
    assert locked.status_code == 429
    still = _basic(client, password=PASSWORD)
    assert still.status_code == 429


def test_form_lockout_blocks_correct_basic(client):
    for _ in range(auth.LOGIN_IP_MAX_FAILURES - 1):
        assert _login(client, password="nope").status_code == 200
    assert _login(client, password="nope").status_code == 429
    assert _basic(client, password=PASSWORD).status_code == 429


def test_logout_invalidates_session_server_side(client):
    assert _login(client).status_code == 303
    token = client.cookies.get("hub_session")
    assert token
    csrf = client.cookies.get("hub_csrf")
    client.post(
        "/logout",
        data={"csrf": csrf},
        headers={"Origin": "http://testserver"},
        follow_redirects=False,
    )
    replay = client.get("/api/smart-home/pairing", cookies={auth.SESSION_COOKIE: token})
    assert replay.status_code == 401


def test_testserver_is_not_a_builtin_allowed_host():
    assert "testserver" not in config.parse_allowed_hosts("")
    assert "testserver" not in config._BUILTIN_ALLOWED_HOSTS


def test_forwarded_headers_are_off_by_default():
    assert config.TRUST_FORWARDED is False


def test_device_add_stores_cleaned_host(client):
    assert _login(client).status_code == 303
    token = client.cookies.get("hub_csrf")
    response = client.post(
        "/devices/add",
        data={"name": "Kitchen", "host": "192.168.1.50:80", "port": "80", "csrf": token},
        headers={"Origin": "http://testserver"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    saved = client.get("/api/devices").json()
    assert saved[0]["host"] == "192.168.1.50"


def test_device_add_rejects_whitespace_hosts(client):
    assert _login(client).status_code == 303
    token = client.cookies.get("hub_csrf")
    for host in ("127.0.0.1%20", "127.0.0.1 ", " 192.168.1.50"):
        response = client.post(
            "/devices/add",
            data={"name": "Nope", "host": host, "port": "80", "csrf": token},
            headers={"Origin": "http://testserver"},
            follow_redirects=False,
        )
        assert response.status_code == 400, host
    assert client.get("/api/devices").json() == []


def test_unknown_host_header_is_rejected(client):
    response = client.get("/health", headers={"Host": "evil.example"})
    assert response.status_code == 400
    assert response.json()["error"] == "unknown_host"


def test_lan_host_header_is_allowed(client):
    response = client.get("/health", headers={"Host": "192.168.1.10:8090"})
    assert response.status_code == 200


def test_basic_auth_write_still_needs_csrf(client):
    basic = base64.b64encode(f"admin:{PASSWORD}".encode()).decode()
    denied = client.post(
        "/devices/add",
        data={"name": "Kitchen", "host": "192.168.1.50", "port": "80"},
        headers={"Authorization": f"Basic {basic}", "Origin": "http://testserver"},
        follow_redirects=False,
    )
    assert denied.status_code == 403
    client.get("/login")
    token = client.cookies.get("hub_csrf")
    allowed = client.post(
        "/devices/add",
        data={"name": "Kitchen", "host": "192.168.1.50", "port": "80", "csrf": token},
        headers={"Authorization": f"Basic {basic}", "Origin": "http://testserver"},
        follow_redirects=False,
    )
    assert allowed.status_code == 303


def test_device_add_without_login_is_401(client):
    response = client.post(
        "/devices/add",
        data={"name": "Kitchen", "host": "192.168.1.50", "port": "80"},
        follow_redirects=False,
    )
    assert response.status_code == 401


def test_device_add_rejects_loopback_and_metadata(client):
    assert _login(client).status_code == 303
    token = client.cookies.get("hub_csrf")
    for host in ("127.0.0.1", "localhost", "169.254.169.254", "169.254.1.1", "metadata.google.internal"):
        response = client.post(
            "/devices/add",
            data={"name": "Nope", "host": host, "port": "80", "csrf": token},
            headers={"Origin": "http://testserver"},
            follow_redirects=False,
        )
        assert response.status_code == 400, host
        assert client.get("/api/devices").json() == []


def test_profile_import_without_login_is_401(client):
    response = client.post("/profiles/import", data={"document": "{}"}, follow_redirects=False)
    assert response.status_code == 401


def test_sync_routes_without_login_are_401(client):
    assert client.post("/sync/push", follow_redirects=False).status_code == 401
    assert client.post("/sync/pull", follow_redirects=False).status_code == 401


def test_device_apply_without_login_is_401(client):
    response = client.post(
        "/devices/1/apply",
        data={"profile_id": "pearl-oyster"},
        follow_redirects=False,
    )
    assert response.status_code == 401
