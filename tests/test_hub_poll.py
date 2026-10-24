import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("HUB_DATA_DIR", str(Path("/tmp/openshrooly-hub-poll-test")))
os.environ.setdefault("OPENSHROOLY_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))
os.environ.setdefault("HUB_ENABLE_PSILOCYBIN", "0")
os.environ.setdefault("HUB_ADMIN_PASSWORD", "test-admin-9x")

from openshrooly_lib.device import ESPHomeDeviceClient

from hub import auth
from hub import config
from hub.app import app, poll_once


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HUB_ADMIN_PASSWORD", "test-admin-9x")
    config.DB_PATH = tmp_path / "hub.sqlite"
    config.DATA_DIR = tmp_path
    config.ENABLE_PSILOCYBIN = False
    config.ADMIN_PASSWORD = "test-admin-9x"
    config.BRIDGE_STATUS_URL = "http://127.0.0.1:1"
    config.BRIDGE_STATUS_FILE = ""
    auth.reset_login_guard()
    auth.reset_sessions()
    with TestClient(app) as test_client:
        yield test_client
    auth.reset_login_guard()
    auth.reset_sessions()


class _StatusHandler(BaseHTTPRequestHandler):
    payload = {"manual_code": "349-701-1234", "qr": "MT:SECRETPAIR"}

    def do_GET(self):
        body = json.dumps(self.payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


class _RedirectHandler(BaseHTTPRequestHandler):
    target = ""

    def do_GET(self):
        self.send_response(302)
        self.send_header("Location", self.target)
        self.end_headers()

    def log_message(self, *_args):
        return


def _serve(handler, host="127.0.0.1"):
    server = ThreadingHTTPServer((host, 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def test_device_client_refuses_redirect_to_loopback():
    status_server = _serve(_StatusHandler)
    try:
        _RedirectHandler.target = f"http://127.0.0.1:{status_server.server_address[1]}/status"
        redirect_server = _serve(_RedirectHandler)
        try:
            host, port = redirect_server.server_address
            chamber = ESPHomeDeviceClient(f"http://{host}:{port}")
            status = chamber.fetch_status()
            blob = json.dumps(status)
            assert status["online"] is False
            assert "MT:SECRETPAIR" not in blob
            assert "349-701-1234" not in blob
            assert "manual_code" not in blob
            assert "qr" not in blob
        finally:
            redirect_server.shutdown()
            redirect_server.server_close()
    finally:
        status_server.shutdown()
        status_server.server_close()


def test_api_devices_never_returns_status_or_pairing(client):
    conn = client.app.state.conn
    conn.execute(
        "INSERT INTO devices (name, host, port, added_at, last_status) VALUES (?, ?, ?, ?, ?)",
        (
            "Kitchen",
            "192.168.1.50",
            80,
            "2026-01-01T00:00:00+00:00",
            json.dumps(
                {
                    "online": True,
                    "qr": "MT:SECRETPAIR",
                    "manual_code": "349-701-1234",
                    "entities": {"temperature": {"value": 21}},
                }
            ),
        ),
    )
    conn.commit()
    body = client.get("/api/devices").json()
    assert len(body) == 1
    assert "last_status" not in body[0]
    blob = json.dumps(body)
    assert "MT:SECRETPAIR" not in blob
    assert "349-701-1234" not in blob
    assert "qr" not in blob
    assert "manual_code" not in blob
    home = client.get("/")
    assert home.status_code == 200
    assert b"MT:SECRETPAIR" not in home.content
    assert b"349-701-1234" not in home.content


def test_poll_once_continues_after_blocked_and_unresolvable(client, monkeypatch):
    conn = client.app.state.conn
    conn.execute(
        "INSERT INTO devices (name, host, port, added_at) VALUES (?, ?, ?, ?)",
        ("Blocked", "127.0.0.1", 80, "2026-01-01T00:00:00+00:00"),
    )
    conn.execute(
        "INSERT INTO devices (name, host, port, added_at) VALUES (?, ?, ?, ?)",
        ("Ghost", "offline-chamber.local", 80, "2026-01-01T00:00:00+00:00"),
    )
    conn.execute(
        "INSERT INTO devices (name, host, port, added_at) VALUES (?, ?, ?, ?)",
        ("Kitchen", "192.168.1.50", 80, "2026-01-01T00:00:00+00:00"),
    )
    conn.commit()

    class _Good:
        def fetch_status(self):
            return {"online": True, "entities": {"temperature": {"value": 21.5}}}

    from hub import app as hub_app

    real = hub_app.device_client

    def fake_client(row):
        if row["host"] == "192.168.1.50":
            return _Good()
        return real(row)

    monkeypatch.setattr(hub_app, "device_client", fake_client)
    poll_once(conn)
    rows = {row["name"]: json.loads(row["last_status"] or "{}") for row in conn.execute("SELECT * FROM devices")}
    assert rows["Kitchen"]["online"] is True
    assert rows["Kitchen"]["entities"]["temperature"]["value"] == 21.5
    assert rows["Blocked"]["online"] is False
    assert rows["Blocked"]["blocked"] is True
    assert rows["Ghost"]["online"] is False
    assert rows["Ghost"]["blocked"] is True
    assert "resolved" in rows["Ghost"]["reason"]


def test_device_detail_shows_blocked_state(client):
    conn = client.app.state.conn
    conn.execute(
        "INSERT INTO devices (name, host, port, added_at) VALUES (?, ?, ?, ?)",
        ("Loop", "127.0.0.1", 80, "2026-01-01T00:00:00+00:00"),
    )
    conn.commit()
    device_id = conn.execute("SELECT id FROM devices WHERE name='Loop'").fetchone()["id"]
    page = client.get(f"/devices/{device_id}")
    assert page.status_code == 200
    assert b"Blocked" in page.content
    assert b"not allowed" in page.content
