import json
import os
from pathlib import Path

import pytest

os.environ.setdefault("HUB_DATA_DIR", str(Path("/tmp/openshrooly-hub-smart-home-test")))
os.environ.setdefault("OPENSHROOLY_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))
os.environ.setdefault("HUB_ENABLE_PSILOCYBIN", "0")

from fastapi.testclient import TestClient

from hub.app import app
from hub.smart_home import (
    NEEDS_WATER_THRESHOLD_PCT,
    chamber_from_device,
    needs_water,
    pairing_qr_svg,
    smart_home_state,
)


def _device(status, **extra):
    row = {
        "id": extra.pop("id", 1),
        "name": extra.pop("name", "Kitchen"),
        "host": "192.168.1.20",
        "port": 80,
        "last_status": json.dumps(status),
        "mac": extra.pop("mac", None),
    }
    row.update(extra)
    return row


def _status(online=True, temperature=22.14, humidity=87.6, water=42, light="ON"):
    entities = {}
    if temperature is not None:
        entities["temperature"] = {"value": temperature}
    if humidity is not None:
        entities["humidity"] = {"state": str(humidity)}
    if water is not None:
        entities["water_level"] = {"value": water}
    if light is not None:
        entities["grow_lights"] = {"state": light}
    return {"online": online, "entities": entities}


def test_needs_water_threshold_matches_chamber_banner():
    assert NEEDS_WATER_THRESHOLD_PCT == 15
    assert needs_water(14.9) is True
    assert needs_water(15) is False
    assert needs_water(40) is False
    assert needs_water(None) is None


def test_chamber_mapping_online():
    chamber = chamber_from_device(_device(_status()))
    assert chamber["id"] == 1
    assert chamber["name"] == "Kitchen"
    assert chamber["mac"] is None
    assert chamber["online"] is True
    assert chamber["temperature_c"] == 22.1
    assert chamber["humidity_pct"] == 87.6
    assert chamber["water_pct"] == 42
    assert chamber["needs_water"] is False
    assert chamber["light_on"] is True


def test_chamber_mapping_needs_water_and_unknown_light():
    chamber = chamber_from_device(_device(_status(water=8, light=None)))
    assert chamber["needs_water"] is True
    assert chamber["light_on"] is None


def test_offline_chamber_clears_derived_flags():
    chamber = chamber_from_device(_device(_status(online=False, water=4)))
    assert chamber["online"] is False
    assert chamber["temperature_c"] == 22.1
    assert chamber["needs_water"] is None
    assert chamber["light_on"] is None


def test_missing_status_is_offline():
    chamber = chamber_from_device(
        {"id": 2, "name": "Shed", "last_status": None, "mac": None}
    )
    assert chamber["online"] is False
    assert chamber["temperature_c"] is None
    assert chamber["needs_water"] is None


def test_invalid_entity_values_become_none():
    chamber = chamber_from_device(
        _device({"online": True, "entities": {"temperature": {"state": "unavailable"}}})
    )
    assert chamber["temperature_c"] is None
    assert chamber["humidity_pct"] is None


def test_smart_home_state_wraps_rows():
    body = smart_home_state([_device(_status(water=8))])
    assert body["needs_water_threshold_pct"] == 15
    assert body["chambers"][0]["needs_water"] is True


def test_pairing_qr_svg_from_matter_payload():
    svg = pairing_qr_svg("MT:YNJV7VSC00KA0648G00")
    assert svg
    assert "<svg" in svg


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HUB_ADMIN_PASSWORD", "test-admin-9x")
    from hub import config

    config.DB_PATH = tmp_path / "hub.sqlite"
    config.ENABLE_PSILOCYBIN = False
    config.ADMIN_PASSWORD = "test-admin-9x"
    config.BRIDGE_STATUS_URL = "http://127.0.0.1:1"
    config.BRIDGE_STATUS_FILE = ""
    with TestClient(app) as test_client:
        yield test_client


def _login(client):
    client.get("/login")
    token = client.cookies.get("hub_csrf")
    return client.post(
        "/login",
        data={"username": "admin", "password": "test-admin-9x", "csrf": token, "next": "/smart-home"},
        headers={"Origin": "http://testserver"},
        follow_redirects=False,
    )


def test_api_smart_home_state_empty(client):
    body = client.get("/api/smart-home/state").json()
    assert body["chambers"] == []
    assert body["needs_water_threshold_pct"] == 15


def test_api_smart_home_state_from_saved_device(client):
    conn = client.app.state.conn
    conn.execute(
        "INSERT INTO devices (name, host, port, added_at, last_status) VALUES (?, ?, ?, ?, ?)",
        ("Kitchen", "10.0.0.8", 80, "2026-01-01T00:00:00+00:00", json.dumps(_status(water=9))),
    )
    conn.commit()
    body = client.get("/api/smart-home/state").json()
    assert len(body["chambers"]) == 1
    chamber = body["chambers"][0]
    assert chamber["name"] == "Kitchen"
    assert chamber["online"] is True
    assert chamber["needs_water"] is True
    assert chamber["temperature_c"] == 22.1


def test_pairing_endpoint_is_503_when_bridge_is_down(client):
    assert _login(client).status_code == 303
    response = client.get("/api/smart-home/pairing")
    assert response.status_code == 503
    assert response.json()["reachable"] is False


def test_smart_home_page_names_missing_bridge(client):
    assert _login(client).status_code == 303
    page = client.get("/smart-home")
    assert page.status_code == 200
    assert b"Matter bridge is not running" in page.content
    assert b"Apple Home" in page.content
    assert b"Google Home" in page.content


def test_pairing_without_login_is_refused(client):
    response = client.get("/api/smart-home/pairing")
    assert response.status_code == 401
    page = client.get("/smart-home", follow_redirects=False)
    assert page.status_code == 303
