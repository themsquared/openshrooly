"""Prove the hub can read bridge status the way compose wires it."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from hub import config
from hub.app import fetch_bridge_status


COMPOSE = Path(__file__).resolve().parents[1] / "docker-compose.yml"


class _StatusHandler(BaseHTTPRequestHandler):
    payload = {"commissioned": False, "qr": "MT:TEST", "manual_code": "111-222", "chambers": 1}

    def do_GET(self):
        if self.path.split("?")[0] != "/status":
            self.send_error(404)
            return
        body = json.dumps(self.payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


def test_compose_keeps_status_off_the_lan():
    text = COMPOSE.read_text(encoding="utf-8")
    assert text.count("network_mode: host") >= 2
    assert "BRIDGE_STATUS_URL: http://127.0.0.1:8091" in text
    assert "BRIDGE_STATUS_BIND: \"127.0.0.1\"" in text
    assert "BRIDGE_STATUS_FILE: /shared/status.json" in text
    assert "host.docker.internal" not in text
    assert "0.0.0.0" not in text


def test_hub_reads_status_file_used_by_compose(tmp_path, monkeypatch):
    status_path = tmp_path / "status.json"
    status_path.write_text(
        json.dumps({"commissioned": False, "qr": "MT:FILE", "manual_code": "333-444", "chambers": 2}),
        encoding="utf-8",
    )
    monkeypatch.setattr(config, "BRIDGE_STATUS_FILE", str(status_path))
    monkeypatch.setattr(config, "BRIDGE_STATUS_URL", "http://127.0.0.1:1")
    body = fetch_bridge_status()
    assert body["reachable"] is True
    assert body["qr"] == "MT:FILE"
    assert body["chambers"] == 2


def test_hub_reaches_loopback_status_http(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), _StatusHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        monkeypatch.setattr(config, "BRIDGE_STATUS_FILE", "")
        monkeypatch.setattr(config, "BRIDGE_STATUS_URL", f"http://{host}:{port}")
        body = fetch_bridge_status()
        assert body["reachable"] is True
        assert body["qr"] == "MT:TEST"
        assert body["manual_code"] == "111-222"
    finally:
        server.shutdown()
        server.server_close()
